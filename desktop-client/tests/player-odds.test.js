import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseDocument} from '../src/core/parser.js';
import {ruleForDate} from '../src/core/rules.js';
import * as core from '../src/core/settlement.js';
import * as drawCore from '../src/core/draws.js';
import {validatePlayerOdds,effectivePlayerOdds,playerOddsDraft,mergePlayerOddsEdits} from '../src/core/player-odds.js';
import {ledgerOverview} from '../src/core/ledger-overview.js';
import {ledgerReceipt} from '../src/core/ledger-receipt.js';
import {SettlementStore,hash} from '../electron/settlement-store.cjs';
import {browserSettlement} from '../src/settlement-preview.js';
const date='2026-10-05';
const defaults=()=>Object.fromEntries(['新','旧','港'].map(m=>[m,{...core.defaultOdds(),confirmed:true}]));
const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date,issue:'2026278',numbers:[1,2,3,4,5,6,49],sourceId:'manual'}]));
const doc=(text,id='a',businessDate=date)=>parseDocument(text,{id,name:'测试账目',businessDate});
const override=(rates,market='新')=>({name:'小明',markets:{[market]:{rates}}});
const playerOdds={小明:override({'special-number':{rate:'40'},'flat-zodiac':{rate:'2.2',specialRate:'1.5'}})};

test('玩家按市场和赔率档位覆盖，其余继承最新默认，不改变其他玩家',()=>{
  const odds=defaults(),documents=[doc('小明：三边49各10\n平特肖马蛇各100\n张三：49各10\n平特肖马蛇各100')];
  const before=JSON.stringify(odds),result=core.settleDocuments(documents,draws,odds,date,{playerOdds});
  assert(result.complete);assert.equal(JSON.stringify(odds),before);
  const xm=result.entries.filter(e=>e.playerId==='小明'),zs=result.entries.filter(e=>e.playerId==='张三');
  assert.deepEqual(xm.filter(e=>e.playType==='special-number').map(e=>e.payoutCents),[40000,47000,47000]);
  assert.equal(xm.find(e=>e.playType==='flat-zodiac').payoutCents,37000);
  assert.equal(zs.find(e=>e.playType==='flat-zodiac').payoutCents,38500);
  odds.旧.rates['special-number'].rate='46';
  const updated=core.settleDocuments(documents,draws,odds,date,{playerOdds});
  assert.equal(updated.entries.find(e=>e.playerId==='小明'&&e.market==='旧').payoutCents,46000);
  const overview=ledgerOverview(documents,draws,{odds,playerOdds},{});
  assert.equal(overview.payoutCents,updated.payoutCents);
  const card=ledgerReceipt({document:{id:'a'},result:updated,inputs:{kind:'current',selection:'a',documents,date,draws,settings:{odds,playerOdds}}});
  assert(card.rows.some(r=>r.rate==='1.5'&&r.detail==='马年生肖档'));
  assert(card.rows.some(r=>r.rate==='40'));assert(card.rows.some(r=>r.rate==='47'));
});

test('单独本命年赔率不覆盖普通赔率，保留市场本金口径和六七码范围',()=>{
  const odds=defaults(),players={小明:override({'flat-zodiac':{specialRate:'1.6'}})},bet=doc('小明：平特肖马蛇各100').bets[0];
  odds.新.rates['flat-zodiac'].rate='2.3';odds.新.includePrincipal=false;
  let r=core.settleBet(bet,draws.新,effectivePlayerOdds(odds.新,players,'小明','新'));
  assert.equal(r.payoutCents,59000);
  odds.新.scopes['flat-zodiac']='six';
  r=core.settleBet(bet,{...draws.新,numbers:[2,3,4,5,6,7,49]},effectivePlayerOdds(odds.新,players,'小明','新'));
  assert.equal(r.payoutCents,33000);
});

