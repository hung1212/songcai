import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {specialCollection} from '../src/core/special-collection.js';

const prefix='二中二30 7各10\n二中二30 19各10\n二中二30 31各10\n二中二30 43各10\n';
const source=prefix+'香港33，34，36各5';
const doc=(text=source)=>({id:'market-prefix-reset',name:'测试',text,businessDate:'2026-10-05',defaultPlayer:''});
const parse=(text=source)=>parseDocument(text,doc(text));
const valid=(text=source)=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('截图第五行香港号码恢复默认特码，前三号各5，全单55元且进入特码集合',()=>{
  const p=valid(),b=p.bets.at(-1);
  assert.equal(p.bets.length,5);assert(p.bets.slice(0,4).every(b=>b.playType==='linked-number-2-2'));
  assert.deepEqual([b.playType,b.markets,b.values,b.basis,b.count,b.unitCents,b.totalCents],['special-number',['港'],[33,34,36],'每号',3,500,1500]);
  assert.equal(b.groups,null);assert.equal(b.semantic.inherited,false);assert.equal(b.semantic.declaration,undefined);
  assert.equal(b.line,5);assert.equal(b.endLine,5);assert.equal(b.raw,'香港33，34，36各5');
  assert.deepEqual(summarize([p]).markets,{新:4000,旧:0,港:1500});assert.equal(summarize([p]).totalCents,5500);
  assert.equal(specialCollection([p]).summary.totalCents,1500);
  assert.deepEqual(reviewInput(doc()).items,[]);
});

test('新行前缀有无冒号与独占市场标题等价，同市场、别名、多市场均重置',()=>{
  for(const [label,markets] of [['香港',['港']],['港',['港']],['香',['港']],['新澳',['新']],['新',['新']],['澳',['新']],['奥',['新']],['旧澳',['旧']],['老',['旧']],['两边',['新','旧']],['三边',['新','旧','港']]]){
    for(const separator of ['', '：', ': ', ' ', '，', '\n']){
      const p=valid('新二中二01 02各10\n'+label+separator+'33 34 36各5\n37 38各2\n总'+19*markets.length);
      assert(p.bets.slice(1).every(b=>b.playType==='special-number'&&!b.semantic.inherited),label+separator);
      assert.deepEqual(p.bets[1].markets,markets);assert.equal(p.bets[1].totalCents,1500*markets.length);
      assert.equal(p.bets[2].totalCents,400*markets.length);
    }
  }
  for(const prior of ['平特肖鼠各10','三连尾1 2 3各10','三中三01 02 03各10','二中二30拖鼠各10']){
    assert.equal(valid(prior+'\n香港33 34 36各5').bets.at(-1).playType,'special-number');
  }
});

test('明确玩法仍优先，正常无市场续行继续继承，尾部市场不冒充标题',()=>{
  const p=valid('二中二01 02各10\n香港三中三33 34 36各5\n37 38 39各2');
  assert.deepEqual(p.bets.map(b=>b.playType),['linked-number-2-2','linked-number-3-3','linked-number-3-3']);
  assert.equal(p.bets[2].semantic.declaration.line,2);
  const plain=valid('二中二01 02各10\n\n33 34各5');
  assert.equal(plain.bets[1].playType,'special-number');
  assert.equal(plain.bets[1].semantic.declaration,undefined);
  assert.equal(plain.bets[1].totalCents,1000);
  const suffix=parse('新二中二01 02各10\n33 34各5香港');
  assert.equal(suffix.bets[1].playType,'linked-number-2-2');assert.equal(suffix.bets[1].status,'review');
  assert(suffix.issues.some(i=>i.code==='TRAILING_MARKET'));
  assert(parse('二中二01 02各10\n香港特肖三中三33 34各5').issues.some(i=>i.code==='PLAY_CONFLICT'));
});

test('新市场行不吞掉前面未完成的投注，金额续行和后续玩家各自正确解析',()=>{
  const unfinished=parse('二中二30拖鼠\n香港33 34 36各5');
  assert(unfinished.issues.some(i=>i.line===1&&i.code==='MISSING_AMOUNT'));
  assert.equal(unfinished.bets.length,1);assert.equal(unfinished.bets[0].playType,'special-number');
  const p=valid('小明：二中二01 02各10\n香港33 34 36\n各5\n张三：01各2');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['linked-number-2-2',['新'],1000],['special-number',['港'],1500],['special-number',['新'],200],
  ]);
  assert.equal(p.bets[1].line,2);assert.equal(p.bets[1].endLine,3);
});

test('AI清除跨段旧玩法上下文且不能把特码改回二中二，旧已采纳解释自动失效',()=>{
  const d=doc(),item=reviewInput(d,'all').items.find(i=>i.line===5);
  assert.deepEqual(item.context,{markets:['港'],play:''});assert.deepEqual(item.preceding,[]);
  const b={markets:['港'],play:'特码',selection:'33，34，36',basis:'每号',amount:'5',evidence:{market:'香港',play:'',selection:'33，34，36',amount:'5'}};
  assert.equal(validateCandidate({bets:[b]},item,d).totalCents,1500);
  assert.throws(()=>validateCandidate({bets:[{...b,play:'二中二',basis:'每组'}]},item,d),/改变.*分组|计费/);
  d.parserVersion='parser-20261010-3';
  d.assistance={...assistanceFor(d,[{line:5,source:'香港33，34，36各5',status:'accepted',replacement:'香港二中二33 34 36各5'}]),version:'semantic-20261010-3'};
  const upgraded=upgradeDocument(d),p=parseDocument(upgraded.text,upgraded);
  assert.equal(upgraded.text,source);assert.equal(p.bets.at(-1).playType,'special-number');assert.deepEqual(p.issues,[]);
});

test('计费总额同为15也必须按特码赔付，香港正码配对不中奖，特码33按5元结算',()=>{
  const p=valid(),odds=defaultOdds();odds.confirmed=true;
  const common={date:doc().businessDate,issue:'2026278'};
  const run=numbers=>settleDocuments([p],{
    新:{...common,market:'新',numbers:[1,2,3,4,5,6,49]},
    港:{...common,market:'港',numbers},
  },{新:odds,港:odds},common.date);
  const lost=run([33,34,1,2,3,4,48]);
  assert(lost.complete);assert.equal(lost.stakeCents,5500);assert.equal(lost.payoutCents,0);assert.equal(lost.entries.at(-1).winCount,0);
  const won=run([34,36,1,2,3,4,33]);
  assert(won.complete);assert.equal(won.entries.at(-1).winningStakeCents,500);assert.equal(won.payoutCents,23500);
});
