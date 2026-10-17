import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
const doc=text=>({id:'flat-one',text,businessDate:'2026-10-15'});
test('奥平特一肖狗五十为新澳平特肖狗50元，不拆成特肖或逐号特码',()=>{
  for(const text of ['奥平特一肖狗五十','澳平特一肖狗50','奥 平 特 一 肖 狗 五十','奥平特一肖：狗五十','新澳平特肖狗伍拾元']){
    const d=doc(text),p=parseDocument(text,d);assert.deepEqual(p.issues,[],text);assert.equal(p.bets.length,1,text);
    const b=p.bets[0];assert.equal(b.playType,'flat-zodiac');assert.equal(b.play,'平特肖');assert.deepEqual(b.markets,['新']);
    assert.deepEqual(b.values,['狗']);assert.equal(b.basis,'每肖');assert.equal(b.unitCents,5000);assert.equal(summarize([p]).totalCents,5000);
    assert.equal(b.raw,text);assert.deepEqual(reviewInput(d).items,[]);
  }
  const text='奥平特一肖狗五十',tokens=highlightText(text);assert.equal(tokens.map(t=>t.text).join(''),text);
  for(const [kind,value] of [['play','平特一肖'],['selection','狗'],['amount','五十']])assert(tokens.some(t=>t.kind===kind&&t.text===value));
});
test('平特一肖优先于上一笔玩法，狗出现在正码或特码都按平特肖赔率赔付且同肖不重复赔',()=>{
  const text='特包龙虎各二十一肖\n奥平特一肖狗五十',p=parseDocument(text,doc(text));assert.deepEqual(p.issues,[]);const b=p.bets.at(-1);
  assert.equal(b.playType,'flat-zodiac');assert.equal(summarize([p]).totalCents,9000);
  for(const numbers of [[9,1,2,3,4,5,6],[1,2,3,4,5,6,9],[9,21,33,45,1,2,3]]){
    const result=settleBet(b,{market:'新',date:'2026-10-15',issue:'2026288',numbers},defaultOdds());
    assert.equal(result.payoutCents,10250);assert.equal(result.winCount,1);
  }
});
test('AI不能将平特一肖缩短为一肖并改为特肖',()=>{
  const d=doc('奥平特一肖狗五十'),item=reviewInput(d,'all').items[0];
  const bet={markets:['新'],play:'平特肖',selection:'狗',basis:'每肖',amount:'50',evidence:{market:'奥',play:'平特一肖',selection:'狗',amount:'五十'}};
  assert.equal(validateCandidate({bets:[bet]},item,d).totalCents,5000);
  assert.throws(()=>validateCandidate({bets:[{...bet,play:'特肖',evidence:{...bet.evidence,play:'一肖'}}]},item,d),/玩法|改变/);
});
