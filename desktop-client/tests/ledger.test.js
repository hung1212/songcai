import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../src/core/ledger.js';
import { LedgerStore } from '../electron/ledger-store.cjs';
import { computed, effectScope, nextTick, ref, watch } from 'vue';
const doc = (id, text, name = '') => ({ id, name, text, businessDate: '2026-10-05', defaultPlayer: '' });
const project = (documents, activeId = documents[0].id, storageRevision = 0) => ({ schemaVersion: 1, documents, activeId, storageRevision });
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songcai-ledger-')), store = new LedgerStore(root, core);
  t.after(() => { try { store.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}
test('未填写标题使用首位玩家，玩法声明不是玩家名', () => {
  assert.equal(core.ledgerTitle(doc('a', '特肖：牛各100\n小明：牛各20\n张三：牛各50')), '小明');
  assert.equal(core.ledgerTitle({ ...doc('a', '牛各20'), defaultPlayer: '小明' }), '小明');
  assert.equal(core.ledgerTitle(doc('a', '牛各20')), '未命名账目');
  assert.equal(core.ledgerTitle(doc('a', '小明：牛100', ' 今日账目 ')), '今日账目');
});
test('同名保存覆盖一条记录，当前编辑的版本优先且不重复统计', t => {
  const { store } = setup(t);
  const saved = store.write(project([doc('old', '小明：牛100')]));
  const updated = store.write(project([doc('new', '小明：牛200'), ...saved.documents], 'new', saved.storageRevision));
  assert.equal(updated.documents.length, 1); assert.equal(updated.documents[0].name, '小明');
  assert.equal(store.read().documents[0].text, '小明：牛200');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM ledger_documents').get().n, 1);
});
test('不同标题保留，切换选中账目并重启仍恢复原文和业务日期', t => {
  const { root, store } = setup(t);
  const saved = store.write(project([doc('a', '小明：牛100'), doc('b', '张三：牛200')], 'b'));
  store.close();
  const reopened = new LedgerStore(root, core);
  assert.deepEqual(reopened.read(), saved); reopened.close();
  assert.equal(fs.existsSync(path.join(root, 'draft.json')), false);
});
test('修改标题发生冲突时原子覆盖，非法原文不破坏已保存账目', t => {
  const { store } = setup(t);
  const saved = store.write(project([doc('a', '牛100', 'A'), doc('b', '牛200', 'B')]));
  const renamed = store.write(project([{ ...saved.documents[0], name: 'B' }, saved.documents[1]], 'a', saved.storageRevision));
  assert.equal(renamed.documents.length, 1); assert.equal(renamed.documents[0].text, '牛100');
  assert.throws(() => store.write(project([{ ...doc('broken', 'x'), text: null }], 'broken', renamed.storageRevision)));
  assert.deepEqual(store.read(), renamed);
});
test('旧文件只迁移一次并保留原件，同名旧数据加迁移后缀保全', t => {
  const { root, store } = setup(t);
  const legacy = JSON.stringify(project([doc('a', '牛100', '旧账'), doc('b', '牛200', '旧账')], 'b'));
  const filename = path.join(root, 'draft.json'); fs.writeFileSync(filename, legacy);
  let saved = store.read();
  assert.deepEqual(saved.documents.map(d => d.name), ['旧账', '旧账（迁移2）']);
  saved.documents[1].text = '牛300'; saved = store.write(saved);
  assert.deepEqual(store.read(), saved); assert.equal(fs.readFileSync(filename, 'utf8'), legacy);
});
test('迁移失败拒绝覆盖；多窗口旧版本写入被拒绝', t => {
  const broken = setup(t); fs.writeFileSync(path.join(broken.root, 'draft.json'), 'broken');
  assert.throws(() => broken.store.read(), /无法迁移/);
  assert.throws(() => broken.store.write(project([doc('a', '牛100')])), /无法迁移/);
  const { store } = setup(t); const first = store.write(project([doc('a', '牛100')]));
  const changed = store.write({ ...first, documents: [doc('a', '牛200')] });
  assert.throws(() => store.write(first), /其他窗口/); assert.deepEqual(store.read(), changed);
});

test('数据库回写的键顺序与默认字段不同，不触发自动保存／解析循环', async t => {
  const scope = effectScope(); t.after(() => scope.stop());
  const state = ref(project([doc('a', '小明：牛100', '小明')]));
  let saves = 0, parses = 0, lastSaved = core.ledgerSnapshotKey(state.value);
  scope.run(() => {
    const key = computed(() => core.ledgerSnapshotKey(state.value));
    watch(() => core.ledgerParseKey(state.value.documents), () => parses++);
    watch(key, value => {
      if (value === lastSaved) return;
      const echoed = core.canonicalLedger(state.value);
      lastSaved = core.ledgerSnapshotKey(echoed); saves++;
      assert.ok(saves < 3, '相同内容不应持续保存');
      state.value = { storageRevision: saves, ...echoed };
    });
  });
  state.value.documents[0].text = '小明：牛200';
  await nextTick(); await nextTick();
  assert.equal(saves, 1); assert.equal(parses, 1);
  assert.notEqual(JSON.stringify(state.value), JSON.stringify(project([doc('a', '小明：牛200', '小明')])));
  assert.equal(core.ledgerSnapshotKey(state.value), core.ledgerSnapshotKey(project([doc('a', '小明：牛200', '小明')])));
});

test('原文、日期和玩家改动使解析失效，切换账目与自动标题标记只影响保存', () => {
  const original = project([doc('a', '小明：牛100', '小明'), doc('b', '张三：牛200', '张三')]);
  for (const field of ['text', 'businessDate', 'defaultPlayer', 'name']) {
    const changed = structuredClone(original); changed.documents[0][field] += '改';
    assert.notEqual(core.ledgerSnapshotKey(changed), core.ledgerSnapshotKey(original));
    assert.notEqual(core.ledgerParseKey(changed.documents), core.ledgerParseKey(original.documents));
  }
  const switched = { ...original, activeId: 'b' };
  assert.notEqual(core.ledgerSnapshotKey(switched), core.ledgerSnapshotKey(original));
  assert.equal(core.ledgerParseKey(switched.documents), core.ledgerParseKey(original.documents));
  const auto = structuredClone(original); auto.documents[0].autoTitle = true;
  assert.notEqual(core.ledgerSnapshotKey(auto), core.ledgerSnapshotKey(original));
  assert.equal(core.ledgerParseKey(auto.documents), core.ledgerParseKey(original.documents));
});

test('拖动前后位置和末尾排序保存到SQLite，重启保留顺序与当前账目', t => {
  const {store,root}=setup(t);
  const initial=store.write(project([doc('a','1各20','甲'),doc('b','2各30','乙'),doc('c','3各40','丙')]));
  let documents=core.reorderDocuments(initial.documents,'c','a');
  assert.deepEqual(documents.map(d=>d.id),['c','a','b']);
  documents=core.reorderDocuments(documents,'c','b',true);
  assert.deepEqual(documents.map(d=>d.id),['a','b','c']);
  documents=core.reorderDocuments(documents,'a','c',true);
  const saved=store.write({...initial,documents});
  const reopened=new LedgerStore(root,core);t.after(()=>reopened.close());
  assert.deepEqual(reopened.read().documents.map(d=>d.id),['b','c','a']);assert.equal(reopened.read().activeId,initial.activeId);
  assert.equal(reopened.read().documents.find(d=>d.id==='a').text,'1各20');
  assert.equal(core.reorderDocuments(saved.documents,'unknown','a'),saved.documents);
  assert.equal(core.reorderDocuments(saved.documents,'a','a'),saved.documents);
});

test('一键清空原文保留自动标题、玩家绑定、顺序和菜单，重启后可恢复',t=>{
  const {root,store}=setup(t);
  const saved=store.write(project([{...doc('b','小明：新49各10'),autoTitle:true,defaultPlayer:'小明'}, {...doc('a','张三：旧1各20'),autoTitle:true}], 'b'));
  const {project:cleared,backup}=store.clearContents(saved);
  assert.deepEqual(cleared.documents.map(d=>[d.id,d.name,d.businessDate,d.defaultPlayer]),saved.documents.map(d=>[d.id,d.name,d.businessDate,d.defaultPlayer]));
  assert.ok(cleared.documents.every(d=>d.text===''&&!d.autoTitle&&!d.assistance&&!d.parserReview));
  assert.equal(backup.count,2);assert.equal(store.read().documents.length,2);
  const reopened=new LedgerStore(root,core);t.after(()=>reopened.close());
  assert.deepEqual(reopened.clearState(),backup);
  const switched=reopened.write({...reopened.read(),activeId:'a'}),restored=reopened.restoreContents(switched);
  assert.deepEqual(restored.project.documents,saved.documents);assert.equal(restored.project.activeId,'a');assert.equal(restored.backup,null);assert.equal(reopened.clearState(),null);
});
test('旧版本清空或撤销被拒绝，新增投注后撤销不会覆盖新内容',t=>{
  const {store}=setup(t);const saved=store.write(project([doc('a','新49各10','甲')]));
  assert.throws(()=>store.clearContents({storageRevision:0}),/变化/);assert.deepEqual(store.read(),saved);
  const cleared=store.clearContents(saved).project;
  assert.throws(()=>store.restoreContents(saved),/变动/);
  const edited=store.write({...cleared,documents:cleared.documents.map(d=>({...d,text:'新01各20'}))});
  assert.throws(()=>store.restoreContents(edited),/新内容/);assert.deepEqual(store.read(),edited);
});
test('清空后再次清空空账目，不会覆盖最近一次恢复备份',t=>{
  const {store}=setup(t);const saved=store.write(project([doc('a','新49各10','甲')]));
  const cleared=store.clearContents(saved);assert.throws(()=>store.clearContents(cleared.project),/已经为空/);
  assert.deepEqual(store.clearState(),cleared.backup);assert.deepEqual(store.restoreContents(cleared.project).project.documents,saved.documents);
});
test('清空或恢复写入失败时整笔SQLite事务回滚',t=>{
  const {store}=setup(t);const saved=store.write(project([doc('a','新49各10','甲')]));
  store.db.exec("CREATE TRIGGER fail_clear BEFORE INSERT ON ledger_documents WHEN NEW.original_text='' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(()=>store.clearContents(saved),/fixture failure/);assert.deepEqual(store.read(),saved);assert.equal(store.clearState(),null);
  store.db.exec('DROP TRIGGER fail_clear');const cleared=store.clearContents(saved);
  store.db.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON ledger_documents WHEN NEW.original_text<>'' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(()=>store.restoreContents(cleared.project),/fixture failure/);assert.deepEqual(store.read(),cleared.project);assert.deepEqual(store.clearState(),cleared.backup);
});
