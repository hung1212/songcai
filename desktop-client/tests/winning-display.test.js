import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {wonStake,winningEntryLabel,winningLineMarks,drawBasisLabel} from '../src/core/winning-display.js';
const date='2026-10-05';
const draw={id:'fixture',market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,49],sourceId:'manual'};
const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}]));
const verification=Object.fromEntries(['新','旧','港'].map(m=>[m,{confirmed:true}]));
function fixture(text,draws={新:draw}){
  const parsed=parseDocument(text,{id:'a',businessDate:date});
  const result=settleDocuments([parsed],draws,odds,date);
  return {parsed,result,marks:winningLineMarks(parsed,result,{odds,verification})};
}
test('部分号码中奖只显示中奖投注，不把整行总额当中奖额',()=>{
  const {parsed,result,marks}=fixture('新 01 02 49各10');
  assert.equal(result.entries[0].stakeCents,3000);
  assert.equal(wonStake(result.entries[0]),1000);
  assert.equal(winningEntryLabel(result.entries[0]),'特码10.00元');
  assert.equal(result.payoutCents,47000);
  assert.equal(marks[1].trial,false);
  assert.match(marks[1].title,/中奖 · 新 · 特码10.00元 · 赔付470.00元/);
  assert.equal(marks[1].entries[0].fileId,parsed.id);
});
test('重复中奖号码与多注组合按实际中的份数显示',()=>{
  const duplicates=fixture('49 49 01各10').result.entries[0];
  assert.equal(wonStake(duplicates),2000);assert.equal(duplicates.payoutCents,94000);
  const combo=fixture('三中三复式 01 02 03 04 20各组10').result.entries[0];
  assert.equal(combo.winCount,4);assert.equal(wonStake(combo),4000);
});
test('同一行分市场标记只列出中奖市场，缺开奖不误报',()=>{
  const {marks,result}=fixture('三边49各10',{新:draw,旧:{...draw,market:'旧',numbers:[1,2,3,4,5,6,48]}});
  assert.equal(result.entries.find(e=>e.market==='港').status,'pending');
  assert.equal(marks[1].entries.length,1);assert.equal(marks[1].entries[0].market,'新');
});
test('跨行选号的中奖投注标记完整原文范围',()=>{
  const {parsed,marks}=fixture('30.42.43.21.07.\n49.25.13.01.31.各20');
  assert.equal(parsed.bets[0].endLine,2);assert.deepEqual(Object.keys(marks),['1','2']);
});
test('未中奖、49退本金与待结算不显示中奖底色',()=>{
  const {result,marks}=fixture('01各10\n大100\n三中二01 02 03各10');
  assert.deepEqual(result.entries.map(e=>e.status),['lost','pending','pending']);
  const refundOdds={新:{...odds.新,refund49:{...odds.新.refund49,attribute:true}}};
  const refund=settleDocuments([parseDocument('大100',{id:'a',businessDate:date})],{新:draw},refundOdds,date);
  assert.equal(refund.entries[0].status,'refund');assert.equal(wonStake(refund.entries[0]),null);
  assert.deepEqual(marks,{});
});
test('历史与正在编辑的版本不标记；原文、行号、市场不匹配不误标',()=>{
  const {parsed,result}=fixture('49各10');
  for(const options of [{fresh:false},{history:true}])assert.deepEqual(winningLineMarks(parsed,result,options),{});
  for(const patch of [{raw:'49各20'},{line:2},{market:'港'},{betId:'other'}]){
    assert.deepEqual(winningLineMarks(parsed,{entries:[{...result.entries[0],...patch}]}),{});
  }
});
test('切换开奖号后中奖消失；未核对开奖或赔率会标为试算',()=>{
  const {parsed,result}=fixture('49各10');
  assert.equal(winningLineMarks(parsed,result,{odds})[1].trial,true);
  assert.equal(winningLineMarks(parsed,result,{verification})[1].trial,true);
  const next=settleDocuments([parsed],{新:{...draw,numbers:[1,2,3,4,5,6,48]}},odds,date);
  assert.deepEqual(winningLineMarks(parsed,next,{odds,verification}),{});
});
test('旧赔付记录从当时快照恢复中奖额，缺失信息不拿整行金额替代',()=>{
  const old={status:'won',play:'特码',winCount:1,stakeCents:3000};
  assert.equal(wonStake(old,{unitCents:1000}),1000);
  assert.equal(wonStake(old),null);
  assert.match(winningEntryLabel(old),/待核对/);
  assert.equal(wonStake({...old,unitCents:Number.MAX_SAFE_INTEGER,winCount:2}),null);
});
test('开奖依据展示所选市场的实际日期和期号',()=>{
  assert.equal(drawBasisLabel({新:draw}),'新 2026-10-05 · 2026278期');
  assert.equal(drawBasisLabel({}),'尚无可用开奖');
});
