import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ledgerDrawSelection} from '../src/core/draw-selection.js';
import {verifyDraws} from '../src/core/draw-verification.js';
import {parseDocument} from '../src/core/parser.js';
import * as core from '../src/core/settlement.js';
import * as drawCore from '../src/core/draws.js';
import {SettlementStore} from '../electron/settlement-store.cjs';
import install from '../electron/settlement-service.cjs';
const date='2026-10-05';
const settings=()=>({sources:structuredClone(drawCore.DEFAULT_DRAW_SOURCES),odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...core.defaultOdds(),confirmed:true}]))});
const draw=(id,market,sourceId,date='2026-10-04',extra={})=>({id,market,sourceId,sourceName:sourceId,sourceUrl:'',date,issue:date==='2026-10-04'?'2026277':'2026105',numbers:[1,2,3,4,5,6,48],observedAt:'2026-10-05T00:00:00Z',...extra});
function samples(){return {新:[draw('n2','新','pengsai-new'),draw('n1','新','macaujc-new')],旧:[draw('o2','旧','pengsai-old'),draw('o1','旧','lamlhc-old')],港:[draw('h2','港','1234-hk','2026-10-03'),draw('h1','港','hkjc','2026-10-03')]};}
test('各市场独立最近一期，一致时按网站优先顺序选第一站，不依赖导入顺序',()=>{
 const all=samples(),config=settings(),s=ledgerDrawSelection(all,config);assert.deepEqual(s.drawDates,{新:'2026-10-04',旧:'2026-10-04',港:'2026-10-03'});assert.deepEqual(s.drawIds,{新:'n1',旧:'o1',港:'h1'});
 const v=verifyDraws(all,config,s.drawDates,s.drawIds);assert(Object.values(v).every(c=>c.confirmed));assert.equal(v.港.records[0].id,'h1');
 config.sources.新.reverse();assert.equal(ledgerDrawSelection(all,config).drawIds.新,'n2');
});
test('日期切换仅用当天，香港缺期不套用另一天；同日取最新期号',()=>{
 const all=samples();const s=ledgerDrawSelection(all,settings(),{mode:'date',date:'2026-10-04'});assert.equal(s.drawIds.港,'');assert.deepEqual(s.drawDates,{新:'2026-10-04',旧:'2026-10-04',港:'2026-10-04'});
 all.新.push(draw('newer','新','macaujc-new','2026-10-04',{issue:'2026278'}));assert.equal(ledgerDrawSelection(all,settings()).drawIds.新,'newer');
 assert.deepEqual(ledgerDrawSelection({},settings()).drawIds,{新:'',旧:'',港:''});
});
test('有冲突默认留空，用户选过的证据保留；单站及同源站不冒充多站确认',()=>{
 const all=samples(),s=settings();all.旧[0].numbers=[1,2,3,4,5,48,6];let result=ledgerDrawSelection(all,s);assert.equal(result.drawIds.旧,'');
 result=ledgerDrawSelection(all,s,{previous:{旧:'o1'}});assert.equal(result.drawIds.旧,'o1');assert.equal(verifyDraws(all,s,result.drawDates,result.drawIds).旧.confirmed,false);
 all.旧=[draw('p','旧','pengsai-old'),draw('l','旧','liucai-old')];result=ledgerDrawSelection(all,s);assert.equal(verifyDraws(all,s,result.drawDates,result.drawIds).旧.status,'single');
});
test('最近一期不受账目业务年份筛选，生肖展开仍按账目日期',()=>{
 const d=parseDocument('马数各十',{id:'a',businessDate:'2026-02-16'});assert.equal(d.bets[0].count,4);
 const chosen=draw('h','新','macaujc-new','2026-02-17',{numbers:[1,2,3,4,5,6,12]});
 const strict=core.settleDocuments([d],{新:chosen},settings().odds,'2026-02-16');assert.equal(strict.pending,1);
 const flexible=core.settleDocuments([d],{新:chosen},settings().odds,'2026-02-16',{drawDates:{新:chosen.date}});assert.equal(flexible.entries[0].status,'won');assert.equal(flexible.entries[0].businessDate,'2026-02-16');assert.equal(flexible.entries[0].drawDate,'2026-02-17');assert.equal(flexible.stakeCents,4000);
 const old={港:[draw('past','港','hkjc','2025-12-30')]};assert.equal(ledgerDrawSelection(old,settings(),{date:'2026-01-01'}).drawIds.港,'past');
});
test('实际赔付服务支持最近日期、指定日期、独立账目与历史版本，并拒绝过期试算',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-latest-'));const store=new SettlementStore(dir,core,drawCore);const cfg=store.settings();cfg.odds=settings().odds;store.saveSettings(cfg);store.addDraws(Object.values(samples()).flat());store.close();
 const documents=[{id:'a',name:'甲',text:'三边48各10',businessDate:date},{id:'b',name:'乙',text:'三边48各500',businessDate:date}],handlers=new Map(),sender={};
 const service=await install({electron:{app:{getPath:()=>dir},ipcMain:{handle:(n,f)=>handlers.set(n,f)}},window:()=>({webContents:sender}),ledger:{read:()=>({documents})},inbox:{settlementDocuments:()=>[]}});t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
 const call=(n,v)=>handlers.get('settlement:'+n)({sender},v),loaded=call('load',{date,allDates:true}),chosen=ledgerDrawSelection(loaded.draws,loaded.settings);
 let request={date,kind:'current',activeId:'a',drawMode:'latest',drawIds:chosen.drawIds};const trial=call('preview',request);assert.equal(trial.result.payoutCents,141000);assert.equal(trial.result.entries.length,3);assert.equal(trial.inputs.drawDates.港,'2026-10-03');
 const saved=call('save',{...request,inputHash:trial.inputHash,reviewed:true});assert.equal(saved.inputs.documents.length,1);assert.equal(saved.inputs.selection,'a');assert.equal(call('load',{date}).history.length,1);
 const exact=ledgerDrawSelection(loaded.draws,loaded.settings,{mode:'date',date:'2026-10-04'});const partial=call('preview',{...request,drawMode:'date',drawDate:'2026-10-04',drawIds:exact.drawIds});assert.equal(partial.result.pending,1);
 assert.throws(()=>call('preview',{...request,drawMode:'date',drawDate:'2026-10-05'}),/不匹配/);
 documents[0].text='三边48各20';assert.throws(()=>call('save',{...request,inputHash:trial.inputHash,reviewed:true}),/已经变化/);assert.equal(call('get',{id:saved.id}).result.payoutCents,141000);
});
test('同时自动获取会等待同一次请求；新年没有当年记录时读取上一年',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-latest-sync-')),handlers=new Map(),sender={};let release,calls=0;
 const gate=new Promise(r=>release=r),fetcher=async()=>{calls++;await gate;return new Response(JSON.stringify({code:200,data:[{type:'8',expect:'2025365',openTime:'2025-12-31 21:32:32',openCode:'1,2,3,4,5,6,48'}]}));};
 const service=await install({electron:{app:{getPath:()=>dir},ipcMain:{handle:(n,f)=>handlers.set(n,f)}},window:()=>({webContents:sender}),ledger:{read:()=>({documents:[]})},inbox:{settlementDocuments:()=>[]},fetcher});t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
 const call=(n,v)=>handlers.get('settlement:'+n)({sender},v),cfg=call('load',{date:'2026-01-01'}).settings;cfg.sources={新:['macaujc-new'],旧:[],港:[]};call('settings',cfg);
 const first=call('sync',{date:'2026-01-01',auto:true});let complete=false;const second=call('sync',{date:'2026-01-01',auto:true}).then(v=>{complete=true;return v;});await new Promise(r=>setImmediate(r));assert.equal(complete,false);release();assert.deepEqual(await first,await second);assert.equal(calls,2);
 assert.equal(call('load',{date:'2026-01-01',allDates:true}).draws.新[0].date,'2025-12-31');assert.equal((await call('sync',{date:'2026-01-01',auto:true})).length,0);
});
