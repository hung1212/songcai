import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {ledgerReceipt,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {createReceiptPreferences,RECEIPT_PREFERENCES_KEY} from '../src/receipt-preferences.js';

function fixture(text,configure=()=>{}){
  const document={id:'receipt-stakes',name:'测试账单',businessDate:'2026-10-05'},parsed=parseDocument(text,document);
  const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date:document.businessDate,issue:'2026278',numbers:[1,2,3,4,5,6,49]}]));
  const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,defaultOdds()]));
  const inputs={kind:'current',selection:document.id,documents:[parsed],draws,settings:{odds,rebates:{测试账单:{perTenThousandCents:10000}}}};
  configure(inputs);
  return {document,inputs,result:settleDocuments([parsed],draws,odds,document.businessDate,{rebates:inputs.settings.rebates})};
}
const amounts=card=>Object.fromEntries(card.playStakeRows.map(row=>[row.name,row.stakeCents]));

test('玩法投注汇总包括中奖、未中、和局及待结算，同玩法跨市场重复投注全部累计',()=>{
  const data=fixture('新49 49各10\n新20各10\n新平特蛇各100\n新大50\n旧20各30',i=>{delete i.draws.旧;i.settings.odds.新.refund49.attribute=true;});
  assert.deepEqual(data.result.issues,[]);
  assert.deepEqual([...new Set(data.result.entries.map(e=>e.status))].sort(),['lost','pending','refund','won']);
  const before=JSON.stringify(data),card=ledgerReceipt(data);
  assert.deepEqual(amounts(card),{'平特肖':10000,'大小·大数':5000,'特码':6000});
  assert.equal(card.playStakeRows.reduce((n,r)=>n+r.stakeCents,0),card.stakeCents);
  assert.equal(card.stakeCents,21000);assert.notEqual(card.rebateTurnoverCents,card.stakeCents);
  assert.equal(card.rows.find(r=>r.play==='特码').stakeCents,2000);
  assert.equal(JSON.stringify(data),before);
});

test('细分玩法独立列出、跨赔率档不拆分，分位金额不重算单价',()=>{
  const data=fixture('新特码49各0.01\n新特码49各0.02\n新牛，猪，鸡，羊，各肖40元\n新平特肖马蛇各100\n新二连肖马蛇各10\n新三连肖马蛇龙各20');
  assert.deepEqual(data.result.issues,[]);
  const card=ledgerReceipt(data);
  assert.deepEqual(amounts(card),{'特码':3,'特肖':16000,'平特肖':20000,'2连肖':1000,'3连肖':2000});
  assert.equal(card.playStakeRows.reduce((n,r)=>n+r.stakeCents,0),card.stakeCents);
  assert.equal(card.playStakeRows.filter(r=>r.name==='平特肖').length,1);
});

test('历史从已存投注明细取金额，未知玩法明确标注，原文问题不增加投注金额',()=>{
  const data=fixture('49各10\n特码99各30');assert.equal(data.result.issues.length,1);
  data.inputs.documents[0].text='20各999';data.inputs.documents[0].bets[0].unitCents=99900;
  delete data.result.entries[0].play;
  const card=ledgerReceipt({...data,history:true});assert.deepEqual(amounts(card),{'特码':1000});
  delete data.inputs.documents[0].bets[0].play;
  const unknown=ledgerReceipt({...data,history:true});assert.deepEqual(amounts(unknown),{'未分类玩法':1000});
  data.result.stakeCents++;
  assert.throws(()=>ledgerReceipt(data),/玩法投注明细与投注总额不一致/);
});

test('独立开关默认关闭，旧配置兼容，跨实例修改保留另一项，重启后还原',()=>{
  const values=new Map([[RECEIPT_PREFERENCES_KEY,'{"showName":true}']]),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const first=createReceiptPreferences(storage),second=createReceiptPreferences(storage);
  assert.equal(first.showPlayStakes.value,false);assert.equal(first.showName.value,true);
  first.setShowPlayStakes(true);second.setShowName(false);first.reload();
  assert.equal(first.showPlayStakes.value,true);assert.equal(first.showName.value,false);
  first.setShowName(true);second.setShowPlayStakes(false);
  const restarted=createReceiptPreferences(storage);assert.equal(restarted.showPlayStakes.value,false);assert.equal(restarted.showName.value,true);
  const failed=createReceiptPreferences({getItem:()=>values.get(RECEIPT_PREFERENCES_KEY),setItem:()=>{throw new Error('disk full');}});
  assert.throws(()=>failed.setShowPlayStakes(true),/disk full/);assert.equal(failed.showPlayStakes.value,false);assert.equal(failed.showName.value,true);
  for(const value of ['broken','null','{"showPlayStakes":"true"}']){values.set(RECEIPT_PREFERENCES_KEY,value);first.reload();assert.equal(first.showPlayStakes.value,false);}
});

test('显示开关仅影响图片内容，空账目和历史也可切换，名称与金额开关互不影响',()=>{
  for(const data of [fixture('49各10\n平特蛇各20'),fixture('')]){
    const before=JSON.stringify(data),card=ledgerReceipt({...data,history:true});
    const page=receiptPages(card,{showPlayStakes:true})[0],off=receiptSvg(page),on=receiptSvg(page,{showPlayStakes:true});
    assert(!off.svg.includes('各玩法投注金额'));assert(on.svg.includes('各玩法投注金额'));assert(on.height>off.height);
    assert(!on.svg.includes('测试账单'));assert(receiptSvg(page,{showName:true,showPlayStakes:true}).svg.includes('测试账单'));
    if(card.stakeCents){assert(on.svg.includes('特码投注'));assert(on.svg.includes('平特肖投注'));assert(on.svg.includes('20 元'));}
    else assert(on.svg.includes('暂无已识别投注'));
    assert.equal(JSON.stringify(data),before);
  }
});

test('玩法、中奖、退水独立分页无缺漏，关掉玩法显示不会多出空页，最大图片尺寸合规',()=>{
  const base=ledgerReceipt(fixture('三边49各10'));
  for(const [wins,rebates,stakes] of [[1,1,40],[40,40,40],[40,40,1]]){
    const card={...base,rows:Array.from({length:wins},(_,i)=>({...base.rows[0],key:String(i)})),
      rebateRows:Array.from({length:rebates},(_,i)=>({...base.rebateRows[0],key:String(i)})),
      playStakeRows:Array.from({length:stakes},(_,i)=>({...base.playStakeRows[0],key:String(i),name:'测试<&"'}))};
    const pages=receiptPages(card,{showPlayStakes:true});assert.equal(pages.length,3);
    assert.deepEqual(pages.flatMap(p=>p.playStakeRows),card.playStakeRows);
    assert.deepEqual(pages.flatMap(p=>p.rows),card.rows);assert.deepEqual(pages.flatMap(p=>p.rebateRows),card.rebateRows);
    assert.equal(receiptPages(card).length,wins===1?1:3);
    for(const page of pages){
      const {svg,height}=receiptSvg(page,{showPlayStakes:true,showName:true});
      assert.equal(page.stakeCents,card.stakeCents);assert.equal(page.payableCents,card.payableCents);
      assert.equal((svg.match(/data-stake-play=/g)||[]).length,page.playStakeRows.length);
      assert(svg.includes(page.playStakeRows.length?'测试&lt;&amp;&quot;投注':'玩法投注明细见其他页'));
      assert(height*2<16000&&640*2*height*2<24000000);
    }
  }
});
