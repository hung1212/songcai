import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TransferStore} from '../electron/transfer-store.cjs';
import {validateTransferRecord,transferTerms,transferPosition,incrementalEvaluation,incrementalPlan,optimizeIncremental,transferRecordScope} from '../src/core/transfer-journal.js';
const book=(L=Array(49).fill(0),net=10000)=>({stakeCents:net,playerRebateCents:0,numbers:L.map((l,i)=>({number:i+1,cents:Math.floor(l/47),liabilityCents:l}))});
const batch=(extra={})=>({id:'batch-test-0001',date:'2026-10-27',market:'新',documentId:'a',ownerName:'玩家A',rate:47.3,rebatePercent:3.3,entries:[{number:1,cents:10000}],...extra});
test('分批赔率与退水冻结，逐笔取整；相同号码跨批次累计',()=>{
 const b=book([470000,...Array(48).fill(0)],20000);
 const r=[batch(),batch({id:'batch-test-0002',rate:45,rebatePercent:2,entries:[{number:1,cents:5000}]})];
 const p=transferPosition(b,r);assert.equal(p.totalCents,15000);assert.equal(p.rebateCents,430);assert.equal(p.payouts[0],698000);
 assert.equal(p.profitCents[0],233430);assert.equal(p.profitCents[1],5430);
 assert.equal(transferPosition(b,[...r,{...batch(),voidedAt:'now'}]).totalCents,15000);
});
test('平均补打只补差额，原文减少后已转出也不撤回',()=>{
 const b=book([470000,...Array(48).fill(0)],10000);b.numbers[0].cents=10000;
 const r=[batch({entries:[{number:1,cents:4000}]})];
 assert.equal(incrementalPlan(b,r).transferCents[0],5796);
 b.stakeCents=1000;b.numbers[0].cents=1000;b.numbers[0].liabilityCents=47000;
 const result=incrementalPlan(b,r);assert.equal(result.totalCents,0);assert.equal(result.position.totalCents,4000);
});
test('不同日期市场玩家隔离；集合包括公共和已删除账目记录，不能分摊公共转出',()=>{
 const records=[batch(),batch({id:'batch-test-0002',documentId:''}),batch({id:'batch-test-0003',documentId:'gone'}),batch({id:'batch-test-0004',market:'港'})];
 assert.equal(transferRecordScope(records,{date:'2026-10-27',market:'新'}).records.length,3);
 const p=transferRecordScope(records,{date:'2026-10-27',market:'新',documentIds:['a']});assert.equal(p.records.length,1);assert.equal(p.sharedCount,1);
 assert.throws(()=>transferRecordScope([batch({period:'2026:301'}),batch({id:'batch-test-0005',period:'2026:302'})],{date:'2026-10-27',market:'新'}),/期号/);
 assert.throws(()=>transferRecordScope([batch({period:'2026:301'})],{date:'2026-10-27',market:'新',period:'2026:302'}),/期号/);
});
test('整数目标优化与独立穷举一致，包含降低赔率、负剩余赔付和禁止新增号码',()=>{
 let seed=239;const random=()=>{seed=seed*16807%2147483647;return seed;};
 for(let sample=0;sample<90;sample++){
  const L=Array.from({length:49},(_,i)=>i<3?random()%20000-5000:-100000),b=book(L,10000),p=transferPosition(b,[]),terms=transferTerms(sample%2?'45':'47.3',sample%3?'3.3':'0');
  const target=random()%16000-8000,allowed=sample%2?[0,1,2]:[0,1];let best=null;
  for(let a=0;a<9;a++)for(let c=0;c<9;c++)for(let d=0;d<(allowed.length===3?9:1);d++){
   const r=incrementalEvaluation(b,p,[a*100,c*100,d*100,...Array(46).fill(0)],terms);
   if(r.worstProfitCents>=target&&(!best||r.totalCents<best.totalCents||r.totalCents===best.totalCents&&r.worstProfitCents>best.worstProfitCents))best=r;
  }
  const actual=optimizeIncremental(b,p,terms,target,allowed);assert.equal(actual.feasible,!!best,`sample ${sample}`);if(best){assert.equal(actual.totalCents,best.totalCents);assert.equal(actual.worstProfitCents,best.worstProfitCents);}
 }
});
test('优先已有号码；无法只补已有时新增号码明确返回，数量上限不够不放松风险',()=>{
 const b=book([470000,470000,...Array(47).fill(0)],20000),r=[batch({entries:[{number:1,cents:1000}]})];
 const impossible=incrementalPlan(b,r,{mode:'few',maxLossCents:0,maxNewNumbers:0});assert.equal(impossible.feasible,false);
 const p=incrementalPlan(b,r,{mode:'few',maxLossCents:0,maxNewNumbers:1});assert.equal(p.feasible,true);assert.deepEqual(p.newNumbers,[2]);assert(p.worstProfitCents>=0);
 const saved=[...r,batch({id:'batch-test-0002',entries:p.transferCents.flatMap((cents,i)=>cents?[{number:i+1,cents}]:[])})];
 const next=incrementalPlan(b,saved,{mode:'few',maxLossCents:0,maxNewNumbers:0});assert.equal(next.totalCents,0);
});
test('SQLite幂等保存、重新打开、作废审计和空间隔离',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-transfer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let store=new TransferStore(dir,validateTransferRecord);const r=store.add(batch());assert.equal(store.add(batch()).createdAt,r.createdAt);assert.throws(()=>store.add(batch({rate:44})),/不同/);store.close();
 store=new TransferStore(dir,validateTransferRecord);assert.equal(store.list(batch()).length,1);assert.throws(()=>store.void({id:r.id,reason:''}),/原因/);store.void({id:r.id,reason:'金额录错，实际尚未转出'});assert(store.list(batch())[0].voidedAt);store.close();
 const other=new TransferStore(path.join(dir,'other'),validateTransferRecord);assert.equal(other.list(batch()).length,0);other.close();
});
test('无效金额、报价、重复号码和整数溢出拒绝',()=>{
 for(const patch of [{rate:0},{rebatePercent:101},{entries:[{number:1,cents:0}]},{entries:[{number:1,cents:100},{number:1,cents:100}]},{entries:[{number:50,cents:100}]},{rate:'47.333'},{date:'bad'}])assert.throws(()=>validateTransferRecord(batch(patch)));
});

