import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateReply} from '../src/core/ai-review.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {specialCollection} from '../src/core/special-collection.js';
import {highlightText} from '../src/core/highlight.js';
import {formatBetLines,prepareBetPaste,perZodiacPackages} from '../src/core/text-format.js';
const doc=(text,date='2026-10-10')=>({id:'a',text,businessDate:date});
const valid=(text,date)=>{const d=doc(text,date),p=parseDocument(text,d);assert.deepEqual(p.issues,[],text);assert.deepEqual(reviewInput(d).items,[]);return p;};
test('特包猪兔龙各十米一肖分别包号10元，共30元，保留原文和号码分布',()=>{
  for(const text of ['特包猪兔龙各十米一肖','新澳特包猪兔龙各10元一肖','特 包 猪 兔 龙 各 壹拾 圆 一 肖','特码包猪兔龙各１０米１肖']){
    const p=valid(text);assert.deepEqual(p.bets.map(b=>[b.values,b.unitCents,b.totalCents]),[[[8,20,32,44],250,1000],[[4,16,28,40],250,1000],[[3,15,27,39],250,1000]]);
    assert(p.bets.every(b=>b.playType==='special-number'&&b.raw===text&&b.semantic.ruleId==='R28'));assert.equal(summarize([p]).totalCents,3000);assert.equal(specialCollection([p]).summary.totalCents,3000);
  }
});
test('本命生肖独立除以5，其他肖除以4，跨农历年及多市场仍守恒',()=>{
  const a=valid('特包马羊各10米一肖');assert.deepEqual(a.bets.map(b=>[b.count,b.unitCents,b.totalCents]),[[5,200,1000],[4,250,1000]]);
  const b=valid('特包马羊各10米一肖','2027-02-06');assert.deepEqual(b.bets.map(b=>[b.count,b.unitCents]),[[4,250],[5,200]]);
  assert.equal(summarize([valid('旧\n特包猪兔龙各十米一肖\n两边特包马羊各10米一肖')]).totalCents,7000);
  const c=valid('特包猪猪各10米一肖，01各20');assert.equal(c.bets.length,3);assert.equal(summarize([c]).totalCents,4000);
});
test('普通后置一肖仍为特肖，冲突／不均分不误计账',()=>{
  assert.equal(valid('奥特虎猪兔各十米一肖').bets[0].playType,'special-zodiac');
  for(const text of ['特包猪兔龙各10.01米一肖','特肖包猪兔龙各十米一肖','平特包猪兔龙各十米一肖','特包猪兔龙各号十米一肖','特包猪兔龙各十米二肖','包龙各40']){
    const p=parseDocument(text,doc(text));assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
});
test('AI保留每肖原总额，赔付采用分摊的每号2.5元',()=>{
  const d=doc('特包猪兔龙各十米一肖'),item=reviewInput(d,'all').items[0];
  const candidate={bets:[...'猪兔龙'].map(a=>({markets:['新'],play:'包'+a,selection:a,basis:'每号',amount:'10',evidence:{market:'',play:'特包',selection:a,amount:'十'}}))};
  assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  const p=valid(d.text),odds={...defaultOdds(),confirmed:true},draw={market:'新',date:d.businessDate,issue:'2026283',numbers:[1,2,3,4,5,6,8]};
  assert.equal(settleBet(p.bets[0],draw,odds).payoutCents,11750);
});

test('中文金额紧邻一肖时，特包龙虎各二十一肖按每肖20元均分，总40元',()=>{
  for(const text of ['特包龙虎各二十一肖','新澳特包龙虎各二十一肖','特包龙虎各20一肖','特包龙虎各２０１肖','特 包 龙 虎 各 贰拾 一 肖','特包龙虎各二十元一肖']){
    const p=valid(text,'2026-10-15');
    assert.deepEqual(p.bets.map(b=>[b.playType,b.values,b.unitCents,b.totalCents]),[
      ['special-number',[3,15,27,39],500,2000],['special-number',[5,17,29,41],500,2000],
    ],text);
    assert(p.bets.every(b=>b.raw===text&&b.allocation.totalCents===2000&&b.semantic.ruleId==='R28'));
    assert.deepEqual(summarize([p]).numbers,summarize([valid('龙虎各5','2026-10-15')]).numbers);
    assert.equal(summarize([p]).totalCents,4000);assert.equal(specialCollection([p]).summary.totalCents,4000);
  }
});
test('包号中文金额与后置一肖不混淆，重复生肖、多市场与五号生肖仍按各自总额',()=>{
  for(const [amount,cents] of [['十',1000],['十一',1100],['二十',2000],['二十一',2100],['一百',10000]]){
    const source=`特包龙虎各${amount}一肖`,p=valid(source);assert(p.bets.every(b=>b.totalCents===cents));
    assert.equal(perZodiacPackages(source)[0].amount,amount);
  }
  assert.equal(summarize([valid('两边特包龙龙各二十一肖')]).totalCents,8000);
  assert.deepEqual(valid('特包马龙各二十一肖').bets.map(b=>[b.count,b.unitCents,b.totalCents]),[[5,400,2000],[4,500,2000]]);
  const mixed=valid('特包龙虎各二十一肖，猴各5\n奥平特一肖狗五十');
  assert.deepEqual(mixed.bets.map(b=>[b.playType,b.totalCents]),[['special-number',2000],['special-number',2000],['special-number',2000],['flat-zodiac',5000]]);
  for(const text of ['特包龙虎各10.01一肖','特肖包龙虎各二十一肖','特包龙虎各号二十一肖']){
    const p=parseDocument(text,doc(text));assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
});
test('包号金额高亮、整理换行和粘贴保留完整的二十＋一肖',()=>{
  const text='特包龙虎各二十一肖，猴各5',tokens=highlightText(text);
  assert.equal(tokens.map(t=>t.text).join(''),text);
  assert(tokens.some(t=>t.kind==='amount'&&t.text==='二十'));
  assert(tokens.some(t=>t.kind==='play'&&t.text==='一肖'));
  assert.equal(formatBetLines(text),'特包龙虎各二十一肖，\n猴各5');
  assert.equal(prepareBetPaste('',0,0,text),'特包龙虎各二十一肖，\n猴各5\n');
});
test('无货币单位包号的AI证据保留20元原总额，实际按每号5元赔付',()=>{
  const d=doc('特包龙虎各二十一肖','2026-10-15'),item=reviewInput(d,'all').items[0];
  const candidate={bets:[...'龙虎'].map(a=>({markets:['新'],play:'包'+a,selection:a,basis:'每号',amount:'20',evidence:{market:'',play:'特包',selection:a,amount:'二十'}}))};
  assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  const bad={bets:candidate.bets.map(b=>({...b,play:'特肖',basis:'每肖'}))};
  const rejected=validateReply({items:[{line:1,candidates:[bad]}]},[item],d)[0];
  assert.notEqual(rejected.status,'agree');
  const p=valid(d.text,d.businessDate),draw={market:'新',date:d.businessDate,issue:'2026288',numbers:[1,2,4,5,6,7,3]};
  const results=p.bets.map(b=>settleBet(b,draw,defaultOdds()));
  assert.deepEqual(results.map(r=>r.payoutCents),[23500,0]);
});