test('本命年赔率与退水按农历换年切换，混合生肖和重复份数分别累计',t=>{
  t.mock.method(Date,'now',()=>Date.parse('2027-02-07T12:00:00+08:00'));
  for(const [businessDate,animal,other] of [['2026-02-16','蛇','马'],['2026-02-17','马','蛇'],['2027-02-06','羊','马']]) {
    const document=doc(`小明：平特肖${animal}${animal}${other}各100`,'year',businessDate);
    assert.deepEqual(document.issues,[]);
    const rule=ruleForDate(businessDate),numbers=[...new Set([rule.zodiac[animal][0],rule.zodiac[other][0],1,2,3,4,5,6,7,8])].slice(0,7);
    const draw={...draws.新,date:businessDate,issue:businessDate.slice(0,4)+'047',numbers},odds=defaults();
    const special={小明:override({'flat-zodiac':{specialRate:'1.5',rate:'2.2'}})},rebates={小明:{perTenThousandCents:10000,playRates:{'flat-zodiac':20000,'flat-zodiac-year':5000}}};
    const r=core.settleDocuments([document],{新:draw},odds,businessDate,{playerOdds:special,rebates});
    assert.equal(r.payoutCents,52000);assert.equal(r.rebateCents,300);
    assert.deepEqual(Object.fromEntries(r.players[0].rebateBreakdown.map(b=>[b.playKey,b.turnoverCents])),{'flat-zodiac-year':20000,'flat-zodiac':10000});
  }
});

test('本命年退水留空继承平特肖，填0只关闭本命年退水，中奖与未中奖均算流水',()=>{
  const documents=[doc('小明：平特肖马鼠各100')],odds=defaults();
  for(const [special,expected] of [[undefined,400],[0,200],[5000,250]]) {
    const playRates={'flat-zodiac':20000,...(special===undefined?{}:{'flat-zodiac-year':special})};
    const r=core.settleDocuments(documents,draws,odds,date,{rebates:{小明:{perTenThousandCents:10000,playRates}}});
    assert.equal(r.rebateCents,expected);assert.equal(r.players[0].turnoverCents,20000);
    const card=ledgerReceipt({document:{id:'a'},result:r,inputs:{kind:'current',selection:'a',documents,draws,date,settings:{odds}}});
    if(special)assert(card.rebateRows.some(row=>row.name==='平特肖（本命年）'&&row.rebateCents===50));
  }
  const pending=core.settleDocuments(documents,{},odds,date,{rebates:{小明:{perTenThousandCents:10000}}});assert.equal(pending.rebateCents,0);
});

test('退水按所选开奖日期识别本命年，拆行舍入与混合一行合计一致',()=>{
  const odds=defaults(),rebates={小明:{perTenThousandCents:10000,playRates:{'flat-zodiac':20000,'flat-zodiac-year':5000}}};
  const options={rebates,drawDates:{新:date}};
  const combined=core.settleDocuments([doc('小明：平特肖马蛇各0.17','a','2026-02-16')],draws,odds,'2026-02-16',options);
  const split=core.settleDocuments([doc('小明：平特肖马各0.17\n平特肖蛇各0.17','a','2026-02-16')],draws,odds,'2026-02-16',options);
  assert.equal(combined.rebateCents,split.rebateCents);
  assert.equal(combined.players[0].rebateBreakdown.find(r=>r.playKey==='flat-zodiac-year').perTenThousandCents,5000);
  assert.equal(combined.players[0].rebateBreakdown.reduce((n,r)=>n+r.rebateCents,0),combined.rebateCents);
});

