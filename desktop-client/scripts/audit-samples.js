import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/core/parser.js';

const root = path.resolve(fileURLToPath(new URL('../../number-of-statistical-plug/oglang-test', import.meta.url)));
async function collect(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? collect(path.join(folder, e.name)) : e.name.endsWith('.og') ? [path.join(folder, e.name)] : []))).flat();
}
const started = performance.now();
const files = await collect(root);
const report = { businessDate: '2026-10-05', note: '统一日期仅用于工程回归，不代表原始样例年份。此报告衡量处理覆盖，不能代替人工金额正确率。', files: [], codes: {}, totals: { files: files.length, nonempty: 0, parsedLines: 0, reviewLines: 0, metadataLines: 0, parsedBets: 0, errors: 0, warnings: 0, unhandled: 0, crashes: 0 } };
for (const filename of files.sort()) {
  const text = await fs.readFile(filename, 'utf8');
  try {
    const p = parseDocument(text, { id: filename, name: path.relative(root, filename), businessDate: report.businessDate });
    const item = { file: path.relative(root, filename), nonempty: p.nonemptyLines, parsedBets: p.bets.filter(b => b.status === 'parsed').length,
      parsedLines: p.coverage.filter(l => l.status === 'parsed').length, reviewLines: p.coverage.filter(l => l.status === 'review').length, metadataLines: p.coverage.filter(l => l.status === 'metadata').length,
      errors: p.issues.filter(i => i.severity === 'error').length, warnings: p.issues.filter(i => i.severity === 'warning').length, unhandled: p.coverage.filter(l => l.status === 'unhandled').length };
    report.files.push(item);
    for (const key of Object.keys(item)) if (key in report.totals) report.totals[key] += item[key];
    p.issues.forEach(i => { report.codes[i.code] = (report.codes[i.code] || 0) + 1; });
  } catch (e) { report.files.push({ file: path.relative(root, filename), crash: e.message }); report.totals.crashes++; }
}
report.durationMs = Math.round(performance.now() - started);
await fs.mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../reports/sample-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.totals, durationMs: report.durationMs, diagnostics: report.codes }, null, 2));
if (report.totals.crashes || report.totals.unhandled) process.exitCode = 1;
