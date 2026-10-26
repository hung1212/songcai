import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ruleForDate} from '../src/core/rules.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,reviewPayload,validateCandidate,validateReply,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='特串45 拖 鸡各10，';
const groups=[[45,10],[45,22],[45,34],[45,46]];
const doc=(text=source,businessDate='2026-10-11')=>({id:'special-pair-drag',name:'测试',text,businessDate,defaultPlayer:''});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};

test('特串单号拖鸡按四个明确配对各10共40，固定号码忠于原文',()=>{
  for(const anchor of [45,44]){
    const text=source.replace('45',String(anchor)),p=valid(text),b=p.bets[0];
    assert.equal(p.bets.length,1);assert.deepEqual(b.groups,groups.map(g=>[anchor,g[1]]));
    assert.deepEqual(b.values,[anchor,10,22,34,46]);
    assert.deepEqual([b.playType,b.size,b.mode,b.basis,b.count,b.unitCents,b.perMarketCents,b.totalCents],['special-pair',2,'groups','每组',4,1000,4000,4000]);
    assert.equal(b.semantic.ruleId,'R34');assert.deepEqual(b.drag,{ruleId:'R34',anchor,animal:'鸡',numbers:[10,22,34,46],excluded:[]});
    assert.equal(b.raw,text);assert.equal(b.line,1);assert.equal(b.endLine,1);assert.deepEqual(b.warnings,[]);
    assert.equal(summarize([p]).totalCents,4000);assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
});

test('特串拖号支持空格、冒号、全角、中文金额和跨行单价',()=>{
  for(const text of ['特串45拖鸡各10','特串：45号拖鸡肖每组十元','特串４５拖鸡各１０','特串 45 拖 鸡 各十米','特串45拖鸡：各10','特串45拖鸡各组10元','特串45拖鸡\n各10']){
    const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,4000,text);
    assert.equal(b.raw,text);assert.equal(senderHeader(text),null);assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
  assert.equal(valid('特串45拖鸡\n各10').bets[0].endLine,2);
});

test('明确特串标题可继承，多市场各自计费，固定拖号不传播到后续投注',()=>{
  const text='小明：旧特串\n45拖鸡各10\n01 02各5\n三边特串44拖鸡各10\n张三：特串45拖鸡各10\n香港33 34各5';
  const p=valid(text);assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['special-pair',['旧'],4000],['special-number',['旧'],1000],['special-pair',['新','旧','港'],12000],['special-pair',['新'],4000],['special-number',['港'],1000],
  ]);
  assert.equal(p.bets[0].semantic.inherited,true);assert.equal(p.bets[0].semantic.declaration.line,1);
  assert.deepEqual(p.bets[0].groups,groups);assert.equal(p.bets[1].drag,undefined);assert.equal(p.bets[1].groups,null);
  assert.equal(p.bets[3].player,'张三');assert.equal(summarize([p]).totalCents,22000);
  assert.deepEqual(reviewInput(doc(text)).items,[]);
  assert.deepEqual(valid('小明：旧特串\n张三：45拖鸡各10').bets.map(b=>[b.playType,b.markets,b.totalCents]),[['linked-number-2-2',['新'],4000]]);
});

test('特串拖号按农历切年展开四号或五号，重合号码不与自身配对',()=>{
  for(const date of ['2026-01-01','2026-02-16','2026-02-17','2027-02-05','2027-02-06','2029-04-01']){
    const b=valid(source,date).bets[0],numbers=ruleForDate(date).zodiac.鸡.filter(n=>n!==45);
    assert.deepEqual(b.groups,numbers.map(n=>[45,n]),date);assert.equal(b.totalCents,numbers.length*1000,date);
  }
  assert.deepEqual(valid(source,'2026-02-16').bets[0].groups,[[45,9],[45,21],[45,33]]);
  assert.equal(valid(source,'2029-04-01').bets[0].count,5);
  const overlap=valid('特串10拖鸡各10').bets[0];assert.deepEqual(overlap.groups,[[10,22],[10,34],[10,46]]);
  assert.deepEqual(overlap.drag.excluded,[10]);assert.equal(overlap.totalCents,3000);
  assert.deepEqual(valid('特串01拖马各10').bets[0].groups,[[1,13],[1,25],[1,37],[1,49]]);
});

