import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import * as ledgerCore from '../src/core/ledger.js';
import {LedgerStore} from '../electron/ledger-store.cjs';
import {parseDocument,summarize} from '../src/core/parser.js';
import {parseDocument as legacyParse} from '../src/core/legacy/parser-v044.js';
import {upgradeDocument,upgradeProject,upgradeComparison,reviewSettlement} from '../src/core/parser-upgrade.js';
import {PARSER_VERSION} from '../src/core/business-syntax.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {manualDraw} from '../src/core/draws.js';
const doc=(extra={})=>({id:'a',name:'旧 四肖中特',autoTitle:true,text:'旧 四肖中特：龙牛狗蛇200',businessDate:'2026-10-05',defaultPlayer:'',...extra});
test('旧账自动采用当前解释；修改原文继续计算，无须确认升级',()=>{
 let d=upgradeDocument(doc());assert.equal(d.name,'旧 四肖中特');assert.equal(d.autoTitle,false);
 const review=upgradeComparison(d);assert.equal(review.before.totalCents,320000);assert.equal(review.after.totalCents,20000);assert(review.changes[0].changedFields.includes('markets'));assert.equal(summarize([parseDocument(d.text,d)]).totalCents,20000);
 assert.equal(d.parserReview.status,'automatic');assert.equal(upgradeDocument(d),d);
 d.text+='\n1各100';assert.equal(summarize([parseDocument(d.text,d)]).totalCents,30000);
 assert.equal(d.parserReview.original.text,doc().text);
});
test('无变化不打扰；玩家或市场纠正自动应用，原解释仅留档',()=>{
 assert.equal(upgradeDocument(doc({name:'小明',text:'小明：旧1各100'})).parserReview,undefined);
 assert(upgradeDocument(doc({text:'四肖中特：龙牛狗蛇0.01'})).parserReview);
});
test('SQLite升级固定ID和标题，不发生同名覆盖，原文和旧解释重启保留',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-upgrade-'));const store=new LedgerStore(root,ledgerCore);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 store.setMeta('legacy-migrated','1');store.setMeta('revision','3');store.setMeta('active-id','a');
 const insert=store.db.prepare('INSERT INTO ledger_documents(id,title,original_text,business_date,default_player,auto_title,position,updated_at) VALUES(?,?,?,?,?,?,?,?)');
 for(const [i,d] of [doc(),doc({id:'b',name:'未命名账目',text:'1各100'})].entries())insert.run(d.id,d.name,d.text,d.businessDate,'',1,i,'2026-10-05');
 let p=store.read();assert.equal(p.documents.length,2);assert.deepEqual(p.documents.map(d=>d.name),['旧 四肖中特','未命名账目']);assert.equal(p.storageRevision,4);assert.equal(p.documents[0].parserReview.before.totalCents,320000);assert.deepEqual(store.read(),p);
 assert.equal(p.documents[0].parserReview.status,'automatic');
 p.documents[0].text+='\n2各100';p=store.write(p);assert.deepEqual(store.read(),p);assert.equal(p.documents[0].parserReview.original.text,doc().text);
});
for(const status of ['pending','accepted'])test(`0.4.5的${status}升级记录自动迁移且不丢原文与历史`,()=>{
 const d=upgradeDocument(doc());d.parserVersion='parser-20261006-1';d.parserReview.status=status;d.parserReview.toVersion=d.parserVersion;
 if(status==='accepted'){d.parserReview.acceptedAt='2026-10-06T00:00:00Z';d.parserReview.acceptedKey='old-key';}
 const before=JSON.stringify(d);const loaded=upgradeProject(ledgerCore.validateProject({schemaVersion:1,documents:[d],activeId:d.id}));
 const next=loaded.documents[0];assert.equal(next.parserVersion,PARSER_VERSION);assert.equal(next.parserReview.status,'automatic');
 assert.deepEqual(next.parserReview.before,d.parserReview.before);assert.deepEqual(next.parserReview.original,d.parserReview.original);
 assert.equal(next.parserReview.acceptedAt,d.parserReview.acceptedAt);assert.equal(JSON.stringify(d),before);
 assert.equal(summarize([parseDocument(d.text,d)]).totalCents,20000); // Even an unmigrated record never blocks parsing.
 assert.equal(upgradeProject(loaded),loaded);
});
test('升级截图三行直接算600，真正的玩法冲突只影响对应行',()=>{
 const d=upgradeDocument(doc({text:'新澳奥 四肖中特：龙牛狗蛇200\n奥 四肖中特 龙牛狗蛇200\n30.42各100.'}));
 let p=parseDocument(d.text,d);assert.equal(summarize([p]).totalCents,60000);assert.equal(p.issues.length,0);assert.equal(new Set(p.bets.map(b=>b.playerId)).size,1);
 d.text+='\n特肖三中三1 2 100';p=parseDocument(d.text,d);assert.equal(summarize([p]).totalCents,60000);assert(p.issues.some(i=>i.line===4&&i.code==='PLAY_CONFLICT'));assert(!p.issues.some(i=>i.code==='PARSER_UPGRADE'));
});
test('SQLite已保存的待升级状态重启后自动计账，二次读取不重复写库',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-pending-'));let store=new LedgerStore(root,ledgerCore);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 const d=upgradeDocument(doc());d.parserVersion='parser-20261006-1';d.parserReview.status='pending';d.parserReview.toVersion=d.parserVersion;
 const saved=store.write({schemaVersion:1,documents:[d],activeId:d.id,storageRevision:0});store.close();store=new LedgerStore(root,ledgerCore);
 const loaded=store.read();assert.equal(loaded.storageRevision,saved.storageRevision+1);assert.equal(loaded.documents[0].parserReview.status,'automatic');assert.equal(summarize([parseDocument(loaded.documents[0].text,loaded.documents[0])]).totalCents,20000);assert.deepEqual(store.read(),loaded);
});
test('旧赔付只附加差异，使用快照的开奖和赔率，不覆写保存的金额',()=>{
 const original=doc({name:'账目',text:'新 四肖中特：龙牛狗蛇200'});const parsed={...legacyParse(original.text,original),originalText:original.text};
 const draw=manualDraw({market:'新',issue:'2026278',date:original.businessDate,numbers:[1,2,3,4,6,7,9],sourceName:'固定测试'}),odds=Object.fromEntries(['新','旧','港'].map(m=>[m,defaultOdds()]));
 const snapshot={inputs:{documents:[parsed],draws:{新:draw},settings:{odds},date:original.businessDate},result:settleDocuments([parsed],{新:draw},odds,original.businessDate)};const frozen=JSON.stringify(snapshot);
 const r=reviewSettlement(snapshot);assert.equal(r.required,true);assert.equal(r.beforeStakeCents,320000);assert.equal(r.afterStakeCents,20000);assert.equal(r.beforePayoutCents,940000);assert.equal(r.afterPayoutCents,56000);assert.equal(JSON.stringify(snapshot),frozen);
});
