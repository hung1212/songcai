import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,normalize} from '../src/core/parser.js';
import {reviewInput,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {marketTokens} from '../src/core/business-syntax.js';
import {issueDetails} from '../src/core/issue-details.js';
const date='2026-10-05';
const doc=text=>({id:'subtotal',name:'样例',text,businessDate:date});
const parse=text=>parseDocument(text,doc(text));
function valid(text,total){const p=parse(text);assert.deepEqual(p.issues,[],text);assert.equal(summarize([p]).totalCents,total*100,text);assert.deepEqual(reviewInput(doc(text)).items,[],text);assert(p.bets.every(b=>b.raw===text||text.includes(b.raw)));return p;}

test('完整单价后的二是等号，不新增投注或吞掉中文玩法金额',()=>{
  for(const [text,total] of [['05+14+15+36+32+各5米二25米',25],['05+15各10米二20米',20],['38+17+05+39+11+32+44各号3米二21米',21],['绿波各20二320',320],['11+05+17+29+35各号5米二25米',25],['11+23+各号5米二10米',10]])valid(text,total);
  assert.equal(valid('二中二01 02各二十',20).bets[0].playType,'linked-number-2-2');
  valid('01 02各二百二十',440);valid('01 02各0.5二1',1);
  assert(parse('01 02各二5').issues.some(i=>i.severity!=='warning'));
});
test('各金额点米、各肖各号保留每号金额和马年五号',()=>{
  valid('牛猪狗各5.米=60',60);valid('马鼠猪兔龙:各肖各号5米合计105',105);
  valid('新，14.26.38.13.25.37.各15.米 1.3.8.23.30.35.41.49.31.34.46.28.29.5.2.各10米',240);
  valid('34.44.42.38.49各6O.米',300);
  valid('01 02各1.25米',2.5);assert(parse('01各.5米').issues.length);
  assert(parse('特肖牛各肖各号5').issues.some(i=>i.severity!=='warning'));
  assert(parse('牛各肖5各号10').issues.some(i=>i.severity!=='warning'));
});
test('噢门是新澳市场，原文市场证据保留',()=>{
  const p=valid('噢门特，42--36各20米，\n43--39--25--49--26--38--6--22各2米',56);
  assert(p.bets.every(b=>b.markets.join()==='新'));
  assert.deepEqual(marketTokens('噢门特42各20').map(t=>[t.quote,t.markets]),[['噢门',['新']]]);
});
test('同句两笔等号小计分开核对，金额不会被当成号码',()=>{
  const p=valid('.29.47各200=400米.39.32.33.38各100=400米，',800);
  assert.deepEqual(p.bets.map(b=>[b.values,b.unitCents]),[[[29,47],20000],[[39,32,33,38],10000]]);
  assert.deepEqual(p.metadata.filter(m=>m.inlineEquation).map(m=>[m.expectedCents,m.actualCents]),[[40000,40000],[40000,40000]]);
  valid('虎猴各号3米二24米一05+35各号5米共34米',34);
  const bad=parse('01各5=7米，02各10=8米');assert.equal(summarize([bad]).totalCents,1500);
  assert.equal(bad.issues.filter(i=>i.code==='TOTAL_MISMATCH'&&i.severity==='warning').length,2);
  valid('01=30',30);
});
test('连续已核对的小计可核对段合计，明细后合计优先本次未核对范围',()=>{
  valid('澳门特蛇兔猴羊各数10=160\n牛鼠龙各数5=60\n共220',220);
  valid('马鼠猪兔龙各肖各号5米合计105\n14，26，22，34各号15米合计60\n\n总合计165',165);
  for(const text of ['01各5=5\n\n共5','甲：01各5=5\n乙：共5','01各5=5\n新\n共5'])assert(parse(text).issues.some(i=>/^TOTAL_/.test(i.code)),text);
});
test('合计弱提示既不阻止投注赔付退水，也不会请求AI核验',()=>{
  for(const text of ['01 02各5共11','01 02各5=11','01 02各5\n共11']){
    const d=doc(text),p=parse(text);assert(p.issues.every(i=>i.severity==='warning'));assert(p.bets.every(b=>b.status==='parsed'));
    assert.match(issueDetails(p.issues[0]).suggestion,/照常计算/);assert.deepEqual(reviewInput(d).items,[]);
    const result=settleDocuments([p],{新:{market:'新',date,issue:'2026278',numbers:[3,4,5,6,7,8,1]}},{新:defaultOdds()},date,{rebates:{样例:{perTenThousandCents:10000,playRates:{}}}});
    assert.equal(result.complete,true);assert.equal(result.stakeCents,1000);assert.equal(result.payoutCents,23500);assert.equal(result.rebateCents,10);
    for(const status of ['pending','failed','review']){const item={line:text.split('\n').length,source:text.split('\n').at(-1),status,required:true,replacement:''};const withAI={...d,assistance:assistanceFor(d,[item])};assert.equal(summarize([parseDocument(text,withAI)]).totalCents,1000);assert(!currentReviewItems(withAI)[0].requiresAction);assert(!parseDocument(text,withAI).issues.some(i=>i.code==='AI_REVIEW'));}
  }
});
test('金额及计费歧义仍待处理，同句独立明确的投注不被AI失败牵连',()=>{
  for(const text of ['包猪各十米08 32,36,42,44,48各十米','包兔猪各五米']){
    const d=doc(text),p=parse(text);assert(p.issues.some(i=>i.code==='BASIS_CONFLICT'));assert.equal(reviewInput(d).items.length,1);
    for(const status of ['pending','failed','review']){const a={...d,assistance:assistanceFor(d,[{line:1,source:text,status,required:true,replacement:''}])};const result=parseDocument(text,a);assert.equal(summarize([result]).totalCents,text.includes('08')?6000:0);assert(result.issues.some(i=>i.code==='AI_REVIEW'));}
  }
  assert(parse('二中二01 02三组各10共10').issues.some(i=>i.code==='COUNT_MISMATCH'&&i.severity==='error'));
  assert(parse('01各5,99各10共5').issues.some(i=>i.code==='NUMBER_RANGE'));
});
