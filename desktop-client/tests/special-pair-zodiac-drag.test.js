import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ruleForDate} from '../src/core/rules.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,reviewPayload,validateCandidate,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
import {upgradeDocument,reviewSettlement} from '../src/core/parser-upgrade.js';
import {settleDocuments} from '../src/core/settlement.js';
import {manualDraw} from '../src/core/draws.js';

const source='特串、猴拖鸡每组5米';
const groups=[11,23,35,47].flatMap(a=>[10,22,34,46].map(b=>[a,b]));
const doc=(text=source,businessDate='2026-10-18')=>({id:'special-pair-zodiac-drag',text,businessDate});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};

test('特串猴拖鸡保留16个跨生肖号码组，每组5元，总80元且不需AI补解释',()=>{
  const p=valid(),b=p.bets[0];assert.equal(p.bets.length,1);
  assert.deepEqual([b.play,b.playType,b.mode,b.basis,b.count,b.unitCents,b.totalCents],['特串','special-pair','groups','每组',16,500,8000]);
  assert.deepEqual(b.groups,groups);assert.deepEqual(b.warnings,[]);assert.equal(b.semantic.ruleId,'R45');
  assert.deepEqual(b.zodiacCross,{ruleId:'R45',animals:['猴','鸡'],numbers:[[11,23,35,47],[10,22,34,46]]});
  assert.equal(b.raw,source);assert.equal(b.line,1);assert.equal(b.endLine,1);
  assert.equal(summarize([p]).totalCents,8000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('生肖互拖支持特碰别名、标点、中文金额、标题和金额续行，原文高亮完整',()=>{
  for(const text of ['特串猴拖鸡各5','特碰：猴拖鸡每组伍米','特串，猴 拖 鸡 每组５元','特串猴肖拖鸡肖：每组五元','特串\n猴拖鸡每组5米','特串猴拖鸡\n每组5米']){
    const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,8000);
    assert.equal(senderHeader(text.split('\n')[0]),null);assert.deepEqual(reviewInput(doc(text)).items,[]);
    assert.equal(highlightText(text).map(t=>t.text).join(''),text);
  }
  const b=valid('特串猴拖鸡\n每组5米').bets[0];assert.equal(b.endLine,2);assert.equal(b.raw,'特串猴拖鸡\n每组5米');
  const tokens=highlightText(source);assert(tokens.some(t=>t.kind==='play'&&t.text==='拖'));
  assert(tokens.some(t=>t.kind==='selection'&&t.text==='猴'));assert(tokens.some(t=>t.kind==='amount'&&t.text==='5'));
});

test('生肖互拖按业务日期的农历年展开，五号生肖按实际20组计费',()=>{
  for(const date of ['2026-01-01','2026-02-16','2026-02-17','2027-02-05','2027-02-06','2028-03-01','2029-03-01']){
    const b=valid(source,date).bets[0],z=ruleForDate(date).zodiac;
    assert.deepEqual(b.groups,z.猴.flatMap(a=>z.鸡.map(b=>[a,b])),date);
    assert.equal(b.totalCents,z.猴.length*z.鸡.length*500,date);
  }
  assert.equal(valid(source,'2028-03-01').bets[0].count,20);
  assert.equal(valid('特串马拖鸡每组5米').bets[0].totalCents,10000);
});

test('市场与玩家继承保留，普通投注不继承拖肖，空行和换玩家结束玩法标题',()=>{
  const p=valid('小明：香港特串\n猴拖鸡每组5米\n01 02各5\n三边特串猴拖鸡每组5米\n张三：特串猴拖鸡每组5米');
  assert.deepEqual(p.bets.map(b=>[b.player,b.playType,b.markets,b.totalCents]),[
    ['小明','special-pair',['港'],8000],['小明','special-number',['港'],1000],
    ['小明','special-pair',['新','旧','港'],24000],['张三','special-pair',['新'],8000],
  ]);
  assert.equal(p.bets[0].semantic.inherited,true);assert.equal(p.bets[0].semantic.declaration.line,1);
  assert.equal(p.bets[1].zodiacCross,undefined);
  for(const text of ['香港特串\n\n猴拖鸡每组5','小明：特串\n张三：猴拖鸡每组5']){
    const reset=valid(text);assert.equal(reset.bets[0].playType,'linked-number-2-2');assert.deepEqual(reset.bets[0].markets,['新']);assert.equal(summarize([reset]).totalCents,8000);
  }
});

test('歧义拖法和计费冲突仍待处理，现有特串复式、单号拖肖和二连肖规则不变',()=>{
  for(const [text,code] of [
    ['特串猴拖猴每组5','GROUP_SIZE'],['特串猴拖鸡兔每组5','DAN_TUO'],['特串猴兔拖鸡每组5','DAN_TUO'],
    ['特串猴拖鸡拖狗每组5','DAN_TUO'],['特串复式猴拖鸡每组5','DAN_TUO'],['特串猴胆拖鸡每组5','DAN_TUO'],
    ['二中二猴鼠拖鸡每组5','DAN_TUO'],['特串猴拖鸡每肖5','BASIS_CONFLICT'],
    ['特串猴拖鸡各号5','BASIS_CONFLICT'],['特串猴拖鸡','MISSING_AMOUNT'],['特串猴拖鸡每组-5','INVALID_AMOUNT'],
  ]){const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);}
  assert.equal(valid('特串复式猴鸡每组5').bets[0].count,28);
  assert.equal(valid('特串45拖鸡每组5').bets[0].count,4);
  assert.equal(valid('二连肖猴拖鸡每组5').bets[0].count,1);
  assert.equal(valid('特串猴鸡每组5').bets[0].semantic.ruleId,'R43');
});

test('只结算跨生肖一正一特，方向互换和多组中奖正确，使用配置的特串赔率',()=>{
  const b=valid().bets[0],odds=defaultOdds();odds.rates['special-pair'].rate='120';
  const settle=numbers=>settleBet(b,{market:'新',date:'2026-10-18',issue:'2026291',numbers},odds);
  for(const numbers of [[10,22,23,1,2,3,11],[11,23,22,1,2,3,10]]){
    const r=settle(numbers);assert.equal(r.winCount,2);assert.equal(r.winningStakeCents,1000);assert.equal(r.payoutCents,120000);
  }
  for(const numbers of [[23,35,47,1,2,3,11],[10,22,34,1,2,3,46],[11,10,23,22,1,2,3]])assert.equal(settle(numbers).payoutCents,0);
  assert.equal(settle([10,22,34,46,23,1,11]).winCount,4);
});

test('AI核验保留互拖分组和原单价，拒绝复式28组、连肖、变更金额和生肖',()=>{
  for(const text of [source,'香港特串\n猴拖鸡每组5米']){
    const d=doc(text),item=reviewInput(d,'all').items.at(-1),inherited=text.includes('\n');
    const b={markets:[inherited?'港':'新'],play:'特串',selection:'猴拖鸡',basis:'每组',amount:'5',evidence:{market:'',play:inherited?'':'特串',selection:'猴拖鸡',amount:'5'}};
    assert.deepEqual(validateCandidate({bets:[b]},item,d).bets[0].groups,groups);
    assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
    for(const change of [{selection:'复式猴鸡'},{play:'2连肖'},{amount:'80'},{selection:'龙拖鸡'}]){
      assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/选号|分组|玩法|计费|金额/);
    }
  }
});

test('旧版AI误读失效并重算80元，原文和历史快照保留且可查看复算差异',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261016-2';d.settlements=[{id:'past',payoutCents:12345}];
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'特串复式猴鸡各5':''}]),version:'semantic-20261016-2'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.equal(next.text,source);assert.deepEqual(next.settlements,d.settlements);assert.deepEqual(p.issues,[]);
    assert.equal(summarize([p]).totalCents,8000);assert.deepEqual(currentReviewItems(next),[]);
  }
  const old={...parse(),parserVersion:'parser-20261016-2',originalText:source,bets:[]};
  const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,defaultOdds()])),date='2026-10-18';
  const draws={新:manualDraw({market:'新',date,issue:'2026291',numbers:[10,22,23,1,2,3,11],sourceName:'固定测试'})};
  const snapshot={inputs:{documents:[old],settings:{odds},draws,date},result:settleDocuments([old],draws,odds,date)};
  const saved=JSON.stringify(snapshot),review=reviewSettlement(snapshot);
  assert.equal(review.required,true);assert.equal(review.afterStakeCents,8000);assert.equal(review.afterPayoutCents,150000);
  assert.equal(JSON.stringify(snapshot),saved);
});
