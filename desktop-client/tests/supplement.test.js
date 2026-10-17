import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, summarize } from '../src/core/parser.js';
import { CATEGORY_ALIASES, FIVE_ELEMENTS } from '../src/core/classifications.js';

const parse = (text, businessDate = '2026-10-05') => parseDocument(text, { businessDate, defaultPlayer: '测试玩家' });
const valid = (text, date) => {
  const result = parse(text, date);
  assert.deepEqual(result.issues.filter(i => i.severity === 'error'), [], JSON.stringify(result.issues));
  return result;
};

test('天肖逐号计费，保留原词、生肖、日期与展开号码', () => {
  const p = valid('天肖各100');
  const b = p.bets[0];
  assert.equal(b.playType, 'special-number');
  assert.equal(b.count, 25);
  assert.equal(b.totalCents, 250000);
  assert.deepEqual(b.expansions[0].members, [...'龙兔牛马猴猪']);
  assert.equal(b.expansions[0].source, '天肖');
  assert.equal(b.expansions[0].businessDate, '2026-10-05');
  assert.deepEqual(b.expansions[0].numbers, b.values);
  assert.equal(valid('天肖各100', '2027-02-05').bets[0].count, 25);
  assert.equal(valid('天肖各100', '2027-02-06').bets[0].totalCents, 240000);
});

test('所有分类及别名解析；红肖不同于红波，单笔不同于单数', () => {
  for (const c of CATEGORY_ALIASES) {
    const p = valid(`${c.alias}：各100`);
    assert.equal(p.bets[0].player, '测试玩家');
    assert.deepEqual(p.bets[0].expansions[0].members, c.members);
    const expected = c.members.flatMap(a => p.rule.zodiac[a]);
    assert.deepEqual(p.bets[0].values, expected);
    assert.equal(p.bets[0].totalCents, expected.length * 10000);
  }
  assert(valid('红肖各100').bets[0].values.includes(25));
  assert(!valid('红波各100').bets[0].values.includes(25));
  assert(valid('单笔生肖各100').bets[0].values.includes(2));
  assert.equal(valid('特肖天肖各100').bets[0].totalCents, 60000);
});

test('五行固定且完整覆盖49个号码；跨农历年不轮转', () => {
  assert.deepEqual(Object.values(FIVE_ELEMENTS).flat().sort((a, b) => a - b), Array.from({ length: 49 }, (_, i) => i + 1));
  for (const [element, numbers] of Object.entries(FIVE_ELEMENTS)) {
    const a = valid(`${element}各100`, '2026-02-16').bets[0];
    const b = valid(`${element}行各100`, '2027-02-06').bets[0];
    assert.deepEqual(a.values, numbers);
    assert.deepEqual(a.values, b.values);
    assert.equal(a.totalCents, numbers.length * 10000);
    assert.equal(a.expansions[0].fixed, true);
  }
});

test('波色整项与特码逐号保持不同身份和号码分布', () => {
  const direct = valid('红波100');
  assert.equal(direct.bets[0].playType, 'wave');
  assert.deepEqual(direct.bets[0].values, ['红波']);
  assert.equal(summarize([direct]).totalCents, 10000);
  assert(summarize([direct]).numbers.every(n => !n.cents));
  for (const text of ['红波各100', '红波各号100', '红波每号100', '特码红波100']) {
    const p = valid(text);
    assert.equal(p.bets[0].playType, 'special-number');
    assert.equal(summarize([p]).totalCents, 170000);
    assert.equal(summarize([p]).numbers.filter(n => n.cents === 10000).length, 17);
  }
});

