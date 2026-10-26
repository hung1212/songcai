import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {assistanceFor,reviewInput} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {toCents} from '../src/core/rules.js';

const doc=text=>({id:'review-fixture',name:'核对',businessDate:'2026-10-21',text});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};
const cross=(a,b)=>a.flatMap(x=>b.map(y=>[x,y]));
const source='新澳特码11 12 24 32 34\n35 38 39 各30   26.36.42.48各15新二连07.19.43.31串17.25.01.37.02.各20';
const multi='3.27.串7.31二连一组1百.3.27串7.31一组一百特串。21.33.串8.32二连一组一百，21.33.串8.32特串。21.33.3.27.7.31.8.32个号一百特';

test('跨行号码用末行第一笔单价，后续单价和玩法不吞并前笔',()=>{
  const p=valid(source);assert.equal(summarize([p]).totalCents,70000);
  assert.deepEqual(p.bets.map(b=>[b.playType,b.count,b.unitCents,b.totalCents]),[
    ['special-number',8,3000,24000],['special-number',4,1500,6000],['linked-number-2-2',20,2000,40000],
  ]);
  assert.deepEqual(p.bets[0].values,[11,12,24,32,34,35,38,39]);assert.deepEqual(p.bets[1].values,[26,36,42,48]);
  assert.deepEqual(p.bets[2].groups,cross([7,19,43,31],[17,25,1,37,2]));
  assert.deepEqual([p.bets[0].line,p.bets[0].endLine,p.bets[0].continuation.amountLine],[1,2,2]);
  assert.equal(p.bets[0].raw,source);assert.equal(p.bets[1].raw,source.split('\n')[1]);
  assert.deepEqual(reviewInput(doc(source)).items,[]);
  const tokens=highlightText(source,'',[1]);assert(tokens.some(t=>t.text==='34'&&t.kind==='selection'));assert.equal(tokens.map(t=>t.text).join(''),source);
});

test('金额后的空白分隔另一笔，不能把30当号码也不能吞掉第一笔金额',()=>{
  for(const gap of [' ','   ','\t','\u00a0']){
    const p=valid(`35 38 39各30${gap}26.36.42.48各15`);
    assert.deepEqual(p.bets.map(b=>[b.values,b.unitCents]),[[[35,38,39],3000],[[26,36,42,48],1500]]);
  }
  for(const last of ['港35 38 39各30','特肖兔各30','乙：35 38 39各30']){
    const p=parse('11 12 24 32 34\n'+last);assert.equal(p.bets[0].endLine,1,last);
  }
  const p=valid('11 12 24 32 34\n35 38 39各30 香港26各15');
  assert.deepEqual(p.bets.map(b=>[b.markets,b.totalCents]),[[['新'],24000],[['港'],1500]]);
  for(const text of ['35 38各1/2米','35 38各10.123元'])assert(parse(text).issues.length,text);
});

test('复式三四连各连10同时计四组三连肖和一组四连肖，不重复计价',()=>{
  for(const text of ['牛虎鼠狗复式三四连各连10米','牛虎鼠狗复式三四连肖各连10米','牛虎鼠狗复式三四各连十']){
    const p=valid(text);assert.equal(summarize([p]).totalCents,5000);assert.deepEqual(p.bets.map(b=>[b.playType,b.size,b.count]),[['linked-zodiac',3,4],['linked-zodiac',4,1]]);
  }
  const p=valid('01 02 03 04复式三四连各连10');assert.deepEqual(p.bets.map(b=>[b.playType,b.count]),[['linked-number-3-3',4],['linked-number-4-4',1]]);
  assert(parse('牛虎鼠复式三四连各连10').issues.length);
});

test('多个串拖操作后独立顿号连接共享金额，每个操作保持二中二两侧',()=>{
  const source='新澳：羊打鼠、鼠打狗、每组15斤。外',p=valid(source),b=p.bets[0];
  assert.deepEqual(b.groups,[...cross([12,24,36,48],[7,19,31,43]),...cross([7,19,31,43],[9,21,33,45])]);
  assert.equal(b.playType,'linked-number-2-2');assert.equal(b.count,32);assert.equal(b.totalCents,48000);assert.equal(b.raw,source);
  for(const text of ['羊串鼠，鼠串狗，三中三各15','羊串鼠、鼠串狗、每肖15','羊串鼠、鼠串狗猪、特肖各15'])assert(parse(text).issues.length,text);
});

test('数字混合中文计量金额1百保留完整单价及高亮证据，不只读作1元',()=>{
  for(const [amount,cents] of [['1百',10000],['2千',200000],['1.5百',15000]]){
    assert.equal(toCents(amount),cents);
    const text=`3.27.串7.31二连一组${amount}`,b=valid(text).bets[0];assert.equal(b.unitCents,cents);assert.equal(b.totalCents,4*cents);
    assert.deepEqual(b.groups,cross([3,27],[7,31]));
    assert(highlightText(text).some(t=>t.kind==='amount'&&t.text===amount));
  }
  for(const text of ['3串7二连各1百2','3串7二连各1.234百'])assert(parse(text).issues.length,text);
});