test('特串其他未确认拖法、非法号码、计费冲突和缺金额继续待处理',()=>{
  for(const [text,code] of [
    ['特串45 44拖鸡各10','DAN_TUO'],['特串45拖鸡兔各10','DAN_TUO'],['特串兔拖鸡猴各10','DAN_TUO'],
    ['特串复式45拖鸡各10','DAN_TUO'],['特串45胆拖鸡各10','DAN_TUO'],
    ['特串00拖鸡各10','NUMBER_RANGE'],['特串50拖鸡各10','NUMBER_RANGE'],
    ['特串45拖鸡每肖10','BASIS_CONFLICT'],['特串45拖鸡各号10','BASIS_CONFLICT'],
    ['特串45拖鸡','MISSING_AMOUNT'],
  ]){
    const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);
  }
});

test('特串仅结算固定号与生肖号的一正一特，正特互换有效，遵循配置赔率',()=>{
  const b=valid().bets[0],odds=defaultOdds();odds.confirmed=true;
  const settle=(numbers,settings=odds)=>settleBet(b,{market:'新',date:doc().businessDate,issue:'2026284',numbers},settings);
  const three=settle([10,22,34,1,2,3,45]);assert.equal(three.winCount,3);assert.equal(three.winningStakeCents,3000);assert.equal(three.payoutCents,450000);
  const reversed=settle([45,22,34,1,2,3,10]);assert.equal(reversed.winCount,1);assert.equal(reversed.winningStakeCents,1000);assert.equal(reversed.payoutCents,150000);
  for(const numbers of [[45,10,22,34,46,1,2],[10,22,34,1,2,3,46],[1,2,3,4,5,6,45]]){
    const lost=settle(numbers);assert.equal(lost.winCount,0);assert.equal(lost.payoutCents,0);
  }
  assert.equal(settle([10,22,34,46,1,2,45]).winCount,4);
  const custom=structuredClone(odds);custom.rates['special-pair'].rate='120';
  assert.equal(settle([45,22,34,1,2,3,10],custom).payoutCents,120000);
});

test('AI保留特串固定号分组和单价，拒绝改号、扁平复式、二中二及改金额',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'特串',selection:'45拖鸡',basis:'每组',amount:'10',evidence:{market:'',play:'特串',selection:'45 拖 鸡',amount:'10'}};
  const candidate={bets:[b]},r=validateCandidate(candidate,item,d);
  assert.deepEqual(r.bets[0].groups,groups);assert.equal(r.totalCents,4000);
  assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'44拖鸡'}]},item,d),/选号|分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'45鸡'}]},item,d),/分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,play:'二中二'}]},item,d),/玩法/);
  assert.throws(()=>validateCandidate({bets:[{...b,amount:'40'}]},item,d),/金额/);
  const unsupported=doc('特串兔拖鸡猴各10'),pending=reviewInput(unsupported).items[0];
  assert.throws(()=>validateCandidate(candidate,pending,unsupported),/拖号分组未明确/);
});

test('旧AI错误解释失效，特串拖号自动重算40元，原文和高亮保持完整',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261010-6';
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'特串45鸡各10':''}]),version:'semantic-20261010-6'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.equal(next.text,source);assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);
    assert.equal(summarize([p]).totalCents,4000);assert.deepEqual(currentReviewItems(next),[]);
  }
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.deepEqual(tokens.filter(t=>t.kind==='play').map(t=>t.text),['特串','拖']);
  assert.deepEqual(tokens.filter(t=>t.kind==='selection').map(t=>t.text),['45','鸡']);
  assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['10']);
});
