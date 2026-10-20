import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../src/core/settlement.js';
import * as drawCore from '../src/core/draws.js';
import {parseDocument} from '../src/core/parser.js';
import {validateRebates,settlementPlayers,receiptRebateSummary,rebateRateLabel} from '../src/core/rebates.js';
import {rebatePlayKey} from '../src/core/rebate-plays.js';
import {rebateDraft,mergeRebateEdits} from '../src/core/rebate-edits.js';
import {ledgerOverview} from '../src/core/ledger-overview.js';
import {ledgerReceipt,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {SettlementStore,hash} from '../electron/settlement-store.cjs';
import installSettlement from '../electron/settlement-service.cjs';
import {browserSettlement} from '../src/settlement-preview.js';
const date='2026-10-05',parse=(text,id='a')=>parseDocument(text,{id,name:'小明',businessDate:date});
const draw={market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,49],sourceId:'manual'};
const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,{...core.defaultOdds(),confirmed:true}]));
const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{...draw,market:m}]));
const calculate=(docs,rebates,d=draws)=>core.settleDocuments(docs,d,odds,date,{rebates});
const config={小明:{perTenThousandCents:10000,playRates:{'special-number':5000,'flat-zodiac':20000,'linked-number-3-3':0}}};

test('同玩家各玩法使用独立退水，未覆盖跟随默认，覆盖0不退水；其他玩家不受影响',()=>{
  const docs=[parse('小明：20各10000\n平特肖龙各5000\n二中二1 2各2000\n三中三1 2 3各3000'),{...parse('张三：20各10000','b'),name:'张三'}];
  assert.deepEqual(docs[0].issues,[]);
  const r=calculate(docs,config),p=r.players.find(p=>p.id==='小明');
  assert.equal(p.rebateCents,17000);assert.equal(p.turnoverCents,2000000);assert.equal(r.players.find(p=>p.id==='张三').rebateCents,0);
  assert.deepEqual(Object.fromEntries(p.rebateBreakdown.map(r=>[r.playKey,[r.perTenThousandCents,r.rebateCents]])),{'special-number':[5000,5000],'flat-zodiac':[20000,10000],'linked-number-2-2':[10000,2000],'linked-number-3-3':[0,0]});
  assert.equal(r.payableCents,r.payoutCents+17000);assert.equal(p.netCents,p.payoutCents+17000-p.stakeCents);assert.equal(rebateRateLabel(p),'按玩法设置');
  const overview=ledgerOverview(docs,draws,{odds,rebates:config},{});assert.equal(overview.rebateCents,r.rebateCents);assert.equal(overview.payableCents,r.payableCents);
});

test('二连肖与三连肖、各粒任中、特肖与多肖中特、平码与平特号码分别设置',()=>{
  const p=parse('小明：二连肖马蛇各10\n三连肖马蛇龙各20\n平特任中一：44/75\n二粒任中44 45各30\n特肖马10\n二肖中特马蛇20\n平码01各10\n平特号码01各20');
  assert.deepEqual(p.issues,[]);
  assert.deepEqual(p.bets.map(rebatePlayKey),['linked-zodiac-2','linked-zodiac-3','flat-any-1','flat-any-2','special-zodiac','special-zodiac-any-2','flat-number','flat-seven-number']);
  assert.equal(rebatePlayKey({playType:'special-zodiac-any',size:1}),'special-zodiac');
  const rates=Object.fromEntries(p.bets.map((b,i)=>[rebatePlayKey(b),(i+1)*10000]));
  const r=calculate([p],{小明:{perTenThousandCents:0,playRates:rates}});
  assert.equal(r.complete,true);assert.equal(r.rebateCents,795);assert.equal(r.players[0].rebateBreakdown.length,8);
});

test('默认为0也可仅退某玩法；截图仅纳入退水玩法流水，不误显示为统一退水',()=>{
  const doc=parse('小明：20各10000\n平特肖龙各5000');
  const rebates={小明:{perTenThousandCents:0,playRates:{'flat-zodiac':20000}}},result=calculate([doc],rebates);
  const summary=receiptRebateSummary(result.players);assert.deepEqual(summary,{hasRebate:true,turnoverCents:500000,rate:'2%'});
  const card=ledgerReceipt({document:{id:'a'},result,inputs:{kind:'current',selection:'a',date,documents:[doc],draws,settings:{odds,rebates},verification:{新:{confirmed:true}}}});
  assert.equal(card.rebateCents,10000);assert.equal(card.hasRebate,true);
  const svg=receiptSvg(receiptPages(card)[0]).svg;assert(svg.includes('有效流水 5,000 · 2%'));assert(svg.includes('应付合计'));
  assert.equal(receiptRebateSummary(calculate([doc],config).players).rate,'多档退水率');
});

