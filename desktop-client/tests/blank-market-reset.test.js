import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {reviewSettlement} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';
const date='2026-10-12';
const source='新澳特，02--14各30#\n26--38各20#\n\n香港特，蛇号各10#\n\n狗各10，\n33，20块';
const doc=text=>({id:'blank-market',name:'空行市场',text,businessDate:date,defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const r=parse(text);assert.deepEqual(r.issues,[],text);return r;};

test('用户空行分组原文五笔新新港新新：新160港40共200，原文与定位保留',()=>{
  const p=valid(source);assert.deepEqual(p.bets.map(b=>b.markets.join()),['新','新','港','新','新']);
  assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.totalCents]),[[1,1,6000],[2,2,4000],[4,4,4000],[6,6,4000],[7,7,2000]]);
  assert.deepEqual(p.bets.map(b=>b.marketSource),[1,1,4,null,null]);
  assert.deepEqual(summarize([p]).markets,{新:16000,旧:0,港:4000});assert.equal(summarize([p]).totalCents,20000);
  assert(p.bets.every(b=>b.playType==='special-number'&&b.marketEntries[0].market===b.markets[0]));
  assert.deepEqual(p.bets.map(b=>b.raw),source.split('\n').filter(Boolean));assert.equal(new Set(p.bets.map(b=>b.playerId)).size,1);
  assert.deepEqual(reviewInput(doc(source)).items,[]);assert.equal(highlightText(source).map(t=>t.text).join(''),source);
});
test('只有物理空白行重置市场；普通回车、标点、无关备注不重置',()=>{
  for(const blank of ['', ' ', '\t', '\u3000','\u00a0'])for(const newline of ['\n','\r\n','\r']){
    const p=valid(['香港01各10',blank,'02各20','03各30'].join(newline));assert.deepEqual(p.bets.map(b=>b.markets.join()),['港','新','新']);
  }
  for(const middle of ['','谢谢老板\n','#\n'])assert.deepEqual(valid('香港01各10\n'+middle+'02各20').bets.map(b=>b.markets.join()),['港','港']);
  assert.equal(valid('香港01各10\n').bets[0].markets.join(),'港');
});
test('旧港两边三边均在空行后默认新澳，下一组显式市场和同组连续行仍优先',()=>{
  for(const label of ['旧','香港','两边','三边']){
    const p=valid(`${label}01各10\n\n02各20\n03各30\n\n香港04各40\n05各50`);
    assert.deepEqual(p.bets.slice(1).map(b=>b.markets.join()),['新','新','港','港']);
  }
  const p=valid('小明：香港01各10\n小明：02各20\n\n小明：03各30\n张三：04各40');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets.join()]),[['小明','港'],['小明','港'],['小明','新'],['张三','新']]);
  assert.deepEqual(valid('香港\n\n01各10').bets[0].markets,['新']);
});
test('新组重新声明玩法后仍保留合计核对，不跨空行拼接未完成金额',()=>{
  const p=valid('香港二连肖牛羊各10\n\n二连肖牛兔各20\n合计30');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.markets.join()]),[['linked-zodiac','港'],['linked-zodiac','新']]);
  assert.equal(p.metadata.find(m=>m.kind==='金额声明').actualCents,3000);
  const consecutive=valid('香港01 02\n各10');assert.equal(consecutive.bets[0].endLine,2);assert.deepEqual(consecutive.bets[0].markets,['港']);
  const separated=parse('香港01\n\n各10');assert(separated.issues.length);assert.equal(summarize([separated]).totalCents,0);
});
test('段尾只影响本组，空行后不再继承；同组显式冲突仍待处理',()=>{
  const p=valid('旧01各10\n\n02各20\n香港\n\n03各30\n04各40');
  assert.deepEqual(p.bets.map(b=>b.markets.join()),['旧','港','新','新']);
  assert.equal(parse('旧01各10\n02各20\n香港\n\n03各30').bets[1].status,'review');
  const footer=valid('01各10\n02各20\n共30米，香港\n\n03各40');assert.deepEqual(footer.bets.map(b=>b.markets.join()),['港','港','新']);
});
test('AI上下文无旧香港来源，新澳同义场景复用缓存，真实市场变化重新核验',()=>{
  const d=doc(source),items=reviewInput(d,'all').items,last=items.at(-1);
  assert.deepEqual(last.context.markets,['新']);assert(!last.preceding.some(p=>p.line===4));
  const b={markets:['新'],play:'特码',selection:'33',basis:'每号',amount:'20',evidence:{market:'',play:'',selection:'33',amount:'20块'}};
  assert.equal(validateCandidate({bets:[b]},last,d).totalCents,2000);
  assert.throws(()=>validateCandidate({bets:[{...b,markets:['港']}]},last,d),/市场/);
  const key=text=>reviewInput(doc(text),'all').items.at(-1).fragmentKey;
  assert.notEqual(key('香港01各10\n02各20'),key('香港01各10\n\n02各20'));
  assert.equal(key('新01各10\n02各20'),key('新01各10\n\n02各20'));
  d.assistance={...assistanceFor(d,[{line:6,source:'狗各10，',status:'accepted',replacement:'香港狗各10'}]),version:'semantic-20261012-2'};
  assert.deepEqual(summarize([parseDocument(source,d)]).markets,{新:16000,旧:0,港:4000});
});
test('新规则按对应市场开奖赔付，历史快照不改写但显示市场变化复算',()=>{
  const p=valid(source),odds=Object.fromEntries(['新','港'].map(m=>[m,{...defaultOdds(),confirmed:true}]));
  const draws={新:{market:'新',date,issue:'2026285',numbers:[1,3,5,7,11,12,33]},港:{market:'港',date,issue:'26/110',numbers:[1,3,5,7,11,12,2]}};
  const r=settleDocuments([p],draws,odds,date);assert(r.complete);assert.equal(r.payoutCents,188000);assert.equal(r.stakeCents,20000);
  const previous=structuredClone(p);previous.parserVersion='parser-20261012-2';previous.originalText=source;
  for(const b of previous.bets.slice(-2)){b.markets=['港'];b.marketEntries[0].market='港';}
  const old=settleDocuments([previous],draws,odds,date),snapshot={inputs:{documents:[previous],date,draws,settings:{odds}},result:old};
  const before=JSON.stringify(snapshot),review=reviewSettlement(snapshot);assert(review.required);assert.equal(review.beforePayoutCents,47000);assert.equal(review.afterPayoutCents,188000);assert.equal(JSON.stringify(snapshot),before);
});
