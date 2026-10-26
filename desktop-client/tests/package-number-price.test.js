import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {ANIMALS,ruleForDate} from '../src/core/rules.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const date='2026-10-21';
const doc=text=>({id:'package-number-price',name:'负责人',text,businessDate:date});
const parse=(text,businessDate=date)=>parseDocument(text,{...doc(text),businessDate});
const valid=(text,businessDate)=>{const p=parse(text,businessDate);assert.deepEqual(p.issues,[],text);return p;};

test('包鸡每个号100为4号各100共400，截图另外包鸡各号15米为60元',()=>{
  for(const [text,unit,total] of [['包鸡每个号100',10000,40000],['另外包鸡各号15米',1500,6000]]){
    const p=valid(text),b=p.bets[0];assert.equal(p.bets.length,1);assert.equal(b.playType,'special-number');assert.equal(b.basis,'每号');
    assert.deepEqual(b.values,[10,22,34,46]);assert.equal(b.unitCents,unit);assert.equal(b.totalCents,total);assert.equal(b.allocation,undefined);
    assert.equal(b.semantic.ruleId,'R56');assert.deepEqual(reviewInput(doc(text)).items,[]);assert.equal(b.raw,text);
    assert.equal(highlightText(text).map(t=>t.text).join(''),text);assert.equal(summarize([p]).totalCents,total);
  }
});

test('各号每个号码等逐号词、包鸡号、全角中文金额及续行不均分单价',()=>{
  for(const unit of ['各号','每号','各个号','每个号','各号码','每个号码','每个数字','各数']){
    for(const text of [`包鸡${unit}100`,`包 鸡 ：${unit}一百米`,`包鸡\n${unit}１００元`])assert.equal(valid(text).bets[0].totalCents,40000,text);
  }
  for(const text of ['包鸡号100','包鸡号各100','包鸡数各100','包鸡狗每号100']){
    const b=valid(text).bets[0];assert.equal(b.unitCents,10000);assert.equal(b.totalCents,text.includes('狗')?80000:40000);assert.equal(b.allocation,undefined);
  }
  const b=valid('包鸡\n每个号100').bets[0];assert.deepEqual([b.line,b.endLine],[1,2]);assert.equal(b.raw,'包鸡\n每个号100');
});

test('逐号中止此前特肖玩法继承，市场玩家仍继承，多市场独立计费',()=>{
  const p=valid('小明：旧特肖牛各10\n另外包鸡各号15米\n两边包马每个号100\n张三：包鸡每号100');
  assert.deepEqual(p.bets.map(b=>[b.player,b.playType,b.markets,b.totalCents]),[
    ['小明','special-zodiac',['旧'],1000],['小明','special-number',['旧'],6000],['小明','special-number',['新','旧'],100000],['张三','special-number',['新'],40000],
  ]);
  assert(p.bets.slice(1).every(b=>!b.semantic.inherited));
});

test('生肖对应号码随农历年变化，单价不变；没有逐号词的包号仍均分总额',()=>{
  for(const businessDate of ['2026-02-16','2026-02-17','2027-02-06'])for(const animal of ANIMALS){
    const b=valid(`包${animal}每号100`,businessDate).bets[0],numbers=ruleForDate(businessDate).zodiac[animal];
    assert.deepEqual(b.values,numbers);assert.equal(b.unitCents,10000);assert.equal(b.totalCents,numbers.length*10000);
  }
  const total=valid('包鸡100').bets[0];assert.equal(total.totalCents,10000);assert.equal(total.unitCents,2500);assert.equal(total.allocation.method,'equal-total');
  assert.equal(valid('包蛇每号160').bets[0].totalCents,64000);
  assert.equal(valid('特包龙虎各二十一肖').bets.reduce((sum,b)=>sum+b.totalCents,0),4000);
  assert.equal(valid('二中二30号拖鼠各10').bets[0].playType,'linked-number-2-2');
});

test('同笔明确特肖或连肖与逐号冲突仍待处理，裸各金额不能猜每号',()=>{
  for(const text of ['特肖包鸡每号100','二连肖包鸡狗每号100','包鸡各100','包鸡每组100','包鸡每个号','包鸡每号-100']){
    const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('赔付及退水按每号特码而非总额均分或特肖，AI不能降低单价',()=>{
  const text='包鸡每个号100',p=valid(text),odds={新:defaultOdds()},draws={新:{market:'新',date,issue:'2026294',numbers:[1,2,3,4,5,6,10]}};
  const result=settleDocuments([p],draws,odds,date,{rebates:{负责人:{perTenThousandCents:0,playRates:{'special-number':10000,'special-zodiac':20000}}}});
  assert.equal(result.stakeCents,40000);assert.equal(result.payoutCents,470000);assert.equal(result.rebateCents,400);
  const d=doc(text),item=reviewInput(d,'all').items[0],b={markets:['新'],play:'特码',selection:'鸡',basis:'每号',amount:'100',evidence:{market:'',play:'每个号',selection:'鸡',amount:'100'}};
  assert.equal(validateCandidate({bets:[b]},item,d).totalCents,40000);
  for(const change of [{amount:'25'},{play:'包鸡'},{play:'特肖',basis:'每肖'}])assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/金额|玩法|候选|包号|计费/);
});

test('旧冲突核验及错误均分解释失效，原文和历史赔付保留',()=>{
  for(const status of ['accepted','review','failed']){
    const d=doc('另外包鸡各号15米');d.parserVersion='parser-20261021-2';d.settlements=[{id:'old',payoutCents:12345}];
    d.assistance={...assistanceFor(d,[{line:1,source:d.text,status,replacement:status==='accepted'?'包鸡15':''}]),version:'semantic-20261021-2'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,d.text);assert.deepEqual(next.settlements,d.settlements);
    assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,6000);
  }
});
