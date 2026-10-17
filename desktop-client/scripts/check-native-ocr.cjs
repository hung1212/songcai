const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { runHelper } = require('../electron/inbox-service.cjs');
(async () => {
  const { restoreOcrSpaces } = await import('../src/core/ocr-spacing.js');
  const root = path.resolve(__dirname, '..');
  const raw = await runHelper({ command: 'ocr', path: path.join(root, 'tests/fixtures/ocr-numbers.png') }, { base: path.join(root, 'native') });
  const result = restoreOcrSpaces(raw);
  const expected = ['牛各20', '34 23,12各50', '34 23 23 1,12各50', '复试三中二23 44 42 1 23 41 2各10',
    '旧1 2 3各100元', '特码 01 11 21 31 41 各1000元', '特码1 11 1 11各100元', '特码231各100元', '特码123各100元',
    '红波100', '特码 01 02 03 各10.50元', '2026年10月5日 15:30'];
  assert.deepEqual(result.text.split('\n'), expected);
  assert.equal(result.text.replace(/\s/g, ''), raw.text.replace(/\s/g, ''));
  const report = { checkedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, passed: expected.length,
    rawText: result.rawText, text: result.text, spacingChanges: result.spacingChanges };
  fs.writeFileSync(path.join(root, 'reports/ocr-spacing.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`本地 OCR ${expected.length} 行回归通过，恢复 ${result.spacingChanges.length} 处号码分隔；金额与数字内容保持不变。`);
})().catch(error => { console.error(error); process.exitCode = 1; });
