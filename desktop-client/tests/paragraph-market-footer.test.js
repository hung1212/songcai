import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate,reviewItemKey} from '../src/core/ai-review.js';
import {settleDocuments,defaultOdds} from '../src/core/settlement.js';

const text='11.35.47.各.5.米，\n23..10米，\n香港\n\n19.39.27.各20米，\n03..40米，\n15.100米，\n，香港';
const doc=text=>({id:'paragraph-footer',name:'段尾市场',text,businessDate:'2026-10-10',defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));

test('香港后接空行关闭上一整段，第二段也属香港，原文定位保留且无需AI',()=>{
  const p=parse(text);
  assert.deepEqual(p.issues,[]);
  assert.deepEqual(summarize([p]).markets,{新:0,旧:0,港:22500});
  assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.values,b.totalCents,b.marketSource]),[
    [1,1,[11,35,47],1500,3],[2,2,[23],1000,3],
    [5,5,[19,39,27],6000,8],[6,6,[3],4000,8],[7,7,[15],10000,8],
  ]);
  assert(p.bets.every(b=>b.markets.join()==='港'&&b.marketEntries[0].market==='港'&&b.status==='parsed'));
  assert.deepEqual(p.bets.map(b=>b.raw),text.split('\n').filter((_,i)=>[0,1,4,5,6].includes(i)));
  assert.deepEqual(p.metadata.filter(m=>m.kind==='市场段尾').map(m=>[m.fromLine,m.toLine]),[[1,2],[5,7]]);
  assert.deepEqual(reviewInput(doc(text)).items,[]);
});

test('空行在市场前为标题，在市场后为段尾，段尾可以位于文本末尾',()=>{
  for(const ending of ['', '\n', '\n\n'])assert.equal(summarize([parse('01各10\n02各20\n，香港'+ending)]).markets.港,3000);
  for(const source of ['01各10\n香港\n02各20','01各10\n\n香港\n02各20']){
    const p=parse(source);assert.deepEqual(p.issues,[]);
    assert.deepEqual(p.bets.map(b=>b.markets),[['新'],['港']]);
  }
  const inherited=parse('01各10\n香港\n\n02各20\n张三：03各30');
  assert.deepEqual(inherited.issues,[]);
  assert.deepEqual(inherited.bets.map(b=>b.markets),[['港'],['新'],['新']]);
  const boundary=parse('01各10\n\n02各20\n香港');
  assert.deepEqual(boundary.bets.map(b=>b.markets),[['新'],['港']]);
});

test('保持明确市场冲突、消息和合计边界；多市场计费与跨行金额正确',()=>{
  for(const source of ['新01各10\n02各20\n港','旧\n01各10\n港']){
    assert(parse(source).issues.some(i=>i.code==='TRAILING_MARKET'),source);
  }
  const p=parse('小明：旧01各10\n张三：02各20\n香港');
  assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets.map(b=>b.markets),[['旧'],['港']]);
  const total=parse('01各10\n共10\n02各20\n香港');
  assert.deepEqual(total.issues,[]);assert.deepEqual(total.bets.map(b=>b.markets),[['新'],['港']]);
  const multi=parse('01 02\n各5米\n三边\n\n03各10');
  assert.deepEqual(multi.issues,[]);assert.equal(multi.bets[0].line,1);assert.equal(multi.bets[0].endLine,2);
  assert.deepEqual(summarize([multi]).markets,{新:2000,旧:1000,港:1000});
});

test('段尾市场传入AI上下文；改市场更换缓存，改空行导致标题方向改变也更换缓存',()=>{
  const d=doc(text),item=reviewInput(d,'all').items[0];
  assert.deepEqual(item.context.markets,['港']);
  const candidate={bets:[{markets:['港'],play:'特码',selection:'23',basis:'每号',amount:'10',evidence:{market:'',play:'',selection:'23',amount:'10米'}}]};
  assert.equal(validateCandidate(candidate,reviewInput(d,'all').items[1],d).totalCents,1000);
  const next=doc(text.replaceAll('香港','旧澳')),changed=reviewInput(next,'all').items[0];
  assert.notEqual(reviewItemKey(d,item),reviewItemKey(next,changed));
  const forward=doc(text.replace('香港\n\n','香港\n'));
  assert.notEqual(reviewItemKey(d,item),reviewInput(forward,'all').items[0].fragmentKey);
});

test('段尾归属后按香港开奖赔付，换行符格式不影响结果',()=>{
  const odds=defaultOdds();odds.confirmed=true;
  const date='2026-10-10',draw={market:'港',date,issue:'2026283',numbers:[1,2,3,4,5,6,15]};
  for(const source of [text,text.replaceAll('\n','\r\n')]){
    const p=parse(source),result=settleDocuments([p],{港:draw},{港:odds},date);
    assert(result.complete);assert.equal(result.stakeCents,22500);assert.equal(result.payoutCents,470000);
  }
});
