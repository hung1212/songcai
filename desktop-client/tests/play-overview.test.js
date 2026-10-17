import test from 'node:test';
import assert from 'node:assert/strict';
import {playGroup,playOverview} from '../src/core/play-overview.js';
import {parseDocument} from '../src/core/parser.js';
import {ledgerOverview} from '../src/core/ledger-overview.js';
import {defaultOdds} from '../src/core/settlement.js';
const date='2026-10-05',markets=['新','旧','港'];
const odds=Object.fromEntries(markets.map(m=>[m,{...defaultOdds(),confirmed:true,refund49:{attribute:true,sixZodiac:true,halfWave:false}}]));
const verification=Object.fromEntries(markets.map(m=>[m,{confirmed:true}]));
const draws=Object.fromEntries(markets.map(m=>[m,{id:m,market:m,date,issue:'2026278',numbers:[1,2,3,4,5,6,49]}]));
const doc=(id,text)=>parseDocument(text,{id,name:id,businessDate:date});
const overview=docs=>ledgerOverview(docs,draws,{odds},verification,Object.fromEntries(markets.map(m=>[m,date])));
const entries=o=>o.rows.flatMap(r=>r.result?.entries||[]);
test('玩法分类使用解析类型，特串属于连码，多肖中特与生肖数特码分别归类',()=>{
  const cases={'special-pair':'linked-number','linked-number-2-special':'linked-number','linked-number-3-2':'linked-number','linked-zodiac':'linked-zodiac','flat-any':'flat','flat-zodiac':'flat','flat-tail':'flat','flat-number':'flat','special-zodiac-any':'special-zodiac','special-zodiac':'special-zodiac','wave':'special-number','half-wave':'special-number','attribute':'attribute','special-number':'special-number','linked-tail':'linked-tail','not-hit':'not-hit','future-play':'other'};
  for(const [type,group] of Object.entries(cases))assert.equal(playGroup(type),group,type);
  const parsed=doc('分类','牛数各10\n四肖中特龙牛狗蛇200');assert.equal(parsed.issues.length,0);
  assert.deepEqual(parsed.bets.map(b=>playGroup(b.playType)),['special-number','special-zodiac']);
});
test('玩法、市场、账目三种汇总与原账一致，多市场按各自投注计费',()=>{
  const o=overview([doc('甲','三边特码01 49各10\n新三中三01 02 03各5\n旧二连肖马蛇各10'),doc('乙','港平特肖马各20\n新特肖马100\n新二连尾1 2各5')]);
  assert.equal(o.issueCount,0);
  const all=playOverview(entries(o),{verification,odds});
  assert.equal(all.stakeCents,o.stakeCents);assert.equal(all.payoutCents,o.payoutCents);
  assert.equal(all.categories.reduce((n,g)=>n+g.stakeCents,0),o.stakeCents);
  assert.equal(all.categories.reduce((n,g)=>n+g.payoutCents,0),o.payoutCents);
  assert.equal(all.plays.reduce((n,g)=>n+g.stakeCents,0),o.stakeCents);
  assert.equal(all.ledgers.reduce((n,g)=>n+g.payoutCents,0),o.payoutCents);
  const special=playOverview(entries(o),{group:'special-number',market:'港',verification,odds});
  assert.equal(special.stakeCents,2000);assert.equal(special.winningStakeCents,1000);assert.equal(special.payoutCents,47000);assert.equal(special.entryCount,1);assert.equal(special.ledgerCount,1);
  assert.ok(all.plays.every((r,i,a)=>!i||a[i-1].stakeCents>=r.stakeCents));
});
test('三中三复式中奖金额只计算命中组合，保持来源行用于原文定位',()=>{
  const o=overview([doc('甲','新\n01 02 03 10复式三中三各5')]);
  const r=playOverview(entries(o),{group:'linked-number',verification,odds});
  assert.equal(r.stakeCents,2000);assert.equal(r.winningStakeCents,500);assert.equal(r.winCount,1);assert.equal(r.payoutCents,325000);
  assert.equal(r.entries[0].line,2);assert.equal(r.entries[0].fileId,'甲');
});
test('缺开奖和缺中奖赔率的玩法保留待结算，其他玩法仍独立试算或结算',()=>{
  const o=ledgerOverview([doc('甲','旧特码49各10\n新三中三01 02 03各5\n新特码49各10')],{新:draws.新},{odds:{...odds,新:{...odds.新,rates:{...odds.新.rates,'linked-number-3-3':{rate:''}}}}},{},{新:date});
  const all=playOverview(entries(o),{verification,odds});assert.equal(all.pending,2);assert.equal(all.netCents,null);assert.equal(all.payoutCents,47000);
  const newSpecial=playOverview(entries(o),{group:'special-number',market:'新',odds});assert.equal(newSpecial.pending,0);assert.equal(newSpecial.status,'trial');assert.equal(newSpecial.netCents,46000);
});
test('退款不算中奖，空分类归零；待处理原文不混入已解析金额',()=>{
  const o=overview([doc('甲','新大100\n特肖三中三1 2 100')]);
  const r=playOverview(entries(o),{verification,odds});
  assert.ok(o.issueCount>0);assert.equal(r.refundCents,10000);assert.equal(r.winEntries,0);assert.equal(r.winningStakeCents,0);assert.equal(r.netCents,0);
  const empty=playOverview(entries(o),{group:'linked-zodiac',verification,odds});assert.equal(empty.stakeCents,0);assert.equal(empty.entries.length,0);assert.equal(empty.status,'empty');
});
test('总额越界时拒绝不精确的金额，不修改输入记录',()=>{
  const input=[{id:'x',fileId:'甲',market:'新',playType:'special-number',play:'特码',status:'lost',stakeCents:Number.MAX_SAFE_INTEGER,payoutCents:0}];
  assert.throws(()=>playOverview([...input,...input]),/精确/);
  playOverview(input);assert.equal(input.length,1);assert.equal(input[0].stakeCents,Number.MAX_SAFE_INTEGER);
});
