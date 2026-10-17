import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {highlightText} from '../src/core/highlight.js';
import {sourceResults} from '../src/core/ledger-navigation.js';
import {winningLineMarks} from '../src/core/winning-display.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {upgradeDocument,reviewSettlement} from '../src/core/parser-upgrade.js';
import {reviewInput,assistanceFor} from '../src/core/ai-review.js';
import {specialCollection} from '../src/core/special-collection.js';
const date='2026-10-05';
const source='新凹\n09, 24, 28, 29, 49\n06, 23, 16, 21, 26各2\n42 44 45 47\n12 15 26 32各5块\n11 19 29各10块';
const parse=text=>parseDocument(text,{id:'a',businessDate:date});
const separatePrices='新澳特\n27 39 36 48 49 26 28\n各50米\n15 24 14 04 16 17 19\n各20米\n01 02 03 12 13各10米';

test('独立各50和各20归入上一行号码，截图三笔540元且下一笔独立',()=>{
  const p=parse(separatePrices);assert.deepEqual(p.issues,[]);
  assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.values,b.unitCents,b.totalCents]),[
    [2,3,[27,39,36,48,49,26,28],5000,35000],
    [4,5,[15,24,14,4,16,17,19],2000,14000],
    [6,6,[1,2,3,12,13],1000,5000],
  ]);
  assert.equal(summarize([p]).totalCents,54000);assert.equal(specialCollection([p]).summary.totalCents,54000);
  assert.deepEqual(p.bets.map(b=>b.raw),['27 39 36 48 49 26 28\n各50米','15 24 14 04 16 17 19\n各20米','01 02 03 12 13各10米']);
  assert.deepEqual(reviewInput({id:'a',text:separatePrices,businessDate:date}).items,[]);
});
test('独立每号金额兼容中文全角小数及多行选号，重复号码照计',()=>{
  for(const [amount,cents] of [['各50',5000],['各二十元',2000],['每号２０米',2000],['每个号码0.5元',50],['各.5.米',500]]){
    const p=parse('旧 ２７／３９／２７\n36 48\n'+amount+'\n01各10');assert.deepEqual(p.issues,[],amount);
    assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.count,b.unitCents,b.markets]),[[1,3,5,cents,['旧']],[4,4,1,1000,['旧']]]);
  }
  const flat=parse('平码\n01 02\n各20元');assert.deepEqual(flat.issues,[]);assert.equal(flat.bets[0].playType,'flat-number');assert.equal(flat.bets[0].totalCents,4000);
  const p=parse('01 02\n各20米，03各10');assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.count,b.unitCents]),[[1,2,2,2000],[2,2,1,1000]]);
});
test('独立金额不跨边界找选号，不吞掉下一笔或覆盖已写金额',()=>{
  for(const boundary of ['\n','小明：\n','香港\n','特码\n','共2\n','谢谢\n']){
    const p=parse('01 02\n'+boundary+'各20米\n03各10');
    assert.equal(p.bets[0].endLine,1,boundary);assert.equal(p.bets.at(-1).totalCents,1000,boundary);
    assert(p.issues.some(i=>i.code==='MISSING_SELECTION'&&i.line===i.endLine),boundary);
  }
  for(const text of ['各20米\n03各10','01 02各5\n各20米\n03各10']){
    const p=parse(text);assert.equal(p.bets.at(-1).values[0],3);assert.equal(p.bets.at(-1).unitCents,1000);
    assert(p.issues.some(i=>i.code==='MISSING_SELECTION'));
    if(text.startsWith('01'))assert.equal(p.bets[0].totalCents,1000);
  }
});
test('独立金额修复保持原文高亮和双向定位，中奖采用真实单价',()=>{
  const p=parse(separatePrices),selectionLines=p.bets.filter(b=>b.endLine>b.line).flatMap(b=>Array.from({length:b.endLine-b.line},(_,i)=>b.line+i));
  const tokens=highlightText(separatePrices,'',selectionLines);assert.equal(tokens.map(t=>t.text).join(''),separatePrices);
  assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['50','20','10']);
  assert(tokens.some(t=>t.text==='28'&&t.kind==='selection'));assert(tokens.some(t=>t.text==='19'&&t.kind==='selection'));
  assert.equal(sourceResults(p,2).bets[0].id,sourceResults(p,3).bets[0].id);
  assert.equal(sourceResults(p,4).bets[0].id,sourceResults(p,5).bets[0].id);
  assert.notEqual(sourceResults(p,5).bets[0].id,sourceResults(p,6).bets[0].id);
  const odds={新:{...defaultOdds(),confirmed:true}},draw={market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,28]};
  const result=settleDocuments([p],{新:draw},odds,date);
  assert.equal(result.payoutCents,235000);assert.equal(result.entries.find(e=>e.status==='won').winningStakeCents,5000);
  assert.deepEqual(Object.keys(winningLineMarks(p,result,{odds,verification:{新:{confirmed:true}}})),['2','3']);
});
test('旧独立金额错误核验随升级失效，原文保留并自动重算540元',()=>{
  const d={id:'a',text:separatePrices,businessDate:date,parserVersion:'parser-20261009-2'};
  d.assistance={...assistanceFor(d,[{line:5,source:'各20米',status:'review',required:true,replacement:'',candidates:[],reason:'未识别米与后续号码'}]),version:'semantic-20261009-2'};
  const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,separatePrices);assert.deepEqual(p.issues,[]);
  assert.equal(summarize([p]).totalCents,54000);assert.deepEqual(reviewInput(next).items,[]);
});

