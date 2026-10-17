import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import installInbox from '../electron/inbox-service.cjs';

const fields = { name: '收藏采集测试', businessDate: '2026-10-05', player: '测试玩家', text: '' };
const crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const target = { id: '42', pid: 1234, name: '测试收藏', bounds: { X: 0, Y: 0, Width: 800, Height: 800 } };
async function harness(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songcai-capture-'));
  const handlers = {}, events = new EventEmitter(), calls = [];
  let screen = 0, imageNumber = 0, reading = false;
  const image = index => ({ isEmpty: () => false, getSize: () => ({ width: 800, height: 800 }), crop() { return this; }, toPNG: () => Buffer.from(`test-image-${index}`), toDataURL: () => 'data:image/png;base64,eA==' });
  const webContents = { isDestroyed: () => false, send: (name, value) => events.emit(name, value) };
  const electron = {
    app: { getPath: () => root, isPackaged: false }, ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    nativeImage: { createFromDataURL: () => image(++imageNumber) },
    desktopCapturer: { getSources: async () => [{ id: 'window:42:0', thumbnail: image(screen) }] },
    clipboard: {}, systemPreferences: {}, shell: {}, dialog: {},
  };
  const service = await installInbox({ electron, window: () => ({ webContents }), sleep: async () => {}, nativeRequest: async (request, signal) => {
    calls.push(request.command);
    if (request.command === 'windows') return { windows: [target] };
    if (request.command === 'scroll') { screen = Math.min(screen + 1, 1); return { ok: true }; }
    if (request.command === 'check' && options.loseFocus && screen > 0) throw new Error('微信已失去前台');
    if (request.command === 'ocr') {
      reading = true;
      if (options.ocrFailure) throw new Error('OCR不可用');
      if (options.waitOcr) await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('采集已停止')), { once: true }); });
      if (options.ocrResult) return options.ocrResult;
      return { text: screen ? '特肖牛200元' : '旧 1 2各100元', lines: [], engine: 'test' };
    }
    return { ok: true };
  } });
  t.after(async () => { await service.stop(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const call = (name, value) => handlers[`inbox:${name}`]({ sender: webContents }, value);
  const wait = async id => {
    if (!(await call('get', id)).batch.busy) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('采集测试超时')), 3000);
      const listener = async () => {
        if (!(await call('get', id)).batch.busy) { clearTimeout(timer); events.removeListener('inbox:changed', listener); resolve(); }
      };
      events.on('inbox:changed', listener); listener();
    });
  };
  return { call, wait, calls, service, events, reading: () => reading };
}

test('收藏逐页保存截图与原始OCR，画面停滞只进入范围核对', async t => {
  const h = await harness(t);
  const initial = await h.call('capture', { fields, windowId: target.id, crop, maxPages: 10, atStart: true });
  await h.wait(initial.batch.id);
  const { batch, analysis } = await h.call('get', initial.batch.id);
  assert.equal(batch.assets.length, 2); assert.equal(batch.pages.length, 2); assert.equal(batch.busy, false);
  assert.equal(batch.capture.status, 'range-review'); assert.equal(analysis.eligible, false);
  assert.equal(batch.pages[0].text, '旧 1 2各100元'); assert.equal(analysis.summary.markets.旧, 40000);
  assert.match(batch.problems.join(), /画面未变化/);
  assert.equal(h.calls.filter(command => command === 'ocr').length, 2);
});

test('切换窗口立即暂停，保留之前页面且不继续滚动其他窗口', async t => {
  const h = await harness(t, { loseFocus: true });
  const initial = await h.call('capture', { fields, windowId: target.id, crop, maxPages: 10, atStart: true });
  await h.wait(initial.batch.id); const { batch } = await h.call('get', initial.batch.id);
  assert.equal(batch.assets.length, 1); assert.equal(batch.capture.status, 'interrupted');
  assert.equal(h.calls.filter(command => command === 'scroll').length, 1);
  assert.match(batch.problems.join(), /失去前台/);
});

