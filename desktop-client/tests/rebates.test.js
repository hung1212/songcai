import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../src/core/settlement.js';
import * as draws from '../src/core/draws.js';
import {parseDocument} from '../src/core/parser.js';
import {rebateInput,rebatePercent,validateRebates} from '../src/core/rebates.js';
import {ledgerOverview,settlementBalance} from '../src/core/ledger-overview.js';
import {ledgerReceipt,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {SettlementStore,hash} from '../electron/settlement-store.cjs';
import {browserSettlement} from '../src/settlement-preview.js';
const date='2026-10-05',draw={market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,49],sourceId:'manual'};
const odds=Object.fromEntries(['新','旧','港'].map(m=>{const o=core.defaultOdds();o.confirmed=true;o.refund49.attribute=true;return [m,o];}));
const allDraws=Object.fromEntries(['新','旧','港'].map(m=>[m,{...draw,market:m}]));
const doc=(text,id='a')=>parseDocument(text,{id,name:'小明',businessDate:date});
const rate=(id='小明',cents=10000)=>({[id]:{perTenThousandCents:cents}});
const calculate=(documents,rebates,selected=allDraws)=>core.settleDocuments(documents,selected,odds,date,{rebates});

test('每万元退100元按1%计算，未设置默认0，赢输投注都计流水',()=>{
  const docs=[doc('小明：49各10000\n20各5000'),{...doc('张三：20各1000','b'),name:'张三'}];
  const r=calculate(docs,rate());assert.equal(r.rebateCents,15000);assert.equal(r.payableCents,47015000);assert.equal(r.payoutCents,47000000);
  const p=r.players[0];assert.equal(p.turnoverCents,1500000);assert.equal(p.perTenThousandCents,10000);assert.equal(p.netCents,45515000);
  assert.equal(r.players[1].rebateCents,0);assert.equal(r.players[1].netCents,-100000);
  const zero=calculate(docs);assert.equal(zero.rebateCents,0);assert.equal(zero.payableCents,zero.payoutCents);
});
test('待处理、缺开奖、退款及其他日期不计入有效流水，未完成不显示确定盈亏',()=>{
  const docs=[doc('小明：新20各100\n大100\n旧20各200\n特码99各100'),{...doc('小明：20各10000','other'),rule:{date:'2026-10-04'}}];
  const r=calculate(docs,rate(),{新:draw});assert.equal(r.turnoverCents,10000);assert.equal(r.rebateCents,100);assert.equal(r.refundCents,10000);assert.equal(r.payableCents,10100);assert.equal(r.complete,false);assert.equal(r.players[0].netCents,null);assert.equal(settlementBalance(r).netCents,null);
});
test('原文无署名仍按标题匹配退水，同名共用配置，改名后按新标题',()=>{
  const a=doc('20各100','a'),b={...doc('20各100','b'),name:a.name};
  const r=calculate([a,b],rate(a.name));assert.deepEqual(r.players.map(p=>p.rebateCents),[200]);
  a.name='重命名';assert.equal(calculate([a],rate('小明')).rebateCents,0);
});
test('按账目玩家汇总后舍入到分，多市场分配守恒，每日总额等于单账目结算单之和',()=>{
  const docs=[doc('小明：三边20各0.17\n20各0.17','a'),doc('小明：三边20各0.17','b')];
  const r=calculate(docs,rate()),parts=docs.map(d=>calculate([d],rate()));
  assert.equal(r.rebateCents,2);assert.equal(r.rebateCents,parts.reduce((n,r)=>n+r.rebateCents,0));
  assert.equal(r.players[0].rebateCents,Object.values(r.players[0].markets).reduce((n,g)=>n+g.rebateCents,0));
  const oneLine=calculate([doc('小明：20 20 20 20各0.17')],rate());assert.equal(oneLine.rebateCents,parts[0].rebateCents);
  const overview=ledgerOverview(docs,allDraws,{odds,rebates:rate()},{});assert.equal(overview.rebateCents,r.rebateCents);assert.equal(overview.payableCents,r.payableCents);assert.equal(overview.netCents,r.payableCents-r.stakeCents);
});
test('退水输入精度、负数、上限、危险属性名称及安全整数边界',()=>{
  assert.equal(rebateInput('100'),10000);assert.equal(rebateInput(''),0);assert.equal(rebateInput('0.01'),1);assert.equal(rebatePercent(10000),'1%');assert.equal(rebatePercent(1),'0.0001%');
  for(const value of ['-1','1.001','10001','NaN','Infinity','1e2'])assert.throws(()=>rebateInput(value));
  for(const value of [null,[],{p:{perTenThousandCents:1.5}},{p:{perTenThousandCents:1000001}}])assert.throws(()=>validateRebates(value));
  assert.deepEqual(validateRebates({p:{perTenThousandCents:0}}),{});
  assert.equal(calculate([{...doc('constructor：20各100'),name:'constructor'}],rate('constructor')).rebateCents,100);
  const large=doc('小明：20各100');large.bets[0].perMarketCents=Number.MAX_SAFE_INTEGER;
  assert.doesNotThrow(()=>calculate([large],rate()));
});
test('结算截图单列退水并增加应付和盈亏，旧快照不补算退水',()=>{
  const parsed=doc('小明：49各100\n20各900'),result=calculate([parsed],rate());
  const inputs={kind:'current',selection:'a',date,documents:[parsed],draws:allDraws,settings:{odds,rebates:rate()},verification:{新:{confirmed:true}}};
  const data={document:{id:'a'},result,inputs};const card=ledgerReceipt(data);
  assert.equal(card.payoutCents,470000);assert.equal(card.rebateCents,1000);assert.equal(card.payableCents,471000);assert.equal(card.netCents,371000);
  const svg=receiptSvg(receiptPages(card)[0]).svg;assert(svg.includes('退水'));assert(svg.includes('应付合计'));assert(svg.includes('有效流水 1,000 · 1%'));assert(svg.includes('+3,710'));assert(!svg.includes('小明'));
  const old=calculate([parsed]);delete old.rebateCents;delete old.payableCents;delete old.turnoverCents;old.players=[];
  const history=ledgerReceipt({...data,result:old,history:true});assert.equal(history.rebateCents,0);assert.equal(history.netCents,370000);
  assert.throws(()=>ledgerReceipt({...data,result:{...result,payableCents:0}}),/退水与应付/);
});
test('SQLite退水持久化、旧配置默认0、快照保存当时退水且不被后续修改覆盖',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-rebates-'));let store=new SettlementStore(directory,core,draws);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  assert.deepEqual(store.settings().rebates,{});
  const old=store.settings();old.odds=odds;const settings=store.saveSettings({...old,rebates:rate()});
  const inputs={documents:[doc('小明：20各15000')],draws:allDraws,settings,date,kind:'current',selection:'a',verification:{新:{confirmed:true}}};
  const saved=store.saveSettlement(inputs,hash(inputs));assert.equal(saved.result.rebateCents,15000);
  store.saveSettings({...settings,rebates:rate('小明',20000)});
  assert.equal(store.getSettlement(saved.id).result.rebateCents,15000);assert.equal(store.history(date)[0].payableCents,15000);
  store.close();store=new SettlementStore(directory,core,draws);assert.equal(store.settings().rebates.小明.perTenThousandCents,20000);assert.equal(store.getSettlement(saved.id).result.payableCents,15000);
  const omit=store.settings();delete omit.rebates;store.saveSettings(omit);assert.equal(store.settings().rebates.小明.perTenThousandCents,20000);
});
test('浏览器退水同样按空间隔离并影响预览哈希，旧预览无法保存',async t=>{
  const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};t.after(()=>delete globalThis.localStorage);
  const documents=[{id:'a',name:'小明',text:'小明：20各10000',businessDate:date}];
  const a=browserSettlement(()=>documents),b=browserSettlement(()=>documents,'space-b');
  await a.manual({...draw,sourceName:'合成开奖'});const data=await a.load({date}),request={date,kind:'current',activeId:'a',drawIds:{新:data.draws.新[0].id}};
  const before=await a.preview(request);await a.settings({...data.settings,rebates:rate()});
  const after=await a.preview(request);assert.equal(after.result.rebateCents,10000);assert.notEqual(after.inputHash,before.inputHash);
  assert.equal((await b.preview(request)).result.rebateCents,0);
  await assert.rejects(a.save({...request,inputHash:before.inputHash,reviewed:true}),/变化/);
});
