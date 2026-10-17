import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {assistanceFor,reviewInput,currentReviewItems,reviewFailureMessage} from '../src/core/ai-review.js';
import {issueDetails} from '../src/core/issue-details.js';

const longNumbers='13-25-37-49-06-18-42-09-21-33-12-24-36-48-15-41-05-35-10-22-34-46-08-16-29-10-22-34-46-25各五米';
const quota='今日AI请求已达上限，本地解析仍可使用';
const doc=text=>({id:'pending-reasons',name:'测试账目',text,businessDate:'2026-10-06',defaultPlayer:''});
function record(d,status='failed',lines=d.text.split('\n').map((_,i)=>i+1)){
  d.assistance=assistanceFor(d,lines.map(line=>({line,source:d.text.split('\n')[line-1],status,required:true,replacement:'',candidates:[],reason:quota})));
  return d;
}

test('截图两行有明确金额，额度用完或等待AI不阻止165元计账且重复份数保留',()=>{
  for(const status of ['failed','pending']){
    const d=record(doc('香港\n1 15米\n'+longNumbers),status,[2,3]),saved=JSON.stringify(d.assistance),p=parseDocument(d.text,d);
    assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,16500);assert.equal(summarize([p]).markets.港,16500);
    assert.deepEqual(p.bets.map(b=>[b.playType,b.count,b.unitCents,b.totalCents]),[['special-number',1,1500,1500],['special-number',30,500,15000]]);
    assert.equal(p.bets[1].values.filter(n=>n===10).length,2);assert.equal(p.bets[1].values.filter(n=>n===25).length,2);
    assert(currentReviewItems(d).every(i=>!i.requiresAction&&i.localResolved&&i.reason===quota));
    assert.equal(reviewInput(d,'doubt').items.length,0);assert.equal(JSON.stringify(d.assistance),saved);
  }
});

test('有可追溯来源的玩法继承和无关文字不单独作为必须AI核验的原因',()=>{
  for(const text of ['特码\n1 15米','平特号码\n1 15米','三中三\n01 02 03各10','新特码1各15米，谢谢老板']){
    const d=record(doc(text)),p=parseDocument(text,d);assert.deepEqual(p.issues,[],text);
    assert.equal(reviewInput(d,'doubt').items.length,0,text);assert(summarize([p]).totalCents>0);
    assert(currentReviewItems(d).every(i=>!i.requiresAction),text);
  }
});

test('用户独立澳特标题只声明特码，下一行正常继承新市场，核验失败不挡330元',()=>{
  const text='新澳门\n13.37.23.35.03.39.各30\n澳特\n40.02.01.04.08.30.32.38.11.20.22.47.34.46.45.各10';
  const d=record(doc(text),'failed',[4]),p=parseDocument(text,d);
  assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,33000);assert.equal(p.bets.length,2);
  assert.deepEqual(p.bets.map(b=>[b.markets.join(),b.playType,b.count,b.totalCents]),[['新','special-number',6,18000],['新','special-number',15,15000]]);
  assert.equal(p.bets[1].semantic.inherited,true);assert.deepEqual(p.bets[1].semantic.declaration,{line:3,body:'澳特'});
  assert.equal(reviewInput(d,'doubt').items.length,0);assert.equal(currentReviewItems(d)[0].requiresAction,false);
});

test('真实玩法冲突保留具体业务原因，AI额度失败另外展示，不掩盖原因',()=>{
  const d=record(doc('特码1各15\n特肖三中三1 2 100'),'failed',[2]),p=parseDocument(d.text,d);
  const ai=p.issues.find(i=>i.code==='AI_REVIEW'),detail=issueDetails(ai);
  assert.equal(summarize([p]).totalCents,1500);assert(ai.reviewReasons.some(r=>r.includes('特肖')&&r.includes('其他玩法')));
  assert.match(detail.reason,/同一笔/);assert.equal(detail.aiStatus,quota);assert.match(detail.title,/未完成/);
  assert.match(detail.suggestion,/核对原文/);assert(!detail.reason.includes('请求已达上限'));
  assert.equal(currentReviewItems(d)[0].requiresAction,true);assert.deepEqual(currentReviewItems(d)[0].reviewReasons,ai.reviewReasons);
  assert.deepEqual(reviewInput(d,'doubt').items[0].reviewReasons,ai.reviewReasons);
});

test('核验等待与失败分别显示真实状态，缺金额仍待处理',()=>{
  const d=record(doc('特肖牛'),'pending'),p=parseDocument(d.text,d),detail=issueDetails(p.issues.find(i=>i.code==='AI_REVIEW'));
  assert.match(detail.title,/正在/);assert.match(detail.reason,/缺少金额/);assert.equal(summarize([p]).totalCents,0);
  d.assistance.items[0].status='failed';d.assistance.items[0].reason='AI连接失败或超时，请检查网络后重试';
  const failed=issueDetails(parseDocument(d.text,d).issues.find(i=>i.code==='AI_REVIEW'));
  assert.match(failed.reason,/缺少金额/);assert.match(failed.aiStatus,/超时/);
});

test('AI实际要求核对的解释仍阻止计账，并显示本地试算及核对入口所需信息',()=>{
  const d=record(doc('旧1 15米'),'review');d.assistance.items[0].reason='AI返回的金额与原文15米不一致';
  const p=parseDocument(d.text,d),ai=p.issues.find(i=>i.code==='AI_REVIEW'),detail=issueDetails(ai);
  assert.equal(summarize([p]).totalCents,0);assert.equal(currentReviewItems(d)[0].requiresAction,true);
  assert.equal(detail.reason,d.assistance.items[0].reason);assert.equal(detail.aiStatus,null);
  assert.match(detail.localExplanation,/旧市场 · 特码 · 1份 × 15\.00/);assert.match(detail.suggestion,/候选解释/);
});

test('普通待处理直接给出具体原因和对应修改建议，合计提醒不改变投注金额',()=>{
  for(const [text,pattern,suggestion] of [['50各10',/超出01–49/,/01至49/],['特肖牛',/缺少金额/,/各10元/],['特肖三中三1 2 100',/同时出现特肖/,/每号、每肖或每组/]]){
    const p=parseDocument(text,doc(text)),detail=issueDetails(p.issues[0]);assert.match(detail.reason,pattern);assert.match(detail.suggestion,suggestion);
  }
  const p=parseDocument('1各10\n共20',doc('1各10\n共20')),detail=issueDetails(p.issues[0]);
  assert.match(detail.reason,/已解析10/);assert.match(detail.suggestion,/合计/);assert.equal(summarize([p]).totalCents,1000);
});

test('历史版本的失败记录和旧原文不再阻塞当前已确定的投注',()=>{
  const d=record(doc('1 15米\n'+longNumbers));d.assistance.version='semantic-20261006-2';
  const p=parseDocument(d.text,d);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,16500);
  assert.equal(d.assistance.items[0].reason,quota);
});

test('前端失败记录保留额度或连接原因，只去掉IPC包装',()=>{
  assert.equal(reviewFailureMessage(new Error("Error invoking remote method 'ai:review': Error: "+quota)),quota);
  assert.equal(reviewFailureMessage(new Error('Codex 登录已过期')), 'Codex 登录已过期');
  assert.equal(reviewFailureMessage(new Error('AI连接失败或超时，请检查网络后重试')),'AI连接失败或超时，请检查网络后重试');
});
