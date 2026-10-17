import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ruleForDate} from '../src/core/rules.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,validateCandidate,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';

const source='新凹特碰\n龙狗每组2';
const groups=[[3,9],[3,21],[3,33],[3,45],[15,9],[15,21],[15,33],[15,45],[27,9],[27,21],[27,33],[27,45],[39,9],[39,21],[39,33],[39,45]];
const doc=(text=source,businessDate='2026-10-16')=>({id:'special-pair-cross',text,businessDate});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};

test('新凹特碰标题继承到龙狗，号码交叉16组各2共32元且无待处理',()=>{
  const p=valid(),b=p.bets[0];assert.equal(p.bets.length,1);
  assert.deepEqual([b.play,b.playType,b.mode,b.basis,b.count,b.unitCents,b.totalCents],['特串','special-pair','groups','每组',16,200,3200]);
  assert.deepEqual(b.markets,['新']);assert.deepEqual(b.groups,groups);assert.deepEqual(b.warnings,[]);
  assert.equal(b.semantic.ruleId,'R43');assert.equal(b.semantic.inherited,true);
  assert.deepEqual(b.semantic.declaration,{line:1,body:'新凹特碰'});
  assert.equal(b.raw,'龙狗每组2');assert.equal(b.line,2);assert.equal(b.endLine,2);
  assert.deepEqual(b.zodiacCross,{ruleId:'R43',animals:['龙','狗'],numbers:[[3,15,27,39],[9,21,33,45]]});
  assert.equal(summarize([p]).totalCents,3200);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('特碰与特串同义，支持冒号、全角中文金额和金额续行，保留原文及高亮',()=>{
  for(const text of ['新凹特碰龙狗每组2','新凹特串\n龙狗每组2','新凹特碰：龙狗各２米','新 凹 特 碰：龙 狗每组二元','特串龙、狗每组贰米','特碰龙/狗各2','特碰龙狗\n每组2']){
    const p=valid(text),b=p.bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,3200);
    assert.equal(senderHeader(text.split('\n')[0]),null);assert.deepEqual(reviewInput(doc(text)).items,[]);
    assert.equal(highlightText(text).map(t=>t.text).join(''),text);
  }
  const tokens=highlightText(source);assert(tokens.some(t=>t.kind==='play'&&t.text==='特碰'));
  assert(tokens.some(t=>t.kind==='selection'&&t.text==='龙狗'));assert(tokens.some(t=>t.kind==='amount'&&t.text==='2'));
  const b=valid('特碰龙狗\n每组2').bets[0];assert.equal(b.raw,'特碰龙狗\n每组2');assert.equal(b.endLine,2);
});

test('特碰市场按标题继承，多市场各自计费，空行与玩家边界重置且不传播选号',()=>{
  const text='小明：旧特碰\n龙狗每组2\n01 02各5\n三边特碰龙狗每组2\n张三：龙狗各2\n香港特碰\n龙狗每组2\n\n龙狗各2';
  const p=valid(text);assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['special-pair',['旧'],3200],['special-number',['旧'],1000],['special-pair',['新','旧','港'],9600],
    ['special-number',['新'],1600],['special-pair',['港'],3200],['special-number',['新'],1600],
  ]);
  assert.equal(p.bets[3].player,'张三');assert.equal(p.bets[1].zodiacCross,undefined);
  assert.deepEqual(reviewInput(doc(text)).items,[]);
});

test('生肖对碰使用业务日期的农历生肖表，本命生肖五号产生20组',()=>{
  for(const date of ['2026-01-01','2026-02-16','2026-02-17','2027-02-05','2027-02-06','2024-03-01']){
    const b=valid(source,date).bets[0],zodiac=ruleForDate(date).zodiac;
    assert.deepEqual(b.groups,zodiac.龙.flatMap(n=>zodiac.狗.map(m=>[n,m])),date);
    assert.equal(b.totalCents,zodiac.龙.length*zodiac.狗.length*200,date);
  }
  const b=valid('特碰马狗每组2').bets[0];assert.equal(b.count,20);assert.equal(b.totalCents,4000);
  assert(b.groups.some(g=>g[0]===49));assert.equal(valid(source,'2024-03-01').bets[0].count,20);
});

