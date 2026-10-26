import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseDocument,summarize} from '../src/core/parser.js';
import * as core from '../src/core/settlement.js';
import * as drawCore from '../src/core/draws.js';
import {TWO_NUMBER_SPECIAL_RATE as key,TWO_NUMBER_SPECIAL_TOGGLE as toggle,withOptionalOdds} from '../src/core/odds.js';
import {validatePlayerOdds,effectivePlayerOdds,playerOddsDraft,mergePlayerOddsEdits,validatePlayerOddsSettings} from '../src/core/player-odds.js';
import {ledgerReceipt,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {winningLineMarks,payoutTierLabel} from '../src/core/winning-display.js';
import {ledgerOverview} from '../src/core/ledger-overview.js';
import {SettlementStore,hash} from '../electron/settlement-store.cjs';
import {browserSettlement} from '../src/settlement-preview.js';
const date='2026-10-21';
const draw={id:'draw',market:'新',date,issue:'2026294',numbers:[1,2,3,4,5,6,49],sourceId:'manual'};
const odds=(enabled=false,rate='')=>{const o=core.defaultOdds();o.confirmed=true;o[toggle]=enabled;o.rates[key].rate=rate;return o;};
const markets=o=>Object.fromEntries(['新','旧','港'].map(m=>[m,structuredClone(o)]));
const doc=(text='二中二1 2 49各10',name='小明',id=name)=>{const p=parseDocument(text,{id,name,businessDate:date});assert.deepEqual(p.issues,[]);return p;};
const settle=(text,o=odds())=>core.settleBet(doc(text).bets[0],draw,o);
const player=(enabled,rate,market='新')=>({小明:{name:'小明',markets:{[market]:{[toggle]:enabled,rates:rate===undefined?{}:{[key]:{rate}}}}}});

test('默认和旧设置均关闭，填赔率不代表开启，原二中二赔付不变',()=>{
  const old=odds();delete old[toggle];delete old.rates[key];
  for(const o of [old,odds(),odds(false,'20')]){
    assert.equal(settle('二中二1 49各10',o).payoutCents,0);
    assert.equal(settle('二中二1 2各10',o).payoutCents,60000);
  }
  assert.equal(core.validateOdds(old)[toggle],false);
  assert.deepEqual(withOptionalOdds(old).rates[key],{rate:'',specialRate:''});
  assert(!Object.hasOwn(old,toggle));
});

test('正码加特码按独立赔率，另一个号码未开出不中奖',()=>{
  const o=odds(true,'20');
  assert.equal(settle('二中二1 49各10',o).payoutCents,20000);
  assert.equal(settle('二中二1 2各10',o).payoutCents,60000);
  for(const text of ['二中二9 49各10','二中二1 9各10','二中二8 9各10'])assert.equal(settle(text,o).status,'lost');
  assert.equal(settle('二中二1 49各10',o).tiers[0].key,key);
});

test('复式两档分别累计，49个号码全包与独立枚举相符，不重复计中奖或投注',()=>{
  const o=odds(true,'20'),mixed=settle('二中二1 2 49各10',o);
  assert.deepEqual(mixed.tiers.map(t=>[t.key,t.count,t.payoutCents]),[['linked-number-2-2',1,60000],[key,2,40000]]);
  assert.equal(mixed.winCount,3);assert.equal(mixed.winningStakeCents,3000);assert.equal(mixed.payoutCents,100000);
  const text='二中二 '+Array.from({length:49},(_,i)=>i+1).join(' ')+'各1';
  const b=doc(text).bets[0],r=core.settleBet(b,draw,o);
  let normal=0,special=0;
  for(let a=1;a<=49;a++)for(let b=a+1;b<=49;b++){
    if(draw.numbers.slice(0,6).includes(a)&&draw.numbers.slice(0,6).includes(b))normal++;
    else if((a===49&&draw.numbers.slice(0,6).includes(b))||(b===49&&draw.numbers.slice(0,6).includes(a)))special++;
  }
  assert.equal(b.count,1176);assert.equal(b.totalCents,117600);
  assert.equal(r.winCount,normal+special);assert.equal(r.payoutCents,(normal*60+special*20)*100);
  assert.deepEqual([normal,special],[15,6]);
});

test('互拖仅计跨侧组合，明确重复组保留份数',()=>{
  const o=odds(true,'20'),p=doc('二中二1 2拖3 49各10'),r=core.settleBet(p.bets[0],draw,o);
  assert.equal(p.bets[0].count,4);assert.equal(r.winCount,4);assert.equal(r.payoutCents,160000);
  const repeated=settle('二中二(1 49)(1 49)各10',o);assert.equal(repeated.winCount,2);assert.equal(repeated.payoutCents,40000);
});

test('新增档位与特串和二中特赔率独立，开关不改变它们',()=>{
  for(const enabled of [false,true]){
    const o=odds(enabled,'20');o.rates['two-special'].rate='35';o.rates['two-normal'].rate='25';
    assert.equal(settle('特串1 49各10',o).payoutCents,150000);
    assert.equal(settle('二中特1 49各10',o).payoutCents,35000);
    assert.equal(settle('二中特1 2各10',o).payoutCents,25000);
  }
});

test('独立档位沿用本金口径和逐份分位舍入',()=>{
  const o=odds(true,'1.005');
  assert.equal(settle('二中二(1 49)(2 49)各1',o).payoutCents,202);
  o.includePrincipal=false;assert.equal(settle('二中二(1 49)(2 49)各1',o).payoutCents,402);
});

test('开启必须有有效赔率，非法开关和不完整有效配置保持待结算',()=>{
  assert.throws(()=>core.validateOdds(odds(true)),/请填写对应赔率/);
  assert.equal(settle('二中二1 49各10',odds(true)).status,'pending');
  for(const flag of ['true',1,null,{}])assert.throws(()=>core.validateOdds({...odds(),[toggle]:flag}),/开关/);
  for(const rate of ['0','-1','NaN','20.12345','10001'])assert.throws(()=>core.validateOdds(odds(true,rate)),/赔率/);
  assert.throws(()=>validatePlayerOddsSettings(markets(odds()),player(true)),/小明.*请填写对应赔率/);
  validatePlayerOddsSettings(markets(odds()),player(true,'20'));
});

test('玩家可覆盖开关及赔率，按账目名和市场生效，继承最新默认',()=>{
  const defaults=markets(odds()),players=player(true,'25'),documents=[doc('三边二中二1 49各10'),doc('小明：二中二1 49各10','张三')];
  const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{...draw,market:m}]));
  let r=core.settleDocuments(documents,draws,defaults,date,{playerOdds:players});
  assert.deepEqual(r.entries.map(e=>e.payoutCents),[25000,0,0,0]);
  defaults.新=odds(true,'20');
  r=core.settleDocuments(documents,draws,defaults,date,{playerOdds:player(false)});
  assert.deepEqual(r.entries.map(e=>e.payoutCents),[0,0,0,20000]);
  assert.equal(effectivePlayerOdds(defaults.新,{},'小明','新')[toggle],true);
  assert.deepEqual(validatePlayerOdds(player(false)),player(false));
  const rateOnly={小明:{markets:{新:{rates:{[key]:{rate:'25'}}}}}};
  assert.equal(core.settleDocuments([doc('二中二1 49各10')],{新:draw},markets(odds()),date,{playerOdds:rateOnly}).payoutCents,0);
  assert.equal(core.settleDocuments([doc('二中二1 49各10')],{新:draw},defaults,date,{playerOdds:rateOnly}).payoutCents,25000);
});

