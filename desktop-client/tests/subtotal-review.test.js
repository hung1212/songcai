import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {assistanceFor,reviewInput,currentReviewItems} from '../src/core/ai-review.js';
const doc=text=>({id:'subtotal',name:'测试玩家',text,businessDate:'2026-10-05',defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
// Synthetic amounts reproduce a prior wager followed by a business header
// and several continuation rows. Subtotal scope follows the header, not names.
const source='奥三中三01/02/03，30米\n澳特:鼠牛号各5米\n01,02各5米\n03,04,05各5米。共65\n澳特:06,07各十米共20米';
const adjacentSource='新澳特：02,05,06,09,10,11,14,17,18,21,22,23,26,29,各十斤\n\n新澳特03.06.08.13.16.18.23.27.28.32.37.39.42.43.47.49各十五斤，\n\n新澳特19.31.01.49.03.27.29.41.14.26各五斤，\n共50';
test('截图共50准确核对上一条10号各5，前面的投注照常累计',()=>{
 const p=parse(adjacentSource);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,43000);assert.equal(p.bets.length,3);
 const sum=p.metadata.find(m=>m.kind==='金额声明');assert.deepEqual([sum.fromLine,sum.toLine,sum.expectedCents,sum.actualCents,sum.subtotalRule],[5,5,5000,5000,'R22']);
 assert.equal(reviewInput(doc(adjacentSource)).items.length,0);
 assert(!reviewInput(doc(adjacentSource),'all').items.some(i=>i.line===6));
 assert(parse(adjacentSource.replace('共50','共51')).issues.some(i=>i.code==='TOTAL_MISMATCH'));
});
test('相邻小计包含同行全部分句、跨行号码、重复下注和多市场金额',()=>{
 for(const [tail,from,to,total] of [
  ['01各20，共20',2,2,5000],
  ['01各20，02各30\n共50',2,2,8000],
  ['01 02\n03各10\n共30',2,3,6000],
  ['01/01/02各10\n共30',2,2,6000],
  ['两边01各20，02各5\n共50',2,2,8000],
 ]){
  const p=parse('49各30\n'+tail),sum=p.metadata.find(m=>m.kind==='金额声明');assert.deepEqual(p.issues,[],tail);
  assert.deepEqual([sum.fromLine,sum.toLine,sum.subtotalRule],[from,to,'R22'],tail);assert.equal(summarize([p]).totalCents,total,tail);
 }
});
test('局部小计不跨空行标题或旧小计，不选半行凑数，不覆盖明确总额范围',()=>{
 for(const tail of ['01各20\n\n共20','01各20\n特码\n共20','01各20\n共20\n共20','01各20，02各30\n共30','01各20\n合计20','01各20\n总共20','01各20\n总20']){
  const p=parse('49各30\n'+tail);assert(p.issues.some(i=>['TOTAL_MISMATCH','TOTAL_SCOPE'].includes(i.code)),tail);
 }
 const p=parse('01各30\n02各20\n共20，香港');assert(p.issues.some(i=>i.code==='TOTAL_MISMATCH'));assert(p.bets.every(b=>b.markets.join()==='港'));
});
test('相邻行有漏解析、缺金额或冲突时不宣称局部小计核对成功',()=>{
 for(const tail of ['01各20，特肖牛\n共20','01各20，特肖三中三1 2 100\n共20']){
  const p=parse('49各30\n'+tail);assert(p.issues.some(i=>i.severity==='error'),tail);assert(!p.metadata.some(m=>m.subtotalRule==='R22'),tail);
 }
});
for(const status of ['pending','failed','review'])test(`已核对的独立共50清除旧${status}提示，不替换原文`,()=>{
 const d=doc(adjacentSource);d.assistance=assistanceFor(d,[{line:6,source:'共50',status,required:true,replacement:'',candidates:[]}]);
 const p=parseDocument(d.text,d);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,43000);
 assert.equal(currentReviewItems(d)[0].requiresAction,false);assert.equal(currentReviewItems(d)[0].localResolved,true);
});
test('业务冒号开始的小计段不创建玩家，前面的投注保留在总账',()=>{
 const p=parse(source);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,11500);assert.equal(new Set(p.bets.map(b=>b.playerId)).size,1);
 const sums=p.metadata.filter(m=>m.kind==='金额声明');assert.deepEqual(sums.map(m=>[m.fromLine,m.toLine,m.expectedCents,m.actualCents]),[[2,4,6500,6500],[5,5,2000,2000]]);
 assert.equal(reviewInput(doc(source)).items.length,0);
});
test('有明确段落的小计、上次小计后累计、整条消息合计均可核对',()=>{
 for(const text of ['1各30\n新特码：2各20\n3各10，共30','1各30\n新特码：2各20\n3各10，共60','1各30\n特码\n2各20\n3各10\n共30\n合计60','1各30\n共30\n2各20\n共20\n合计50'])assert.deepEqual(parse(text).issues,[],text);
});
test('不任意搜索凑数、不跨玩家、不把本段小计当整条消息合计',()=>{
 for(const text of ['1各30\n2各20\n3各10 共30','甲：1各30\n乙：2各20\n共50','1各30\n新特码：2各20\n3各10 合计30','1各30\n新特码：2各20\n3各10 共31'])assert(parse(text).issues.some(i=>i.code==='TOTAL_MISMATCH'),text);
});
test('小计按每个市场重复投注，缺号缺金额仍保留真实错误',()=>{
 const p=parse('1各30\n两边特码：2各20\n3各10 共60');assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,9000);
 assert(parse('1各30\n澳特：\n特肖牛\n共40').issues.some(i=>i.code==='MISSING_AMOUNT'));
});
for(const status of ['failed','pending'])test(`旧${status}核验的误报已被本地修复，不再阻止计账`,()=>{
 const d=doc(source);d.assistance=assistanceFor(d,[{line:4,source:source.split('\n')[3],status,required:true,replacement:'',candidates:[],reason:'核验已停止'}]);
 const original=JSON.stringify(d.assistance),p=parseDocument(d.text,d);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,11500);
 const [item]=currentReviewItems(d);assert.equal(item.requiresAction,false);assert.equal(item.localResolved,true);assert.equal(JSON.stringify(d.assistance),original);
});
test('真实AI待确认结果仍需核对；核验失败不假称AI解释有分歧',()=>{
 const d=doc(source);d.assistance=assistanceFor(d,[{line:4,source:source.split('\n')[3],status:'review',required:true,replacement:'',candidates:[]}]);
 let p=parseDocument(d.text,d);assert(p.issues.some(i=>i.code==='AI_REVIEW'));assert.equal(currentReviewItems(d)[0].requiresAction,true);
 const conflict=doc('特码1各30\n特肖三中三1 2 100');conflict.assistance=assistanceFor(conflict,[{line:2,source:conflict.text.split('\n')[1],status:'failed',required:true,replacement:'',candidates:[]}]);
 p=parseDocument(conflict.text,conflict);assert.equal(summarize([p]).totalCents,3000);assert(p.issues.some(i=>i.code==='AI_REVIEW'&&i.message.includes('未完成')&&!i.message.includes('差异')));assert.equal(currentReviewItems(conflict)[0].requiresAction,true);
});
