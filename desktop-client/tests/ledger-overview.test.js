import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {ledgerOverview,settlementBalance} from '../src/core/ledger-overview.js';
import {defaultOdds} from '../src/core/settlement.js';
const date='2026-10-05',markets=['新','旧','港'];
const settings=()=>({odds:Object.fromEntries(markets.map(m=>[m,{...defaultOdds(),confirmed:true,refund49:{attribute:true,sixZodiac:true,halfWave:false}}]))});
const draw=(market,numbers=[1,2,3,4,5,6,49])=>({id:market,market,date,issue:'2026278',numbers,sourceId:'manual-test'});
const draws=Object.fromEntries(markets.map(m=>[m,draw(m)])),dates=Object.fromEntries(markets.map(m=>[m,date])),verified=Object.fromEntries(markets.map(m=>[m,{confirmed:true}]));
const doc=(id,text,businessDate=date)=>parseDocument(text,{id,name:id,businessDate});
test('所有账目分别结算，跨业务日期仍计入，玩家净输赢等于应付减去投注',()=>{
  const result=ledgerOverview([doc('甲','新特码49各100'),doc('乙','旧特码01各20','2026-10-04'),doc('丙','港特码49各10')],draws,settings(),verified,dates);
  assert.equal(result.stakeCents,13000);assert.equal(result.payoutCents,517000);assert.equal(result.netCents,504000);
  assert.deepEqual(result.rows.map(r=>r.netCents),[460000,-2000,46000]);assert.equal(result.status,'complete');
  assert.equal(result.winningLedgers,2);assert.equal(result.winCount,2);assert.equal(result.wins.length,2);
  assert.equal(result.wins[0].fileId,'甲');assert.equal(result.wins[0].raw,'新特码49各100');
  assert.deepEqual(result.markets.map(m=>m.stakeCents),[10000,2000,1000]);
  assert.deepEqual(result.markets.map(m=>m.payoutCents),[470000,0,47000]);
});
test('一次投注三边各算一次，不因菜单汇总重复增加历史赔付',()=>{
  const cfg={...settings(),history:[{stakeCents:999999,payoutCents:999999}]};
  const result=ledgerOverview([doc('甲','三边特码49各10')],draws,cfg,verified,dates);
  assert.equal(result.stakeCents,3000);assert.equal(result.payoutCents,141000);assert.equal(result.netCents,138000);assert.equal(result.wins.length,3);
});
test('退本金算应付，退款不误显示为玩家输钱',()=>{
  const r=ledgerOverview([doc('甲','新大100')],draws,settings(),verified,dates);
  assert.equal(r.refundCents,10000);assert.equal(r.payoutCents,10000);assert.equal(r.netCents,0);assert.equal(r.wins.length,0);assert.equal(r.rows[0].label,'持平');
});
test('缺少开奖、缺中奖赔率、原文歧义均阻止显示确定净输赢',()=>{
  const cfg=settings();cfg.odds.新.rates['linked-number-3-3'].rate='';
  for(const [text,ds,os] of [['旧特码01各10',{新:draws.新},settings()],['新三中三1 2 3各10',draws,cfg],['特肖三中三1 2 100',draws,settings()]]){
    const result=ledgerOverview([doc('甲',text),doc('乙','新特码49各10')],ds,os,verified,dates);
    assert.equal(result.rows[0].status,'pending',text);assert.equal(result.rows[0].netCents,null,text);
    assert.equal(result.status,'pending');assert.equal(result.netCents,null);assert.equal(result.pendingLedgers,1);
    assert.equal(result.rows[1].payoutCents,47000);
  }
});
test('来源或赔率未确认时显示试算，确认后显示完成，只检查有投注的市场',()=>{
  const docs=[doc('甲','新特码49各10')];
  assert.equal(ledgerOverview(docs,draws,settings(),{},dates).status,'trial');
  const cfg=settings();cfg.odds.新.confirmed=false;
  assert.equal(ledgerOverview(docs,draws,cfg,verified,dates).status,'trial');
  assert.equal(ledgerOverview(docs,draws,settings(),{新:{confirmed:true}},dates).status,'complete');
});
test('清空后保留空账目，金额和中奖记录归零，致命解析错误仍待结算',()=>{
  const r=ledgerOverview([doc('甲',''),doc('乙','')],{},settings(),{},dates);
  assert.equal(r.rows.length,2);assert.ok(r.rows.every(r=>r.status==='empty'));assert.equal(r.netCents,0);assert.equal(r.stakeCents,0);assert.equal(r.wins.length,0);
  const broken=ledgerOverview([{id:'x',name:'坏日期',bets:[],issues:[{message:'日期无效'}]}],{},settings(),{},dates);
  assert.equal(broken.netCents,null);assert.equal(broken.rows[0].status,'pending');
});
test('过大汇总金额报错，不输出失去精度的数字',()=>{
  const fake=doc('甲','新特码01各1');fake.bets[0].perMarketCents=Number.MAX_SAFE_INTEGER;fake.bets[0].totalCents=Number.MAX_SAFE_INTEGER;fake.bets[0].marketEntries[0].amountCents=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>ledgerOverview([fake,{...fake,id:'乙'}],{},settings(),{},dates),/超出|范围/);
  assert.equal(settlementBalance(null).netCents,null);
});
test('取消的号码与金额跨行改动保持原解析行为',()=>{
  const p=doc('跨行','14.41.23.32.13.31.11.\n各5');
  assert.equal(summarize([p]).totalCents,3500);assert.equal(p.issues.length,0);
});
