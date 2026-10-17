import test from 'node:test';
import assert from 'node:assert/strict';
import {effectScope,ref} from 'vue';
import {parseDocument} from '../src/core/parser.js';
import {specialCollection} from '../src/core/special-collection.js';
import {specialNumberHighlights} from '../src/core/special-number-highlights.js';
import {useLedgerOverview} from '../src/use-ledger-overview.js';
import {defaultOdds} from '../src/core/settlement.js';
import {DEFAULT_DRAW_SOURCES} from '../src/core/draws.js';
import {sortDistribution} from '../src/core/number-distribution.js';
import {today} from '../src/core/rules.js';

const parse=(text,id='a',date='2026-10-04')=>parseDocument(text,{id,name:id,businessDate:date});
const draw=(market,number,extra={})=>({id:market,market,date:'2026-10-05',issue:'2026278',numbers:[1,2,3,4,5,6,number],...extra});
const state={draws:{新:draw('新',35),旧:draw('旧',48),港:draw('港',48)},verification:{新:{confirmed:true},旧:{confirmed:true},港:{confirmed:true}}};
const sources=()=>structuredClone(DEFAULT_DRAW_SOURCES);
const config=()=>({sources:sources(),odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}]))});

test('按市场匹配特码，仅高亮对应市场确有投注的号码，正码和跨市场不误标',()=>{
  const p=parse('新35 48各100\n香港48各20\n旧35各30\n新01各10');
  const hits=specialNumberHighlights(p.bets,state);
  assert.deepEqual(Object.keys(hits),['35','48']);
  assert.deepEqual(hits[35].map(h=>[h.market,h.stakeCents]),[['新',10000]]);
  assert.deepEqual(hits[48].map(h=>[h.market,h.stakeCents]),[['港',2000]]);
  assert.equal(hits[48][0].trial,false);assert(hits[48][0].title.includes('香港 · 2026-10-05'));
  assert.deepEqual(specialNumberHighlights(p.bets,state,'旧'),{});
  assert.deepEqual(Object.keys(specialNumberHighlights(p.bets,state,'新')),['35']);
});

test('同号跨市场分别标记和累计重复份数，生肖展开及多市场继续使用实际每号金额',()=>{
  const p=parse('三边48 48各10\n新包羊40\n旧48各30');
  const same={...state,draws:{新:draw('新',48),旧:draw('旧',48),港:draw('港',48)}};
  const hits=specialNumberHighlights(p.bets,same)[48];
  assert.deepEqual(hits.map(h=>[h.market,h.stakeCents]),[['新',3000],['旧',5000],['港',2000]]);
});

test('来源冲突未采用不高亮，单站为待核对，确认后转为中奖且过期确认撤回',()=>{
  const bets=parse('新35各10').bets;
  assert.deepEqual(specialNumberHighlights(bets,{draws:{新:state.draws.新},verification:{新:{status:'conflict',confirmed:false}}}),{});
  const pending=specialNumberHighlights(bets,{draws:{新:state.draws.新},verification:{新:{status:'single',confirmed:false}}});
  assert(pending[35][0].trial);assert(pending[35][0].title.includes('待核对'));
  assert.equal(specialNumberHighlights(bets,{draws:{新:state.draws.新},verification:{新:{status:'conflict',confirmed:true}}})[35][0].trial,false);
  assert.deepEqual(specialNumberHighlights(bets,{}),{});
});

test('高亮不影响金额、49号平均、排序与原数据；日期筛选仅限制参与投注',()=>{
  const docs=[parse('新35各10','a'),parse('香港48各20','b','2026-10-03')];
  const before=JSON.stringify(docs),data=specialCollection(docs),summary=JSON.stringify(data.summary);
  const sorted=sortDistribution(data.distribution.numbers,null,'amount-desc');
  assert.equal(sorted[0].number,48);assert.equal(sorted[1].number,35);
  assert.equal(specialNumberHighlights(data.bets,state)[35][0].stakeCents,1000);
  const scoped=specialCollection(docs,{date:'2026-10-04'});
  assert.deepEqual(Object.keys(specialNumberHighlights(scoped.bets,state)),['35']);
  assert.deepEqual(specialNumberHighlights([],state),{});
  assert.deepEqual(specialNumberHighlights([{...docs[0].bets[0],status:'review'},{...docs[0].bets[0],playType:'flat-number'}],state),{});
  assert.equal(JSON.stringify(docs),before);assert.equal(JSON.stringify(data.summary),summary);
  assert.equal(data.distribution.numbers.length,49);assert.equal(data.summary.totalCents,3000);
});

test('集合独立使用最新开奖，不受统计历史日期影响，网络更新仍按最新并保留市场确认',async()=>{
  const make=(id,sourceId,number,date='2026-10-05')=>draw('新',number,{id,sourceId,date,issue:date==='2026-10-04'?'2026277':'2026278'});
  const cache={settings:config(),reports:[],draws:{新:[make('old','macaujc-new',44,'2026-10-04'),make('first','macaujc-new',35),make('second','pengsai-new',35)],旧:[],港:[]}};
  const requests=[],scope=effectScope();
  const state=scope.run(()=>useLedgerOverview(ref([parse('新35各10')]),()=>[],{id:'collection-latest-test',api:{settlement:{load:async q=>{requests.push(['load',q]);return structuredClone(cache);},sync:async q=>requests.push(['sync',q])}}}));
  try{
    await state.changeMode('date','2026-10-04');
    assert.equal(state.draws.value.新.numbers[6],44);
    assert.equal(state.latest.value.draws.新.id,'first');assert(state.latest.value.verification.新.confirmed);
    assert.equal(state.latest.value.odds.新.scopes['flat-zodiac'],'seven');
    cache.settings.odds.新.scopes['flat-zodiac']='six';await state.refresh();
    assert.equal(state.latest.value.odds.新.scopes['flat-zodiac'],'six');
    await state.refresh({sync:true,latest:true,auto:true});
    assert.deepEqual(requests.find(r=>r[0]==='sync')[1],{date:today(),latest:true,auto:true});
    assert.equal(state.mode.value,'date');assert.equal(state.drawDate.value,'2026-10-04');
    await state.changeMode('latest');
    cache.draws.新[2].numbers[6]=48;await state.refresh();
    assert.equal(state.latest.value.verification.新.status,'conflict');assert.equal(state.latest.value.draws.新,undefined);
    state.select('新','first');state.adopt('新','first');assert(state.latest.value.verification.新.confirmed);
    cache.draws.新[2].numbers[6]=49;await state.refresh();assert.equal(state.latest.value.verification.新.confirmed,false);
  }finally{scope.stop();}
});
