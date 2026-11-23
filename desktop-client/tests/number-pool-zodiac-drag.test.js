import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {ruleForDate} from '../src/core/rules.js';
import {reviewInput,validateCandidate} from '../src/core/ai-review.js';
const lines=['01.13.49.串狗二连一组五十','01.13.49串狗一组五十特串'];
const doc=text=>({id:'pool-dog',name:'测试',businessDate:'2026-11-17',text});
const parse=(text,date='2026-11-17')=>parseDocument(text,{...doc(text),businessDate:date});
const expected=[1,13,49].flatMap(n=>[9,21,33,45].map(d=>[n,d]));
test('多个号码串狗：二连与后置特串各12组600元，两条独立计费',()=>{
 const p=parse(lines.join('\n'));assert.deepEqual(p.issues,[]);assert.equal(p.bets.length,2);
 assert.deepEqual(p.bets.map(b=>b.playType),['linked-number-2-2','special-pair']);
 for(const [i,b] of p.bets.entries()){
  assert.deepEqual(b.groups,expected);assert.equal(b.raw,lines[i]);assert.equal(b.count,12);
  assert.equal(b.basis,'每组');assert.equal(b.unitCents,5000);assert.equal(b.totalCents,60000);
 }
 assert.equal(summarize([p]).totalCents,120000);assert.deepEqual(reviewInput(doc(lines.join('\n'))).items,[]);
});
test('号码列表分隔、中文金额、玩法前后置、继承标题和农历切年',()=>{
 for(const text of ['二中二01 13 49拖狗每组50','特串（01、13、49）对打狗各50','二中二０１／１３／４９串狗一组五十','旧特串\n01.13.49串狗\n各50']){
  const p=parse(text);assert.deepEqual(p.issues,[],text);assert.deepEqual(p.bets[0].groups,expected,text);assert.equal(p.bets[0].totalCents,60000);
 }
 for(const date of ['2026-02-16','2026-02-17','2027-02-06','2030-06-01']){
  const p=parse('02.14.38串狗二连一组五十',date),groups=[2,14,38].flatMap(n=>ruleForDate(date).zodiac.狗.filter(d=>d!==n).map(d=>[n,d]));
  assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);assert.equal(p.bets[0].totalCents,groups.length*5000);
 }
});
test('排除自身配对，重复组和冲突不猜测，不扩展成普通复式',()=>{
 const p=parse('二中二01.09串狗各50');assert.deepEqual(p.issues,[]);assert.equal(p.bets[0].count,7);assert.deepEqual(p.bets[0].drag.excluded,[9]);
 for(const text of ['二中二09.21串狗各50','二中二01.01串狗各50','特串00.13串狗各50','特串013.49串狗各50','二中二01.50串狗各50','特串01.13串狗每号50','二中二01.13串狗每肖50','特串01.13串狗','复式二中二01.13串狗各50','三中三01.13串狗各50']){
  const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
 }
});
test('二中二只中跨侧正码配对；特串一正一特，正特方向可互换',()=>{
 const odds=defaultOdds(),bets=lines.map(s=>parse(s).bets[0]);
 const draw=numbers=>({market:'新',date:'2026-11-17',issue:'2026321',numbers});
 const normals=draw([1,13,9,21,2,3,49]);
 assert.equal(settleBet(bets[0],normals,odds).winCount,4);
 assert.equal(settleBet(bets[0],normals,odds).payoutCents,4*5000*60);
 assert.equal(settleBet(bets[1],normals,odds).winCount,2);
 assert.equal(settleBet(bets[1],normals,odds).payoutCents,2*5000*150);
 assert.equal(settleBet(bets[1],draw([1,13,49,2,3,4,9]),odds).winCount,3);
 assert.equal(settleBet(bets[1],draw([1,13,49,9,21,33,2]),odds).winCount,0);
});
test('AI校验保留多固定号、生肖两侧和原单价，拒绝改号或扁平复式',()=>{
 const d=doc(lines[1]),item=reviewInput(d,'all').items[0];
 const b={markets:['新'],play:'特串',selection:'01.13.49串狗',basis:'每组',amount:'50',evidence:{market:'',play:'特串',selection:'01.13.49串狗',amount:'五十'}};
 assert.deepEqual(validateCandidate({bets:[b]},item,d).bets[0].groups,expected);
 for(const changes of [{selection:'01.13串狗'},{selection:'01.13.49狗'},{amount:'600'},{play:'二中二'}])assert.throws(()=>validateCandidate({bets:[{...b,...changes}]},item,d));
});
