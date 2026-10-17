import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { restoreOcrSpaces } from '../src/core/ocr-spacing.js';
import { parseDocument, summarize } from '../src/core/parser.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/ocr-spacing.json', import.meta.url)));
export const expected = ['牛各20', '34 23,12各50', '34 23 23 1,12各50', '复试三中二23 44 42 1 23 41 2各10',
  '旧1 2 3各100元', '特码 01 11 21 31 41 各1000元', '特码1 11 1 11各100元', '特码231各100元', '特码123各100元',
  '红波100', '特码 01 02 03 各10.50元', '2026年10月5日 15:30'];
test('真实 Vision 几何回归：一位数、重复号码、金额、小数与时间全部保持边界', () => {
  const restored = restoreOcrSpaces(fixture);
  assert.deepEqual(restored.text.split('\n'), expected);
  assert.equal(restored.rawText, fixture.text);
  assert.equal(restored.text.replace(/\s/g, ''), fixture.text.replace(/\s/g, ''));
  assert.equal(restored.lines[2].rawText, fixture.lines[2].text);
});
test('空格恢复后的真实选号交给原解析器计费，不改变重复选号口径', () => {
  const lines = restoreOcrSpaces(fixture).text.split('\n');
  const parse = text => parseDocument(text, { businessDate: '2026-10-05', defaultPlayer: '测试玩家' });
  assert.equal(summarize([parse(lines[2])]).totalCents, 25000);
  assert.equal(summarize([parse(lines[3])]).totalCents, 20000); // 6个不同号码，C(6,3) × 10
  assert.equal(summarize([parse(lines[4])]).markets.旧, 30000);
});
test('缺少几何证据或两次识别的数字不同，不猜测拆分连续数字', () => {
  assert.equal(restoreOcrSpaces({ text: '特码231各100元' }).text, '特码231各100元');
  const altered = structuredClone(fixture); altered.spacingEvidence = { wordLines: [], characterLines: [] };
  assert.equal(restoreOcrSpaces(altered).text, fixture.text);
  for (const row of fixture.spacingEvidence.characterLines) {
    assert.ok(row.tokens.every(token => Number.isFinite(token.box.x)));
  }
  const disagreement = structuredClone(fixture);
  for (const list of Object.values(disagreement.spacingEvidence)) if (Array.isArray(list)) for (const row of list) for (const token of row.tokens) token.text = token.text.replace(/3/g, '9');
  assert.equal(restoreOcrSpaces(disagreement).lines[2].text, fixture.lines[2].text);
});
test('重叠字符框与错行证据不插入空格，保留原文供人工核对', () => {
  const bad = structuredClone(fixture);
  for (const row of bad.spacingEvidence.characterLines) for (const token of row.tokens) token.box.x = row.box.x;
  for (const row of bad.spacingEvidence.wordLines) row.box.y += 5000;
  assert.equal(restoreOcrSpaces(bad).text, fixture.text);
});
