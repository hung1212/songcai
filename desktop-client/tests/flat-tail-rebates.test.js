import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {validateRebates} from '../src/core/rebates.js';
import {rebateDraft,mergeRebateEdits} from '../src/core/rebate-edits.js';
import {ledgerReceipt,receiptSvg,receiptPages} from '../src/core/ledger-receipt.js';
const zero='flat-tail-zero',nonzero='flat-tail-nonzero',date='2026-11-21';
function fixture(text='平特0尾1尾2尾各100',playRates={[zero]:10000,[nonzero]:20000},defaultRate=0){
 const document={id:'tail-rebate',name:'小明',businessDate:date},parsed=parseDocument(text,document);assert.deepEqual(parsed.issues,[]);
 const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date,issue:'2026325',numbers:[10,11,23,34,45,46,49]}]));
 const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,defaultOdds()])),rebates={小明:{perTenThousandCents:defaultRate,playRates}};
 const result=settleDocuments([parsed],draws,odds,date,{rebates});
 return {document,result,inputs:{kind:'current',selection:document.id,documents:[parsed],draws,settings:{odds,rebates}}};
}
test('混合0尾和非0尾拆分有效流水，中奖未中均退水，截图分项守恒',()=>{
 const f=fixture(),r=f.result,p=r.players[0];
 assert.equal(r.stakeCents,30000);assert.equal(r.rebateCents,500);assert.equal(r.payableCents,r.payoutCents+500);
 assert.deepEqual(Object.fromEntries(p.rebateBreakdown.map(b=>[b.playKey,[b.turnoverCents,b.rebateCents]])),{[zero]:[10000,100],[nonzero]:[20000,400]});
 const card=ledgerReceipt(f),svg=receiptSvg(receiptPages(card)[0]).svg;
 assert(svg.includes('平特尾（0尾）'));assert(svg.includes('平特尾（非0尾）'));
 assert.equal(card.rebateRows.reduce((n,r)=>n+r.rebateCents,0),500);
 assert.equal(fixture('平特0尾各100\n平特1尾2尾各100').result.rebateCents,500);
});
test('独立关闭、默认继承，另一个玩家及缺开奖不计入退水',()=>{
 assert.equal(fixture(undefined,{[zero]:0},10000).result.rebateCents,200);
 assert.equal(fixture(undefined,{[nonzero]:0},10000).result.rebateCents,100);
 assert.equal(fixture(undefined,{}).result.rebateCents,0);
 const f=fixture(),parsed=f.inputs.documents[0],{odds,rebates}=f.inputs.settings;
 const missing=settleDocuments([parsed],{},odds,date,{rebates});assert.equal(missing.rebateCents,0);assert.equal(missing.turnoverCents,0);
 const other=settleDocuments([{...parsed,name:'张三'}],f.inputs.draws,odds,date,{rebates});assert.equal(other.rebateCents,0);
});
test('原统一退水无损转为两项，显式零优先；取消一项只恢复该项默认',()=>{
 const old={小明:{perTenThousandCents:5000,playRates:{'flat-tail':10000}}},snapshot=JSON.stringify(old);
 const migrated=validateRebates(old);assert.deepEqual(migrated.小明.playRates,{[zero]:10000,[nonzero]:10000});assert.equal(JSON.stringify(old),snapshot);
 assert.equal(fixture(undefined,old.小明.playRates,5000).result.rebateCents,300);
 assert.deepEqual(validateRebates({小明:{...old.小明,playRates:{...old.小明.playRates,[zero]:0}}}).小明.playRates,{[zero]:0,[nonzero]:10000});
 const before={小明:rebateDraft(old.小明)},after=structuredClone(before);after.小明.plays[zero]='';
 const saved=mergeRebateEdits(old,old,before,after);assert.deepEqual(saved.小明.playRates,{[nonzero]:10000});
 assert.equal(fixture(undefined,saved.小明.playRates,5000).result.rebateCents,250);
 const concurrent=structuredClone(old);concurrent.小明.playRates['flat-tail']=20000;
 assert.throws(()=>mergeRebateEdits(old,concurrent,before,after),/其他页面/);
});
test('多市场、小数金额、重复尾数保留份数并按整单舍入',()=>{
 const combined=fixture('三边平特0尾0尾1尾各0.17'),split=fixture('三边平特0尾各0.17\n平特0尾各0.17\n平特1尾各0.17');
 assert.equal(combined.result.rebateCents,split.result.rebateCents);
 assert.equal(combined.result.stakeCents,153);
 assert.equal(combined.result.players[0].rebateBreakdown.find(r=>r.playKey===zero).turnoverCents,102);
 assert.equal(combined.result.rebateCents,combined.result.players[0].rebateBreakdown.reduce((n,r)=>n+r.rebateCents,0));
});
