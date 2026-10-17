import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { compareDraws, normalizedIssue, verifyDraws } from '../src/core/draw-verification.js';
import * as draws from '../src/core/draws.js';
import * as settlement from '../src/core/settlement.js';
import { parseDocument } from '../src/core/parser.js';
import { SettlementStore, hash } from '../electron/settlement-store.cjs';
import { fetchJson } from '../electron/settlement-service.cjs';
const date='2026-10-04';
const numbers=[7,12,49,19,23,8,48];
const record=(id,sourceId='lamlhc-old',extra={})=>({id,sourceId,sourceName:sourceId,sourceUrl:'',market:'旧',date,issue:'2026277',numbers:[...numbers],observedAt:'2026-10-05T08:00:00Z',...extra});
const options={market:'旧',date,selectedId:'a',sourceIds:['lamlhc-old','pengsai-old','liucai-old']};
const config=()=>({sources:structuredClone(draws.DEFAULT_DRAW_SOURCES),odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...settlement.defaultOdds(),confirmed:true}]))});
test('同一期正码排序不同视为一致；独立来源组去重',()=>{
  const data=[record('a'),record('b','pengsai-old',{numbers:[8,7,12,23,19,49,48]}),record('c','liucai-old')];
  const c=compareDraws(data,options);assert.equal(c.status,'consistent');assert.equal(c.providers.length,2);assert(c.records.every(r=>r.matchesSelected));
  const sameUpstream=compareDraws(data.slice(1),{...options,selectedId:'b'});assert.equal(sameUpstream.status,'single');assert.equal(sameUpstream.providers.length,1);
});
test('同一网站重复或人工抄录不能增加交叉核对数',()=>{
  const c=compareDraws([record('a'),record('b'),record('c','manual'),record('d','manual-aa1396')],options);
  assert.equal(c.status,'single');assert.equal(c.providers.length,1);
});
test('特码与正码对调是冲突，少数不同也不自动采用多数',()=>{
  const data=[record('a'),record('b','pengsai-old'),record('c','liucai-old',{numbers:[7,12,49,19,23,48,8]})];
  let result=verifyDraws({旧:data},config(),date,{旧:'a'});assert.equal(result.旧.status,'conflict');assert.equal(result.旧.confirmed,false);
  result=verifyDraws({旧:data},config(),date,{旧:'a'},{旧:{drawId:'a',reviewKey:result.旧.reviewKey}});
  assert.equal(result.旧.confirmed,true);assert.equal(result.旧.method,'user');assert.equal(result.旧.records.filter(r=>!r.matchesSelected).length,1);
});
test('取消勾选不同结果的网站仍显示已知冲突',()=>{
  const c=compareDraws([record('a'),record('b','pengsai-old',{numbers:[1,12,49,19,23,8,48]})],{...options,sourceIds:['lamlhc-old']});
  assert.equal(c.status,'conflict');assert.equal(c.records.find(r=>r.id==='b').enabled,false);
});
test('不同市场不同期号不混比；同一期日期不同保留差异',()=>{
  let c=compareDraws([record('a'),record('b','pengsai-old',{issue:'2026276'}),record('c','pengsai-old',{market:'新'})],options);
  assert.equal(c.status,'single');assert.equal(c.records.length,2);assert.equal(c.records.find(r=>r.id==='b').sameIssue,false);
  c=compareDraws([record('a'),record('b','pengsai-old',{date:'2026-10-03'})],options);
  assert.equal(c.status,'conflict');assert.equal(c.records.find(r=>r.id==='b').sameDate,false);
  assert.equal(normalizedIssue('26/105','2026-10-03'),normalizedIssue('2026105','2026-10-03'));
});
test('用户决定绑定具体证据，新增更正或改变结果后需要重新选择',()=>{
  const data=[record('a')], settings=config();let r=verifyDraws({旧:data},settings,date,{旧:'a'});
  const decision={旧:{drawId:'a',reviewKey:r.旧.reviewKey}};
  assert(verifyDraws({旧:data},settings,date,{旧:'a'},decision).旧.confirmed);
  assert(!verifyDraws({旧:[...data,record('b','pengsai-old',{numbers:[1,12,49,19,23,8,48]})]},settings,date,{旧:'a'},decision).旧.confirmed);
  assert(!verifyDraws({旧:data},settings,date,{旧:''},decision).旧.confirmed);
});
test('读取失败与缺期状态明确保留，不冒充没有冲突即核对成功',()=>{
  const c=compareDraws([record('a')],{...options,reports:[{market:'旧',sourceId:'lamlhc-old',ok:false,message:'连接失败',checkedAt:'2026-10-05T09:00:00Z'},{market:'旧',sourceId:'pengsai-old',ok:true,message:'已读取其他期号'}]});
  assert.equal(c.status,'single');assert.equal(c.sourceStates[0].state,'failed');assert.equal(c.sourceStates[0].found,true);
  assert.equal(c.sourceStates[1].state,'missing');assert.equal(c.sourceStates[2].state,'unchecked');
});
test('错误旧频道保留查看但不能采用，也不混入正确旧频道冲突',()=>{
  const data=[record('a'),record('b','pengsai-old'),record('wrong','macaujc-normal',{numbers:[45,1,4,34,13,11,36]})];
  assert.equal(compareDraws(data,options).status,'consistent');
  const v=verifyDraws({旧:data},config(),date,{旧:'wrong'});assert.equal(v.旧.confirmed,false);assert(v.旧.records.find(d=>d.id==='wrong').excluded);
  assert.throws(()=>draws.normalizeSources({旧:['macaujc-normal']}),/不符/);
});
test('lamlhc页面只提取旧频道数字，不执行脚本或采用网页生肖',()=>{
  const html='<script>window.__NUXT__={mchkl:{results:[{openCode:"07,12,49,19,23,08,48",issue:"2026277",openTime:"2026-10-04 21:35:27"}]},nhkl:{results:[]}};throw new Error("不可执行");</script>';
  const r=draws.decodeDraws(html,draws.drawSource('lamlhc-old','旧'),'旧',2026);
  assert.deepEqual(r.records[0].numbers,numbers);assert.equal(r.records[0].date,date);
  assert.throws(()=>draws.decodeDraws('<html>格式变更</html>',draws.drawSource('lamlhc-old','旧'),'旧',2026),/结构/);
});
test('彭赛按明确频道解析，缺日期历史不自行推算或跨市场回退',()=>{
  const data={oldMacau:{latest:{expect:'2026277',openCode:numbers.join(','),openTime:'2026-10-04 21:35:27'},history:['2026276|1,2,3,4,5,6,7']}};
  const r=draws.decodeDraws(data,draws.drawSource('pengsai-old','旧'),'旧',2026);assert.equal(r.records.length,1);
  assert.throws(()=>draws.decodeDraws(data,draws.drawSource('pengsai-hk','港'),'港',2026),/该市场/);
});
test('香港官方使用完整公开查询，排序后的正码与第三方开奖顺序一致',()=>{
  const source=draws.drawSource('hkjc','港'),request=draws.drawRequest(source,2026),body=JSON.parse(request.body);
  assert.equal(body.operationName,'marksixResult');assert.equal(body.variables.lastNDraw,30);assert.match(body.query,/lotteryDrawsFragment/);assert.match(body.query,/lotteryPool/);
  const payload={data:{lotteryDraws:[{id:'2026105N',year:'2026',no:105,drawDate:'2026-10-03+08:00',status:'Result',drawResult:{drawnNo:[8,23,29,31,34,43],xDrawnNo:48}}]}};
  const official=draws.decodeDraws(payload,source,'港',2026).records[0];
  const c=compareDraws([{...official,id:'official'},{...official,id:'other',sourceId:'1234-hk',numbers:[31,23,34,43,29,8,48]}],{market:'港',date:'2026-10-03',selectedId:'official',sourceIds:['hkjc','1234-hk']});
  assert.equal(c.status,'consistent');assert.equal(c.issue,'2026105');assert.equal(c.providers.length,2);
});
test('1234按网页年度历史读取，支持数组和期号字典，拒绝错误频道及异常行',async()=>{
  const source=draws.drawSource('1234-hk','港'),request=draws.drawRequest(source,2026);
  assert.equal(request.url,'https://www.1234kj.tv/api/HistoryOpenInfo');assert.equal(request.body,'lotteryId=2034&issueNum=2026');
  const row={lotteryId:2034,issue:2026105,openCode:'31,23,34,43,29,08,48',openTime:'2026-10-03 21:30:00'};
  const payload=await fetchJson(request,async(_url,options)=>{assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded; charset=UTF-8');return new Response(JSON.stringify({code:0,data:[row]}));});
  assert.deepEqual(draws.decodeDraws(payload,source,'港',2026).records[0].numbers,[31,23,34,43,29,8,48]);
  assert.equal(draws.decodeDraws({code:0,data:{2026105:row}},source,'港',2026).records.length,1);
  const mixed=draws.decodeDraws({code:0,data:[row,null,{...row,lotteryId:2032}]},source,'港',2026);assert.equal(mixed.records.length,1);assert.equal(mixed.rejected.length,2);
  assert.throws(()=>draws.decodeDraws({code:1,data:[row]},source,'港',2026),/失败状态/);
  assert.throws(()=>draws.decodeDraws({code:0,data:{message:row}},source,'港',2026),/列表/);
});
test('aa1396人工录入不可伪装自动网络来源，来源链接限定目录',()=>{
  const r=draws.manualDraw({sourceId:'hkjc',sourceUrl:'https://invalid.test',referenceId:'aa1396',sourceName:'官方'});
  assert.equal(r.sourceId,'manual-aa1396');assert.equal(r.sourceUrl,'https://aa1396.vip/');assert.match(r.sourceName,/人工录入/);
  assert.throws(()=>draws.manualDraw({referenceId:'unknown'}),/未知/);
});
test('旧版单来源配置自动升级、多选持久化，保留赔率和历史',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-multisource-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let store=new SettlementStore(dir,settlement,draws);const odds=config().odds;odds.旧.rates['special-number'].rate='48';store.close();
  const db=new DatabaseSync(path.join(dir,'settlement.sqlite'));db.prepare('UPDATE settings SET revision=7,payload=?').run(JSON.stringify({sources:{新:'macaujc-new',旧:'macaujc-normal',港:'hkjc'},odds}));db.close();
  store=new SettlementStore(dir,settlement,draws);const s=store.settings();assert.equal(s.revision,8);assert.deepEqual(s.sources.旧,draws.DEFAULT_DRAW_SOURCES.旧);assert.equal(s.odds.旧.rates['special-number'].rate,'48');
  store.saveFetchReport({market:'旧',sourceId:'lamlhc-old',ok:false,message:'连接失败'},2026);store.close();
  store=new SettlementStore(dir,settlement,draws);assert.equal(store.settings().revision,8);assert.equal(store.fetchReports(2026)[0].ok,false);store.close();
});
test('保存含冲突来源与用户选择；未确认或新增证据导致旧试算不能保存',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-multisource-save-'));const store=new SettlementStore(dir,settlement,draws);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const settings=config(),records=[record('a'),record('b','pengsai-old',{numbers:[1,12,49,19,23,8,48]})];
  const input={documents:[parseDocument('测试玩家：旧48各100',{businessDate:date,id:'a'})],draws:{旧:records[0]},settings,date,kind:'current',selection:'a',verification:verifyDraws({旧:records},settings,date,{旧:'a'})};
  assert.throws(()=>store.saveSettlement(input,hash(input)),/多站核对/);
  input.verification=verifyDraws({旧:records},settings,date,{旧:'a'},{旧:{drawId:'a',reviewKey:input.verification.旧.reviewKey}});
  const saved=store.saveSettlement(input,hash(input));assert.equal(saved.result.payoutCents,470000);assert.equal(saved.inputs.verification.旧.records.length,2);assert.equal(saved.inputs.verification.旧.method,'user');
  const before=hash(input);input.verification=verifyDraws({旧:[...records,record('c','manual')]},settings,date,{旧:'a'});
  assert.throws(()=>store.saveSettlement(input,before),/已经变化/);
  assert.equal(store.getSettlement(saved.id).inputs.verification.旧.records.length,2);
});
