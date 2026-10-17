import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, summarize } from '../src/core/parser.js';
import { specialCollection } from '../src/core/special-collection.js';
import { settleDocuments, defaultOdds } from '../src/core/settlement.js';
import { createBatch, inspectBatch } from '../src/core/inbox.js';
const date='2026-10-05';
const parse=(text,id='a',extra={})=>parseDocument(text,{id,name:'账目'+id,businessDate:date,...extra});
test('截图无关前缀忽略，两笔140元归本单玩家且原文保留',()=>{
 const text='阿斯顿发新4.5.16.17.28.41各20米\n阿道夫29.40各10米';const p=parse(text);
 assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,14000);assert.equal(summarize([p]).players.length,1);
 assert(p.bets.every(b=>b.assigned));assert.equal(p.bets[0].raw,text.split('\n')[0]);assert.equal(p.bets[1].playerId,p.bets[0].playerId);
 assert(p.metadata.some(m=>m.kind==='无关文字'));assert(p.coverage.every(c=>c.status==='parsed'));
});
test('问候、任意无关字词和表情不提示，不从人名或免费提取生肖',()=>{
 const p=parse('新年快乐\n阿道夫🙂\n小明你好\n免费\n麻烦新4.5各20米谢谢老板\nABC29.40各10米');
 assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,6000);assert.equal(p.bets.length,2);
 assert(p.coverage.every(c=>c.status!=='unhandled'));assert.deepEqual(p.bets[0].values,[4,5]);
});
test('只要会影响算账就保留提示：玩法冲突、错字、非法号码和缺金额',()=>{
 for(const text of ['特肖三中三1 2 100.','特肖三中三1 2 3 100','特码三中三1 2 3 100','特消牛100','99各100','三中三1 2各100','新4.5']){
  const p=parse(text);assert(p.issues.some(i=>i.severity==='error'),text);assert.equal(summarize([p]).totalCents,0,text);
 }
 assert.equal(parse('特肖三中三1 2 100.').issues[0].code,'PLAY_CONFLICT');
});
test('取消和改价指令不当噪声忽略，相关段落暂不计费',()=>{
 for(const text of ['新49各100米不要','旧49各100\n上条取消','1各20\n改成100','1各20米翻倍']){
  const p=parse(text);assert(p.issues.some(i=>i.code==='BET_INSTRUCTION'),text);assert.equal(summarize([p]).totalCents,0,text);
 }
});
test('未署名玩家按账目隔离，显式玩家保留身份，筛选和赔付不混人',()=>{
 const a=parse('旧1各20\n2各10','a',{name:'同名资料'}),b=parse('1各30','b',{name:'同名资料'});
 const s=summarize([a,b]);assert.equal(s.players.length,2);assert.equal(summarize([a,b],{player:a.bets[0].playerId}).totalCents,3000);
 const o=defaultOdds();o.confirmed=true;const draw={date,issue:'2026278',numbers:[2,3,4,5,6,7,1]};
 const settled=settleDocuments([a,b],{新:{...draw,market:'新'},旧:{...draw,market:'旧'}},{新:o,旧:o},date);
 assert(settled.complete);assert.equal(settled.players.length,2);assert.equal(settled.payoutCents,235000);
 const named=parse('小明：旧1各20\n张三：2各10');assert.deepEqual(named.bets.map(b=>[b.player,b.markets]),[['小明',['旧']],['张三',['新']]]);
});
test('收件箱不填玩家也可按本单玩家核对入账，明确绑定冲突仍提示',()=>{
 const batch=createBatch({text:'阿道夫1各20',businessDate:date,name:'私聊记录'},'inbox-a');batch.review.source=true;
 assert(inspectBatch(batch).eligible);assert.equal(inspectBatch(batch).summary.players.length,1);
 const conflict=createBatch({text:'张三：1各20',player:'小明',businessDate:date},'inbox-b');conflict.review.source=true;
 assert(inspectBatch(conflict).blockers.some(b=>b.includes('不同')));
});
test('特码集合纳入所有账目逐号特码，分市场、日期统计，其他玩法不混入',()=>{
 const a=parse('小明：两边1.1.2各20\n特肖牛100\n红波100'),b=parse('3各10\n天肖各1','b'),c=parse('4各50','c',{businessDate:'2026-10-04'});
 const all=specialCollection([a,b,c]);assert.equal(all.summary.totalCents,20500);assert.equal(all.documentCount,3);
 assert.equal(all.summary.numbers.find(n=>n.number===1).cents,8100);assert.equal(all.bets.length,4);assert.equal(all.summary.totalCents,all.summary.numbers.reduce((sum,n)=>sum+n.cents,0));
 const selected=specialCollection([a,b,c],{date,market:'旧'});assert.equal(selected.summary.totalCents,6000);assert.equal(selected.bets.length,1);
 assert.equal(specialCollection([a,b,c],{date,market:'新'}).summary.totalCents,9500);
 assert.equal(specialCollection([a,b],{date}).summary.totalCents,15500);
});
test('原账目改动或移除后重新派生集合，异常投注不纳入，顺序不影响金额',()=>{
 const a=parse('1各20'),b=parse('2各10\n特码三中三1 2 3各100','b');
 const first=specialCollection([a,b]);assert.equal(first.summary.totalCents,3000);assert.equal(first.issues.length,1);
 assert.deepEqual(specialCollection([b,a]).summary.numbers,first.summary.numbers);
 assert.equal(specialCollection([parse('1各30'),b]).summary.totalCents,4000);
 assert.equal(specialCollection([b]).summary.totalCents,1000);
});
