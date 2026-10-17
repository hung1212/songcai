import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightText } from '../src/core/highlight.js';
const of = (text, kind) => highlightText(text).filter(t => t.kind === kind).map(t => t.text);
test('玩法紫色、生肖号码蓝色、金额橙色，保留原文空格', () => {
  const text = '特肖牛 各100元';
  assert.deepEqual(of(text, 'play'), ['特肖']); assert.deepEqual(of(text, 'selection'), ['牛']);
  assert.deepEqual(of(text, 'amount'), ['100']); assert.equal(highlightText(text).map(t => t.text).join(''), text);
});
test('区分组合玩法的数字、选号与小数金额，支持分类和中文金额', () => {
  assert.deepEqual(of('三中二 01 13 25 各10.50元', 'play'), ['三中二']);
  assert.deepEqual(of('三中二 01 13 25 各10.50元', 'selection'), ['01', '13', '25']);
  assert.deepEqual(of('三中二 01 13 25 各10.50元', 'amount'), ['10.50']);
  assert.deepEqual(of('天肖各一百元\n红波100\n特肖牛100', 'amount'), ['一百', '100', '100']);
});
test('玩家名、HTML样式文字、换行和全角数字不被修改', () => {
  const text = '牛先生：特肖牛 各１００元\r\n<script>hello</script>\n';
  assert.equal(highlightText(text).map(t => t.text).join(''), text);
  assert.deepEqual(of(text, 'selection'), ['牛']); assert.deepEqual(of(text, 'amount'), ['１００']);
  assert.equal(highlightText('牛先生：')[0].kind, '');
});
