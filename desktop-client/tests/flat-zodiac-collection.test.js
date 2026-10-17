import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../src/core/parser.js';
import { ANIMALS } from '../src/core/rules.js';
import { flatZodiacCollection, flatZodiacAmount, sortFlatZodiacs } from '../src/core/flat-zodiac-collection.js';

const date = '2026-10-10';
const parse = (text, id = 'a', day = date) => parseDocument(text, { id, name: '账目'+id, businessDate: day });
const row = (data, animal) => data.animals.find(item => item.animal === animal);

test('按生肖汇总全部账目平特肖及同义玩法，排除特肖、连肖、特码及其他平特玩法', () => {
  const a = parse('两边平特肖鼠鼠牛各10\n特肖鼠100\n三连肖鼠牛虎各10\n平特尾1各10\n特码01各5\n平码02各5\n平特任中1 2各10');
  const b = parse('旧平肖鼠各0.5\n平特一肖马各20\n平特牛各10', 'b');
  const data = flatZodiacCollection([a,b]);
  assert.deepEqual(a.issues,[]);assert.deepEqual(b.issues,[]);
  assert.equal(data.summary.totalCents,9050);assert.equal(data.bets.length,4);assert.equal(data.documentCount,2);
  assert.deepEqual(data.summary.markets,{新:3000,旧:6050,港:0});
  assert.equal(row(data,'鼠').cents,4050);assert.equal(row(data,'牛').cents,3000);assert.equal(row(data,'马').cents,2000);
  assert.equal(row(data,'鼠').documentCount,2);assert.equal(row(data,'鼠').betCount,2);
  assert.equal(data.animals.reduce((sum,item)=>sum+item.cents,0),data.summary.totalCents);
  assert.equal(data.summary.players.length,2);
});

test('业务日期和市场筛选统一影响生肖、总额、来源与玩家数量；多市场不会重复全单金额', () => {
  const a = parse('两边平特肖鼠牛各100\n香港平肖鼠各50');
  const b = parse('旧平肖鼠各30','b','2026-10-09');
  const all = flatZodiacCollection([a,b]);assert.equal(all.summary.totalCents,48000);
  assert.equal(row(all,'鼠').cents,28000);assert.equal(row(all,'牛').cents,20000);
  const old = flatZodiacCollection([a,b],{date,market:'旧'});
  assert.equal(old.summary.totalCents,20000);assert.equal(old.bets.length,1);assert.equal(old.documentCount,1);
  assert.deepEqual(old.summary.markets,{新:0,旧:20000,港:0});
  assert.equal(row(old,'鼠').cents,10000);assert.equal(row(old,'牛').cents,10000);
  assert.equal(flatZodiacAmount(old.bets[0],{market:'旧',animal:'鼠'}),10000);
  assert.equal(flatZodiacAmount(old.bets[0],{animal:'鼠'}),20000);
  assert.equal(flatZodiacAmount(old.bets[0],{market:'港'}),0);
  assert.equal(flatZodiacCollection([a,b],{date:'2026-10-09',market:'港'}).summary.totalCents,0);
});

test('重复生肖、同文不同账目按实际份数计费，保留跨行原文与定位', () => {
  const text='平特肖鼠鼠牛\n各10元';
  const a=parse(text),b=parse(text,'b');
  const data=flatZodiacCollection([a,b]);
  assert.equal(data.summary.totalCents,6000);assert.equal(row(data,'鼠').cents,4000);
  assert.equal(flatZodiacAmount(data.bets[0],{animal:'鼠'}),2000);
  assert.equal(data.bets[0].raw,text);assert.equal(data.bets[0].line,1);assert.equal(data.bets[0].endLine,2);
  assert.notEqual(data.bets[0].id,data.bets[1].id);
});

test('十二生肖均展示，包含零投注的平均和精确超额，不随农历年份换算号码', () => {
  const empty=flatZodiacCollection([]);assert.deepEqual(empty.animals.map(item=>item.animal),ANIMALS);
  assert.equal(empty.averageCents,0);assert(empty.animals.every(item=>item.cents===0&&!item.aboveAverage));
  const data=flatZodiacCollection([parse('平特肖马各0.01','a','2026-02-16'),parse('平特肖马各0.01','b','2026-02-17')]);
  assert.equal(data.summary.totalCents,2);assert.equal(row(data,'马').cents,2);assert.equal(data.averageCents,0);
  assert.equal(data.aboveCount,1);assert.equal(row(data,'马').excessCents,2);
});

test('金额升降序与鼠至猪顺序稳定，不修改汇总或原账目；增删改和空间隔离按输入生效', () => {
  const a=parse('平特肖牛虎各100'),b=parse('平特肖鼠各10','b');
  const before=JSON.stringify([a,b]),data=flatZodiacCollection([a,b]);
  assert.deepEqual(sortFlatZodiacs(data.animals).slice(0,3).map(item=>item.animal),['牛','虎','鼠']);
  assert.equal(sortFlatZodiacs(data.animals,'amount-asc')[0].animal,'兔');
  assert.deepEqual(sortFlatZodiacs(data.animals,'zodiac').map(item=>item.animal),ANIMALS);
  assert.deepEqual(data.animals.map(item=>item.animal),ANIMALS);assert.equal(JSON.stringify([a,b]),before);
  assert.deepEqual(flatZodiacCollection([b,a]).animals,data.animals);
  assert.equal(flatZodiacCollection([parse('平特肖牛各200'),b]).summary.totalCents,21000);
  assert.equal(flatZodiacCollection([b]).summary.totalCents,1000);
  assert.equal(flatZodiacCollection([parse('','a'),parse('','b')]).summary.totalCents,0);
});

test('争议投注不计入，保留原文问题入口；汇总金额超过安全范围明确报错', () => {
  const p=parse('平特肖鼠各20\n特肖牛10\n平特肖虎各30港');
  const data=flatZodiacCollection([p]);
  assert.equal(data.summary.totalCents,2000);assert.equal(row(data,'虎').cents,0);
  assert.equal(data.issues[0].code,'TRAILING_MARKET');assert.equal(data.issues[0].fileId,'a');
  const huge=parse('平特肖鼠各50000000000000');
  assert.throws(()=>flatZodiacCollection([huge,parse('平特肖牛各50000000000000','b')]),/精确计算范围/);
});
