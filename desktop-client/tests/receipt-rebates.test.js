import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {ledgerReceipt,receiptPages,receiptSvg,receiptRebateFormula} from '../src/core/ledger-receipt.js';
const date='2026-10-05';
function fixture(text,rebates,legacy=false){
  const document={id:'receipt-rebates',name:'小明',businessDate:date},parsed=parseDocument(text,document);
  assert.deepEqual(parsed.issues,[]);
  const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date,issue:'2026278',numbers:[1,2,3,4,5,6,49]}]));
  const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}]));
  const inputs={kind:'current',selection:document.id,documents:[parsed],date,draws,settings:{odds,rebates},verification:Object.fromEntries(['新','旧','港'].map(m=>[m,{confirmed:true}]))};
  // Synthesize an old multi-player snapshot only for historical compatibility.
  const documents=legacy?parsed.bets.map(b=>({...parsed,name:b.player,bets:[b]})):[parsed];
  const result=settleDocuments(documents,draws,odds,date,{rebates});
  if(legacy)result.version='songcai-settlement-2';
  return {document,inputs,result};
}
const rendered=card=>receiptSvg(receiptPages(card)[0]).svg;

test('结算单分开列出特码、平码、平特肖退水，跨市场汇总且保留原应付盈亏',()=>{
  const data=fixture('小明：两边49各100\n平码01各200\n平特肖蛇100',{小明:{perTenThousandCents:10000,playRates:{'flat-number':20000,'flat-zodiac':30000}}});
  const before=JSON.stringify(data),card=ledgerReceipt(data);
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(card.rebateRows.map(r=>[r.name,r.turnoverCents,r.rebateCents]),[['特码',20000,200],['平特肖',20000,600],['平码',40000,800]]);
  assert.equal(card.rebateCents,1600);assert.equal(card.payableCents,data.result.payoutCents+1600);assert.equal(card.netCents,card.payableCents-card.stakeCents);
  const svg=rendered(card);for(const row of card.rebateRows){assert(svg.includes(`data-rebate-play="${row.key}"`));assert(svg.includes(receiptRebateFormula(row)));}
  assert(svg.includes('退水合计'));assert(!svg.includes('小明'));assert(!svg.includes('仅用于测试的账目'));
});

test('正文多个玩家统一按账单名退水，全部流水使用账单的费率',()=>{
  const card=ledgerReceipt(fixture('小明：49各100\n张三：49各200\n李四：49各900',{小明:{perTenThousandCents:10000},张三:{perTenThousandCents:20000}}));
  assert.deepEqual(card.rebateRows,[{key:'special-number',name:'特码',turnoverCents:120000,rebateCents:1200,rate:'1%'}]);
  assert.equal(card.rebateCents,1200);assert.equal(card.rebateTurnoverCents,120000);assert.equal(card.stakeCents,120000);
  assert(rendered(card).includes('有效流水 1,200 · 1%'));
});

test('分位舍入使用结算分摊金额，不重新乘费率；舍入为0仍保留已退水玩法',()=>{
  const data=fixture('小明：20各0.25\n平码01各0.25',{小明:{perTenThousandCents:10000}}),card=ledgerReceipt(data);
  assert.equal(card.rebateCents,1);assert.equal(card.rebateRows.length,2);
  assert.deepEqual(card.rebateRows.map(r=>r.rebateCents).sort(),[0,1]);
  assert.equal(card.rebateRows.reduce((n,r)=>n+r.rebateCents,0),card.rebateCents);
  const zero=ledgerReceipt(fixture('小明：20各0.01',{小明:{perTenThousandCents:10000}}));
  assert.equal(zero.hasRebate,true);assert.equal(zero.rebateRows[0].rebateCents,0);assert(rendered(zero).includes('data-rebate-play="special-number"'));
});

