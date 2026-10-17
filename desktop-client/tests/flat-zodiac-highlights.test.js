import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {flatZodiacCollection} from '../src/core/flat-zodiac-collection.js';
import {flatZodiacHighlights} from '../src/core/flat-zodiac-highlights.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';

const parse=(text,id='a',date='2026-10-04')=>parseDocument(text,{id,name:id,businessDate:date});
const draw=(market,numbers=[1,13,25,37,2,14,3],date='2026-10-05')=>({market,numbers,date,issue:date.replaceAll('-',''),sourceId:'manual'});
const state=()=>({draws:{新:draw('新'),旧:draw('旧',[7,19,31,43,8,20,9])},verification:{新:{confirmed:true},旧:{confirmed:true}},odds:{新:defaultOdds(),旧:defaultOdds()}});

test('按开奖农历生肖匹配正码与特码，只有相应市场的平特肖投注才能高亮',()=>{
  const bets=parse('新平特肖马蛇龙鼠各10\n旧平特肖马鼠各20\n香港平特肖龙各30\n特肖马100\n二连肖马蛇各10').bets;
  const hits=flatZodiacHighlights(bets,state());
  assert.deepEqual(Object.keys(hits).sort(),[...'马蛇龙鼠'].sort());
  assert.deepEqual(hits.马.map(h=>[h.market,h.stakeCents]),[['新',1000]]);
  assert.deepEqual(hits.鼠.map(h=>[h.market,h.stakeCents]),[['旧',2000]]);
  assert.deepEqual(hits.龙.map(h=>h.market),['新']);
  assert.deepEqual(hits.马[0].numbers,[1,13,25,37]);
  assert(hits.龙[0].title.includes('正码＋特码'));assert.equal(hits.马[0].trial,false);
  assert.deepEqual(flatZodiacHighlights(bets,state(),'港'),{});
});

test('同肖开出多号只命中一份，原文重复生肖仍逐份累加，同肖多市场各自标记',()=>{
  const s=state();s.draws.旧=draw('旧');
  const bets=parse('两边平特肖马马蛇各10\n旧平特肖马各5').bets;
  const hits=flatZodiacHighlights(bets,s);
  assert.deepEqual(hits.马.map(h=>[h.market,h.stakeCents]),[['新',2000],['旧',2500]]);
  assert.deepEqual(hits.蛇.map(h=>[h.market,h.stakeCents]),[['新',1000],['旧',1000]]);
});

test('遵守各市场六/七码配置，并与现有结算中的中奖份数和投注金额一致',()=>{
  const s=state();s.draws.旧=draw('旧');s.odds.旧.scopes['flat-zodiac']='six';
  const bets=parse('两边平特肖马马蛇龙鼠各10').bets;
  const hits=flatZodiacHighlights(bets,s);
  assert.deepEqual(hits.龙.map(h=>h.market),['新']);
  assert.equal(hits.马.find(h=>h.market==='旧').scope,'six');
  for(const m of ['新','旧']) {
    const settlement=settleBet({...bets[0],assigned:true},s.draws[m],s.odds[m],Date.parse('2026-10-06'),{drawDate:s.draws[m].date});
    assert.equal(settlement.status,'won');
    const stake=Object.values(hits).flat().filter(h=>h.market===m).reduce((sum,h)=>sum+h.stakeCents,0);
    assert.equal(stake,settlement.winningStakeCents);
    assert.equal(settlement.winCount,m==='新'?4:3);
  }
});

test('生肖号码按开奖农历年切换，跨年旧账目仍以其原生肖与最新开奖匹配',()=>{
  const bets=parse('平特肖马蛇龙兔各10','a','2025-10-04').bets,s=state();
  s.draws={新:draw('新',undefined,'2026-02-16')};
  assert.deepEqual(Object.keys(flatZodiacHighlights(bets,s)).sort(),[...'蛇龙兔'].sort());
  s.draws.新=draw('新',undefined,'2026-02-17');
  assert.deepEqual(Object.keys(flatZodiacHighlights(bets,s)).sort(),[...'马蛇龙'].sort());
});

test('冲突未采用不高亮；单站为待核对，确认后高亮，失效确认撤回',()=>{
  const bets=parse('平特肖马各10').bets,s=state();
  s.verification.新={status:'conflict',confirmed:false};assert.deepEqual(flatZodiacHighlights(bets,s),{});
  s.verification.新={status:'single',confirmed:false};assert(flatZodiacHighlights(bets,s).马[0].trial);
  s.verification.新={status:'conflict',confirmed:true};assert.equal(flatZodiacHighlights(bets,s).马[0].trial,false);
  s.verification.新.confirmed=false;assert.deepEqual(flatZodiacHighlights(bets,s),{});
  assert.deepEqual(flatZodiacHighlights(bets,{}),{});
});

test('筛选和原文修改重算标记，不改动来源金额和平均值，排除待处理与其他玩法',()=>{
  const docs=[parse('平特肖马各10'),parse('平特肖龙各20','b','2026-10-03')],before=JSON.stringify(docs),s=state();
  const data=flatZodiacCollection(docs),summary=JSON.stringify(data.summary);
  assert.deepEqual(Object.keys(flatZodiacHighlights(data.bets,s)).sort(),[...'马龙'].sort());
  assert.deepEqual(Object.keys(flatZodiacHighlights(flatZodiacCollection(docs,{date:'2026-10-04'}).bets,s)),['马']);
  assert.deepEqual(flatZodiacHighlights([{...data.bets[0],status:'review'},{...data.bets[0],playType:'special-zodiac'}],s),{});
  assert.deepEqual(flatZodiacHighlights(parse('平特肖鼠各10').bets,s),{});
  assert.equal(JSON.stringify(docs),before);assert.equal(JSON.stringify(data.summary),summary);
  assert.equal(data.summary.totalCents,3000);assert.equal(data.averageCents,250);assert.equal(data.animals.length,12);
});
