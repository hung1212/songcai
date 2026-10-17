// Preview updates must never replace resources used by a live Electron process.
// Its cached ASAR header would read the new archive at old byte offsets.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function assertStopped(appDirectory, run = spawnSync) {
  const result = run('ps', ['-axo', 'args='], { encoding: 'utf8' });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('无法检查松财是否仍在运行，已停止更新；请在正常终端环境重试。');
  }
  const prefix = path.resolve(appDirectory) + '/Contents/';
  if (result.stdout.split('\n').some(line => line.trim().startsWith(prefix))) {
    throw new Error('松财仍在运行，已停止更新。请按 ⌘Q 完全退出，再重新执行更新。');
  }
}

function installPreview(archive, targetDirectory, run = spawnSync) {
  const target = path.resolve(targetDirectory), zip = path.resolve(archive);
  if (!fs.statSync(zip).isFile() || !zip.endsWith('.zip')) throw new Error('请提供有效的 Mac ZIP 包');
  if (!/^松财-.+-mac-(?:x64|arm64)$/.test(path.basename(target))) throw new Error('目标须为松财版本解压目录，例如“松财-0.1.1-mac-x64”');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('更新目标不能是符号链接');
  if (fs.existsSync(target) && !fs.existsSync(path.join(target, '松财.app/Contents/Resources/app.asar'))) throw new Error('目标不是已有的松财应用目录，已停止更新');
  assertStopped(path.join(target, '松财.app'), run);
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.songcai-update-'));
  let backup = null;
  const command = (name, args) => {
    const result = run(name, args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`${name}失败：${result.error?.message || result.stderr}`);
  };
  try {
    command('ditto', ['-x', '-k', zip, stage]);
    const app = path.join(stage, '松财.app');
    if (!fs.existsSync(path.join(app, 'Contents/Resources/app.asar'))) throw new Error('ZIP中缺少松财应用');
    command('codesign', ['--verify', '--deep', '--strict', app]);
    // Check again after extraction: the user may have reopened the app.
    assertStopped(path.join(target, '松财.app'), run);
    if (fs.existsSync(target)) {
      backup = `${target}-更新前备份-${Date.now()}`;
      fs.renameSync(target, backup);
    }
    try { fs.renameSync(stage, target); }
    catch (error) { if (backup) fs.renameSync(backup, target); throw error; }
    return { app: path.join(target, '松财.app'), backup };
  } finally {
    // Only remove our own temporary staging folder, never user app/data paths.
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { assertStopped, installPreview };
if (require.main === module) {
  try {
    if (process.platform !== 'darwin') throw new Error('此更新脚本仅用于 macOS');
    const archive = process.argv[2];
    if (!archive) throw new Error('用法：node scripts/install-mac-preview.cjs <ZIP路径> [解压目录]');
    console.log(JSON.stringify(installPreview(archive, process.argv[3] || path.resolve(archive).replace(/\.zip$/, '')), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
