import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import * as ledgerCore from '../src/core/ledger.js';
import {LedgerStore} from '../electron/ledger-store.cjs';
import {SpaceStore} from '../electron/space-store.cjs';
import installInbox from '../electron/inbox-service.cjs';
import installSettlement from '../electron/settlement-service.cjs';
import installAI from '../electron/ai-review-service.cjs';
import {browserSpaces} from '../src/space-preview.js';
import {browserSettlement} from '../src/settlement-preview.js';
import {spaceKey} from '../src/space-context.js';
import {STORAGE_KEY} from '../src/project.js';
import {clearPreviewContents,restorePreviewContents,clearPreviewState} from '../src/ledger-clear-preview.js';
const date='2026-10-05';
const doc=(id,text='11各100',name='小明')=>({id,text,name,businessDate:date,defaultPlayer:'小明'});
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-spaces-'));const spaces=new SpaceStore(root,ledgerCore);t.after(()=>{spaces.close();fs.rmSync(root,{recursive:true,force:true});});return {root,spaces};}
function write(spaces,id,documents){return spaces.ledger(id).write({...spaces.project(id),documents,activeId:documents[0]?.id||''});}

test('SQLite升级先备份旧账目，保留原ID、原文和默认空间路径',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-spaces-upgrade-'));
 const old=new LedgerStore(root,ledgerCore);const original=old.write({schemaVersion:1,activeId:'old',documents:[doc('old')],storageRevision:0});
 const spaces=new SpaceStore(root,ledgerCore);
 t.after(()=>{spaces.close();old.close();fs.rmSync(root,{recursive:true,force:true});});
 assert.deepEqual(spaces.project('default'),original);assert.equal(spaces.dataDirectory('default'),root);
 const backup=new DatabaseSync(path.join(root,'space-upgrade-backup/ledger.sqlite'),{readOnly:true});
 assert.equal(backup.prepare('SELECT original_text FROM ledger_documents WHERE id=?').get('old').original_text,'11各100');backup.close();
 assert.equal(spaces.list().spaces[0].count,1);
});
test('新空间允许0账目，重启恢复当前空间，同名标题互不覆盖',t=>{
 const {root,spaces}=setup(t);write(spaces,'default',[doc('a','11各300')]);
 const b=spaces.create({name:'二组'});assert.deepEqual(spaces.project(b.id).documents,[]);spaces.activate(b.id);
 const reopened=new SpaceStore(root,ledgerCore);assert.equal(reopened.list().activeId,b.id);assert.deepEqual(reopened.project(b.id).documents,[]);reopened.close();
 write(spaces,b.id,[doc('b','11各80')]);write(spaces,b.id,[doc('b2','11各90')]);
 assert.equal(spaces.project('default').documents[0].text,'11各300');assert.equal(spaces.project(b.id).documents.length,1);assert.equal(spaces.project(b.id).documents[0].text,'11各90');
 assert.throws(()=>spaces.dataDirectory('../elsewhere'),/不存在/);
});
test('仅复制名称绑定和手动顺序，不复制原文；失败初始化不留下半成品空间',t=>{
 const {spaces}=setup(t);write(spaces,'default',[doc('a','11各300','张三'),doc('b','11各80','小明')]);
 const b=spaces.create({name:'下一期',copyFrom:'default',copyNames:true,businessDate:'2026-10-06'}),docs=spaces.project(b.id).documents;
 assert.deepEqual(docs.map(d=>d.name),['张三','小明']);assert(docs.every(d=>!d.text&&!d.assistance&&!d.parserReview&&d.businessDate==='2026-10-06'&&d.defaultPlayer==='小明'&&!['a','b'].includes(d.id)));
 assert.throws(()=>spaces.create({name:'失败空间'},()=>{throw new Error('磁盘失败');}),/磁盘失败/);assert(!spaces.list().spaces.some(s=>s.name==='失败空间'));
 assert.throws(()=>spaces.create({name:'下一期'}),/已存在/);
});
test('清空恢复及保存版本独立，归档保留数据且需恢复才能编辑',t=>{
 const {spaces}=setup(t);write(spaces,'default',[doc('a')]);const b=spaces.create({name:'二组'});write(spaces,b.id,[doc('b','11各80')]);
 const old=spaces.project(b.id),cleared=spaces.ledger('default').clearContents(spaces.project('default'));
 assert.equal(spaces.ledger(b.id).clearState(),null);assert.deepEqual(spaces.project(b.id),old);
 spaces.ledger('default').restoreContents(cleared.project);assert.equal(spaces.project('default').documents[0].text,'11各100');
 spaces.activate(b.id);spaces.archive({id:b.id,archived:true});assert.equal(spaces.list().activeId,'default');assert.throws(()=>spaces.activate(b.id),/归档/);assert.throws(()=>spaces.get(b.id,{write:true}),/归档/);assert.equal(spaces.project(b.id).documents[0].text,'11各80');
 assert.throws(()=>spaces.archive({id:'default',archived:true}),/至少保留/);spaces.archive({id:b.id,archived:false});spaces.activate(b.id);
 spaces.rename({id:b.id,name:'二组改名'});assert.equal(spaces.get(b.id).name,'二组改名');assert.equal(spaces.project(b.id).documents[0].id,'b');
});
async function services(t,options={}){
 const {root,spaces}=setup(t),handlers=new Map(),events=[],sender={isDestroyed:()=>false,send:(n,v)=>events.push([n,v])};
 const image={isEmpty:()=>false,getSize:()=>({width:100,height:100}),toPNG:()=>Buffer.from('fake-image')};
 const electron={app:{getPath:()=>root,isPackaged:false},ipcMain:{handle:(n,f)=>handlers.set(n,f)},nativeImage:{createFromDataURL:()=>image},safeStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}};
 const window=()=>({webContents:sender});
 const inbox=await installInbox({electron,window,spaces,nativeRequest:options.nativeRequest});
 const settlement=await installSettlement({electron,window,spaces,inbox});
 const ai=await installAI({electron,window,spaces,startupCheck:true,codexRunner:options.codexRunner});
 // Stop and close services before SpaceStore and temp dir cleanup.
 const close=async()=>{await inbox.stop();ai.close();settlement.close();inbox.close();};
 t.after(close);
 const call=(name,spaceId,payload)=>handlers.get(name)({sender},{spaceId,payload});return {spaces,call,events,inbox,settlement,ai,handlers,sender};
}
test('真实IPC：开奖共享，赔率、赔付快照与账目范围独立',async t=>{
 const {spaces,call,settlement}=await services(t);write(spaces,'default',[doc('a','11各300')]);const b=spaces.create({name:'二组'});write(spaces,b.id,[doc('b','11各80')]);
 await call('settlement:manual','default',{market:'新',date,issue:'2026278',numbers:'1 2 3 4 5 6 11',sourceName:'合成测试'});
 const aLoad=await call('settlement:load','default',{date}),bLoad=await call('settlement:load',b.id,{date});assert.equal(aLoad.draws.新[0].id,bLoad.draws.新[0].id);
 aLoad.settings.rebates={小明:{perTenThousandCents:10000}};aLoad.settings.odds.新.confirmed=true;aLoad.settings.odds.新.rates['special-number'].rate='48';await call('settlement:settings','default',aLoad.settings);
 assert.equal((await call('settlement:load',b.id,{date})).settings.odds.新.rates['special-number'].rate,'47');
 const drawId=aLoad.draws.新[0].id;const input={date,kind:'current',activeId:'a',drawIds:{新:drawId}};
 const aPreview=await call('settlement:preview','default',input),bPreview=await call('settlement:preview',b.id,{...input,activeId:'b'});
 assert.equal(aPreview.result.stakeCents,30000);assert.equal(aPreview.result.payoutCents,1440000);assert.equal(bPreview.result.stakeCents,8000);assert.equal(bPreview.result.payoutCents,376000);assert.equal(aPreview.result.rebateCents,300);assert.equal(bPreview.result.rebateCents,0);
 await assert.rejects(call('settlement:preview',b.id,input),/当前空间/);
 input.decisions={新:{drawId,reviewKey:aPreview.inputs.verification.新.reviewKey}};
 const ready=await call('settlement:preview','default',input),saved=await call('settlement:save','default',{...input,inputHash:ready.inputHash,reviewed:true});assert.equal(saved.inputs.spaceId,'default');
 assert.equal((await call('settlement:load',b.id,{date})).history.length,0);await assert.rejects(call('settlement:get',b.id,{id:saved.id}),/不存在/);
 assert.equal((await settlement.ensure(b.id)).store.history(date).length,0);
});
test('真实IPC：收件箱归属固定，省略空间的旧请求始终落默认空间',async t=>{
 const {spaces,call,handlers,sender}=await services(t);const b=spaces.create({name:'二组'});spaces.activate(b.id);
 const payload={player:'小明',businessDate:date,name:'测试',source:'合成',text:'11各100'};
 const a=await handlers.get('inbox:create')({sender},payload),second=await call('inbox:create',b.id,payload);
 assert.equal((await call('inbox:list','default',{})).total,1);assert.equal((await call('inbox:list',b.id,{})).total,1);
 await assert.rejects(call('inbox:get',b.id,a.batch.id),/不存在/);assert.equal((await call('inbox:get',b.id,second.batch.id)).batch.text,'11各100');
 await assert.rejects(handlers.get('inbox:list')({sender:{}},{spaceId:b.id,payload:{}}),/未知窗口/);
});
test('真实IPC：AI返回后仍归原空间，历史和表达规则隔离，连接设置共享',async t=>{
 let release,started;const gate=new Promise(r=>release=r),running=new Promise(r=>started=r);
 const {spaces,call}=await services(t,{codexRunner:async(_s,_m,{onAttempt})=>{onAttempt();started();await gate;return {result:{items:[]},usage:{inputTokens:1,outputTokens:1}};}});
 const b=spaces.create({name:'二组'});const settings=(await call('ai:load','default')).settings;
 await call('ai:configure','default',{...settings,enabled:true,mode:'all'});assert.equal((await call('ai:load',b.id)).settings.enabled,true);
 const pending=call('ai:review','default',{document:doc('a','11各100'),mode:'all'});await running;spaces.activate(b.id);
 await assert.rejects(call('ai:configure',b.id,{...settings,enabled:false}),/先停止/);
 release();await pending;
 assert.equal((await call('ai:history','default',{id:'a'})).length,1);assert.equal((await call('ai:history',b.id,{id:'a'})).length,0);
 assert.equal((await call('ai:load','default')).usage.requests,(await call('ai:load',b.id)).usage.requests);
});
test('浏览器空间保存、清空恢复和公共开奖同样隔离',async t=>{
 const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};t.after(()=>delete globalThis.localStorage);
 localStorage.setItem(STORAGE_KEY,JSON.stringify({schemaVersion:1,activeId:'a',documents:[doc('a')]}));
 const spaces=browserSpaces();const created=await spaces.create({name:'二组',copyFrom:'default',copyNames:false}),id=created.activeId;
 assert.equal(created.spaces.find(s=>s.id===id).count,0);
 const p={schemaVersion:1,activeId:'b',documents:[doc('b','11各80')]};localStorage.setItem(spaceKey(STORAGE_KEY,id),JSON.stringify(p));
 const cleared=clearPreviewContents(p,id);assert.equal(clearPreviewState(),null);assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).documents[0].text,'11各100');restorePreviewContents(cleared.project,id);
 const a=browserSettlement(()=>[doc('a')]),b=browserSettlement(()=>p.documents,id);
 await b.manual({market:'新',date,issue:'2026278',numbers:'1 2 3 4 5 6 11',sourceName:'合成测试'});
 assert.equal((await a.load({date})).draws.新.length,1);
 const settings=(await a.load({date})).settings;settings.odds.新.rates['special-number'].rate='48';await a.settings(settings);
 assert.equal((await b.load({date})).settings.odds.新.rates['special-number'].rate,'47');
});
test('图片识别在切换后完成仍写原空间，其他空间不会收到完成通知',async t=>{
 let release,started;const gate=new Promise(r=>release=r),running=new Promise(r=>started=r);
 const {spaces,call,events,inbox}=await services(t,{nativeRequest:async request=>{if(request.command==='ocr'){started();await gate;return {text:'11各25',lines:[],engine:'test'};}return {};}});
 const b=spaces.create({name:'二组'});
 const batch=await call('inbox:images','default',{fields:{player:'小明',businessDate:date,name:'合成图片',source:'合成'},images:[{name:'synthetic.png',data:'data:image/png;base64,eA=='}]});
 await running;spaces.activate(b.id);
 await assert.rejects(call('inbox:images',b.id,{fields:{},images:[]}),/其他空间/);
 release();await inbox.stop();
 const stored=await call('inbox:get','default',batch.batch.id);assert(stored.batch.text.includes('11各25'));assert.equal(stored.batch.busy,false);
 assert.equal((await call('inbox:list',b.id,{})).total,0);assert(events.filter(([n])=>n==='inbox:changed').every(([,v])=>v.spaceId==='default'));
});