test('未设置或关闭的玩法不展示退水，只有已结算且参与退水的玩法显示',()=>{
  const data=fixture('小明：20各100\n平码01各100\n旧20各100',{小明:{perTenThousandCents:0,playRates:{'flat-number':10000}}});
  delete data.inputs.draws.旧;
  data.result=settleDocuments(data.inputs.documents,data.inputs.draws,data.inputs.settings.odds,date,{rebates:data.inputs.settings.rebates});
  const card=ledgerReceipt(data);assert.equal(card.status,'pending');assert.equal(card.netCents,null);
  assert.deepEqual(card.rebateRows.map(r=>[r.name,r.rebateCents]),[['平码',100]]);
  const none=ledgerReceipt(fixture('小明：20各100',{}));assert.equal(none.hasRebate,false);assert.deepEqual(none.rebateRows,[]);assert(!rendered(none).includes('退水合计'));
});

test('历史缺玩法明细只列未分类退水，不按当前配置补算；新旧明细合计守恒',()=>{
  const data=fixture('小明：49各100\n张三：平码01各200',{小明:{perTenThousandCents:10000},张三:{perTenThousandCents:20000}},true);
  delete data.result.players.find(p=>p.id==='小明').rebateBreakdown;
  data.inputs.settings.rebates.小明.perTenThousandCents=90000;
  const card=ledgerReceipt({...data,history:true});
  assert.equal(card.rebateCents,500);assert.equal(card.hasUnclassifiedRebate,true);
  assert.deepEqual(card.rebateRows.map(r=>[r.name,r.rebateCents]),[['平码',400],['未分类退水',100]]);
  assert.match(receiptRebateFormula(card.rebateRows[1]),/历史记录未保存玩法明细/);
  assert(!rendered(card).includes('9%'));assert(rendered(card).includes('按已保存的结算金额展示'));
  delete data.result.players.find(p=>p.id==='张三').rebateBreakdown;
  const old=ledgerReceipt({...data,history:true});assert.equal(old.rebateRows.length,1);assert.equal(old.rebateRows[0].rebateCents,500);
});

test('玩法退水明细损坏时拒绝生成误导截图，即使玩家间误差刚好抵消',()=>{
  const data=fixture('小明：49各100\n张三：49各100',{小明:{perTenThousandCents:10000},张三:{perTenThousandCents:10000}},true);
  data.result.players[0].rebateBreakdown[0].rebateCents++;
  data.result.players[1].rebateBreakdown[0].rebateCents--;
  assert.throws(()=>ledgerReceipt(data),/玩法退水明细与退水合计不一致/);
});

test('中奖与退水明细分别分页不丢行、不重复，所有页保留全单总额且PNG尺寸合规',()=>{
  const base=ledgerReceipt(fixture('小明：三边49各100',{小明:{perTenThousandCents:10000}}));
  for(const [wins,rebates] of [[40,2],[2,40],[40,40]]){
    const card={...base,rows:Array.from({length:wins},(_,i)=>({...base.rows[0],key:String(i)})),rebateRows:Array.from({length:rebates},(_,i)=>({...base.rebateRows[0],key:String(i),name:'玩法<&"'}))};
    const pages=receiptPages(card);assert.equal(pages.length,3);assert.deepEqual(pages.flatMap(p=>p.rows),card.rows);assert.deepEqual(pages.flatMap(p=>p.rebateRows),card.rebateRows);
    for(const p of pages){
      assert.equal(p.rebateCents,base.rebateCents);assert.equal(p.payableCents,base.payableCents);assert.equal(p.netCents,base.netCents);
      const {svg,height}=receiptSvg(p);assert(height*2<16000&&640*2*height*2<24000000);
      assert(svg.includes('退水合计'));assert(svg.includes('应付合计'));assert.equal((svg.match(/data-draw-market=/g)||[]).length,3);
      if(p.rebateRows.length)assert(svg.includes('玩法&lt;&amp;&quot;'));else assert(svg.includes('退水明细见其他页'));
      if(!p.rows.length){assert(svg.includes('中奖明细见其他页'));assert(!svg.includes('无中奖记录'));}
    }
  }
});
