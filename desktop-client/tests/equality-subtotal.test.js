import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
const source='雨：\n01.13.34.46.06.18各5=30米。';
const doc=(text=source)=>({id:'equation',name:'等号小计',text,businessDate:'2026-10-19'});
const parse=(text=source)=>parseDocument(text,doc(text));
test('截图六号码各5等于30自动核对，不新增下注或缺号码提示',()=>{
  const p=parse();assert.deepEqual(p.issues,[]);assert.equal(p.bets.length,1);assert.equal(summarize([p]).totalCents,3000);assert.equal(p.bets[0].raw,source.split('\n')[1]);
  const total=p.metadata.find(m=>m.kind==='金额声明');assert.deepEqual([total.expectedCents,total.actualCents,total.fromLine,total.toLine],[3000,3000,2,2]);assert(total.inlineEquation);
  assert.deepEqual(reviewInput(doc()).items,[]);
  for(const text of ['01 02各五＝十元','01 02各0.5 = 1米。','01 02各5，=10','01=5=5'])assert.deepEqual(parse(text).issues,[],text);
});
test('等号金额与完整相邻投注或连续段核对，兼容重复、多市场和跨行三中三',()=>{
  for(const [text,cents] of [['49各30\n01 02各5=10',4000],['01各10\n02各20=30',3000],['01各5，02各10=15',1500],['01 01各5=10',1000],['两边01 02各5=20',2000],['三中三\n01-02-03\n04-05-06各10=20',2000]]){
    const p=parse(text);assert.deepEqual(p.issues,[],text);assert.equal(summarize([p]).totalCents,cents,text);
  }
});
test('等号小计不匹配时给出差额，不把部分金额凑成合计或覆盖其他错误',()=>{
  for(const text of ['01 02各5=11','01各5，02各10=10','甲：01各5\n乙：02各10=15','01各5\n\n02各10=15','01各5\n共5\n02各10=15'])assert(parse(text).issues.some(i=>i.code==='TOTAL_MISMATCH'),text);
  const mismatch=parse('01 02各5=11').issues.find(i=>i.code==='TOTAL_MISMATCH');assert.match(mismatch.message,/合计11.*已解析10.*相差-1/);
  for(const text of ['01各5，99各10=5','特肖三中三1 2 100=100','01 02各5=10.001'])assert(parse(text).issues.length,text);
});
test('单等号投注单价和单独一行合计保留原含义',()=>{
  const p=parse('01=30');assert.deepEqual(p.issues,[]);assert.equal(p.bets[0].unitCents,3000);assert(!p.metadata.some(m=>m.kind==='金额声明'));
  assert.deepEqual(parse('01 02各5\n=10').issues,[]);
});
test('正确等号小计清除已失效的AI提示，金额不符及真实错误继续待核对',()=>{
  for(const text of [source,'雨：01各10\n02各20=30'])for(const status of ['pending','failed','review']){
    const d=doc(text),line=d.text.split('\n').length;d.assistance=assistanceFor(d,[{line,source:text.split('\n').at(-1),status,required:true,replacement:'',candidates:[]}]);
    assert.deepEqual(parseDocument(text,d).issues,[]);assert.equal(currentReviewItems(d)[0].requiresAction,false);assert.equal(currentReviewItems(d)[0].localResolved,true);
  }
  for(const text of ['01 02各5=11','01各5，99各10=5']){
    const d=doc(text);d.assistance=assistanceFor(d,[{line:1,source:text,status:'failed',required:true,replacement:'',candidates:[]}]);assert(currentReviewItems(d)[0].requiresAction);
  }
  const d=doc();d.parserVersion='parser-20261019-1';d.assistance={...assistanceFor(d,[{line:2,source:source.split('\n')[1],status:'review',replacement:'',candidates:[]}]),version:'semantic-20261019-1'};const next=upgradeDocument(d);assert.equal(next.text,source);assert.deepEqual(parseDocument(next.text,next).issues,[]);
});
