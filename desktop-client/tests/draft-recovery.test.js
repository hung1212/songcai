import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import * as core from '../src/core/ledger.js';
import {SpaceStore} from '../electron/space-store.cjs';
import {DraftRecovery} from '../electron/draft-recovery.cjs';
import createCloseDraft from '../electron/close-draft.cjs';
import vm from 'node:vm';

const project=text=>({schemaVersion:1,activeId:'a',storageRevision:0,documents:[{id:'a',name:'小明',text,businessDate:'2026-10-14',defaultPlayer:'小明',autoTitle:false}]});
function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-recovery-'));
  const spaces=new SpaceStore(directory,core),recovery=new DraftRecovery(directory,core,'session-one');
  t.after(()=>{spaces.close();recovery.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,spaces,recovery};
}
test('保存冲突保留数据库新内容，恢复副本跨重启保存最后一版原文',t=>{
  const {directory,spaces,recovery}=setup(t),ledger=spaces.ledger();
  const first=ledger.write(project('01各10'));
  ledger.write({...first,documents:project('02各20').documents});
  const unsaved={...first,documents:project('03各30\n04各40').documents};
  assert.throws(()=>ledger.write(unsaved),/其他窗口/);
  const a=recovery.save(spaces.get(),unsaved);
  const b=recovery.save(spaces.get(),{...unsaved,documents:project('03各30\n04各40\n05各50').documents});
  assert.equal(a.id,b.id);assert.equal(recovery.list().length,1);
  const reopened=new DraftRecovery(directory,core,'session-two');
  try{
    assert.equal(reopened.hasCurrent(b.id),false);
    const registry=reopened.restore(b.id,spaces);
    assert.notEqual(registry.activeId,'default');
    assert.equal(spaces.project(registry.activeId).documents[0].text,'03各30\n04各40\n05各50');
    assert.equal(spaces.project().documents[0].text,'02各20');
    assert.equal(reopened.list().length,0);
  }finally{reopened.close();}
});
test('成功保存只清当前会话当前空间的副本，不误删其他空间与旧会话',t=>{
  const {directory,spaces,recovery}=setup(t),b=spaces.create({name:'二组'});
  recovery.save(spaces.get(),project('01各10'));recovery.save(b,project('02各20'));
  const other=new DraftRecovery(directory,core,'session-two');
  try{other.save(spaces.get(),project('03各30'));recovery.saved('default');assert.equal(recovery.list().length,2);assert.deepEqual(recovery.list().map(x=>x.spaceName).sort(),['二组','默认空间']);}finally{other.close();}
});
test('恢复保留全部同名原文，使用独立空间且可重复恢复不同副本',t=>{
  const {spaces,recovery}=setup(t),input=project('01各10');input.documents.push({...input.documents[0],id:'b',text:'02各20'});
  const a=recovery.save(spaces.get(),input),first=recovery.restore(a.id,spaces);
  assert.deepEqual(spaces.project(first.activeId).documents.map(d=>d.text),['01各10','02各20']);
  assert.deepEqual(spaces.project(first.activeId).documents.map(d=>d.name),['小明','小明（恢复2）']);
  const b=recovery.save(spaces.get(),project('03各30')),second=recovery.restore(b.id,spaces);
  assert.notEqual(first.activeId,second.activeId);assert.notEqual(spaces.get(first.activeId).name,spaces.get(second.activeId).name);
  assert.throws(()=>recovery.restore(b.id,spaces),/已经恢复/);
});
test('副本写入失败时保留上次完整副本；恢复失败时仍可重试',t=>{
  const {spaces,recovery}=setup(t),backup=recovery.save(spaces.get(),project('01各10'));
  recovery.db.exec("CREATE TRIGGER fail_backup BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT,'磁盘故障'); END;");
  assert.throws(()=>recovery.save(spaces.get(),project('02各20')),/磁盘故障/);
  const originalCreate=spaces.create;spaces.create=()=>{throw new Error('空间创建失败');};
  assert.throws(()=>recovery.restore(backup.id,spaces),/空间创建失败/);assert.equal(recovery.list().length,1);
  spaces.create=originalCreate;const registry=recovery.restore(backup.id,spaces);
  assert.equal(spaces.project(registry.activeId).documents[0].text,'01各10');
});