test('明确复式、号码分组及单号拖肖仍按原特串计算，冲突或缺失输入不自动计入',()=>{
  for(const text of ['特串复式龙狗每组2','特碰复试龙狗各2','特碰复式\n龙狗每组2']){
    const b=valid(text).bets[0];assert.equal(b.count,28);assert.equal(b.totalCents,5600);assert.equal(b.zodiacCross,undefined);
  }
  assert.equal(valid('特碰03 09 21每组2').bets[0].count,3);
  assert.deepEqual(valid('特碰(03 09)(15 21)每组2').bets[0].groups,[[3,9],[15,21]]);
  assert.equal(valid('特碰45拖鸡各10').bets[0].totalCents,4000);
  assert.equal(valid('二连肖龙狗每组2').bets[0].totalCents,200);
  for(const [text,code] of [['特碰龙龙每组2','GROUP_SIZE'],['特碰龙狗每肖2','BASIS_CONFLICT'],['特碰龙狗各号2','BASIS_CONFLICT'],['特碰龙狗','MISSING_AMOUNT'],['特碰龙狗每组-2','INVALID_AMOUNT'],['特碰龙拖狗每组2','DAN_TUO'],['特碰特肖龙狗每组2','PLAY_CONFLICT']]){
    const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);
  }
});

test('对碰只赔跨生肖的一正一特，正特互换、多组中奖及配置赔率均正确',()=>{
  const b=valid().bets[0],odds=defaultOdds();
  const settle=(numbers,settings=odds)=>settleBet(b,{market:'新',date:'2026-10-16',issue:'2026289',numbers},settings);
  for(const numbers of [[9,21,15,1,2,4,3],[3,15,21,1,2,4,9]]){
    const r=settle(numbers);assert.equal(r.winCount,2);assert.equal(r.winningStakeCents,400);assert.equal(r.payoutCents,60000);
  }
  for(const numbers of [[15,27,39,1,2,4,3],[21,33,45,1,2,4,9],[3,9,15,21,1,2,4],[1,2,4,5,6,7,3]]){
    const r=settle(numbers);assert.equal(r.winCount,0);assert.equal(r.payoutCents,0);
  }
  const custom=structuredClone(odds);custom.rates['special-pair'].rate='120';
  assert.equal(settle([9,21,15,1,2,4,3],custom).payoutCents,48000);
});

test('AI保留特碰的跨生肖分组和标题继承，拒绝改为28组复式、连肖或逐号计费',()=>{
  for(const text of [source,'新凹特碰龙狗每组2']){
    const d=doc(text),item=reviewInput(d,'all').items.at(-1);
    const b={markets:['新'],play:'特串',selection:'龙狗',basis:'每组',amount:'2',evidence:{market:text.includes('\n')?'':'新凹',play:text.includes('\n')?'':'特碰',selection:'龙狗',amount:'2'}};
    assert.deepEqual(validateCandidate({bets:[b]},item,d).bets[0].groups,groups);
    for(const change of [{selection:'复式龙狗'},{play:'2连肖'},{play:'特码',basis:'每号'},{amount:'32'}]){
      assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/选号|分组|玩法|计费|金额/);
    }
  }
});

test('旧版特碰错误核验失效并重算32元，历史结算快照和投注原文保留',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261015-1';d.settlements=[{id:'past',payoutCents:12345}];
    d.assistance={...assistanceFor(d,[{line:2,source:'龙狗每组2',status,replacement:status==='accepted'?'新 特码龙狗各2':''}]),version:'semantic-20261015-1'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.equal(next.text,source);assert.deepEqual(next.settlements,d.settlements);assert.deepEqual(p.issues,[]);
    assert.equal(summarize([p]).totalCents,3200);assert.deepEqual(currentReviewItems(next),[]);
  }
});
