import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../src/core/settlement.js';
import { verifyDraws } from '../src/core/draw-verification.js';
import * as drawCore from '../src/core/draws.js';
import { parseDocument } from '../src/core/parser.js';
import { SettlementStore, hash } from '../electron/settlement-store.cjs';
import { fetchJson } from '../electron/settlement-service.cjs';
const date='2026-10-04';
const draw={id:'fixture-draw',market:'新',issue:'2026277',date,numbers:[1,2,3,4,5,6,49],sourceId:'manual'};
const odds=()=>{const o=core.defaultOdds();o.confirmed=true;o.refund49={attribute:true,sixZodiac:true,halfWave:false};o.rates['three-two'].rate='20';o.rates['three-three'].rate='90';o.rates['two-normal'].rate='25';o.rates['two-special'].rate='50';return o;};
const bet=text=>{const p=parseDocument(`测试玩家：新 ${text}`,{businessDate:date,id:'fixture'});assert.equal(p.issues.filter(i=>i.severity!=='warning').length,0,JSON.stringify(p.issues));return p.bets[0];};
const settle=(text,numbers=draw.numbers,o=odds())=>core.settleBet(bet(text),{...draw,numbers},o);
for(const [text,numbers,payout,wins] of [
  ['特码49各100',draw.numbers,470000,1], ['特码01各100',draw.numbers,0,0],
  ['特码49 49各100',draw.numbers,940000,2],
  ['特肖马各100',draw.numbers,90000,1], ['特肖蛇各100',[1,3,4,5,6,7,2],117000,1],
  ['二肖中特马蛇100',draw.numbers,50000,1], ['二肖中特蛇牛100',[1,3,4,5,6,7,2],56000,1],
  ['红波100',[3,4,5,6,9,10,1],27000,1], ['红波各100',[3,4,5,6,9,10,1],470000,1],
  ['红单100',[3,4,5,6,9,10,1],55000,1], ['蓝大100',[1,2,3,4,5,6,25],50000,1],
  ['平码01 49各100',draw.numbers,70000,1], ['平特号码01 49各100',draw.numbers,140000,2],
  ['平特马各100',draw.numbers,18000,1], ['平特蛇各100',draw.numbers,20500,1],
  ['平尾0各100',[10,20,30,40,1,2,49],20500,1], ['平尾1各100',[1,11,21,31,41,2,49],18000,1],
  ['二连肖马蛇各100',draw.numbers,38000,1], ['二连肖牛虎各100',draw.numbers,40000,1],
  ['二连尾1 9各100',draw.numbers,30000,1],
  ['三中三01 02 03各100',draw.numbers,6500000,1], ['二中二01 02各100',draw.numbers,600000,1],
  ['三中二01 02 20各100',draw.numbers,200000,1], ['三中二01 02 03各100',draw.numbers,900000,1],
  ['二中特01 02各100',draw.numbers,250000,1], ['二中特01 49各100',draw.numbers,500000,1],
  ['特串01 49各100',draw.numbers,1500000,1], ['特串01 02各100',draw.numbers,0,0],
  ['三粒任中01 20 30各100',draw.numbers,25000,1], ['三粒任中01 02 49各100',draw.numbers,25000,1],
  ['五不中10 11 12 13 14各100',draw.numbers,20000,1], ['五不中10 11 12 13 49各100',draw.numbers,0,0],
])test(`赔付核算 ${text} => ${payout/100}`,()=>{const r=settle(text,numbers);assert.notEqual(r.status,'pending',r.note);assert.equal(r.payoutCents,payout);assert.equal(r.winCount,wins);});
test('49和局只用于已配置玩法，逐号投注不受独立分类和局影响',()=>{
  for(const text of ['大100','单100','合单100','六肖中特马蛇牛虎鼠兔100']) {const r=settle(text);assert.equal(r.status,'refund');assert.equal(r.payoutCents,10000);}
  const pending=core.defaultOdds();assert.equal(settle('大100',draw.numbers,pending).payoutCents,null);
  assert.equal(settle('大各100').payoutCents,470000);
  pending.refund49.attribute=false;assert.equal(settle('大100',draw.numbers,pending).payoutCents,19000);
});
test('含本、净赔率与逐份分位舍入准确，不用浮点金额累计',()=>{
  const o=odds();o.includePrincipal=false;assert.equal(settle('红波100',[3,4,5,6,9,10,1],o).payoutCents,37000);
  o.includePrincipal=true;o.rates['special-number'].rate='1.005';assert.equal(settle('49 49各1',draw.numbers,o).payoutCents,202);
  o.rates['special-number'].rate='10000';const b=bet('49各100');b.unitCents=Number.MAX_SAFE_INTEGER;b.perMarketCents=b.unitCents;assert.equal(core.settleBet(b,draw,o).status,'pending');
});
test('复式与显式逐组枚举的赔付一致，不枚举巨量组合',()=>{
  const combos=(pool,k)=>{const out=[];const go=(left,g)=>{if(g.length===k){out.push(g);return;}for(let i=0;i<left.length;i++)go(left.slice(i+1),[...g,left[i]]);};go(pool,[]);return out;};
  for(const [play,pool,k] of [['三中二',[1,2,3,10,49],3],['二中特',[1,2,10,49],2],['三粒任中',[1,2,10,11,49],3],['五不中',[1,10,11,12,13,14,15],5],['三连肖',[...'马蛇牛鼠猪'],3],['三连尾',[0,1,2,3,9],3]]) {
    const combined=settle(`${play}复式 ${pool.join(' ')}各1`);
    const explicit=settle(`${play} ${combos(pool,k).map(g=>'('+g.join(' ')+')').join('')}各1`);
    assert.notEqual(combined.status,'pending',combined.note);assert.equal(combined.payoutCents,explicit.payoutCents,play);assert.equal(combined.winCount,explicit.winCount,play);
  }
  const large=settle('十不中 '+Array.from({length:49},(_,i)=>i+1).join(' ')+'各0.01');assert.notEqual(large.status,'pending');assert(large.winCount>1_000_000);
});
test('未配置赔率、未归属、日期市场不符及缺少支持均保持待结算',()=>{
  assert.equal(settle('三中二01 02 03各100',draw.numbers,core.defaultOdds()).payoutCents,null);
  assert.equal(settle('四中四01 02 03 04各100').payoutCents,null);
  assert.equal(core.settleBet({...bet('49各100'),assigned:false},draw,odds()).payoutCents,null);
  assert.equal(core.settleBet(bet('49各100'),{...draw,market:'旧'},odds()).payoutCents,null);
  assert.equal(core.settleBet(bet('49各100'),{...draw,date:'2026-10-03'},odds()).payoutCents,null);
});
test('生肖中奖判断与有当年生肖赔率在农历新年切换',()=>{
  for(const [d,a] of [['2026-02-16','蛇'],['2026-02-17','马'],['2027-02-06','羊']]){
    const p=parseDocument(`小明：特肖${a}100`,{businessDate:d}).bets[0];
    const r=core.settleBet(p,{...draw,date:d,issue:d.slice(0,4)+'047'},odds(),Date.parse(d+'T23:00:00+08:00'));assert.equal(r.payoutCents,90000);
  }
});
test('多市场分别结算，同一玩家各市场赔付汇总，缺开奖不记为0已结算',()=>{
  const documents=[parseDocument('小明：三边49各100\n张三：新01各50',{businessDate:date,id:'a'})];
  const settings=Object.fromEntries(['新','旧','港'].map(m=>[m,odds()]));
  const data=core.settleDocuments(documents,{新:draw,旧:{...draw,market:'旧',numbers:[2,3,4,5,6,49,1]}},settings,date);
  assert.equal(data.stakeCents,35000);assert.equal(data.payoutCents,470000);assert.equal(data.pending,1);assert.equal(data.complete,false);
  assert.equal(data.players[0].markets.港.pending,1);assert.equal(data.entries.find(e=>e.market==='港').payoutCents,null);
});
test('原文期号不一致、原文解析错误阻止整体完成',()=>{
  const settings={新:odds()};const p=parseDocument('小明：第276期49各100',{businessDate:date});
  assert.equal(core.settleDocuments([p],{新:draw},settings,date).entries[0].status,'pending');
  const broken=parseDocument('小明：49各100\n特码99各10',{businessDate:date});
  const r=core.settleDocuments([broken],{新:draw},settings,date);assert.equal(r.complete,false);assert(r.issues.length);
});
test('开奖导入拒绝重复号、缺号、未来与错误日期；保留正确顺序和特码',()=>{
  for(const numbers of [[1,2,3,4,5,6,6],[1,2,3],[1,2,3,4,5,6,50]])assert.throws(()=>drawCore.validateDraw({...draw,numbers}));
  assert.throws(()=>drawCore.validateDraw({...draw,date:'2026-02-30'}));
  assert.throws(()=>drawCore.validateDraw({...draw,date:'2026-10-06'},Date.parse('2026-10-05T09:00:00+08:00')));
  assert.deepEqual(drawCore.validateDraw({...draw,numbers:'41 23 14 31 13 32 + 11'}).numbers,[41,23,14,31,13,32,11]);
});
test('真实公开接口格式按频道校验，丢弃异常数据，空列表不当成功',()=>{
  const source=drawCore.drawSource('macaujc-new','新');
  const row={type:'8',expect:'2026277',openTime:'2026-10-04 21:32:32',openCode:'41,23,14,31,13,32,11'};
  const r=drawCore.decodeDraws({code:200,data:[row,{...row,type:'7'}]},source,'新',2026);
  assert.equal(r.records.length,1);assert.equal(r.rejected.length,1);assert.equal(r.records[0].openedAt,'2026-10-04T21:32:32+08:00');
  assert.throws(()=>drawCore.decodeDraws({code:200,data:[]},source,'新',2026));
  assert.throws(()=>drawCore.drawSource('hkjc','旧'));
  const hk=drawCore.drawSource('hkjc','港');const data={data:{lotteryDraws:[{year:2026,no:87,drawDate:'2026-10-04',drawResult:{drawnNo:[1,2,3,4,5,6],xDrawnNo:7}}]}};
  assert.equal(drawCore.decodeDraws(data,hk,'港',2026).records[0].issue,'2026087');
});
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-settlement-'));const store=new SettlementStore(dir,core,drawCore);t.after(()=>{try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});return {store,dir};}
test('SQLite开奖重复导入不新增，同一期更正保留旧版；原子拒绝非法批次',t=>{
  const {store}=setup(t);assert.equal(store.addDraws([draw]).added,1);assert.equal(store.addDraws([draw]).added,0);
  store.addDraws([{...draw,numbers:[2,3,4,5,6,49,1]}]);assert.equal(store.listDraws('新',2026).length,2);
  assert.throws(()=>store.addDraws([{...draw,issue:'2026276'}, {...draw,numbers:[]} ]));assert.equal(store.listDraws('新',2026).length,2);
});
test('赔率保存版本保护、快照防重复与更正保留、拒绝旧预览及未确认配置',t=>{
  const {store,dir}=setup(t);const settings=store.settings();settings.odds.新=odds();const saved=store.saveSettings(settings);assert.throws(()=>store.saveSettings(settings),/已更新/);
  const p=parseDocument('小明：49各100',{businessDate:date,id:'a'});const inputs={documents:[p],draws:{新:draw},settings:saved,date,kind:'current',selection:'a'};
  assert.throws(()=>store.saveSettlement(inputs,'wrong'),/已经变化/);
  const check=verifyDraws({新:[draw]},saved,date,{新:draw.id});inputs.verification=verifyDraws({新:[draw]},saved,date,{新:draw.id},{新:{drawId:draw.id,reviewKey:check.新.reviewKey}});
  const first=store.saveSettlement(inputs,hash(inputs));assert.equal(first.result.payoutCents,470000);assert.equal(first.paid,false);
  assert.equal(store.saveSettlement(inputs,hash(inputs)).reused,true);assert.equal(store.history(date).length,1);
  const next=structuredClone(inputs);next.settings.odds.新.rates['special-number'].rate='48';const second=store.saveSettlement(next,hash(next));assert.equal(second.result.payoutCents,480000);assert.equal(store.history(date).length,2);assert.equal(store.getSettlement(first.id).result.payoutCents,470000);
  next.settings.odds.新.confirmed=false;assert.throws(()=>store.saveSettlement(next,hash(next)),/尚未确认/);
  store.close();const reopened=new SettlementStore(dir,core,drawCore);assert.equal(reopened.history(date).length,2);assert.equal(reopened.getSettlement(first.id).inputHash,first.inputHash);reopened.close();
});
test('网络读取处理失败、非JSON和过大响应，不关闭TLS验证或跟随任意重定向',async()=>{
  const request={url:'https://example.test/data',method:'GET'};
  assert.deepEqual(await fetchJson(request,async(_url,options)=>{assert.equal(options.redirect,'error');return new Response('{"data":[]}');}),{data:[]});
  await assert.rejects(fetchJson(request,async()=>new Response('unavailable',{status:503})),/503/);
  await assert.rejects(fetchJson(request,async()=>new Response('<html>')),/JSON/);
  await assert.rejects(fetchJson(request,async()=>new Response('a',{headers:{'content-length':'5000001'}})),/过大/);
});
test('赔付服务通过真实SQLite与IPC隔离市场、收件箱及账目，并拒绝过期预览',async t=>{
  const {default:install}=await import('../electron/settlement-service.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-settlement-ipc-'));const handlers=new Map(),sender={};
  let text='小明：新11各100元';const fetcher=async url=>{
    if(url.includes('hkjc'))throw new Error('网络不可用');
    return new Response(JSON.stringify({code:200,data:[{type:'8',expect:'2026277',openTime:'2026-10-04 21:32:32',openCode:'41,23,14,31,13,32,11'}]}));
  };
  const service=await install({electron:{app:{getPath:()=>dir},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}},window:()=>({webContents:sender}),ledger:{read:()=>({documents:[{id:'a',name:'账目A',text,businessDate:date,defaultPlayer:''}]})},inbox:{settlementDocuments:()=>[parseDocument('微信玩家：新11各50',{businessDate:date,id:'inbox-1'})]},fetcher});
  t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
  const call=(name,input)=>handlers.get('settlement:'+name)({sender},input);
  const first=await call('load',{date});first.settings.sources={新:['macaujc-new'],旧:[],港:['hkjc']};first.settings.odds.新.confirmed=true;await call('settings',first.settings);
  const inProgress=call('sync',{date});assert.throws(()=>call('preview',{date,kind:'current',activeId:'a'}),/正在同步/);
  assert.throws(()=>call('save',{date,kind:'current',activeId:'a',reviewed:true}),/正在同步/);
  const reports=await inProgress;assert.equal(reports[0].ok,true);assert.equal(reports[1].ok,false);
  const loaded=await call('load',{date});const d=loaded.draws.新[0];assert.equal(d.numbers[6],11);assert.equal(loaded.draws.旧.length,0);
  const input={date,kind:'current',activeId:'a',drawIds:{新:d.id}};
  const p=await call('preview',input);assert.equal(p.result.payoutCents,470000);
  text='小明：新11各200元';assert.throws(()=>call('save',{...input,inputHash:p.inputHash,reviewed:true}),/已经变化/);
  input.decisions={新:{drawId:d.id,reviewKey:p.inputs.verification.新.reviewKey}};
  const current=await call('preview',input);const saved=await call('save',{...input,inputHash:current.inputHash,reviewed:true});assert.equal(saved.inputs.documents[0].originalText,text);
  const inbox=await call('preview',{...input,kind:'inbox'});assert.equal(inbox.result.payoutCents,235000);assert.equal(inbox.result.players[0].name,'微信玩家');
  assert.throws(()=>handlers.get('settlement:load')({sender:{}},{date}),/未知窗口/);
});