test('字段合并保护其他玩家和市场，清空恢复继承，相同字段冲突拒绝',()=>{
  const before={小明:playerOddsDraft(playerOdds.小明)},after=structuredClone(before),latest=structuredClone(playerOdds);
  after.小明.新['flat-zodiac'].specialRate='1.7';latest.小明.markets.港={rates:{'special-number':{rate:'45'}}};
  latest.张三=override({'special-number':{rate:'44'}});
  const merged=mergePlayerOddsEdits(playerOdds,latest,before,after);
  assert.equal(merged.小明.markets.新.rates['flat-zodiac'].rate,'2.2');assert.equal(merged.小明.markets.新.rates['flat-zodiac'].specialRate,'1.7');
  assert.deepEqual(merged.小明.markets.港,latest.小明.markets.港);assert.deepEqual(merged.张三,latest.张三);
  latest.小明.markets.新.rates['flat-zodiac'].specialRate='1.8';assert.throws(()=>mergePlayerOddsEdits(playerOdds,latest,before,after),/其他页面修改/);
  after.小明.新['special-number'].rate='';after.小明.新['flat-zodiac'].rate='';after.小明.新['flat-zodiac'].specialRate='';
  assert.deepEqual(mergePlayerOddsEdits(playerOdds,playerOdds,before,after),{});
  for(const id of ['__proto__','constructor','toString']) {
    const before=Object.fromEntries([[id,playerOddsDraft()]]),after=structuredClone(before);after[id].新['special-number'].rate='45';
    assert.equal(mergePlayerOddsEdits({}, {},before,after)[id].markets.新.rates['special-number'].rate,'45');
  }
});

test('拒绝非法赔率、市场和档位，允许留空继承',()=>{
  for(const rate of ['0','-1','10001','2.12345','abc',Infinity])assert.throws(()=>validatePlayerOdds({小明:override({'flat-zodiac':{rate}})}));
  assert.throws(()=>validatePlayerOdds({小明:override({'special-number':{specialRate:'2'}})}));
  assert.throws(()=>validatePlayerOdds({小明:override({'unknown':{rate:'2'}})}));
  assert.throws(()=>validatePlayerOdds({小明:override({'flat-zodiac':{rate:'2'}},'不存在')}));
  assert.deepEqual(validatePlayerOdds({小明:override({'flat-zodiac':{rate:'',specialRate:''}})}),{});
});

test('SQLite保存、重启和旧请求兼容；历史保留原玩家赔率与赔付',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-player-odds-'));let store=new SettlementStore(dir,core,drawCore);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const settings=store.saveSettings({...store.settings(),odds:defaults(),playerOdds}),documents=[doc('小明：49各10')];
  const input={documents,draws,settings,date,kind:'current',selection:'a',verification:{新:{confirmed:true}}};
  const saved=store.saveSettlement(input,hash(input));assert.equal(saved.result.payoutCents,40000);
  store.saveSettings({...settings,playerOdds:{小明:override({'special-number':{rate:'41'}})}});
  const legacy=store.settings();delete legacy.playerOdds;store.saveSettings(legacy);
  assert.equal(store.getSettlement(saved.id).result.payoutCents,40000);assert.equal(store.getSettlement(saved.id).inputs.settings.playerOdds.小明.markets.新.rates['special-number'].rate,'40');
  store.close();store=new SettlementStore(dir,core,drawCore);assert.equal(store.settings().playerOdds.小明.markets.新.rates['special-number'].rate,'41');
});

test('浏览器空间隔离、真实预览使用玩家赔率，改变后拒绝旧预览',async t=>{
  const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};t.after(()=>delete globalThis.localStorage);
  const documents=[{id:'a',name:'小明',text:'小明：49各10',businessDate:date}],a=browserSettlement(()=>documents),b=browserSettlement(()=>documents,'b');
  await a.manual(draws.新);const loaded=await a.load({date});await a.settings({...loaded.settings,odds:defaults(),playerOdds});
  const input={date,kind:'current',activeId:'a',drawIds:{新:loaded.draws.新[0].id}},p=await a.preview(input);
  assert.equal(p.result.payoutCents,40000);assert.deepEqual((await b.load({date})).settings.playerOdds,{});
  await a.settings({...p.settings,playerOdds:{}});await assert.rejects(()=>a.save({...input,inputHash:p.inputHash,reviewed:true}),/发生变化/);
});
