import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument, summarize, senderHeader} from '../src/core/parser.js';
import {defaultOdds, settleBet, settleDocuments} from '../src/core/settlement.js';
import {reviewInput, validateCandidate, validateReply, assistanceFor} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';

const date='2026-10-06';
const doc=text=>({id:'package-market',name:'测试',text,businessDate:date,defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('包单数1100为25个单数特码每号44元，含49，分布金额守恒',()=>{
  const p=valid('新凹\n包单数1100'),b=p.bets[0],s=summarize([p]);
  assert.equal(p.bets.length,1);assert.equal(b.raw,'包单数1100');assert.equal(b.line,2);
  assert.equal(b.marketSource,1);assert.deepEqual(b.markets,['新']);assert.equal(b.playType,'special-number');
  assert.equal(b.basis,'每号');assert.equal(b.count,25);assert.equal(b.unitCents,4400);
  assert.deepEqual(b.values,Array.from({length:25},(_,i)=>2*i+1));
  assert.equal(b.perMarketCents,110000);assert.equal(b.totalCents,110000);assert.equal(b.marketEntries[0].amountCents,110000);
  for(const {number,cents} of s.numbers)assert.equal(cents,number%2?4400:0);
  assert.equal(s.numbers.reduce((a,b)=>a+b.cents,0),110000);
  assert.equal(b.allocation.totalCents,110000);assert.equal(b.semantic.ruleId,'R12');
  assert(!p.metadata.some(m=>m.kind==='无关文字'));assert.deepEqual(reviewInput(doc('新凹\n包单数1100'),'doubt').items,[]);
});

test('新凹在旧市场后确实切换，包号不继承特肖或组合玩法',()=>{
  const p=valid('小明：旧特肖猪20\n新凹\n包单数1100\n02各10\n张三：包双数1200');
  assert.deepEqual(p.bets.map(b=>b.playType),['special-zodiac','special-number','special-number','special-number']);
  assert.deepEqual(p.bets.map(b=>b.markets),[['旧'],['新'],['新'],['新']]);
  assert.equal(p.bets[2].unitCents,1000);assert.equal(p.bets[2].allocation,undefined);
  assert.equal(p.bets[3].count,24);assert.equal(p.bets[3].unitCents,5000);
});

test('包号支持冒号、空格、中文金额、全角及可精确均分的小数总额',()=>{
  for(const text of ['新凹：包单数1100','新凹包单数一千一百米','包 单 数：１１００元','包单数，1100','特码 包单数1100','包单数\n1100'])assert.equal(valid(text).bets[0].unitCents,4400,text);
  assert.equal(valid('包单数：1100.25').bets[0].unitCents,4401);
  assert.equal(valid('包双数12').bets[0].unitCents,50);
  assert.equal(valid('两边包单数1100').bets[0].totalCents,220000);
  assert.equal(senderHeader('包单数：1100'),null);
  const text='包单数：１１００',tokens=highlightText(text);
  assert.equal(tokens.map(t=>t.text).join(''),text);assert(tokens.some(t=>t.kind==='amount'&&t.text==='１１００'));
});

test('总额不能精确均分、各号冲突或混入其他选号时不猜金额',()=>{
  for(const [text,code] of [['包单数1100.01','PACKAGE_SPLIT_PRECISION'],['包双数1100','PACKAGE_SPLIT_PRECISION'],['包单数各100','BASIS_CONFLICT'],['包单数每号100','BASIS_CONFLICT'],['特肖包单数1100','BASIS_CONFLICT'],['三中三包单数1100','BASIS_CONFLICT'],['包单数双数1100','PACKAGE_SELECTION'],['包单数01 03 1100','PACKAGE_SELECTION']]) {
    const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);
  }
  for(const [text,type,total] of [['单1100','attribute',110000],['单数各10','special-number',25000],['红波100','wave',10000],['红波各100','special-number',170000],['特肖包40钱牛','special-zodiac',4000]]) {
    const b=valid(text).bets[0];assert.equal(b.playType,type);assert.equal(b.totalCents,total);assert.equal(b.allocation,undefined);
  }
});

test('包单数赔付使用每号44元，49不套用独立单双的和局',()=>{
  const b=valid('包单数1100').bets[0],odds=defaultOdds();odds.confirmed=true;odds.refund49.attribute=true;
  const draw={market:'新',date,issue:'2026279',numbers:[1,2,3,4,5,6,49]};
  const won=settleBet(b,draw,odds);assert.equal(won.status,'won');assert.equal(won.winCount,1);assert.equal(won.payoutCents,206800);
  assert.equal(settleBet(b,{...draw,numbers:[1,2,3,4,5,6,8]},odds).payoutCents,0);
});

test('AI用原文包号总额核验，本地算单价，不允许把总额改成每号1100或补造44',()=>{
  const d=doc('新凹\n包单数1100'),item=reviewInput(d,'all').items.find(i=>i.line===2);
  const b={markets:['新'],play:'包单数',selection:'单数',basis:'每号',amount:'1100',evidence:{market:'',play:'包单数',selection:'单数',amount:'1100'}};
  const candidate={bets:[b]};const result=validateCandidate(candidate,item,d);
  assert.equal(result.totalCents,110000);assert.equal(result.bets[0].unitCents,4400);
  assert.equal(validateReply({items:[{line:2,candidates:[candidate]}]},[item],d)[0].status,'agree');
  assert.throws(()=>validateCandidate({bets:[{...b,play:'特码'}]},item,d),/改变|计费/);
  assert.throws(()=>validateCandidate({bets:[{...b,amount:'44'}]},item,d),/金额/);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'双数'}]},item,d),/包号/);
});

