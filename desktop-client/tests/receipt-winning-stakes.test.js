import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {ledgerReceipt,receiptFormula,receiptPages,receiptSvg,receiptWinningStakeLines} from '../src/core/ledger-receipt.js';

const date='2026-10-20';
function fixture(text,configure=()=>{}){
  const document={id:'winning-stakes',name:'负责人',businessDate:date},parsed=parseDocument(text,document);
  assert.deepEqual(parsed.issues,[],text);
  const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date,issue:'2026293',numbers:[38,10,48,49,13,9,5]}]));
  const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}]));
  const inputs={kind:'current',selection:document.id,documents:[parsed],draws,settings:{odds},verification:Object.fromEntries(['新','旧','港'].map(m=>[m,{confirmed:true}]))};
  configure(inputs);
  const result=settleDocuments([parsed],draws,odds,date,{rebates:inputs.settings.rebates,playerOdds:inputs.settings.playerOdds});
  assert.equal(result.complete,true);
  return {document,inputs,result};
}
const detail=row=>receiptWinningStakeLines(row).join('');

test('截图示例：中奖2元和5元合计7元，945投注、329赔付、亏616不变',()=>{
  const data=fixture('新特码05各2\n新特码05各5\n新特码20各938'),before=JSON.stringify(data),card=ledgerReceipt(data);
  assert.equal(JSON.stringify(data),before);assert.equal(card.rows.length,1);
  assert.equal(receiptFormula(card.rows[0]),'7 × 47');assert.equal(detail(card.rows[0]),'中奖投注：2＋5＝7元');
  assert.deepEqual(card.rows[0].stakeParts,[{unitCents:200,count:1},{unitCents:500,count:1}]);
  assert.deepEqual([card.stakeCents,card.payoutCents,card.netCents],[94500,32900,-61600]);
  const svg=receiptSvg(receiptPages(card)[0]).svg;
  assert(svg.includes('中奖投注：2＋5＝7元'));assert(!svg.includes('938'));assert(svg.includes('−616'));
});

test('只计算实际中奖注额，同单价多注用乘法展示，单笔不重复写总数',()=>{
  const card=ledgerReceipt(fixture('特码05 05 20各2\n特码05各5\n平特肖蛇羊马鼠各10\n特肖虎各30'));
  assert.equal(detail(card.rows.find(r=>r.play==='特码')),'中奖投注：2×2＋5＝9元');
  const flat=card.rows.filter(r=>r.play==='平特肖');
  assert.deepEqual(flat.map(r=>detail(r)).sort(),['中奖投注：10×2＝20元','中奖投注：10元'].sort());
  assert.equal(detail(card.rows.find(r=>r.play==='特肖')),'中奖投注：30元');
  assert.equal(card.rows.find(r=>r.play==='平特肖'&&r.rate==='1.8').detail,'马年生肖档');
});

test('连码、连肖、连尾、任中玩法均按命中组数拆分，三中二保留不同档位',()=>{
  for(const [text,count] of [
    ['二中二38 10 48 20各10',3],['二连肖蛇羊马鼠各10',3],
    ['二连尾8 9 0 2各10',3],['平特任中一38各10\n平特任中一05各10\n平特任中一20各10',2],
  ]){
    const card=ledgerReceipt(fixture(text));
    assert.equal(card.rows.reduce((n,r)=>n+r.count,0),count,text);
    assert.equal(card.rows.reduce((n,r)=>n+r.stakeCents,0),count*1000,text);
    for(const row of card.rows){assert.deepEqual(row.stakeParts,[{unitCents:1000,count:row.count}]);assert(detail(row).includes(row.count>1?`10×${row.count}`:'10元'));}
  }
  const card=ledgerReceipt(fixture('三中二38 10 48 20各10',i=>{i.settings.odds.新.rates['three-two'].rate='20';i.settings.odds.新.rates['three-three'].rate='90';}));
  assert.equal(detail(card.rows.find(r=>r.detail==='中三正码')),'中奖投注：10元');
  assert.equal(detail(card.rows.find(r=>r.detail==='中二正码')),'中奖投注：10×3＝30元');
});