test('开关草稿三态合并，保留并发修改其他字段，冲突拒绝，恢复继承可删除独立配置',()=>{
  const original=player(false),before={小明:playerOddsDraft(original.小明)},after=structuredClone(before),latest=structuredClone(original);
  assert.equal(before.小明.新[key].enabled,false);assert.equal(before.小明.旧[key].enabled,'');
  after.小明.新[key].enabled=true;latest.小明.markets.新.rates[key]={rate:'25'};
  const merged=mergePlayerOddsEdits(original,latest,before,after);
  assert.equal(merged.小明.markets.新[toggle],true);assert.equal(merged.小明.markets.新.rates[key].rate,'25');
  const without=structuredClone(original);delete without.小明.markets.新[toggle];
  assert.throws(()=>mergePlayerOddsEdits(original,without,before,after),/其他页面修改/);
  after.小明.新[key].enabled='';assert.deepEqual(mergePlayerOddsEdits(original,original,before,after),{});
  for(const id of ['__proto__','constructor']){
    const before=Object.fromEntries([[id,playerOddsDraft()]]),after=structuredClone(before);after[id].新[key].enabled=false;
    assert.equal(mergePlayerOddsEdits({}, {},before,after)[id].markets.新[toggle],false);
  }
});

test('汇总、高亮、结算单分开两档；退水仍按二中二实际流水只计一次',()=>{
  const p=doc(),defaults=markets(odds()),players=player(true,'20'),rebates={小明:{perTenThousandCents:0,playRates:{'linked-number-2-2':100000}}};
  const result=core.settleDocuments([p],{新:draw},defaults,date,{playerOdds:players,rebates});
  assert(result.complete);assert.equal(result.stakeCents,summarize([p]).totalCents);assert.equal(result.stakeCents,3000);
  assert.equal(result.rebateCents,300);assert.equal(result.payableCents,100300);
  assert.equal(result.players[0].rebateBreakdown[0].playKey,'linked-number-2-2');
  const inputs={kind:'current',selection:p.id,documents:[p],draws:{新:draw},date,settings:{odds:defaults,playerOdds:players,rebates},verification:{新:{confirmed:true}}};
  const card=ledgerReceipt({document:p,result,inputs});
  assert.equal(card.rows.length,2);assert.equal(card.rows.find(r=>r.detail==='正码＋特码').payoutCents,40000);
  assert.deepEqual(card.rows.map(r=>r.stakeCents),[1000,2000]);
  assert(receiptSvg(receiptPages(card)[0]).svg.includes('正码＋特码'));
  assert.equal(ledgerOverview([p],{新:draw},inputs.settings,inputs.verification).payoutCents,100000);
  const marks=winningLineMarks(p,result);assert(marks[1]);
  assert.equal(payoutTierLabel(result.entries[0].tiers[1]),'正码＋特码');
});