test('完整49号目标与原算法交叉核对；高流水计算不逐元循环',async()=>{
 const {minimizeSpecialTransfer}=await import('../src/core/special-transfer.js');
 let seed=1009;const random=()=>{seed=seed*16807%2147483647;return seed;};
 for(let sample=0;sample<15;sample++){
  const L=Array.from({length:49},()=>random()%10000000),b=book(L,10000000),p=transferPosition(b,[]),target=sample%3?-100000:0;
  const previous=minimizeSpecialTransfer(L,b.stakeCents,target),next=optimizeIncremental(b,p,transferTerms(47.3,3.3),target);
  assert.equal(next.feasible,previous.feasible);if(previous.feasible)assert.equal(next.totalCents,previous.totalCents);
 }
 const b=book(Array.from({length:49},(_,i)=>i*1000000000),10000000000);
 const start=performance.now();incrementalPlan(b,[],{mode:'few',maxLossCents:10000000,maxNewNumbers:8});assert(performance.now()-start<3000);
});

test('桌面接口校验账目归属，记录与设置数据库独立保存',async t=>{
 const {default:installSettlement}=await import('../electron/settlement-service.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-transfer-ipc-'));
 const service=await installSettlement({electron:{app:{getPath:()=>dir}},window:()=>null,ledger:{read:()=>({documents:[{id:'a',businessDate:'2026-10-27'}]})},inbox:{},directory:dir,register:false});
 t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.throws(()=>service.handlers.transferAdd(batch({documentId:'other'})),/先保存/);
 const saved=service.handlers.transferAdd(batch());assert.equal(service.handlers.transferList(batch())[0].id,saved.id);
 service.handlers.transferVoid({id:saved.id,reason:'仅测试录入修正'});assert(service.handlers.transferList(batch())[0].voidedAt);
 assert.deepEqual(service.handlers.transferDelete({id:saved.id,date:saved.date,market:saved.market}),{deleted:true});assert.equal(service.handlers.transferList(batch()).length,0);
 assert(fs.existsSync(path.join(dir,'transfers.sqlite')));
});

test('删除已打出批次持久化、正确重算补打及成本；日期市场空间隔离，重复删除安全',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-transfer-delete-'));
 let store=new TransferStore(dir,validateTransferRecord);const other=new TransferStore(path.join(dir,'other'),validateTransferRecord);
 t.after(()=>{store.close();other.close();fs.rmSync(dir,{recursive:true,force:true});});
 const a=batch({entries:[{number:1,cents:4000}]}),b=batch({id:'batch-test-0002',entries:[{number:2,cents:2000}]});store.add(a);store.add(b);other.add(a);
 const portfolio=book([470000,235000,...Array(47).fill(0)],15000);portfolio.numbers[0].cents=10000;portfolio.numbers[1].cents=5000;
 const before=incrementalPlan(portfolio,store.list(a));
 assert.throws(()=>store.delete({...a,market:'港'}),/不匹配/);assert.throws(()=>store.delete({...a,date:'2026-10-28'}),/不匹配/);assert.equal(store.list(a).length,2);
 assert.deepEqual(store.delete(a),{deleted:true});assert.deepEqual(store.delete(a),{deleted:false});
 const remaining=store.list(a),after=incrementalPlan(portfolio,remaining);
 assert.equal(after.transferCents[0]-before.transferCents[0],4000);assert.equal(after.transferCents[1],before.transferCents[1]);
 assert.deepEqual(transferPosition(portfolio,remaining),transferPosition(portfolio,[b]));assert.equal(other.list(a).length,1);
 store.close();store=new TransferStore(dir,validateTransferRecord);assert.deepEqual(store.list(a).map(r=>r.id),[b.id]);
 store.void({id:b.id,reason:'测试'});store.delete(b);assert.equal(store.list(a).length,0);
});

test('浏览器删除与数据库一致，限定当前空间日期市场',async t=>{
 const {browserTransfers}=await import('../src/transfer-preview.js');
 const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),data=new Map();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}});
 t.after(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage;});
 const a=browserTransfers('delete-a'),b=browserTransfers('delete-b'),r=batch();await a.transferAdd(r);await b.transferAdd(r);
 await assert.rejects(a.transferDelete({...r,market:'港'}),/不匹配/);assert.equal((await a.transferList(r)).length,1);
 assert.deepEqual(await a.transferDelete(r),{deleted:true});assert.deepEqual(await a.transferDelete(r),{deleted:false});
 assert.equal((await a.transferList(r)).length,0);assert.equal((await b.transferList(r)).length,1);
});
