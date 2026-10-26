import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, summarize } from '../src/core/parser.js';
import { chineseNumber, choose, ruleForDate } from '../src/core/rules.js';
import { validateProject } from '../src/project.js';

const parse = text => parseDocument(text, { businessDate: '2026-10-05', defaultPlayer: '测试玩家' });
const result = text => { const p = parse(text); assert.deepEqual(p.issues.filter(i => i.severity === 'error'), [], JSON.stringify(p.issues)); return summarize([p]); };
const amount = (text, value) => assert.equal(result(text).totalCents, value * 100);

test('农历年切换而不是公历元旦', () => {
  assert.equal(ruleForDate('2026-01-01').animal, '蛇');
  assert.equal(ruleForDate('2026-02-16').animal, '蛇');
  assert.equal(ruleForDate('2026-02-17').animal, '马');
  assert.equal(ruleForDate('2027-01-01').animal, '马');
  assert.equal(ruleForDate('2027-02-05').animal, '马');
  assert.equal(ruleForDate('2027-02-06').animal, '羊');
  assert.deepEqual(ruleForDate('2027-02-06').zodiac.羊, [1, 13, 25, 37, 49]);
  assert.throws(() => ruleForDate('2026-02-30'));
});
test('用户实例：按玩家归属和市场继承', () => {
  const s = result('小明：旧 1 2 3 各100元\n特肖虎100元\n张三：特肖虎100元');
  assert.equal(s.totalCents, 50000);
  assert.equal(s.players.find(p => p.name === '小明').旧, 40000);
  assert.equal(s.players.find(p => p.name === '张三').新, 10000);
});
test('同人重复消息头不重置，空行及返回原玩家默认新澳', () => {
  const s = result('小明：旧 1各100\n\n小明：特肖虎100\n张三：特肖牛100\n小明：特肖兔100');
  assert.equal(s.players.find(p => p.name === '小明').旧, 10000);
  assert.equal(s.players.find(p => p.name === '小明').新, 20000);
});
test('多市场继承及显式替换', () => {
  let s = result('小明：两边 1各100\n特肖虎100');
  assert.deepEqual(s.markets, { 新: 20000, 旧: 20000, 港: 0 });
  s = result('小明：三边 1各100\n港 特肖虎100\n特肖牛100');
  assert.deepEqual(s.markets, { 新: 10000, 旧: 10000, 港: 30000 });
});
test('相同输入重复解析不累加，文件间不继承，筛选不改变结果', () => {
  const a = parse('小明：旧 12各50');
  const b = parse('小明：特肖虎100');
  assert.equal(summarize([a, b]).totalCents, 15000);
  assert.equal(summarize([a, b], { market: '旧' }).totalCents, 5000);
  assert.equal(summarize([parse('小明：旧 12各50')]).totalCents, 5000);
});
test('姓名中的新老字不影响市场', () => { amount('老友：12各50', 50); assert.equal(result('新的一天：旧 1各20').markets.旧, 2000); });
test('同一行的独立投注分别绑定市场', () => { assert.deepEqual(result('小明：新1各100，旧2各50').markets, { 新: 10000, 旧: 5000, 港: 0 }); });
test('用户连写原文按金额单位拆成两笔特码，保留原文和号码分布', () => {
  const text = '新4.5.16.17.28.41各20米29.40各10米', p = parse(text);
  assert.deepEqual(p.issues, []);
  assert.deepEqual(p.bets.map(b => [b.playType, b.values, b.unitCents, b.totalCents]), [
    ['special-number', [4, 5, 16, 17, 28, 41], 2000, 12000],
    ['special-number', [29, 40], 1000, 2000],
  ]);
  assert(p.bets.every(b => b.raw === text && b.line === 1 && b.endLine === 1 && b.player === '测试玩家'));
  const s = summarize([p]); assert.equal(s.totalCents, 14000);
  assert.deepEqual(s.markets, { 新: 14000, 旧: 0, 港: 0 });
  assert.deepEqual(s.numbers.filter(n => n.cents).map(n => [n.number, n.cents]), [[4,2000],[5,2000],[16,2000],[17,2000],[28,2000],[29,1000],[40,1000],[41,2000]]);
  assert.deepEqual(s, result(text.replace('20米', '20米\n')));
});
test('金额单位后可紧接下一组号码，小数单价不拆开', () => {
  for (const unit of ['米','元','块','斤','钱']) {
    const p = parse(`旧4.5各20.50${unit}29.40各10${unit}`);
    assert.deepEqual(p.issues, []); assert.equal(p.bets.length, 2);
    assert.equal(p.bets[0].unitCents, 2050);
    assert.deepEqual(summarize([p]).markets, { 新: 0, 旧: 6100, 港: 0 });
  }
});
test('连写投注继承玩家市场，明确市场及换玩家时仍正确切换', () => {
  const s = result('小明：旧4.5各20米29.40各10米新8各5米\n张三：4.5各20米29.40各10米');
  assert.deepEqual(s.players.map(p => [p.name, p.新, p.旧]), [['小明',500,6000],['张三',6000,0]]);
});
test('无单位的数字连写不猜分界，超长小数单价仍待处理', () => {
  for (const text of ['新4.5各20.12329.40各10米', '新4.5各20.123米']) {
    const p = parse(text); assert(p.issues.some(i => i.severity === 'error'));
    assert.equal(summarize([p]).totalCents, 0);
  }
});
test('连肖后头尾选号重新识别为特码', () => { amount('二连肖虎兔牛各50\n0尾各30', 270); });
for (const [name, text, total] of [
  ['普通号码', '26 38各100', 200], ['中文金额', '香港特码鼠各一百二十', 480],
  ['马年生肖', '香港马各号100', 500], ['平特肖简称', '独肖兔100元', 100],
  ['多肖中特整项', '新澳六肖中特虎牛兔马蛇龙100', 100], ['二肖中特', '二肖中特虎牛100', 100],
  ['特肖逐肖', '特肖虎牛各100', 200], ['同一行多个金额', '新澳平特猴100，马龙各50', 200],
  ['平特尾不展开号码', '平特：1尾＝150', 150], ['特码尾展开', '新特1尾各20', 100],
  ['零尾排除00', '0尾各30', 120], ['三个头排除00', '新特1头：0头：4头：各30', 870],
  ['三连肖', '三肖龙马兔50', 50], ['复式连肖', '四肖复式，龙马兔虎狗各30', 150],
  ['单式连码', '二中二 1 2 各组100', 100], ['复式连码', '复式三中三13-14-04-26各10', 40],
  ['三中二选三', '三中二 03 06 09 33 36 39 各5', 100], ['特串', '特串18.38.30各组10', 30],
  ['不中单式', '五不中 1 2 3 4 5 100', 100], ['不中复式', '五不中 1 2 3 4 5 6 100', 600],
  ['十不中', '十不中 1 2 3 4 5 6 7 8 9 10 100', 100], ['红波', '红波各号10', 170],
  ['蓝单', '蓝波单号各5', 40], ['生肖别名', '兔子各100', 400],
  ['子兔', '子兔100', 800], ['重复选号累计', '31.36.34.34.39.33.30.37各十', 80],
  ['复式共用两玩法', '香新5.11.30.40.43.三中三死活各三', 120],
  ['中文千位金额', '30号一千五百', 1500], ['小数精确计费', '1 2 3各0.1', .3],
  ['数字O纠错', '新澳特码，6，2OO元', 200], ['金额括号', '21（500）', 500],
  ['分组保留', '三中三 11-25-36。21-38-47。06-22-39。08-17-19各组25', 100],
  ['括号分组', '三中三 (1,2,3)(4,5,6)各20', 40],
  ['跨行选号', '30.42.43.21.07.\n49.25.13.01.31.各20', 200],
  ['连肖数字不能当金额', '龙猪羊 3有 50米', 50], ['平特三连肖', '平特三连肖：虎蛇鼠50斤', 50],
  ['个作为金额标记', '新特48.40.16.26.43个50。', 250], ['每个号码金额', '绿波每个数各5', 80],
  ['单位续行', '斤，04 05 11 14（共4码）各10', 40],
  ['明确特肖金额前置', '特肖包40钱牛', 40],
]) test(name, () => amount(text, total));

