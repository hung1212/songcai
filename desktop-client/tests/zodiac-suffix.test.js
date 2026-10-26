import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate,REVIEW_INSTRUCTIONS} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';

const doc=text=>({id:'suffix',name:'测试',text,businessDate:'2026-10-05',defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('用户后置一肖按三个平特肖各10元，原文保留且无AI待处理',()=>{
  const text='奥特虎猪兔各十米一肖',p=valid(text),b=p.bets[0];
  assert.equal(p.bets.length,1);assert.equal(b.playType,'flat-zodiac');assert.equal(b.basis,'每肖');
  assert.deepEqual(b.values,['虎','猪','兔']);assert.deepEqual(b.markets,['新']);assert.equal(b.count,3);
  assert.equal(b.unitCents,1000);assert.equal(b.totalCents,3000);assert.equal(b.raw,text);
  assert.equal(reviewInput(doc(text),'doubt').items.length,0);
  const highlighted=highlightText(text);assert.equal(highlighted.map(t=>t.text).join(''),text);
  assert(highlighted.some(t=>t.kind==='play'&&t.text==='一肖'));
});

test('一肖简称前置和后置支持中文、数字、全角与字段空格',()=>{
  for(const text of ['一肖虎猪兔各十米','奥特虎猪兔各10元一肖','奥特虎猪兔各１０米１肖','奥特虎猪兔各十米 一 肖','奥特虎猪兔各0.5米一肖，','奥特\\虎猪兔各十米一肖/']) {
    const b=valid(text).bets[0];assert.equal(b.playType,'flat-zodiac',text);assert.deepEqual(b.values,['虎','猪','兔']);
    assert.equal(b.totalCents,text.includes('0.5')?150:3000,text);
  }
});

test('后置一肖只绑定所属投注，奥明确切换新市场，切换玩家默认新',()=>{
  const p=valid('小明：旧\n奥特虎猪兔各十米一肖，香港特牛各20米一肖\n张三：奥特虎猪兔各十米一肖');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets.join(),b.playType,b.totalCents]),[
    ['小明','新','flat-zodiac',3000],['小明','港','flat-zodiac',2000],['张三','新','flat-zodiac',3000],
  ]);
});

test('后接选号金额的一肖仍是下一笔前缀，多肖中特、平特肖和连肖不被改写',()=>{
  const inline=valid('特虎各10米一肖牛各20米');
  assert.deepEqual(inline.bets.map(b=>[b.playType,b.totalCents]),[['special-number',4000],['flat-zodiac',2000]]);
  for(const [text,type,total] of [
    ['三肖中特虎猪兔30','special-zodiac-any',3000],['二肖中特虎猪20','special-zodiac-any',2000],
    ['一肖中特虎10','special-zodiac-any',1000],['平特一肖虎猪兔各10','flat-zodiac',3000],
    ['三连肖虎猪兔10','linked-zodiac',1000],
  ]){const p=valid(text);assert.equal(p.bets[0].playType,type,text);assert.equal(summarize([p]).totalCents,total,text);}
});

test('一肖不覆盖每号、平码等明确冲突，缺金额也不能补值',()=>{
  for(const text of ['奥特虎猪兔各号十米一肖','特码虎猪兔各十米一肖','平码01各十米一肖','一肖虎猪兔']){
    const p=parse(text);assert(p.issues.some(i=>i.severity==='error'),text);assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('AI标准同步后置一肖含义且拒绝把它解释为每号特码',()=>{
  const d=doc('奥特虎猪兔各十米一肖'),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'平特肖',selection:'虎猪兔',basis:'每肖',amount:'10',evidence:{market:'',play:'一肖',selection:'虎猪兔',amount:'十'}};
  assert.equal(validateCandidate({bets:[b]},item,d).totalCents,3000);
  assert.throws(()=>validateCandidate({bets:[{...b,play:'特码',basis:'每号'}]},item,d),/玩法|计费/);
  assert(REVIEW_INSTRUCTIONS.includes('奥特虎猪兔各十米一肖'));
});