test('多图识别失败仍保存所有原图，不能静默丢弃后续附件', async t => {
  const h = await harness(t, { ocrFailure: true });
  const initial = await h.call('images', { fields, images: [{ name: '第一张', data: 'data:image/png;base64,eA==' }, { name: '第二张', data: 'data:image/png;base64,eA==' }] });
  await h.wait(initial.batch.id); const { batch, analysis } = await h.call('get', initial.batch.id);
  assert.equal(batch.assets.length, 2); assert.equal(batch.pages.length, 0); assert.equal(analysis.eligible, false);
  assert.equal(batch.problems.length, 2);
});

test('停止正在识别的任务保存当前截图，关闭等待任务收尾', async t => {
  const h = await harness(t, { waitOcr: true });
  const initial = await h.call('capture', { fields, windowId: target.id, crop, maxPages: 10, atStart: true });
  for (let i = 0; i < 20 && !h.reading(); i++) await new Promise(resolve => setImmediate(resolve));
  await h.service.stop();
  const { batch } = await h.call('get', initial.batch.id);
  assert.equal(batch.assets.length, 1); assert.equal(batch.busy, false); assert.equal(batch.capture.status, 'interrupted');
});

test('续读不会覆盖用户已校正的文字，也不会自动入账', async t => {
  const h = await harness(t);
  const initial = await h.call('capture', { fields, windowId: target.id, crop, maxPages: 1, atStart: true });
  await h.wait(initial.batch.id);
  let { batch } = await h.call('get', initial.batch.id);
  batch = (await h.call('update', { id: batch.id, revision: batch.revision, patch: { text: '旧 1 2各200元' } })).batch;
  await h.call('capture', { fields, windowId: target.id, crop, maxPages: 5, atStart: true, batchId: batch.id, revision: batch.revision });
  await h.wait(batch.id);
  const continued = (await h.call('get', batch.id)).batch;
  assert.match(continued.text, /1 2各200元/); assert.equal(continued.assets.length, 2);
  assert.equal(continued.state, 'draft'); assert.equal(continued.review.range, false);
});

test('数字间距修复进入解析稿，原始 OCR 独立保留且不自动确认', async t => {
  const ocrResult = JSON.parse(fs.readFileSync(new URL('./fixtures/ocr-spacing.json', import.meta.url)));
  const h = await harness(t, { ocrResult });
  const initial = await h.call('images', { fields, images: [{ name: '测试图', data: 'data:image/png;base64,eA==' }] });
  await h.wait(initial.batch.id);
  const { batch } = await h.call('get', initial.batch.id);
  assert.match(batch.text, /34 23 23 1,12各50/); assert.equal(batch.pages[0].rawText, ocrResult.text);
  assert.ok(batch.pages[0].spacingChanges.length); assert.equal(batch.review.content, false);
});

test('原图重新识别新建草稿，保留旧校正文字和独立附件并提示重复', async t => {
  const h = await harness(t);
  const initial = await h.call('images', { fields, images: [{ name: '原图', data: 'data:image/png;base64,eA==' }] });
  await h.wait(initial.batch.id);
  let { batch } = await h.call('get', initial.batch.id);
  batch = (await h.call('update', { id: batch.id, revision: batch.revision, patch: { text: '手动修正 1各500元' } })).batch;
  const newer = await h.call('reocr', { id: batch.id, revision: batch.revision }); await h.wait(newer.batch.id);
  assert.equal((await h.call('get', batch.id)).batch.text, '手动修正 1各500元');
  const result = await h.call('get', newer.batch.id);
  assert.notEqual(result.batch.assets[0].id, batch.assets[0].id); assert.equal(result.batch.assets[0].sha256, batch.assets[0].sha256);
  assert.equal(result.batch.state, 'draft'); assert.equal(result.analysis.duplicates.length, 1);
  assert.match(result.batch.problems.join(), /重新识别/);
});
