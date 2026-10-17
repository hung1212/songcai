import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import installAI from '../electron/ai-review-service.cjs';
import {LedgerStore} from '../electron/ledger-store.cjs';
import {writeLedger,clearLedger} from '../electron/ledger-ai-lifecycle.cjs';
import * as ledgerCore from '../src/core/ledger.js';
import {reviewInput,assistanceFor,decideReview} from '../src/core/ai-review.js';
import {parseDocument,summarize} from '../src/core/parser.js';
const doc=(text,extra={})=>({id:'a',name:'测试',text,businessDate:'2026-10-10',defaultPlayer:'',...extra});
const proposal=i=>{const m=i.body.match(/(\d{2})各(\d+)/);return {bets:[{markets:i.context.markets,play:'特码',basis:'每号',selection:m[1],amount:m[2],evidence:{market:'',play:'',selection:m[1],amount:m[2]}}]};};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function setup(t,runner){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-fragments-')),calls=[];
  const electron={app:{getPath:()=>directory},ipcMain:{handle(){}},safeStorage:{}};
  const create=()=>installAI({electron,window:()=>({webContents:{}}),codexRunner:async(s,m,o)=>{
    o.onAttempt();const items=JSON.parse(m[1].content).items;calls.push(items);
    if(runner)await runner(items,o);
    return {result:{items:items.map(i=>({line:i.line,candidates:[proposal(i)]}))},usage:{inputTokens:1,outputTokens:1}};
  }});
  let service=await create();t.after(()=>{service.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {calls,directory,get service(){return service;},get api(){return service.handlers;},restart:async()=>{service.close();service=await create();}};
}
test('追加仅请求新增片段，插空行改位置复用，重复原文仍按两笔计账',async t=>{
  const h=await setup(t),a=doc('新\n01各10');
  const first=await h.api.review({document:a,mode:'all'});assert.equal(first.items[0].status,'agree');
  const b=doc('新\n01各10\n02各20');const second=await h.api.review({document:b,mode:'all'});
  assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1].map(i=>i.body),['02各20']);assert.equal(second.items.length,2);
  const moved=doc('新\n\n02各20\n\n01各10\n01各10'),third=await h.api.review({document:moved,mode:'all'});
  assert.equal(h.calls.length,2);assert.equal(third.cached,true);assert.deepEqual(third.items.map(i=>i.line),[3,5,6]);
  assert.equal(summarize([parseDocument(moved.text,moved)]).totalCents,4000);
});
test('同批相同内容只发送一次，结果映射所有出现位置',async t=>{
  const h=await setup(t),d=doc('新\n01各10\n01各10');const r=await h.api.review({document:d,mode:'all'});
  assert.equal(h.calls[0].length,1);assert.deepEqual(r.items.map(i=>[i.line,i.source,i.status]),[[2,'01各10','agree'],[3,'01各10','agree']]);
});
test('市场玩法玩家日期与接口变化失效，无关尾部追加不失效',async t=>{
  const h=await setup(t),d=doc('新\n01各10');await h.api.review({document:d,mode:'all'});
  for(const changed of [doc('旧\n01各10'),doc('平码\n01各10'),doc('新\n01各10',{defaultPlayer:'另一人'}),doc('新\n01各10',{businessDate:'2026-10-11'}),doc('新\n01各20')]){
    const n=h.calls.length;await h.api.review({document:changed,mode:'all'});assert.equal(h.calls.length,n+1);
  }
  assert.equal(h.api.cached({document:doc('新\n01各10\n谢谢'),mode:'all'}).missing,0);
  await h.api.configure({...h.api.load().settings,model:'different'});
  assert.equal(h.api.cached({document:d,mode:'all'}).missing,1);
});
test('跨行完整投注和尾部市场属于依赖，修改后不复用旧解释',()=>{
  const key=text=>reviewInput(doc(text),'all').items.find(i=>i.line===1).fragmentKey;
  assert.notEqual(key('01 02\n各20'),key('01 02\n各50'));
  assert.notEqual(key('新01各10'),key('新01各10\n港'));
  assert.equal(key('新01各10'),key('新01各10\n\n旧02各20'));
  const last=text=>reviewInput(doc(text),'all').items.at(-1).fragmentKey;
  assert.equal(last('旧01各10\n新02各20'),last('旧01各30\n新02各20'));
  assert.equal(last('旧01各10\n02各20'),last('旧01各30\n02各20'));
});
test('第一笔进行中追加第二笔不取消请求，同账目并发合并已完成结果',async t=>{
  const started=deferred(),release=deferred();let n=0;
  const h=await setup(t,async(_items,{signal})=>{if(n++===0){started.resolve(signal);await release.promise;}});
  const a=doc('01各10'),pending=h.api.review({document:a,mode:'all'});const signal=await started.promise;
  const b=doc('01各10\n02各20'),snapshot=h.api.cached({document:b,mode:'all'});
  assert.equal(snapshot.items[0].status,'pending');assert.equal(snapshot.missing,1);assert.equal(signal.aborted,false);
  const appended=h.api.review({document:b,mode:'all'});release.resolve();await pending;const result=await appended;
  assert.deepEqual(h.calls.map(batch=>batch.map(i=>i.body)),[['01各10'],['02各20']]);assert.equal(result.items.length,2);
});
test('失败状态跨追加和重启保留，手动重试只发失败片段',async t=>{
  let fail=true;const h=await setup(t,async items=>{if(fail&&items.some(i=>i.body==='02各20'))throw new Error('Codex核验失败');});
  await h.api.review({document:doc('01各10'),mode:'all'});
  const d=doc('01各10\n02各20');let r=await h.api.review({document:d,mode:'all'});assert.equal(r.status,'failed');
  await h.restart();r=await h.api.review({document:d,mode:'all'});assert.equal(r.cached,true);assert.equal(h.calls.length,2);
  fail=false;r=await h.api.review({document:d,mode:'all',force:true});assert.equal(h.calls.length,3);assert.deepEqual(h.calls[2].map(i=>i.body),['02各20']);assert(r.items.every(i=>i.status==='agree'));
  await h.api.review({document:d,mode:'all',retryLine:1});assert.deepEqual(h.calls[3].map(i=>i.body),['01各10']);
});
test('人工确认结果在追加和重启后保留，重新核验可主动更新',async t=>{
  const h=await setup(t),d=doc('01各10');const result=await h.api.review({document:d,mode:'all'});
  d.assistance=assistanceFor(d,result.items,result.id,result);d.assistance=decideReview(d,1,'original');
  h.api.cached({document:d,mode:'all'});await h.restart();
  const next={...d,text:'\n01各10\n02各20'},r=await h.api.review({document:next,mode:'all'});
  assert.equal(r.items[0].status,'original');assert.equal(r.items[0].line,2);assert.equal(h.calls.length,2);
  await h.api.review({document:next,mode:'all',retryLine:2});
  assert.equal(h.api.cached({document:next,mode:'all'}).items[0].status,'agree');
});
test('清空期间迟到结果不写回缓存，重输同文作为新任务；其他账目保留',async t=>{
  const started=deferred(),release=deferred();let wait=false;
  const h=await setup(t,async()=>{if(wait){started.resolve();await release.promise;}});
  const other=doc('02各20',{id:'b'});await h.api.review({document:other,mode:'all'});
  wait=true;const d=doc('01各10'),pending=h.api.review({document:d,mode:'all'});await started.promise;
  const epoch=h.api.cached({document:d,mode:'all'}).generation;h.service.clearDocuments(['a']);release.resolve();const old=await pending;
  assert.equal(old.invalidated,true);assert.equal(h.api.history({id:'a'}).length,0);assert.equal(h.api.cached({document:d,mode:'all'}).missing,1);
  assert.equal(h.api.cached({document:other,mode:'all'}).missing,0);
  assert.equal((await h.api.review({document:d,mode:'all',generation:epoch})).invalidated,true);
  await h.api.review({document:d,mode:'all'});assert.equal(h.calls.length,3);
});
test('真正清空和删除账目同时清缓存，保存失败不清缓存',async t=>{
  const h=await setup(t),store=new LedgerStore(h.directory,ledgerCore);t.after(()=>store.close());
  const a=doc('01各10'),b=doc('02各20',{id:'b',name:'其他'});
  let saved=writeLedger(store,h.service,{schemaVersion:1,documents:[a,b],activeId:'a',storageRevision:0});
  await h.api.review({document:a,mode:'all'});await h.api.review({document:b,mode:'all'});
  assert.throws(()=>clearLedger(store,h.service,{storageRevision:0}),/变化/);assert.equal(h.api.cached({document:a,mode:'all'}).missing,0);
  saved=writeLedger(store,h.service,{...saved,documents:[b],activeId:'b'});
  assert.equal(h.api.cached({document:a,mode:'all'}).missing,1);assert.equal(h.api.cached({document:b,mode:'all'}).missing,0);
  const cleared=clearLedger(store,h.service,{storageRevision:saved.storageRevision});assert.equal(cleared.project.documents[0].text,'');assert.equal(cleared.project.documents[0].name,'其他');
  assert.equal(h.api.cached({document:b,mode:'all'}).missing,1);
});
