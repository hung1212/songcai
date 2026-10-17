import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../src/core/inbox.js';
import { InboxStore } from '../electron/inbox-store.cjs';
import { validCrop } from '../electron/inbox-service.cjs';

const fields = { businessDate: '2026-10-05', player: '小明', source: '小明私聊', text: '旧 1 2 3 各100元\n特肖虎100元', name: '小明收藏' };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songcai-inbox-test-'));
  const store = new InboxStore(root, core);
  t.after(() => { try { store.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
  return { store, root };
}
function reviewed(store, id) {
  const batch = store.get(id);
  return store.update(id, batch.revision, { review: { source: true, content: true, range: true, warnings: true, duplicates: true } }).batch;
}
const entry = batch => ({ id: batch.id, revision: batch.revision });

test('收件箱复用市场继承，未核对时不能计入账目', t => {
  const { store } = setup(t); const batch = store.create(fields);
  assert.equal(store.detail(batch.id).analysis.summary.markets.旧, 40000);
  assert.equal(store.confirm([entry(batch)]).rejected.length, 1);
  assert.equal(store.list().summary.totalCents, 0);
  const ready = reviewed(store, batch.id);
  assert.equal(store.confirm([entry(ready)]).posted.length, 1);
  assert.equal(store.list().summary.markets.旧, 40000);
});

test('同一人独立两份资料不继承上份旧市场，A-B-A也重置', t => {
  const { store } = setup(t);
  const first = store.create(fields), second = store.create({ ...fields, text: '特肖虎100元' });
  assert.equal(store.detail(first.id).analysis.summary.markets.旧, 40000);
  assert.equal(store.detail(second.id).analysis.summary.markets.新, 10000);
  const mixed = store.create({ ...fields, multiplePlayers: true, text: '小明：旧 1各100\n张三：特肖虎100\n小明：特肖虎100' });
  const check = store.detail(mixed.id).analysis;
  assert.equal(check.summary.markets.新, 20000); assert.equal(check.summary.markets.旧, 10000);
});

test('两个真实相同消息均保留，不按正文哈希删除', t => {
  const { store } = setup(t);
  const batch = store.create({ ...fields, text: '特肖虎100\n特肖虎100' });
  const check = store.detail(batch.id).analysis;
  assert.equal(check.result.bets.length, 2); assert.equal(check.summary.totalCents, 20000);
});

test('重复点击、旧请求重试和重新启动都不重复入账', t => {
  const { store, root } = setup(t); const batch = reviewed(store, store.create(fields).id);
  assert.equal(store.confirm([entry(batch), entry(batch)]).posted.length, 1);
  assert.equal(store.confirm([entry(batch)]).already.length, 1);
  const connection = new InboxStore(root, core);
  assert.equal(connection.confirm([entry(batch)]).already.length, 1);
  assert.equal(connection.list().summary.totalCents, 40000); connection.close();
});

test('修改金额使已勾选核对失效，旧版本确认被拒绝', t => {
  const { store } = setup(t); const before = reviewed(store, store.create(fields).id);
  const after = store.update(before.id, before.revision, { text: '特肖虎1000', review: before.review }).batch;
  assert.equal(after.review.source, false);
  assert.equal(store.confirm([entry(before)]).rejected.length, 1);
  assert.equal(store.confirm([entry(after)]).rejected.length, 1);
  assert.throws(() => store.update(before.id, before.revision, { text: '1各100' }), /已有更新/);
});

test('原文署名冲突、取消指令、异常号码不能混入批量入账', t => {
  const { store } = setup(t);
  for (const text of ['张三：特肖虎100', '50各100', '特肖虎100\n上条取消']) {
    const batch = reviewed(store, store.create({ ...fields, text }).id);
    assert.equal(store.confirm([entry(batch)]).rejected.length, 1);
  }
  assert.equal(store.list().summary.totalCents, 0);
});

test('OCR金额语法合法仍须核对原图，收藏另须确认读取范围', t => {
  const { store } = setup(t); const batch = store.create({ ...fields, kind: 'favorite' });
  let next = store.update(batch.id, batch.revision, { review: { source: true } }).batch;
  assert.equal(store.confirm([entry(next)]).rejected.length, 1);
  next = store.update(next.id, next.revision, { review: { source: true, content: true } }).batch;
  assert.equal(store.confirm([entry(next)]).rejected.length, 1);
  next = reviewed(store, batch.id);
  assert.equal(store.confirm([entry(next)]).posted.length, 1);
});

test('两份相同资料必须核对重复；确认是真实第二次后才追加', t => {
  const { store } = setup(t); const first = reviewed(store, store.create(fields).id);
  store.confirm([entry(first)]);
  let second = store.create(fields);
  assert.equal(store.detail(second.id).analysis.duplicates.length, 1);
  second = store.update(second.id, second.revision, { review: { source: true } }).batch;
  assert.equal(store.confirm([entry(second)]).rejected.length, 1);
  second = reviewed(store, second.id);
  assert.equal(store.confirm([entry(second)]).posted.length, 1);
  assert.equal(store.list().summary.totalCents, 80000);
});

test('批量确认异常项留待处理，合格项可独立入账', t => {
  const { store } = setup(t); const good = reviewed(store, store.create(fields).id), bad = store.create({ ...fields, text: '缺金额' });
  const result = store.confirm([entry(good), entry(bad)]);
  assert.deepEqual(result.posted, [good.id]); assert.equal(result.rejected.length, 1);
  assert.equal(store.get(bad.id).state, 'draft');
});

test('确认事务故障不留下部分新增账目，已入账原文锁定', t => {
  const { store } = setup(t); const good = reviewed(store, store.create(fields).id);
  assert.throws(() => store.confirm([entry(good), { id: 'missing', revision: 1 }]), /不存在/);
  assert.equal(store.list().summary.totalCents, 0);
  store.confirm([entry(good)]);
  assert.throws(() => store.update(good.id, store.get(good.id).revision, { text: '1各200' }), /不能修改/);
});

test('异常中断恢复原图和已有文字，不能标为采集完成', t => {
  const { store } = setup(t); const batch = store.create({ ...fields, kind: 'favorite' });
  batch.busy = true; batch.capture = { status: 'running' }; store.save(batch); store.recover();
  const restored = store.get(batch.id);
  assert.equal(restored.busy, false); assert.equal(restored.text, fields.text);
  assert.equal(restored.capture.status, 'interrupted'); assert.match(restored.problems[0], /中断/);
});

test('备份恢复保持原 ID 和已确认金额；再次恢复不会新增账目', t => {
  const { store } = setup(t); const source = reviewed(store, store.create(fields).id); store.confirm([entry(source)]);
  const backup = store.backup();
  const destination = setup(t).store;
  assert.equal(destination.restore(backup).restored, 1);
  assert.equal(destination.list().summary.totalCents, 40000);
  assert.equal(destination.restore(backup).skipped, 1);
  assert.equal(destination.list().summary.totalCents, 40000);
  backup.batches[0].text = '1各200';
  assert.equal(destination.restore(backup).conflicts, 1);
  assert.equal(destination.get(source.id).text, fields.text);
});

test('篡改备份金额不能按旧的已入账结果恢复', t => {
  const { store } = setup(t); const batch = reviewed(store, store.create(fields).id); store.confirm([entry(batch)]);
  const backup = store.backup(); backup.batches[0].text = '特肖虎1000';
  const destination = setup(t).store; destination.restore(backup);
  assert.equal(destination.get(batch.id).state, 'draft'); assert.equal(destination.list().summary.totalCents, 0);
});

test('原图备份保留内容哈希；缺图拒绝整个新导入批次', t => {
  const { store } = setup(t); const batch = store.create(fields);
  const bytes = Buffer.from('89504e470d0a1a0a01020304', 'hex');
  const image = store.addAsset(batch.id, bytes, '原图', { width: 1, height: 1 });
  const backup = store.backup(); const destination = setup(t).store;
  destination.restore(backup);
  assert.deepEqual(fs.readFileSync(destination.assetPath(image.id)), bytes);
  const missing = setup(t).store;
  backup.assets = [];
  assert.throws(() => missing.restore(backup), /缺少原图/); assert.equal(missing.all().length, 0);
});

test('原始 OCR、恢复空格的文字和记录经过备份仍可核对', t => {
  const { store } = setup(t); const source = store.create({ ...fields, kind: 'image' });
  const asset = store.addAsset(source.id, Buffer.from('89504e470d0a1a0a01020304', 'hex'), '原图', { width: 1, height: 1 });
  const batch = store.get(source.id);
  batch.pages = [{ assetId: asset.id, text: '旧1 2 3各100元', rawText: '旧123各100元', spacingChanges: [{ line: 1, original: '123', restored: '1 2 3' }], lowConfidenceLines: [1] }]; store.save(batch);
  const destination = setup(t).store; destination.restore(store.backup());
  const restored = destination.get(batch.id).pages[0];
  assert.equal(restored.rawText, '旧123各100元'); assert.equal(restored.text, '旧1 2 3各100元');
  assert.deepEqual(restored.spacingChanges, batch.pages[0].spacingChanges);
});

test('不同资料超过200份仍可分页保存，来源映射只在核对后建立', t => {
  const { store } = setup(t);
  for (let i = 0; i < 205; i++) store.create({ ...fields, name: `记录${i}` });
  assert.equal(store.list().total, 205); assert.equal(store.list().items.length, 40); assert.equal(store.list().pages, 6);
  assert.equal(store.list().mappings.length, 0);
  reviewed(store, store.list().items[0].id);
  assert.deepEqual(store.list().mappings.map(item => ({ ...item })), [{ source: '小明私聊', player: '小明' }]);
});

test('跨页合并只给建议，单行或整屏重复都保留原文待核对', () => {
  const pages = [{ text: '旧\n01 02各100元\n特肖虎100元' }, { text: '01 02各100元\n特肖虎100元\n特肖牛200元' }];
  const original = JSON.stringify(pages), combined = core.stitchPages(pages);
  assert.equal(JSON.stringify(pages), original);
  assert.equal(combined.overlaps.length, 1); assert.match(combined.problems.join(), /核对/);
  assert.equal(core.stitchPages([{ text: '虎100' }, { text: '虎100\n牛100' }]).text, '虎100\n虎100\n牛100');
  const repeated = core.stitchPages([pages[0], pages[0]]);
  assert.equal(repeated.overlaps.length, 0); assert.equal(repeated.text.split('\n').length, 6);
});

test('框选范围超出窗口、非法日期与过长原文被拒绝', () => {
  assert.throws(() => validCrop({ x: -1, y: 0, width: 0.5, height: 0.5 }));
  assert.throws(() => validCrop({ x: 0.8, y: 0, width: 0.5, height: 0.5 }));
  assert.throws(() => validCrop({ x: NaN, y: 0, width: 0.5, height: 0.5 }));
  assert.throws(() => core.createBatch({ ...fields, businessDate: undefined }, 'id'), /日期/);
  assert.throws(() => core.createBatch({ ...fields, text: '1'.repeat(500001) }, 'id'), /50万/);
});

test('跳过重复采集可恢复待核对，不能直接改变已入账记录', t => {
  const { store } = setup(t); const batch = store.create(fields);
  const skipped = store.skip(batch.id, batch.revision); assert.equal(skipped.state, 'skipped');
  const restored = store.skip(batch.id, skipped.revision); assert.equal(restored.state, 'draft');
  store.confirm([entry(reviewed(store, batch.id))]);
  assert.throws(() => store.skip(batch.id, store.get(batch.id).revision), /不能跳过/);
});