test('中奖数据按当前账目隔离，未署名可结算，历史带账目归属',async t=>{
 const {default:install}=await import('../electron/settlement-service.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-ledger-winning-')),handlers=new Map(),sender={};
 const documents=[{id:'a',name:'甲账目',text:'11各20',businessDate:date},{id:'b',name:'乙账目',text:'11各30',businessDate:date}];
 const service=await install({electron:{app:{getPath:()=>dir},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}},window:()=>({webContents:sender}),ledger:{read:()=>({documents})},inbox:{settlementDocuments:()=>[]}});
 t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
 const call=(name,input)=>handlers.get('settlement:'+name)({sender},input);
 const cfg=call('load',{date}).settings;cfg.odds.新.confirmed=true;call('settings',cfg);
 call('manual',{market:'新',issue:'2026277',date,numbers:[41,23,14,31,13,32,11]});
 const d=call('load',{date}).draws.新[0];
 for(const [activeId,payout] of [['a',94000],['b',141000]]){
  const input={date,kind:'current',activeId,drawIds:{新:d.id}};
  let trial=call('preview',input);assert.equal(trial.result.payoutCents,payout);assert.equal(trial.inputs.documents.length,1);
  input.decisions={新:{drawId:d.id,reviewKey:trial.inputs.verification.新.reviewKey}};
  trial=call('preview',input);const saved=call('save',{...input,inputHash:trial.inputHash,reviewed:true});
  assert.equal(saved.inputs.selection,activeId);assert.equal(saved.result.players.length,1);
 }
 const history=call('load',{date}).history;assert.equal(history.filter(h=>h.selection==='a').length,1);assert.equal(history.filter(h=>h.selection==='b').length,1);
 const input={date,kind:'current',activeId:'a',drawIds:{新:d.id}};const prior=call('preview',input);documents[1].text='11各1000';assert.equal(call('preview',input).inputHash,prior.inputHash);
 documents[0].text='11各50';assert.throws(()=>call('save',{...input,inputHash:prior.inputHash,reviewed:true}),/已经变化/);
});