test('SQLite旧设置无写入补默认，保存开关及个人配置，历史金额和开关不随修改变化',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-two-number-'));let store=new SettlementStore(dir,core,drawCore);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const legacy=store.settings();for(const o of Object.values(legacy.odds)){delete o[toggle];delete o.rates[key];}
  store.db.prepare('UPDATE settings SET payload=? WHERE id=1').run(JSON.stringify(legacy));
  const before=store.db.prepare('SELECT payload FROM settings').get().payload;
  const loaded=store.settings();assert.equal(loaded.odds.新[toggle],false);assert.equal(loaded.odds.新.rates[key].rate,'');
  assert.equal(store.db.prepare('SELECT payload FROM settings').get().payload,before);
  const saved=store.saveSettings({...loaded,odds:markets(odds()),playerOdds:player(true,'20')});
  const input={documents:[doc()],draws:{新:draw},settings:saved,date,kind:'current',selection:'小明',verification:{新:{confirmed:true}}};
  const record=store.saveSettlement(input,hash(input));assert.equal(record.result.payoutCents,100000);
  const changed=store.saveSettings({...store.settings(),playerOdds:player(false)});
  assert.equal(store.getSettlement(record.id).result.payoutCents,100000);
  assert.equal(store.getSettlement(record.id).inputs.settings.playerOdds.小明.markets.新[toggle],true);
  assert.throws(()=>store.saveSettings({...changed,playerOdds:player(true)}),/请填写对应赔率/);
  assert.equal(store.settings().revision,changed.revision);
  store.close();store=new SettlementStore(dir,core,drawCore);assert.equal(store.settings().playerOdds.小明.markets.新[toggle],false);
});

test('浏览器旧设置、空间隔离与新开关保存，设置变化后旧结算预览失效',async t=>{
  const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};t.after(()=>delete globalThis.localStorage);
  const legacy=markets(odds());for(const o of Object.values(legacy)){delete o[toggle];delete o.rates[key];}
  memory.set('songcai.settlement.preview.v1',JSON.stringify({settings:{revision:0,sources:drawCore.DEFAULT_DRAW_SOURCES,odds:legacy},draws:[],history:[]}));
  const documents=[{id:'小明',name:'小明',businessDate:date,text:'二中二1 2 49各10'}];
  const api=browserSettlement(()=>documents),other=browserSettlement(()=>documents,'other');
  await api.manual(draw);let loaded=await api.load({date});assert.equal(loaded.settings.odds.新[toggle],false);
  await api.settings({...loaded.settings,playerOdds:player(true,'20')});
  const input={date,kind:'current',activeId:'小明',drawIds:{新:loaded.draws.新[0].id}};
  const preview=await api.preview(input);assert.equal(preview.result.payoutCents,100000);
  const otherSettings=(await other.load({date})).settings;assert.equal(otherSettings.odds.新[toggle],false);assert.deepEqual(otherSettings.playerOdds,{});
  await assert.rejects(()=>api.settings({...preview.settings,playerOdds:player(true)}),/请填写对应赔率/);
  assert.equal((await api.load({date})).settings.revision,preview.settings.revision);
  await api.settings({...preview.settings,playerOdds:{}});
  await assert.rejects(()=>api.save({...input,inputHash:preview.inputHash,reviewed:true}),/发生变化/);
});
