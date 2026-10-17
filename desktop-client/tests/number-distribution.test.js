import test from 'node:test';
import assert from 'node:assert/strict';
import { numberDistribution, sortDistribution, NUMBER_SORTS } from '../src/core/number-distribution.js';
import { ruleForDate, ANIMALS, WAVES } from '../src/core/rules.js';
import { parseDocument, summarize } from '../src/core/parser.js';
const values = amount => Array.from({ length: 49 }, (_, i) => ({ number: i + 1, label: String(i + 1).padStart(2, '0'), cents: amount }));
test('号码生肖随农历新年切换，公历元旦不换；马年01/13/25/37/49为马', () => {
  for (const [date, animal] of [['2026-02-16', '蛇'], ['2026-02-17', '马'], ['2027-01-01', '马'], ['2027-02-05', '马'], ['2027-02-06', '羊']]) {
    const result = sortDistribution(values(0), ruleForDate(date));
    assert.equal(result[0].animal, animal);
    assert.deepEqual(result.filter(n => n.animal === animal).map(n => n.number), [1, 13, 25, 37, 49]);
    assert(result.every(n => ANIMALS.includes(n.animal)));
  }
});
test('金额排序按筛选后的逐号投注，金额相同按号码排序，保留49号及超额', () => {
  const parsed = parseDocument('小明：新10 20各200元\n旧01各500元\n张三：新02各300元', { businessDate: '2026-10-05' });
  const original = numberDistribution(summarize([parsed], { market: '新', player: '小明' }).numbers);
  const sorted = sortDistribution(original.numbers, ruleForDate('2026-10-05'), 'amount-desc');
  assert.deepEqual(sorted.slice(0, 4).map(n => n.number), [10, 20, 1, 2]);
  assert.equal(sorted[0].excessCents, original.numbers[9].excessCents);
  const asc = sortDistribution(original.numbers, null, 'amount-asc');
  assert.deepEqual(asc.slice(-2).map(n => n.number), [10, 20]);
  assert.equal(asc[0].number, 1);
  for (const { value } of NUMBER_SORTS) {
    const numbers = sortDistribution(original.numbers, ruleForDate('2026-10-05'), value);
    assert.equal(numbers.length, 49); assert.equal(new Set(numbers.map(n => n.number)).size, 49);
    assert.equal(numbers.reduce((sum, n) => sum + n.cents, 0), 40000);
    assert.equal(numbers.filter(n => n.aboveAverage).length, 2);
  }
  assert.deepEqual(original.numbers.map(n => n.number), values(0).map(n => n.number));
});
test('生肖从鼠牛虎到猪，波色红蓝绿、尾数0至9，组内号码从小到大', () => {
  const rule = ruleForDate('2026-10-05');
  const sorted = sortDistribution(values(0), rule, 'zodiac');
  assert.deepEqual([...new Set(sorted.map(n => n.animal))], ANIMALS);
  assert.deepEqual(sorted.slice(0, 4).map(n => n.number), [7, 19, 31, 43]);
  assert.deepEqual(sorted.slice(4, 8).map(n => n.number), [6, 18, 30, 42]);
  const wave = sortDistribution(values(0), rule, 'wave');
  assert.deepEqual(wave.map(n => n.number), [...WAVES.红, ...WAVES.蓝, ...WAVES.绿]);
  const tail = sortDistribution(values(0), rule, 'tail');
  assert.deepEqual(tail.slice(0, 9).map(n => n.number), [10, 20, 30, 40, 1, 11, 21, 31, 41]);
});
test('49个号码平均100元，10号200元则只标出超出100元', () => {
  const numbers = values(10000); numbers[9].cents = 20000; numbers[48].cents = 0;
  const result = numberDistribution(numbers);
  assert.equal(result.averageCents, 10000); assert.equal(result.aboveCount, 1);
  assert.equal(result.numbers[9].excessCents, 10000); assert.equal(result.numbers[9].aboveAverage, true);
  assert.equal(result.numbers[0].aboveAverage, false); assert.equal(result.numbers[48].aboveAverage, false);
});
test('只有一个号码投注也除以49；没有投注时平均与超出均为0', () => {
  const numbers = values(0);
  assert.equal(numberDistribution(numbers).averageCents, 0); assert.equal(numberDistribution(numbers).aboveCount, 0);
  numbers[9].cents = 20000;
  const result = numberDistribution(numbers);
  assert.equal(result.averageCents, 408); assert.equal(result.numbers[9].excessCents, 19592);
});
test('随玩家、市场及文档范围重算，仅使用特码逐号金额', () => {
  const first = parseDocument('小明：两边10各200元\n特肖牛1000元\n张三：新20各100元', { businessDate: '2026-10-05', id: 'a' });
  const second = parseDocument('小明：港30各490元', { businessDate: '2026-10-05', id: 'b' });
  assert.equal(numberDistribution(summarize([first], { market: '旧' }).numbers).averageCents, 408);
  assert.equal(numberDistribution(summarize([first], { player: '张三' }).numbers).averageCents, 204);
  assert.equal(numberDistribution(summarize([first, second]).numbers).averageCents, 2020);
  assert.equal(numberDistribution(summarize([second]).numbers).averageCents, 1000);
});
test('不先取整均值来判断超出；小于一分的差额保留超出标记', () => {
  const numbers = values(1); numbers[48].cents = 0;
  const result = numberDistribution(numbers);
  assert.equal(result.averageCents, 1); assert.equal(result.aboveCount, 48);
  assert.equal(result.numbers[0].excessCents, 0); assert.equal(result.numbers[0].aboveAverage, true);
  const maximum = values(0); maximum[0].cents = Number.MAX_SAFE_INTEGER;
  const large = numberDistribution(maximum);
  assert.equal(large.averageCents, Number((BigInt(Number.MAX_SAFE_INTEGER) + 24n) / 49n));
  assert.equal(large.aboveCount, 1);
});
