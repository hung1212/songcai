import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { assertStopped, installPreview } = require('../scripts/install-mac-preview.cjs');

test('更新前检查主进程与助手进程，不能被相似目录混淆', () => {
  const app = '/tmp/松财-0.1.1-mac-x64/松财.app';
  for (const suffix of ['Contents/MacOS/松财', 'Contents/Frameworks/松财 Helper.app/Contents/MacOS/松财 Helper --type=gpu-process']) {
    assert.throws(() => assertStopped(app, () => ({ status: 0, stdout: `${app}/${suffix}\n` })), /仍在运行/);
  }
  assert.doesNotThrow(() => assertStopped(app, () => ({ status: 0, stdout: `/tmp/其他版本/松财.app/Contents/MacOS/松财\n` })));
});

test('进程检查被沙箱阻止时停止更新，不能把检查失败当成未运行', () => {
  assert.throws(() => assertStopped('/tmp/松财.app', () => ({ status: 1, stderr: 'Cannot get process list' })), /无法检查/);
  assert.throws(() => assertStopped('/tmp/松财.app', () => ({ error: new Error('denied') })), /无法检查/);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songcai-update-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, 'package.zip'); fs.writeFileSync(archive, 'test');
  const target = path.join(root, '松财-0.1.1-mac-x64');
  const writeApp = (directory, contents) => {
    const resource = path.join(directory, '松财.app/Contents/Resources');
    fs.mkdirSync(resource, { recursive: true }); fs.writeFileSync(path.join(resource, 'app.asar'), contents);
  };
  writeApp(target, 'old-package');
  let checks = 0;
  const runner = activeOnCheck => (command, args) => {
    if (command === 'ps') return { status: 0, stdout: ++checks === activeOnCheck ? `${target}/松财.app/Contents/MacOS/松财` : '' };
    if (command === 'ditto') writeApp(args.at(-1), 'new-package');
    return { status: 0, stdout: '' };
  };
  const contents = directory => fs.readFileSync(path.join(directory, '松财.app/Contents/Resources/app.asar'), 'utf8');
  return { root, target, archive, runner, contents };
}

test('更新中重新打开 app 时保留旧包，清理的只有临时暂存目录', t => {
  const f = fixture(t);
  assert.throws(() => installPreview(f.archive, f.target, f.runner(2)), /仍在运行/);
  assert.equal(f.contents(f.target), 'old-package');
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['package.zip', '松财-0.1.1-mac-x64'].sort());
});

test('确认完全退出后才替换应用，并保留可恢复的旧包', t => {
  const f = fixture(t);
  const result = installPreview(f.archive, f.target, f.runner(-1));
  assert.equal(f.contents(f.target), 'new-package');
  assert.equal(f.contents(result.backup), 'old-package');
});

test('拒绝把普通目录或符号链接当作应用目录替换', t => {
  const f = fixture(t);
  assert.throws(() => installPreview(f.archive, f.root, f.runner(-1)), /目标须为/);
  const link = path.join(f.root, '松财-link-mac-x64'); fs.symlinkSync(f.target, link);
  assert.throws(() => installPreview(f.archive, link, f.runner(-1)), /符号链接/);
});