export const marketSample=`新奥
猪各号二十米

08/33/44/32/06/36/01/09/48/49/37/20各十米

08/32/09/08/32各二十米

08/32/33/20/09各十米

10/33/32/39/38复式三中三各组十米

总450

香港
07/19/43/08/44/34/23/35/38/27/39/33各十米

07/43/08/44/23/35各二十米

36/48/07/43/35复式三中三各组五米

总290`;

test('空行按新规则重置，旧样例按新620港120，重复号码照下注份数累计',()=>{
  const p=valid(marketSample),s=summarize([p]);
  assert.equal(p.bets.length,8);assert.equal(s.totalCents,74000);assert.deepEqual(s.markets,{新:62000,旧:0,港:12000});
  assert(p.bets.slice(0,5).every(b=>b.markets.join()==='新'));
  assert.deepEqual(p.bets.slice(5).map(b=>b.markets.join()),['港','新','新']);
  assert.equal(p.bets[5].playType,'special-number');assert.equal(p.bets[5].count,12);
  assert.equal(p.bets[2].count,5);assert.equal(p.bets[2].values.filter(n=>n===8).length,2);
  assert.deepEqual(p.metadata.filter(m=>m.kind==='金额声明').map(m=>[m.expectedCents,m.actualCents]),[[45000,45000],[29000,29000]]);
  assert.equal(reviewInput(doc(marketSample),'doubt').items.length,0);
  const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,defaultOdds()]));
  const draws=Object.fromEntries(['新','港'].map(m=>[m,{market:m,date,issue:'2026279',numbers:[1,2,3,4,5,6,49]}]));
  const settled=settleDocuments([p],draws,odds,date);assert.equal(settled.stakeCents,74000);assert.equal(settled.complete,true);
});

test('市场标题前向切换、玩法重置；不同玩家及真正尾注不混用',()=>{
  const p=valid('小明：新三中三01 02 03各10\n\n香港\n\n07 19各20\n总40\n张三：08各5');
  assert.deepEqual(p.bets.map(b=>[b.markets.join(),b.playType,b.totalCents]),[['新','linked-number-3-3',1000],['新','special-number',4000],['新','special-number',500]]);
  assert(parse('小明：1各10\n港\n张三：2各20').issues.some(i=>i.code==='TRAILING_MARKET'));
  assert(parse('新01各10\n02各20\n共30米，香港').issues.some(i=>i.code==='TRAILING_MARKET'));
});

test('总按市场段累计，玩法标题和空行不截断；合计仍看整条消息且错误总额仍可见',()=>{
  const text='新\n01各10\n总10\n香港\n02各20\n三中三\n01 02 03各10\n总30\n合计40';
  assert.equal(summarize([valid(text)]).totalCents,4000);
  const p=parse(marketSample.replace('总290','总291')),issues=p.issues.filter(i=>i.code==='TOTAL_MISMATCH');
  assert.equal(issues.length,1);assert.match(issues[0].message,/已解析290/);assert.deepEqual(summarize([p]).markets,{新:62000,旧:0,港:12000});
});

test('旧AI解释随语义版本失效，重新采用确定的包号与市场标题规则',()=>{
  for(const text of ['新凹\n包单数1100',marketSample]) {
    const d=doc(text);d.assistance={...assistanceFor(d,[{line:2,source:text.split('\n')[1],replacement:'',status:'review'}]),version:'semantic-20261006-1'};
    assert.deepEqual(parseDocument(text,d).issues,[]);
  }
});
