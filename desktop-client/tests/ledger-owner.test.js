import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {ledgerOwnedDocument,ledgerOwnerSettings} from '../src/core/ledger-owner.js';
import {settlementPlayers} from '../src/core/rebates.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {ledgerOverview} from '../src/core/ledger-overview.js';
import {ledgerReceipt} from '../src/core/ledger-receipt.js';
import {specialTransferPlan} from '../src/core/special-transfer.js';
const date='2026-10-05';
const doc=(name,text,id=name)=>parseDocument(text,{id,name,businessDate:date,defaultPlayer:'正文默认名'});
const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}]));
const draws={新:{market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,49]}};
const override=rate=>({markets:{新:{rates:{'special-number':{rate}}}}});
const settings={odds,rebates:{大洋:{perTenThousandCents:30000,playRates:{'flat-zodiac':10000,'flat-zodiac-year':5000}},副号:{perTenThousandCents:20000},雨:{perTenThousandCents:990000}},playerOdds:{大洋:override('45'),副号:override('46'),雨:override('99')}};
const settle=docs=>settleDocuments(docs,draws,odds,date,settings);

test('一账单多个正文署名和默认署名，整单按标题退水和赔率且不修改原文解析',()=>{
  const p=doc('大洋','49各100\n雨：49各100\n阿明：20各100\n平特肖马蛇各100'),before=JSON.stringify(p),r=settle([p]);
  assert.equal(r.complete,true);assert.equal(r.players.length,1);assert.equal(r.players[0].id,'大洋');
  assert.equal(r.stakeCents,50000);assert.equal(r.turnoverCents,50000);assert.equal(r.rebateCents,1050);
  assert.deepEqual(r.entries.slice(0,3).map(e=>e.payoutCents),[450000,450000,0]);
  assert(r.entries.every(e=>e.player==='大洋'&&e.playerId==='大洋'));assert.equal(JSON.stringify(p),before);
  const projected=ledgerOwnedDocument(p);assert.deepEqual(ledgerOwnedDocument(projected),projected);
  assert.deepEqual(projected.bets.map(b=>b.sourcePlayerId),p.bets.map(b=>b.playerId));
  const overview=ledgerOverview([p],draws,settings,{});assert.equal(overview.rebateCents,r.rebateCents);assert.equal(overview.payoutCents,r.payoutCents);
  const card=ledgerReceipt({document:p,result:r,inputs:{kind:'current',selection:p.id,date,documents:[p],draws,settings}});
  assert.equal(card.rebateTurnoverCents,r.stakeCents);assert.equal(card.payableCents,r.payableCents);
});

test('两份账单同一个正文姓名，使用各自标题的配置，转出测算和真实逐号结算一致',()=>{
  const docs=[doc('大洋','雨：49各100\n雨：20各200'),doc('副号','雨：49各100')];
  const r=settle(docs);assert.deepEqual(r.players.map(p=>[p.id,p.rebateCents]),[['大洋',900],['副号',200]]);
  const plan=specialTransferPlan(docs,settings,{date,market:'新'});assert.equal(plan.playerRebateCents,1100);
  for(let n=1;n<=49;n++){
    const normal=Array.from({length:49},(_,i)=>i+1).filter(v=>v!==n).slice(0,6);
    const actual=settleDocuments(docs,{新:{...draws.新,numbers:[...normal,n]}},odds,date,settings);
    assert.equal(plan.numbers[n-1].liabilityCents,actual.payoutCents);
    assert.equal(plan.netStakeCents??(plan.stakeCents-plan.playerRebateCents),actual.stakeCents-actual.rebateCents);
  }
});

test('未配置账单不会套用正文或默认署名配置，改名使用新名称配置，空账单名册只按标题',()=>{
  const p=doc('新玩家','雨：49各100');const r=settle([p]);assert.equal(r.rebateCents,0);assert.equal(r.payoutCents,470000);
  const renamed={...p,name:'大洋'};assert.equal(settle([renamed]).rebateCents,300);assert.equal(settle([renamed]).payoutCents,450000);
  assert.deepEqual(settlementPlayers([p,doc('副号',''),doc('新玩家','雨：20各1','copy')],{includeEmpty:true}).map(p=>p.id),['新玩家','副号']);
});

test('整单舍入只做一次，正文分名分行不改变退水；同名不同账单仍分别舍入',()=>{
  const config={rebates:{大洋:{perTenThousandCents:10000}}};
  const calculate=docs=>settleDocuments(docs,draws,odds,date,config);
  const split=calculate([doc('大洋','雨：20各0.25\n张三：21各0.25')]);
  assert.equal(split.rebateCents,1);assert.equal(split.rebateCents,calculate([doc('大洋','20.21各0.25')]).rebateCents);
  assert.equal(calculate([doc('大洋','20各0.25','a'),doc('大洋','21各0.25','b')]).rebateCents,0);
});

test('正文期号与市场作用域继续独立，未处理投注仍使账单待核对',()=>{
  const p=doc('大洋','雨：新澳277期：20各100\n张三：新澳278期：49各100\n特码99各100');
  const r=settle([p]);assert.deepEqual(r.entries.map(e=>e.status),['pending','won']);
  assert(r.issues.every(i=>i.playerId==='大洋'));assert.equal(r.players[0].netCents,null);assert.equal(r.rebateCents,300);
  assert.throws(()=>specialTransferPlan([p],settings,{date,market:'新'}),/不同期号/);
});

test('旧账单编号配置兼容为同名设置，已有标题配置优先，正文姓名配置不迁移',()=>{
  const p=doc('DXQ','雨：49各100','legacy'),legacy='document:legacy:player';
  const config={odds,rebates:{[legacy]:{name:'本单玩家（DXQ）',perTenThousandCents:30000},雨:{perTenThousandCents:990000}},playerOdds:{[legacy]:{...override('44'),name:'本单玩家（DXQ）'}}};
  const before=JSON.stringify(config),resolved=ledgerOwnerSettings([p],config);
  assert.equal(resolved.rebates.DXQ.perTenThousandCents,30000);assert.equal(resolved.playerOdds.DXQ.markets.新.rates['special-number'].rate,'44');
  assert(!Object.hasOwn(resolved.rebates,legacy));assert.equal(JSON.stringify(config),before);
  const r=settleDocuments([p],draws,odds,date,config);assert.equal(r.rebateCents,300);assert.equal(r.payoutCents,440000);
  const plan=specialTransferPlan([p],config,{date,market:'新'});assert.equal(plan.playerRebateCents,300);assert.equal(plan.numbers[48].liabilityCents,440000);
  config.rebates.DXQ={perTenThousandCents:0};assert.equal(ledgerOwnerSettings([p],config).rebates.DXQ.perTenThousandCents,0);
  assert.equal(ledgerOwnerSettings([{...p,name:'另一个名字'}],config).rebates['另一个名字'],undefined);
  delete resolved.playerOdds.DXQ;assert.deepEqual(ledgerOwnerSettings([p],resolved).playerOdds,{});
});