test('按账目汇总加权退水后只舍入一次，市场和玩法明细守恒，拆行不改变退水',()=>{
  const rates={小明:{perTenThousandCents:10000,playRates:{'flat-zodiac':20000}}};
  const a=parse('小明：三边20各0.17\n三边平特肖鼠各0.17'),b=parse('小明：三边20各0.17','b');
  const r=calculate([a,b],rates),parts=[a,b].map(p=>calculate([p],rates));
  assert.equal(r.rebateCents,3);assert.equal(r.rebateCents,parts.reduce((n,p)=>n+p.rebateCents,0));
  const p=r.players[0];assert.equal(p.rebateCents,Object.values(p.markets).reduce((n,g)=>n+g.rebateCents,0));assert.equal(p.rebateCents,p.rebateBreakdown.reduce((n,g)=>n+g.rebateCents,0));
  const split=calculate([parse('小明：三边20各0.1\n20各0.07\n三边平特肖鼠各0.17')],rates);
  assert.equal(split.rebateCents,parts[0].rebateCents);
});

test('未结算与退本金不计玩法流水；退款玩法配置不影响其他项目',()=>{
  const settings=structuredClone(odds);settings.新.refund49.attribute=true;
  const r=core.settleDocuments([parse('小明：新大100\n20各100\n旧平特肖鼠100')],{新:draw},settings,date,{rebates:{小明:{perTenThousandCents:0,playRates:{attribute:10000,'special-number':20000,'flat-zodiac':30000}}}});
  assert.equal(r.turnoverCents,10000);assert.equal(r.rebateCents,200);assert.equal(r.refundCents,10000);assert.equal(r.complete,false);assert.equal(r.players[0].netCents,null);
  assert.deepEqual(r.players[0].rebateBreakdown.map(r=>r.playKey),['special-number']);
});

test('校验玩法键、金额精度和边界，显式0不能被当作未设置删除',()=>{
  assert.deepEqual(validateRebates({p:{perTenThousandCents:0,playRates:{'special-number':0}}}),{p:{perTenThousandCents:0,playRates:{'special-number':0}}});
  for(const playRates of [{unknown:10},{'special-number':-1},{'special-number':0.1},{'special-number':1000001},[],null]) {
    if(playRates===null)continue;
    assert.throws(()=>validateRebates({p:{perTenThousandCents:0,playRates}}));
  }
  assert.equal(validateRebates({p:{perTenThousandCents:0,playRates:{'flat-zodiac':1000000}}}).p.playRates['flat-zodiac'],1000000);
});

test('玩家名册包括空账目标题，忽略默认署名；同名账目沿用同一配置',()=>{
  const empty=[{...parse('','a'),name:'甲'},{...parse('','b'),name:'乙',defaultPlayer:'小明'}];
  assert.deepEqual(settlementPlayers(empty,{includeEmpty:true}).map(p=>p.id),['甲','乙']);
  assert.deepEqual(settlementPlayers(empty),[]);
  const config={小明:{perTenThousandCents:0,playRates:{'flat-zodiac':10000}}};
  const a=parse('平特肖鼠100','a'),b={...parse('平特肖鼠100','b'),name:a.name};
  assert.deepEqual(calculate([a,b],config).players.map(p=>p.rebateCents),[200]);
});

test('只合并编辑过的字段，保留其他玩家与玩法改动，冲突拒绝而不覆盖',()=>{
  const original={小明:{perTenThousandCents:10000,playRates:{'special-number':5000}}};
  const before={小明:rebateDraft(original.小明)},after=structuredClone(before);after.小明.plays['flat-zodiac']='200';
  const latest=structuredClone(original);latest.小明.perTenThousandCents=30000;latest.张三={perTenThousandCents:40000};
  const merged=mergeRebateEdits(original,latest,before,after,{小明:'小明'});
  assert.equal(merged.小明.perTenThousandCents,30000);assert.equal(merged.小明.playRates['special-number'],5000);assert.equal(merged.小明.playRates['flat-zodiac'],20000);assert.deepEqual(merged.张三,latest.张三);
  latest.小明.playRates['flat-zodiac']=60000;assert.throws(()=>mergeRebateEdits(original,latest,before,after),/其他页面修改/);
  after.小明.plays['flat-zodiac']='1.001';assert.throws(()=>mergeRebateEdits(original,original,before,after));
});

