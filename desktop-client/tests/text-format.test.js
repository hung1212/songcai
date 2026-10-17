import test from 'node:test';
import assert from 'node:assert/strict';
import {formatBetLines,prepareBetPaste} from '../src/core/text-format.js';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
const source='46.22.10.34.18.24.23.07.43.各.5.米，04.40.13.01.49.各.10.米，28.16.各.20.米，37.25.各.50.米，共.235.米，香港';
const formatted='46.22.10.34.18.24.23.07.43.各.5.米，\n04.40.13.01.49.各.10.米，\n28.16.各.20.米，\n37.25.各.50.米，\n共.235.米，香港';
const doc=text=>({id:'paste-test',name:'测试',text,businessDate:'2026-10-06',defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
test('金额之后自动分行，数字及标点原样保留，合计和香港保留同一行',()=>{
 assert.equal(formatBetLines(source),formatted);assert.equal(formatBetLines(formatted),formatted);
 assert.equal(formatBetLines(source).replaceAll('\n',''),source);
});
test('整段、分行、普通金额和无逗号分行都直接解析为香港四笔235元，无需AI确认',()=>{
 for(const text of [source,formatted,formatted.replaceAll('各.','各').replaceAll('.米','米').replace('共.','共'),formatted.replaceAll('，\n','\n')]){
  const p=parse(text);assert.deepEqual(p.issues,[],text);assert.equal(p.bets.length,4);
  assert.deepEqual(p.bets.map(b=>b.count),[9,5,2,2]);assert.deepEqual(p.bets.map(b=>b.totalCents),[4500,5000,4000,10000]);
  assert.ok(p.bets.every(b=>b.markets.join()==='港'&&b.status==='parsed'));assert.equal(summarize([p]).markets.港,23500);
  assert.equal(p.metadata.find(m=>m.kind==='金额声明').actualCents,23500);assert.equal(reviewInput(doc(text)).items.length,0);
 }
});
test('合计只处理本段，不跨发送人、空行或此前合计，也不覆盖明确冲突市场',()=>{
 for(const prefix of ['甲：新01各100\n乙：','新01各100\n共100\n','新01各100\n\n']){
  const p=parse(prefix+'02各10\n03各20\n共30米，香港');
  assert.deepEqual(p.issues,[],prefix);assert.deepEqual(p.bets.map(b=>b.markets),[['新'],['港'],['港']]);
  assert.deepEqual(summarize([p]).markets,{新:10000,旧:0,港:3000});
 }
 const conflict=parse('新01各10，\n02各20，\n共30米，香港');assert(conflict.issues.some(i=>i.code==='TRAILING_MARKET'));
 const bare=parse('小明：1各10\n港\n张三：2各20');assert(bare.issues.some(i=>i.code==='TRAILING_MARKET'));
});
test('保留市场继承及多市场计费，错误合计仍提示实际差额',()=>{
 const p=parse('甲：01各10\n共20，两边\n02各5\n乙：03各10');
 assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets.map(b=>b.markets),[['新','旧'],['新','旧'],['新']]);
 const mismatch=parse(formatted.replace('235','236'));assert.equal(mismatch.issues.length,1);assert.equal(mismatch.issues[0].code,'TOTAL_MISMATCH');assert.equal(summarize([mismatch]).markets.港,23500);
});
test('旧合计行AI的等待、失败和待确认记录不再阻塞这条确定的合计',()=>{
 for(const status of ['pending','failed','review']){
  const d=doc(formatted),source=formatted.split('\n')[4];d.assistance=assistanceFor(d,[{line:5,source,status,required:true,replacement:'',candidates:[],reason:'旧版无法回填市场'}]);
  const p=parseDocument(d.text,d);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,23500);
  assert.equal(currentReviewItems(d)[0].requiresAction,false);
  assert.ok(!reviewInput(d,'all').items.some(i=>i.line===5));
 }
});
test('分隔点金额与真实小数分别处理，孤立各.5仍不能猜金额',()=>{
 assert.equal(summarize([parse('1各.5.米')]).totalCents,500);
 assert.equal(summarize([parse('1各.0.5.米')]).totalCents,50);
 assert.equal(summarize([parse('1各0.5米')]).totalCents,50);
 assert(parse('1各.5米').issues.some(i=>i.code==='DECIMAL_AMBIGUOUS'));
 const p=parse('1各.5.123.米');assert(p.issues.length>0);
 const tokens=highlightText(formatted);assert.equal(tokens.map(t=>t.text).join(''),formatted);
 assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['5','10','20','50','235']);
});
test('不按选号逗号拆行，不切断小数、括号分组、前置金额或市场尾注',()=>{
 for(const text of ['1,2,3各5元','三中三(1,2,3)(4,5,6)各10元','特肖100元虎','1各0.50米，香港','14.41.23.32.13.31.11.\n各5'])assert.equal(formatBetLines(text),text);
 assert.equal(formatBetLines('1,2各0.50元，3,4各2.25元，共5.50元'), '1,2各0.50元，\n3,4各2.25元，\n共5.50元');
 assert.equal(formatBetLines('１各．５．米，２各．１０．米，共．１５．米，香港'),'１各．５．米，\n２各．１０．米，\n共．１５．米，香港');
});
test('整段粘贴在末尾续行，不累加多余空行；选中片段替换保持光标位置',()=>{
 assert.equal(prepareBetPaste('',0,0,source),formatted+'\n');
 assert.equal(prepareBetPaste('旧01各10',6,6,source),'\n\n'+formatted+'\n');
 assert.equal(prepareBetPaste('旧01各10\n',7,7,source+'\n'),'\n'+formatted+'\n');
 assert.equal(prepareBetPaste('1各100元',2,5,'20'),'20');
 assert.equal(prepareBetPaste('1各100元\n2各20元',0,6,'3各10元'),'3各10元');
 assert.equal(prepareBetPaste('1各',2,2,'5'),'5');
 assert.equal(prepareBetPaste('1各10\n2各20',5,9,'3各30元'),'3各30元\n');
});

test('连续粘贴消息以空行分隔，香港尾注不回填此前投注',()=>{
 const first='01各100\n';const next=first+prepareBetPaste(first,first.length,first.length,source);
 const p=parse(next);assert.deepEqual(p.issues,[]);assert.equal(p.bets[0].markets.join(),'新');assert.equal(summarize([p]).markets.港,23500);
});

test('包号金额前后互换都整句粘贴与分行，高亮保留原字和金额依据',()=>{
 for(const text of ['40元包羊','40包羊','四十元 包 羊','４０元包羊']){
  assert.equal(formatBetLines(text),text);assert.equal(prepareBetPaste('',0,0,text),text+'\n');
  const tokens=highlightText(text);assert.equal(tokens.map(t=>t.text).join(''),text);assert(tokens.some(t=>t.kind==='amount'));assert(tokens.some(t=>t.kind==='play'));
 }
 assert.equal(formatBetLines('40元包羊，包蛇60元'),'40元包羊，\n包蛇60元');
 assert.equal(formatBetLines('40元包羊蛇'), '40元包羊蛇');
});