for (const [text, type, count, yuan] of [
  ['红波100.5', 'wave', 1, 100.5], ['蓝波100', 'wave', 1, 100], ['绿波100', 'wave', 1, 100],
  ['红单100', 'half-wave', 1, 100], ['红单各100', 'special-number', 8, 800],
  ['大100', 'attribute', 1, 100], ['合单100', 'attribute', 1, 100],
  ['合双各100', 'special-number', 24, 2400], ['大各100', 'special-number', 25, 2500],
  ['二中特：1 2各100', 'linked-number-2-special', 1, 100],
  ['二中特1 2 3各100', 'linked-number-2-special', 3, 300],
  ['二中特(1 2)(3 4)各100', 'linked-number-2-special', 2, 200],
  ['二连尾0 1 2各100', 'linked-tail', 3, 300],
  ['二尾：0尾 1尾各100', 'linked-tail', 1, 100],
  ['三尾0 1 2 3各100', 'linked-tail', 4, 400],
  ['四尾1 2 3 4各100', 'linked-tail', 1, 100],
  ['2连尾(0 1)(2 3)各100', 'linked-tail', 2, 200],
  ['2尾各100', 'special-number', 5, 500],
  ['平尾0 1各100', 'flat-tail', 2, 200],
  ['平特任中三粒1 2 3 100', 'flat-any', 1, 100],
  ['三粒任中1 2 3各100', 'flat-any', 1, 100],
  ['平特任中1 2 3 100', 'flat-any', 1, 100],
  ['三粒任中复式1 2 3 4各100', 'flat-any', 4, 400],
  ['平特任中(1 2 3)(4 5 6)各100', 'flat-any', 2, 200],
  ['平特任中一粒8 100', 'flat-any', 1, 100],
]) test(`补充玩法：${text}`, () => {
  const p = valid(text), b = p.bets[0];
  assert.equal(b.playType, type);
  assert.equal(b.count, count);
  assert.equal(summarize([p]).totalCents, yuan * 100);
  if (type === 'linked-tail') assert(b.values.every(n => n >= 0 && n <= 9));
});

test('新分类与新玩法沿用发送人市场；同一行波色金额分开', () => {
  const p = valid('小明：两边 红波100，蓝波200\n天肖各100\n二中特1 2各100\n二连尾0 1各100\n三粒任中1 2 3 100\n张三：红波：100');
  assert.deepEqual(summarize([p]).markets, { 新: 320000, 旧: 310000, 港: 0 });
  assert.equal(p.bets.at(-1).player, '张三');
});

test('尾数与任中独立玩法头支持续行；分类开始新的特码投注', () => {
  const p = valid('二连尾\n0 1各100\n2尾 3尾各100\n天肖各100\n平特任中三粒\n1 2 3各100\n4 5 6各100');
  assert.deepEqual(p.bets.map(b => b.totalCents), [10000, 10000, 250000, 10000, 10000]);
});

for (const [text, code] of [
  ['二连尾0 10各100', 'NUMBER_RANGE'], ['二连尾10尾 2尾各100', 'TAIL_AMBIGUOUS'],
  ['二连尾1头 2头各100', 'SELECTION_TYPE'], ['二连尾虎牛各100', 'SELECTION_TYPE'],
  ['二连尾红波各100', 'SELECTION_TYPE'], ['二连尾0 0各100', 'INSUFFICIENT_SELECTION'],
  ['平特任中六粒1 2 3 4 5 6 100', 'PLAY_SIZE'], ['平特任中1 2 3 4 5 6 100', 'PLAY_SIZE'],
  ['三粒任中1 2 3 4各100', 'ANY_GROUP_AMBIGUOUS'], ['三粒任中1 2各100', 'INSUFFICIENT_SELECTION'],
  ['三粒任中(1 2 3)(4 5)各100', 'GROUP_SIZE'],
]) test(`补充玩法异常不入账：${text}`, () => {
  const p = parse(text);
  assert(p.issues.some(i => i.code === code), JSON.stringify(p.issues));
  assert.equal(summarize([p]).totalCents, 0);
});

test('点分隔号码与金额继续按旧样例解析，不把尾部当小数单价', () => {
  const p = valid('三中三11.23.31.10');
  assert.equal(p.bets[0].totalCents, 1000);
  assert.deepEqual(p.bets[0].values, [11, 23, 31]);
});

test('显式生肖玩法标题保留生肖身份；平码仍按号码', () => {
  const p = valid('二连肖\n虎牛兔各100\n平特肖\n马100\n平码虎各100');
  assert.deepEqual(p.bets.map(b => [b.playType, b.totalCents]), [['linked-zodiac', 30000], ['flat-zodiac', 10000], ['flat-number', 40000]]);
});