test('市场和独立赔率保持分行，退水、逐注分位舍入和净赔率均不重新计算',()=>{
  const data=fixture('三边05各1\n新05各1\n新05各0.05',i=>{
    i.settings.odds.新.rates['special-number'].rate='1.005';i.settings.odds.旧.includePrincipal=false;
    i.settings.rebates={负责人:{perTenThousandCents:10000}};
    i.settings.playerOdds={负责人:{name:'负责人',markets:{港:{rates:{'special-number':{rate:'48'}}}}}};
  }),card=ledgerReceipt(data);
  assert.equal(card.rows.length,3);
  const [newRow,oldRow,hkRow]=card.rows;
  assert.equal(detail(newRow),'中奖投注：1×2＋0.05＝2.05元');assert.equal(newRow.payoutCents,207);
  assert.equal(receiptFormula(oldRow),'1 × (47＋1)');assert.equal(oldRow.payoutCents,4800);
  assert.equal(hkRow.rate,'48');assert.equal(hkRow.payoutCents,4800);
  assert.equal(card.payableCents,data.result.payableCents);assert.equal(card.rebateCents,data.result.rebateCents);
  assert.equal(card.netCents,data.result.payableCents-data.result.stakeCents);
});

test('旧快照可从当时投注恢复单价，缺失明细时保留赔付而不猜测构成',()=>{
  const data=fixture('05各2\n05各5');
  for(const entry of data.result.entries)delete entry.unitCents;
  assert.equal(detail(ledgerReceipt({...data,history:true}).rows[0]),'中奖投注：2＋5＝7元');
  for(const bet of data.inputs.documents[0].bets)delete bet.unitCents;
  const old=ledgerReceipt({...data,history:true});
  assert.equal(old.rows[0].stakeCents,700);assert.equal(old.payoutCents,32900);
  assert.equal(detail(old.rows[0]),'中奖投注明细未留存');assert.equal(old.rows[0].stakeParts,null);
});

test('未中奖和退本金不进入中奖构成，只有部分市场可结算时不捏造其他市场数据',()=>{
  const lost=ledgerReceipt(fixture('20各100'));assert.deepEqual(lost.rows,[]);
  const data=fixture('三边05各2');delete data.inputs.draws.旧;
  data.result=settleDocuments(data.inputs.documents,data.inputs.draws,data.inputs.settings.odds,date);
  const card=ledgerReceipt(data);assert.equal(card.status,'pending');assert.equal(card.netCents,null);
  assert.deepEqual(card.rows.map(r=>r.market),['新','港']);assert(card.rows.every(r=>detail(r)==='中奖投注：2元'));
  const refundData=fixture('大100',i=>{i.draws.新.numbers=[38,10,48,5,13,9,49];i.settings.odds.新.refund49.attribute=true;});
  const refund=ledgerReceipt(refundData);assert.equal(refund.refundCents,10000);assert.deepEqual(refund.rows,[]);
});

test('较长金额构成按项换行；超长构成分页不丢项，导出尺寸在上限内',()=>{
  const card=ledgerReceipt(fixture('05各1'));
  const row=card.rows[0];row.stakeParts=Array.from({length:1200},(_,i)=>({unitCents:i+1,count:1}));
  row.stakeCents=row.stakeParts.reduce((n,p)=>n+p.unitCents,0);
  const lines=receiptWinningStakeLines(row);assert(lines.length>100);
  assert.equal(lines.join(''),detail(row));assert(lines.every(line=>line.length<=66));
  const pages=receiptPages(card);assert(pages.length>1);
  assert.deepEqual(pages.flatMap(p=>p.rows.flatMap(r=>r.stakeDetailLines)),lines);
  assert.equal(new Set(pages.flatMap(p=>p.rows.map(r=>r.key))).size,pages.flatMap(p=>p.rows).length);
  for(const page of pages){
    assert.equal(page.payoutCents,card.payoutCents);assert.equal(page.netCents,card.netCents);
    const rendered=receiptSvg(page);assert(rendered.height*2<16000&&640*2*rendered.height*2<24000000);
    assert(rendered.svg.includes('金额只计一次'));
  }
});