function closing({response=0,safe=true,stop=async()=>{}}={}){
  const app=new EventEmitter(),win=new EventEmitter(),prompts=[],messages=[];
  let closed=0,quits=0;
  win.canFlushDraft=true;win.webContents={isDestroyed:()=>false,send:(...args)=>messages.push(args)};
  win.close=()=>closed++;app.quit=()=>quits++;
  const dialog={showMessageBox:async(_win,input)=>{prompts.push(input);return {response};}};
  const controller=createCloseDraft({app,dialog,window:()=>win,recovery:{hasCurrent:id=>safe&&id==='verified'},stop});controller.attach(win);
  return {app,win,controller,prompts,messages,dialog,counts:()=>({closed,quits})};
}
test('连续点关闭只触发一次flush；返回编辑后可再次关闭',async()=>{
  const c=closing();let prevented=0;const event={preventDefault:()=>prevented++};
  c.win.emit('close',event);c.win.emit('close',event);
  assert.equal(prevented,2);assert.equal(c.messages.length,1);
  await c.controller.failed({message:'冲突',backupId:'verified'});
  assert.equal(c.win.allowClose,undefined);assert.equal(c.win.flushingDraft,false);
  c.win.emit('close',event);assert.equal(c.messages.length,2);
});
test('关闭保存冲突后只有已验证当前副本才能退出',async()=>{
  const c=closing({response:1});
  await c.controller.failed({message:'保存冲突',backupId:'verified'});
  assert.deepEqual(c.counts(),{closed:1,quits:0});assert.equal(c.win.allowClose,true);
  assert.match(c.prompts[0].detail,/独立空间/);
  for(const backupId of [undefined,'旧会话副本']){
    const blocked=closing({response:1});await blocked.controller.failed({backupId,backupError:'磁盘已满'});
    assert.deepEqual(blocked.counts(),{closed:0,quits:0});assert.deepEqual(blocked.prompts[0].buttons,['返回编辑']);
    assert.equal(blocked.win.flushingDraft,false);
  }
});
test('Cmd+Q失败后保留副本可退出，取消退出重置quit状态',async()=>{
  const c=closing({response:1});c.app.emit('before-quit');await c.controller.failed({backupId:'verified'});
  assert.deepEqual(c.counts(),{closed:0,quits:1});
  const canceled=closing();canceled.app.emit('before-quit');await canceled.controller.failed({backupId:'verified'});
  await canceled.controller.flushed();assert.deepEqual(canceled.counts(),{closed:1,quits:0});
});
test('停止后台任务失败仍留在编辑界面且可重试',async()=>{
  const c=closing({response:1,stop:async()=>{throw new Error('后台任务失败');}});
  await c.controller.failed({backupId:'verified'});assert.deepEqual(c.counts(),{closed:0,quits:0});
  assert.equal(c.win.allowClose,undefined);assert.equal(c.win.flushingDraft,false);assert.equal(c.prompts.length,2);
});
test('原生提示只出现一次，避免重复退出弹窗',async()=>{
  const c=closing();let done;c.dialog.showMessageBox=()=>new Promise(resolve=>{done=resolve;});
  const pending=c.controller.failed({backupId:'verified'});await c.controller.failed({backupId:'verified'});
  done({response:0});await pending;assert.equal(c.win.flushingDraft,false);
});
test('preload关闭失败补取最新原文，等待提示结束才恢复编辑',async()=>{
  let exposed,handler,finalized=false;const calls=[];
  const ipcRenderer={removeAllListeners(){},on(channel,fn){if(channel==='project:flush')handler=fn;},send(){},
    async invoke(channel,payload){calls.push([channel,payload]);assert.equal(finalized,false);}};
  vm.runInNewContext(fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_key,value)=>exposed=value},ipcRenderer}),process:{argv:[]},
  });
  let current='首行';
  exposed.onBeforeClose(async()=>{current+='\n最新第二行';throw new Error('冲突');},async()=>{assert.equal(current,'首行\n最新第二行');return {id:'latest'};},()=>{finalized=true;});
  await handler();assert.equal(calls.length,1);assert.equal(calls[0][0],'project:flush-failed');assert.equal(calls[0][1].backupId,'latest');assert.equal(finalized,true);
});
