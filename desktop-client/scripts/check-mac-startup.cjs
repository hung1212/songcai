const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'darwin' || !process.argv[2]) {
  console.error('在 macOS 上使用：node scripts/check-mac-startup.cjs path/to/松财.app');
  process.exit(1);
}
const app = path.resolve(process.argv[2]);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const checkNetwork = process.argv.includes('--draw-network-check');
const checkConflict=process.argv.includes('--save-conflict-check');
const result = spawnSync(path.join(app, 'Contents/MacOS/松财'), ['--startup-check', ...(checkNetwork ? ['--draw-network-check'] : []),...(checkConflict?['--save-conflict-check']:[])], {
  env, encoding: 'utf8', timeout: checkNetwork ? 75000 : 45000,
});
const marker = result.stdout?.match(/^SONGCAI_STARTUP_OK (.+)$/m);
if (result.error || result.status !== 0 || !marker) {
  console.error(result.error?.message || `启动失败：exit=${result.status}, signal=${result.signal}`);
  console.error(result.stdout || '', result.stderr || '');
  process.exit(1);
}
const report = { checkedAt: new Date().toISOString(), app, arch: process.arch, os: os.release(), stages: JSON.parse(marker[1]) };
if (checkNetwork) report.drawNetwork = JSON.parse(result.stdout.match(/^SONGCAI_DRAW_NETWORK (.+)$/m)[1]);
if (!Object.values(report.stages).every(value => value === true)) throw new Error('启动验证不完整');
const reports = path.join(__dirname, '../reports');
fs.mkdirSync(reports, { recursive: true });
const receiptPath=result.stdout?.match(/^SONGCAI_RECEIPT_IMAGE (.+)$/m)?.[1];
if(receiptPath)fs.copyFileSync(receiptPath,path.join(reports,'receipt-startup.png'));
fs.writeFileSync(path.join(reports, checkConflict?'mac-close-recovery.json':'mac-startup.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
