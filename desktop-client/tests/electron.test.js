import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import installReceipt from '../electron/receipt-image.cjs';
import closeDraft from '../electron/close-draft.cjs';

async function harness(writeFile = async () => {}, {primary=true}={}) {
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, fn) => handlers.set(name, fn);
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock:()=>primary,whenReady: async () => {}, getPath: () => '/tmp/songcai-test', quit() { this.quitCalled = true; },
  });
  let win;
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); win = this;
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {}, isDestroyed: () => false,
        send: name => this.sent.push(name),
      });
      this.sent = [];
    }
    setMenuBarVisibility() {}
    isMinimized(){return true;}
    restore(){this.restored=true;}
    show(){this.shown=true;}
    focus(){this.focused=true;}
    loadFile() {}
    close() {
      let prevented = false;
      this.emit('close', { preventDefault: () => { prevented = true; } });
      this.closed = !prevented;
    }
  }
  const renames = [],backups=[];
  const modules = {
    electron: { app, BrowserWindow, ipcMain, dialog: {showMessageBox:async()=>({response:0})} },
    './close-draft.cjs':closeDraft,
    './draft-recovery.cjs':{DraftRecovery:class{save(_space,input){backups.push(input);return {id:'backup'};}saved(){}hasCurrent(id){return id==='backup';}close(){}}},
    'node:path': path,
    'node:fs/promises': { writeFile, rename: async (...args) => renames.push(args) },
    './ai-review-service.cjs': async () => ({ ensure:async()=>({clearDocuments(){}}),close() {} }),
    './ledger-ai-lifecycle.cjs': {writeLedger:(store,_ai,input)=>store.write(input)},
    './inbox-service.cjs': async () => ({ stop: async () => {}, close() {} }),
    './settlement-service.cjs': async () => ({ close() {} }),
    './receipt-image.cjs': installReceipt,
    './space-store.cjs': {openSpaces:async()=>({get:()=>({}),ledger:()=>({write:value=>writeFile('ledger.sqlite',JSON.stringify(value))}),close(){}})},
  };
  vm.runInNewContext(await fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'), {
    require: id => modules[id], __dirname: '/app/electron', process: { platform: 'darwin', argv: [] }, TextDecoder,
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, win, ipcMain, renames, backups,call: (name, ...args) => handlers.get(name)({ sender: win.webContents }, ...args) };
}

test('桌面关闭会等待草稿落盘；连续写入按顺序保存最后一版', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const writes = [];
  const h = await harness(async (_file, text) => { await gate; writes.push(JSON.parse(text)); });
  const event = { sender: h.win.webContents };
  h.ipcMain.emit('project:flush-ready', event);
  h.win.close();
  assert.equal(h.win.closed, false);
  assert.deepEqual(h.win.sent, ['project:flush']);
  const first = h.call('project:write-draft', { revision: 1 });
  const last = h.call('project:write-draft', { revision: 2 });
  const close = h.call('project:flushed');
  await Promise.resolve();
  assert.equal(h.win.closed, false);
  release();
  await Promise.all([first, last, close]);
  assert.deepEqual(writes, [{ revision: 1 }, { revision: 2 }]);
  assert.equal(h.renames.length, 0);
  assert.equal(h.win.closed, true);
});

test('草稿保存失败时保留窗口，修复后可以重试关闭', async () => {
  let fail = true;
  const h = await harness(async () => { if (fail) throw new Error('disk full'); });
  const event = { sender: h.win.webContents };
  h.ipcMain.emit('project:flush-ready', event);
  h.win.close();
  await assert.rejects(h.call('project:write-draft', {}), /disk full/);
  await h.call('project:flush-failed',{});
  assert.equal(h.backups.length,1);
  assert.equal(h.win.closed, false);
  fail = false;
  h.win.close();
  await h.call('project:write-draft', { recovered: true });
  await h.call('project:flushed');
  assert.equal(h.win.closed, true);
});

test('最后一个窗口关闭后在 macOS 也完全退出，不留下持有旧资源的后台进程', async () => {
  const h = await harness();
  h.app.emit('window-all-closed');
  assert.equal(h.app.quitCalled, true);
});

test('第二实例启动不打开数据库或新窗口，已有实例恢复并聚焦',async()=>{
  const duplicate=await harness(async()=>{throw new Error('不应写库');},{primary:false});
  assert.equal(duplicate.win,undefined);assert.equal(duplicate.app.quitCalled,true);
  const primary=await harness();primary.app.emit('second-instance');
  assert(primary.win.restored&&primary.win.shown&&primary.win.focused);
});