test('截图的空格与逗号续行一致，总额90而不是211，保留原文和行号',()=>{
  const p=parse(source);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,9000);
  assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.count,b.unitCents,b.totalCents]),[[2,3,10,200,2000],[4,5,8,500,4000],[6,6,3,1000,3000]]);
  assert.deepEqual(p.bets[1].values,[42,44,45,47,12,15,26,32]);
  assert.equal(p.bets[1].raw,'42 44 45 47\n12 15 26 32各5块');assert.equal(p.bets[1].continuation.amountLine,5);
  assert.equal(sourceResults(p,4).bets[0].id,sourceResults(p,5).bets[0].id);
});
for(const separator of [' ','  ','\t',',','，','、','.','/','\\','-'])test(`不同分隔符续行一致：${JSON.stringify(separator)}`,()=>{
  const text=[42,44,45,47].join(separator)+'\n12 15 26 32各5块';const p=parse(text);
  assert.equal(p.issues.length,0);assert.equal(p.bets.length,1);assert.equal(p.bets[0].count,8);assert.equal(summarize([p]).totalCents,4000);
});
test('连续多行、全角、中文和小数单价沿用最后明确金额，重复选号累计',()=>{
  for(const amount of ['各五元','各0.5元','每号5','5元','（5）','各.5.米']){
    const p=parse('４２ ４４ ４５ ４７\n12 15\n26 32 '+amount);
    assert.equal(p.bets.length,1,amount);assert.equal(p.issues.length,0,amount);assert.equal(p.bets[0].count,8);
    assert.equal(summarize([p]).totalCents,amount==='各0.5元'?400:4000,amount);
  }
  const p=parse('旧 42 42\n42 47各5');assert.equal(p.bets[0].count,4);assert.equal(p.bets[0].markets.join(),'旧');
});
test('已有金额和独立简写继续分别计费，不改变没有续行依据的单行',()=>{
  for(const first of ['42 44 45各47','42 44 45 47元','42 44 45（47）']){
    const p=parse(first+'\n12 15 26 32各5块');assert.equal(p.bets.length,2);assert.equal(summarize([p]).totalCents,16100);
  }
  assert.equal(summarize([parse('42 44 45 47')]).totalCents,14100);
  assert.equal(summarize([parse('42 44 45 100\n12 15各5')]).totalCents,31000);
});
test('空行、新玩家、市场、玩法、合计和无关行均不借用下一段单价',()=>{
  for(const boundary of ['\n','小明：','香港\n','三中三\n','共141\n','谢谢\n']){
    const p=parse('42 44 45 47\n'+boundary+'12 15 26 32各5块');
    assert.equal(p.bets[0].line,1,boundary);assert.equal(p.bets[0].endLine,1,boundary);assert.equal(p.bets[0].unitCents,4700,boundary);
  }
  for(const ending of ['香港12 15各5','小明：12 15各5','特码12 15各5'])assert.equal(parse('42 44 45 47\n'+ending).bets[0].endLine,1);
});
test('末行两笔投注只把前段金额用于续行，平码逐号也可续行',()=>{
  const p=parse('42 44 45 47\n12 15各5米29 40各10米');assert.deepEqual(p.bets.map(b=>[b.count,b.unitCents]),[[6,500],[2,1000]]);
  const flat=parse('平码\n42 44 45 47\n12 15各5');assert.equal(flat.bets[0].playType,'flat-number');assert.equal(flat.bets[0].count,6);
});
test('高亮保留中间行末尾号码为蓝色，不误标为金额，输入不改写',()=>{
  const p=parse(source),selectionLines=p.bets.filter(b=>b.endLine>b.line).flatMap(b=>Array.from({length:b.endLine-b.line},(_,i)=>b.line+i));
  const tokens=highlightText(source,'',selectionLines);assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['2','5','10']);
  assert(tokens.some(t=>t.text==='47'&&t.kind==='selection'));
});
test('新规则开奖47时按5元计算赔付235元并标记两行',()=>{
  const p=parse(source),draw={id:'test',market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,47]};
  const odds={新:{...defaultOdds(),confirmed:true}},result=settleDocuments([p],{新:draw},odds,date);
  assert.equal(result.payoutCents,23500);assert.equal(result.entries.find(e=>e.status==='won').winningStakeCents,500);
  assert.deepEqual(Object.keys(winningLineMarks(p,result,{odds,verification:{新:{confirmed:true}}})),['4','5']);
});
test('旧账直接按新规则重算；旧赔付金额保留，仅附加同期开奖下的复算差异',()=>{
  const doc={id:'a',name:'旧账',text:source,businessDate:date,parserVersion:'parser-20261006-7'};
  const updated=upgradeDocument(doc);assert.equal(updated.text,source);assert.equal(summarize([parseDocument(updated.text,updated)]).totalCents,9000);
  // Explicitly marking the old 47 as a price reproduces the previous 211-yuan result.
  const old=parse(source.replace('42 44 45 47\n','42 44 45 47元\n'));old.parserVersion=doc.parserVersion;old.originalText=source;
  const draws={新:{id:'test',market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,47]}},odds={新:defaultOdds()};
  const snapshot={inputs:{documents:[old],draws,settings:{odds},date},result:settleDocuments([old],draws,odds,date)};
  const original=JSON.stringify(snapshot),review=reviewSettlement(snapshot);
  assert.equal(review.beforeStakeCents,21100);assert.equal(review.afterStakeCents,9000);assert.equal(review.afterPayoutCents,23500);assert.equal(JSON.stringify(snapshot),original);
});