test('清空覆盖恢复默认，填0关闭玩法退水，危险名称不污染对象',()=>{
  const original={小明:{perTenThousandCents:10000,playRates:{'special-number':5000}}},before={小明:rebateDraft(original.小明)},after=structuredClone(before);
  after.小明.plays['special-number']='';assert.equal(mergeRebateEdits(original,original,before,after).小明.playRates,undefined);
  after.小明.plays['special-number']='0';assert.equal(mergeRebateEdits(original,original,before,after).小明.playRates['special-number'],0);
  for(const id of ['__proto__','constructor','toString']) {
    const before=Object.fromEntries([[id,rebateDraft()]]),after=Object.fromEntries([[id,{default:'0',plays:{'special-number':'100'}}]]);
    const r=mergeRebateEdits({}, {},before,after,Object.fromEntries([[id,id]]));assert.equal(r[id].playRates['special-number'],10000);
    assert.equal(calculate([{...parse(`${id}：20各100`),name:id}],r).rebateCents,100);
  }
  assert.equal({}.playRates,undefined);
});

test('玩法退水SQLite重启保留，旧配置兼容，已保存快照不跟随新配置改变',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-play-rebates-'));let store=new SettlementStore(dir,core,drawCore);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const settings=store.saveSettings({...store.settings(),odds,rebates:config}),documents=[parse('小明：20各10000\n平特肖龙各5000')];
  const input={documents,draws,settings,date,kind:'current',selection:'a',verification:Object.fromEntries(['新','旧','港'].map(m=>[m,{confirmed:true}]))};
  const saved=store.saveSettlement(input,hash(input));assert.equal(saved.result.rebateCents,15000);
  store.saveSettings({...settings,rebates:{小明:{perTenThousandCents:0}}});assert.equal(store.getSettlement(saved.id).result.rebateCents,15000);assert.equal(store.getSettlement(saved.id).inputs.settings.rebates.小明.playRates['flat-zodiac'],20000);
  store.saveSettings({...store.settings(),rebates:config});store.close();store=new SettlementStore(dir,core,drawCore);assert.deepEqual(store.settings().rebates,config);
});

test('浏览器玩法退水按空间保存，退水变更令旧预览失效',async t=>{
  const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};t.after(()=>delete globalThis.localStorage);
  const documents=[{id:'a',name:'小明',text:'小明：20各10000\n平特肖龙各5000',businessDate:date}];
  const a=browserSettlement(()=>documents),b=browserSettlement(()=>documents,'second');await a.manual(draw);
  const data=await a.load({date}),input={date,kind:'current',activeId:'a',drawIds:{新:data.draws.新[0].id}},before=await a.preview(input);
  await a.settings({...data.settings,rebates:config});const after=await a.preview(input);assert.equal(after.result.rebateCents,15000);assert.notEqual(before.inputHash,after.inputHash);assert.deepEqual((await b.load({date})).settings.rebates,{});
  await assert.rejects(a.save({...input,inputHash:before.inputHash,reviewed:true}),/变化/);
});

test('统一退水名册包含不同日期的已入账微信玩家，沿用现有身份',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-rebate-players-')),handlers=new Map(),sender={};
  const service=await installSettlement({electron:{app:{getPath:()=>dir},ipcMain:{handle:(n,f)=>handlers.set(n,f)},net:{fetch:()=>{throw new Error('unexpected network');}}},window:()=>({webContents:sender}),ledger:{read:()=>({documents:[]})},inbox:{settlementDocuments:day=>{assert.equal(day,'');return [{...parse('微信玩家：20各100','inbox-a'),name:'微信玩家'},{...parse('另一天玩家：20各100','inbox-b'),name:'另一天玩家'}];}}});
  t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
  assert.deepEqual(handlers.get('settlement:players')({sender}).map(p=>p.id),['微信玩家','另一天玩家']);assert.throws(()=>handlers.get('settlement:players')({sender:{}}),/未知窗口/);
});