test('金额后置特串及个号一百特保留玩法边界，互串侧末尾点号为分隔符',()=>{
  for(const text of ['3.27.串7.31一组一百特串。','3.27.串7.31特串1百','特串（3.27.）拖（7.31.）各100']){
    const b=valid(text).bets[0];assert.deepEqual(b.groups,cross([3,27],[7,31]));assert.equal(b.playType,'special-pair');assert.equal(b.totalCents,40000);
  }
  const p=valid('3.27串7.31一组一百特串。21.33.3.27.7.31.8.32个号一百特');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.totalCents]),[['special-pair',40000],['special-number',80000]]);
  const tokens=highlightText('21.33.3.27.7.31.8.32个号一百特');assert(tokens.some(t=>t.kind==='amount'&&t.text==='一百'));
});

test('缺单价特串只留这一片段待处理，不继承前笔金额，不吞掉后笔',()=>{
  const p=parse(multi);assert.equal(p.issues.length,1);assert.equal(p.issues[0].code,'MISSING_AMOUNT');
  assert.match(p.issues[0].message,/21.33.*8.32特串.*缺少每组单价/);assert.deepEqual(p.issues[0].affectedBetIds,[]);
  assert.deepEqual(p.bets.map(b=>[b.playType,b.totalCents]),[['linked-number-2-2',40000],['special-pair',40000],['linked-number-2-2',40000],['special-number',80000]]);
  assert.equal(summarize([p]).totalCents,200000);
  for(const status of ['pending','failed','review']){
    const d=doc(multi);d.assistance=assistanceFor(d,[{line:1,source:multi,status,required:true,replacement:''}]);
    const p=parseDocument(multi,d);assert.equal(summarize([p]).totalCents,200000,status);assert(p.issues.some(i=>i.code==='MISSING_AMOUNT'));
  }
  const confirmed=valid(multi.replace('21.33.串8.32特串。','21.33.串8.32特串各100。'));
  assert.equal(summarize([confirmed]).totalCents,240000);
  assert(parse('21.33串8.32二连各100，21.33串8.32特串。').issues.length);
});

test('新选号后的等号是单价，同句前笔已写各号也不能覆盖成合计',()=>{
  const source='新特鼠各号25。31=80',p=valid(source);assert.equal(summarize([p]).totalCents,18000);
  assert.deepEqual(p.bets.map(b=>[b.values,b.unitCents]),[[[7,19,31,43],2500],[[31],8000]]);
  assert.equal(summarize([p]).numbers.find(n=>n.number===31).cents,10500);assert(!p.metadata.some(m=>m.kind==='金额声明'));
  assert.equal(summarize([valid('01各5，02=30')]).totalCents,3500);
  const sum=valid('01各5。31=80=85');assert.equal(summarize([sum]).totalCents,8500);assert.equal(sum.metadata.find(m=>m.kind==='金额声明').expectedCents,8500);
  assert(parse('01各5。31=80=80').issues.some(i=>i.code==='TOTAL_MISMATCH'));
});

test('粘连2023仍待处理；原文中重复投注保留，不能为降低待处理擅自拆号去重',()=>{
  const p=parse('特码3.4.8.9.2023.24各30');assert(p.issues.some(i=>i.code==='NUMBER_RANGE'));assert.equal(summarize([p]).totalCents,0);
  assert.equal(summarize([valid('特码3.4.8.9.20 23.24各30')]).totalCents,21000);
  const duplicate='21.33.3.27.7.31.8.32个号一百特';assert.equal(summarize([valid(duplicate+'\n\n'+duplicate)]).totalCents,160000);
});

test('修复后的号码金额用于赔付，旧AI解释失效，原文及历史结算不改写',()=>{
  const d=doc(source);d.parserVersion='parser-20261021-5';d.settlements=[{id:'past',payoutCents:12345}];
  d.assistance={...assistanceFor(d,[{line:1,source:source.split('\n')[0],status:'accepted',replacement:'特码11 12 24 32各34'}]),version:'semantic-20261021-5'};
  const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,source);assert.deepEqual(next.settlements,d.settlements);assert.deepEqual(p.issues,[]);
  const draws={新:{market:'新',date:'2026-10-21',issue:'2026294',numbers:[1,3,4,5,6,8,34]}};
  const result=settleDocuments([p],draws,{新:defaultOdds()},'2026-10-21');assert.equal(result.payoutCents,141000);assert.equal(result.stakeCents,70000);
});
