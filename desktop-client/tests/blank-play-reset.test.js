import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
const source='平特 2尾 100\n\n16 36各5',date='2026-10-14';
const doc=(text=source)=>({id:'blank-play',name:'空行玩法',text,businessDate:date,defaultPlayer:'小明'});
const parse=text=>parseDocument(text??source,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('用户空行后的16和36是独立特码，共10元，前笔平特尾100元不变',()=>{
  const p=valid();assert.deepEqual(p.bets.map(b=>[b.playType,b.values,b.count,b.unitCents,b.totalCents]),[['flat-tail',[2],1,10000,10000],['special-number',[16,36],2,500,1000]]);
  assert.equal(summarize([p]).totalCents,11000);assert(p.bets.every(b=>b.player==='小明'&&b.markets.join()==='新'));assert.deepEqual(p.bets.map(b=>b.line),[1,3]);assert.equal(p.bets[1].raw,'16 36各5');assert.equal(p.bets[1].semantic.inherited,false);assert.equal(p.bets[1].semantic.declaration,undefined);assert.deepEqual(reviewInput(doc()).items,[]);
  const screenshot=valid('羊猪猴各5\n\n12 22 32 42 二中二各5\n\n平特 2尾 100\n\n16 36各5');assert.deepEqual(screenshot.bets.map(b=>b.playType),['special-number','linked-number-2-2','flat-tail','special-number']);assert.equal(summarize([screenshot]).totalCents,20000);
});

test('空白行重置所有旧玩法来源和市场，空格制表符及三种换行格式一致',()=>{
  for(const prefix of ['香港平特2尾100','旧二中二01 02各100','三边三连肖兔蛇牛各100','香港平码01各100'])for(const blank of ['', ' ', '\t','\u3000'])for(const newline of ['\n','\r\n','\r']){
    const p=valid([prefix,blank,'16 36各5'].join(newline)),b=p.bets.at(-1);assert.equal(b.playType,'special-number');assert.equal(b.totalCents,1000);assert.deepEqual(b.markets,['新']);assert.equal(b.semantic.declaration,undefined);assert.equal(p.contexts.at(-1).play,'');assert.equal(p.contexts.at(-1).playSource,null);
  }
});

test('普通连续行仍继承玩法，备注和自动折行不冒充空行，新段显式玩法优先',()=>{
  const p=valid('香港平特2尾100\n3尾50');assert(p.bets.every(b=>b.playType==='flat-tail'&&b.markets.join()==='港'));assert.equal(p.bets[1].semantic.declaration.line,1);
  assert.equal(valid('二中二01 02各10\n谢谢老板\n16 36各5').bets[1].playType,'linked-number-2-2');
  const explicit=valid('香港平特2尾100\n\n二中二16 36各5\n\n平特3尾20\n\n羊50');assert.deepEqual(explicit.bets.map(b=>b.playType),['flat-tail','linked-number-2-2','flat-tail','special-zodiac']);
  assert(parse('平特2尾\n\n各100').issues.length>0);
});

test('空行不改玩家和已完成投注，合计仍核对原范围，缺金额不跨段拼接',()=>{
  const p=valid('小明：香港平特2尾100\n\n16 36各5\n合计110');assert.equal(new Set(p.bets.map(b=>b.playerId)).size,1);assert.equal(p.metadata.find(m=>m.kind==='金额声明').actualCents,11000);assert.deepEqual(p.bets.map(b=>b.markets.join()),['港','新']);
  const blankTitle=valid('平特尾\n\n16 36各5');assert.equal(blankTitle.bets[0].playType,'special-number');
  assert.equal(summarize([parse('二中二16 36\n\n各10')]).totalCents,0);
});

test('AI不携带空行前的玩法或市场，拒绝把明确特码重新解释成平码或尾数',()=>{
  const d=doc('香港平特2尾100\n\n16 36各5'),item=reviewInput(d,'all').items.at(-1);
  assert.deepEqual(item.context,{markets:['新'],play:''});assert.deepEqual(item.preceding,[]);assert.equal(item.required,false);
  const b={markets:['新'],play:'特码',selection:'16 36',basis:'每号',amount:'5',evidence:{market:'',play:'',selection:'16 36',amount:'5'}};
  assert.equal(validateCandidate({bets:[b]},item,d).totalCents,1000);
  for(const change of [{play:'平码'},{play:'平尾',basis:'每尾'},{markets:['港']}])assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d));
  const key=text=>reviewInput(doc(text),'all').items.at(-1).fragmentKey;
  assert.notEqual(key('二中二01 02各10\n16 36各5'),key('二中二01 02各10\n\n16 36各5'));
});

test('旧跨空行核验失效并恢复10元特码，赔付按独立玩法计算',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261014-1';d.assistance={...assistanceFor(d,[{line:3,source:'16 36各5',status,replacement:status==='accepted'?'平特尾1 6 3 6各5':''}]),version:'semantic-20261014-1'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,source);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,11000);assert.deepEqual(currentReviewItems(next),[]);
  }
  const odds=defaultOdds();odds.confirmed=true;const p=valid(),draw={market:'新',date,issue:'2026287',numbers:[2,12,22,32,42,3,16]};
  const result=settleDocuments([p],{新:draw},{新:odds},date);assert.equal(result.complete,true);assert.equal(result.stakeCents,11000);assert.equal(result.payoutCents,41500);assert.deepEqual(result.entries.map(e=>e.payoutCents),[18000,23500]);
});
