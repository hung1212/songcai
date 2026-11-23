import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {WAVES} from '../src/core/rules.js';
import {reviewInput,validateCandidate} from '../src/core/ai-review.js';
const source='28.13.49.40对蓝波单各组10';
const doc=text=>({id:'wave-drag',name:'测试',businessDate:'2026-11-22',text});
const parse=text=>parseDocument(text,doc(text));
const left=[28,13,49,40],right=[3,9,15,25,31,37,41,47],groups=left.flatMap(a=>right.map(b=>[a,b]));
test('用户原文默认二中二：四个号码对蓝波单32组各10合计320元',()=>{
 const p=parse(source),b=p.bets[0];assert.deepEqual(p.issues,[]);assert.equal(p.bets.length,1);
 assert.deepEqual(b.groups,groups);assert.equal(b.playType,'linked-number-2-2');assert.equal(b.count,32);
 assert.equal(b.unitCents,1000);assert.equal(b.totalCents,32000);assert.equal(b.raw,source);assert.equal(b.semantic.ruleId,'R64');
 assert.deepEqual(reviewInput(doc(source)).items,[]);
});
test('支持对、串、拖、对打，前后置玩法和金额续行，市场保持',()=>{
 for(const op of ['对','串','拖','对打'])for(const color of ['蓝波单','蓝单','兰波单']){
  const p=parse(`香港二中二28.13.49.40${op}${color}各组十元`);
  assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);assert.deepEqual(p.bets[0].markets,['港']);
 }
 for(const text of ['28/13/49/40串蓝单二连每组10','二中二（28、13、49、40）拖（蓝波单）各10','旧二中二\n28.13.49.40对蓝单\n各10','２８.１３.４９.４０对蓝波单各组１０']){
  const p=parse(text);assert.deepEqual(p.issues,[],text);assert.deepEqual(p.bets[0].groups,groups);
 }
});
test('波色分类按固定表过滤，自身不配对，重复和未知范围仍待处理',()=>{
 for(const color of ['红','蓝','绿'])for(const kind of ['','单','双','大','小']){
  const text=`二中二01.02拖${color}波${kind}各10`,p=parse(text);
  const numbers=WAVES[color].filter(n=>!kind||kind==='单'&&n%2===1||kind==='双'&&n%2===0||kind==='大'&&n>=25||kind==='小'&&n<25);
  const expected=[1,2].flatMap(a=>numbers.filter(b=>b!==a).map(b=>[a,b]));
  if(new Set(expected.map(g=>[...g].sort((a,b)=>a-b).join(','))).size!==expected.length){assert(p.issues.length);continue;}
  assert.deepEqual(p.issues,[],text);assert.deepEqual(p.bets[0].groups,expected);
 }
 for(const text of ['03.09对蓝单各10','28.28对蓝单各10','二中二00.28对蓝单各10','二中二50.28对蓝单各10','二中二028对蓝单各10','二中二28对蓝单双各10','二中二28对蓝单各号10','复式二中二28对蓝单各10','28对蓝单','二中二28对蓝单对13各10']){
  const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
 }
 assert.equal(parse('蓝波单各10').bets[0].playType,'special-number');
 assert.equal(parse('蓝波单100').bets[0].playType,'half-wave');
});
test('二中二按跨侧正码配对结算，特串只按一正一特，不算侧内组合',()=>{
 const b=parse(source).bets[0],sp=parse('特串'+source).bets[0],odds=defaultOdds();
 const draw=numbers=>({market:'新',date:'2026-11-22',issue:'2026326',numbers});
 assert.equal(settleBet(b,draw([28,13,3,9,1,2,49]),odds).winCount,4);
 assert.equal(settleBet(b,draw([28,13,3,9,1,2,49]),odds).payoutCents,240000);
 assert.equal(settleBet(sp,draw([28,13,3,9,1,2,49]),odds).winCount,2);
 assert.equal(settleBet(sp,draw([28,13,49,40,1,2,3]),odds).winCount,4);
 assert.equal(settleBet(b,draw([3,9,15,25,31,37,28]),odds).winCount,0);
});
test('AI保留左右范围、二中二与原单价，不改成普通复式或半波',()=>{
 const d=doc(source),item=reviewInput(d,'all').items[0];
 const b={markets:['新'],play:'二中二',selection:'28.13.49.40对蓝波单',basis:'每组',amount:'10',evidence:{market:'',play:'',selection:'28.13.49.40对蓝波单',amount:'10'}};
 assert.deepEqual(validateCandidate({bets:[b]},item,d).bets[0].groups,groups);
 for(const changes of [{selection:'28.13.49.40蓝波单'},{selection:'28.13.49.40对蓝波双'},{amount:'320'},{play:'特串'}])assert.throws(()=>validateCandidate({bets:[{...b,...changes}]},item,d));
});
