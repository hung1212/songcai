import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {playOverview} from '../src/core/play-overview.js';
import {highlightText} from '../src/core/highlight.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
const source='平特四连尾（1269）（2679）（1267）（1467）（4679）各500';
const date='2026-10-07';
const options={id:'tail-groups',name:'连尾示例',businessDate:date};
const parse=text=>parseDocument(text,options);
const groups=[[1,2,6,9],[2,6,7,9],[1,2,6,7],[1,4,6,7],[4,6,7,9]];
test('用户五个括号各500明确计为五组四连尾2500元，保留组界和原文',()=>{
  const p=parse(source);assert.deepEqual(p.issues,[]);assert.equal(p.bets.length,1);
  const b=p.bets[0];assert.equal(b.playType,'linked-tail');assert.equal(b.size,4);assert.equal(b.basis,'每组');assert.equal(b.mode,'groups');assert.equal(b.count,5);assert.equal(b.unitCents,50000);assert.equal(b.raw,source);assert.equal(b.semantic.ruleId,'R20');assert.deepEqual(b.warnings,[]);assert.deepEqual(b.groups,groups);assert.equal(summarize([p]).totalCents,250000);
});
test('两到四连尾括号紧写支持0尾、全角、中文单价、单组与原空格组混写',()=>{
  for(const [text,count,total] of [['二连尾（01）（29）各五',2,1000],['平特三连尾（０１２）（６７９）各10',2,2000],['4连尾（1269）各500',1,50000],['平特 四 连 尾：（1269）（2 6 7 9）各组500',2,100000],['四连尾【1269】/【2679】每组0.5元',2,100]]){
    const p=parse(text);assert.equal(p.issues.length,0,text);assert.equal(p.bets[0].count,count,text);assert.equal(summarize([p]).totalCents,total,text);
  }
});
test('完整重复组按两份计费，组内重复／长度不符／组外数字仍待处理',()=>{
  const repeated=parse('四连尾（1269）（1269）各500');assert.equal(repeated.issues.length,0);assert.equal(repeated.bets[0].count,2);assert.equal(summarize([repeated]).totalCents,100000);
  for(const text of ['四连尾（1126）各500','四连尾（126）各500','四连尾（12679）各500','四连尾（1269）（2679）8各500']){
    const p=parse(text);assert.ok(p.issues.some(i=>i.severity==='error'),text);assert.equal(summarize([p]).totalCents,0,text);
  }
});
test('不把连码、特码或平特尾中的紧写数字擅自拆成尾数组',()=>{
  for(const text of ['三中三（126）各500','特码（1269）各500','平特尾（1269）各500','四连尾1269各500']){
    const p=parse(text);assert.ok(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
  const old=parse('二连尾0 10各100');assert.equal(old.issues[0].code,'NUMBER_RANGE');
});
test('连尾声明可继承到下一行，原文定位、玩家切换、两市场分别计费保留',()=>{
  const p=parse('甲：旧\n平特四连尾\n（1269）（2679）各500\n乙：两边 四连尾（1267）各100');
  assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets.map(b=>[b.player,b.line,b.endLine,b.markets,b.totalCents]),[['甲',3,3,['旧'],100000],['乙',4,4,['新','旧'],20000]]);assert.equal(summarize([p]).totalCents,120000);
});
test('赔付只对原列出的中奖组计算，不把所有尾数重新组合；玩法统计归入连尾',()=>{
  const p=parse(source),draw={id:'tail-draw',market:'新',date,issue:'2026280',numbers:[1,12,26,39,11,22,49]};
  const result=settleDocuments([p],{新:draw},{新:defaultOdds()},date);
  assert.equal(result.entries[0].winCount,1);assert.equal(result.entries[0].winningStakeCents,50000);assert.equal(result.payoutCents,750000);
  const stats=playOverview(result.entries,{group:'linked-tail'});assert.equal(stats.stakeCents,250000);assert.equal(stats.winningStakeCents,50000);assert.equal(stats.payoutCents,750000);
});
test('原文紧写数字保持蓝色，金额500保持橙色；旧账自动采用新规则',()=>{
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['500']);assert(tokens.some(t=>t.kind==='selection'&&t.text==='1269'));
  const upgraded=upgradeDocument({...options,text:source,parserVersion:'parser-20261007-1'});assert.equal(upgraded.text,source);assert.equal(summarize([parseDocument(upgraded.text,upgraded)]).totalCents,250000);
});