for (const [text, code] of [
  ['老五不中1000', 'MISSING_SELECTION'], ['120 1 100', 'NUMBER_RANGE'],
  ['18.4046各20', 'NUMBER_RANGE'], ['六肖中特虎牛兔马蛇100', 'ZODIAC_COUNT'],
  ['特串5', 'MISSING_SELECTION'], ['二中二兔马拖龙各48', 'DAN_TUO'],
  ['各.5', 'DECIMAL_AMBIGUOUS'], ['1 2各-10', 'INVALID_AMOUNT'], ['0 49各10', 'NUMBER_RANGE'],
]) test(`异常不能计费：${text}`, () => { const p = parse(text); assert(p.issues.some(i => i.code === code), JSON.stringify(p.issues)); assert.equal(summarize([p]).totalCents, 0); });

test('合计/期号不能进入号码和金额，原文保留', () => {
  const p = parse('006期 新 1 2 3（共3码）各20\n合计60');
  assert.equal(summarize([p]).totalCents, 6000); assert.equal(p.issues.length, 0);
  assert.equal(p.bets[0].raw, '006期 新 1 2 3（共3码）各20');
});
test('原文合计冲突可见，不篡改投注结果', () => { const p = parse('小明：1 2 3各10\n合计100'); assert.equal(summarize([p]).totalCents, 3000); assert(p.issues.some(i => i.code === 'TOTAL_MISMATCH')); });
test('合计0和超大合计不引发文档崩溃', () => { assert(parse('合计0').issues.some(i => i.code === 'TOTAL_SCOPE')); assert(parse('合计999999999999999999999999999999').issues.some(i => i.code === 'TOTAL_INVALID')); });
test('后置市场不静默回填他人投注', () => { const p = parse('小明：1各10\n港\n张三：2各20'); assert(p.issues.some(i => i.code === 'TRAILING_MARKET')); assert.equal(summarize([p]).totalCents, 2000); });
test('每条非空原文都有解释，CRLF结果相同', () => {
  const text = '小明：旧 1各10\n[OK]\n未知消息 abc\n张三：特肖虎100';
  const a = parse(text), b = parse(text.replaceAll('\n', '\r\n'));
  assert(a.coverage.every(l => l.status !== 'unhandled'));
  assert.equal(summarize([a]).totalCents, summarize([b]).totalCents);
});
test('中文金额、组合计数边界', () => { assert.equal(chineseNumber('一千三'), 1300); assert.equal(chineseNumber('一千零三'), 1003); assert.equal(chineseNumber('一万二千三百四十五'), 12345); assert.equal(choose(49, 10), 8217822536); });
test('保存格式保留玩家归属和业务日期，拒绝无效结构', () => {
  const p = validateProject({ schemaVersion: 1, activeId: 'a', documents: [{ id: 'a', name: '账单.og', text: '1各100', businessDate: '2026-10-05', defaultPlayer: '小明' }] });
  assert.equal(p.documents[0].defaultPlayer, '小明'); assert.throws(() => validateProject({}));
});

test('汇总溢出显式报错，不能产生失真的账目金额', () => {
  const p = parse('1各50000000000000\n2各50000000000000');
  assert.equal(p.bets.length, 2);
  assert.throws(() => summarize([p]), /精确计算范围/);
});
