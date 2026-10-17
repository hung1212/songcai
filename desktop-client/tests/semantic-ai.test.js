import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseDocument, summarize} from '../src/core/parser.js';
import {normalizeFinancial} from '../src/core/semantic-rules.js';
import {assistanceFor,documentReviewKey,reviewInput,validateCandidate,validateReply,decideReview,decideReviewGroup} from '../src/core/ai-review.js';
import {createBatch,updateBatch,inspectBatch} from '../src/core/inbox.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import installAI,{chatRequest,validateSettings} from '../electron/ai-review-service.cjs';
import createLedger from '../electron/ledger-store.cjs';
const date='2026-10-05';
const doc=(text,extra={})=>({id:'d',name:'测试账目',text,businessDate:date,defaultPlayer:'',...extra});
const parse=(text,extra={})=>parseDocument(text,doc(text,extra));
const candidate=(changes={})=>({bets:[{markets:['新'],play:'特码',selection:'牛鼠',basis:'每号',amount:'15',evidence:{market:'新奥',play:'数',selection:'牛鼠',amount:'十五'},...changes}],explanation:'逐号投注'});
const response=items=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({items})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}}));
function lineItem(d,line=1){return reviewInput(d,'all').items.find(i=>i.line===line);}
async function harness(t,fetcher){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-ai-'));const handlers=new Map(),webContents={};
 const service=await installAI({electron:{app:{getPath:()=>dir},ipcMain:{handle:(n,f)=>handlers.set(n,f)},safeStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from('protected:'+v),decryptString:v=>v.toString().slice(10)}},window:()=>({webContents}),fetcher});
 t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
 const call=(n,value)=>handlers.get('ai:'+n)({sender:webContents},value);
 const setup=extra=>call('configure',{enabled:true,mode:'doubt',endpoint:'https://ai.example.test/v1/chat/completions',model:'fixture',apiKey:'test-secret',consent:true,...extra});
 return {service,call,setup,dir,handlers};
}
for(const [text,cents,type] of [
 ['新奥，牛鼠数各十五',12000,'special-number'],['平特牛各十\n牛鼠数各十五',13000,'special-number'],['二连肖牛鼠各十\n牛鼠数字各十五',13000,'special-number'],['特肖牛鼠各十五',3000,'special-zodiac'],['牛鼠号码各壹拾伍圆',12000,'special-number'],['牛鼠各十五',12000,'special-number'],['两边牛鼠数各十五',24000,'special-number'],['红波100',10000,'wave'],['红波各100',170000,'special-number'],['天肖各100',250000,'special-number']
])test(`标准规则 ${text}`,()=>{const p=parse(text);assert.equal(p.issues.length,0,JSON.stringify(p.issues));assert.equal(summarize([p]).totalCents,cents);assert.equal(p.bets.at(-1).playType,type);assert.equal(p.bets.at(-1).raw,text.split('\n').at(-1));});
test('数只在限定语境生效；不干扰市场继承、换玩家和农历切换',()=>{
 const p=parse('小明：旧平特牛各十\n牛鼠数各十五\n张三：牛鼠数各十五');assert.deepEqual(p.bets.map(b=>b.markets),[['旧'],['旧'],['新']]);
 assert.equal(parse('特肖牛鼠数各十五').issues[0].code,'BASIS_CONFLICT');
 assert.equal(parse('三中三1 2 3各号十').issues[0].code,'BASIS_CONFLICT');
 for(const t of ['特肖牛各10元，数好了','单数各10','双数各10'])assert(!parse(t).issues.some(i=>i.code==='BASIS_CONFLICT'));
 assert.equal(summarize([parse('马数各十',{businessDate:'2026-02-16'})]).totalCents,4000);
 assert.equal(summarize([parse('马数各十',{businessDate:'2026-02-17'})]).totalCents,5000);
 assert.equal(normalizeFinancial('壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬億圓圆'),'一二二三三四五六六七八九十百千万亿元元');
 const b=parse('小明：新奥，牛鼠数各十五').bets[0];const e=b.semantic.evidence[0];assert.equal(e.source,'original');assert.equal(b.raw.slice(e.start,e.end),e.quote);
});
test('AI候选仅解释含义，由本地农历规则展开与算术计算',()=>{
 const d=doc('新奥，牛鼠数各十五'),item=lineItem(d);const c=validateCandidate(candidate(),item,d);assert.equal(c.totalCents,12000);assert.deepEqual(c.bets[0].values,[6,18,30,42,7,19,31,43]);
 const r=validateReply({items:[{line:1,candidates:[candidate()]}]},[item],d);assert.equal(r[0].status,'agree');
});
test('拒绝补金额、改明确金额、伪造市场、证据重叠及撤改指令',()=>{
 const d=doc('新奥，牛鼠数各十五'),item=lineItem(d);
 for(const changes of [{amount:'150'},{selection:'虎'},{evidence:{market:'新奥',play:'数',selection:'牛鼠',amount:'根本没有'}},{markets:['旧']},{selection:'15',evidence:{market:'新奥',play:'数',selection:'十五',amount:'十五'}}])assert.throws(()=>validateCandidate(candidate(changes),item,d));
 const missing=doc('新奥，特码15');assert.throws(()=>validateCandidate(candidate({selection:'15',amount:'15',evidence:{market:'新奥',play:'特码',selection:'15',amount:'15'}}),lineItem(missing),missing),/重叠/);
 const cancel=doc('取消新奥牛鼠数各十五');assert.throws(()=>validateCandidate(candidate(),lineItem(cancel),cancel),/撤改/);
 const unknown=doc('新奥牛鼠数各一皮');assert.throws(()=>validateCandidate(candidate({amount:'100',evidence:{market:'新奥',play:'数',selection:'牛鼠',amount:'一皮'}}),lineItem(unknown),unknown),/明确金额/);
 assert.throws(()=>validateReply({items:[{line:99,candidates:[]}]},[item],d),/行号/);
 assert.equal(validateReply({items:[]},[item],d)[0].status,'review');
});
test('核验决定保留原文，精确绑定版本并阻止争议账目完成赔付',()=>{
 const d=doc('新奥特肖牛鼠数各十五');const prepared=lineItem(d);const items=validateReply({items:[{line:1,candidates:[candidate()]}]},[prepared],d);assert.equal(items[0].status,'review');
 d.assistance=assistanceFor(d,items,'run');let p=parseDocument(d.text,d);assert(p.issues.some(i=>i.code==='AI_REVIEW'));
 d.assistance=decideReview(d,1,0);p=parseDocument(d.text,d);assert.equal(p.issues.length,0);assert.equal(summarize([p]).totalCents,12000);assert.equal(p.bets[0].raw,d.text);
 for(const changed of [{text:d.text+' '},{businessDate:'2026-10-04'},{defaultPlayer:'另一人'}]){const other={...d,...changed};assert.equal(parseDocument(other.text,other).assistance,undefined);}
 d.assistance=decideReview(d,1,'undo');p=parseDocument(d.text,d);assert.equal(settleDocuments([p],{},Object.fromEntries(['新','旧','港'].map(m=>[m,defaultOdds()])),date).complete,false);
});
test('同玩家相同上下文批量确认，玩家切换不能串组',()=>{
 const d=doc('甲：新奥特肖牛鼠数各十五\n新奥特肖牛鼠数各十五\n乙：新奥特肖牛鼠数各十五');const items=reviewInput(d,'all').items;
 d.assistance=assistanceFor(d,validateReply({items:items.map(i=>({line:i.line,candidates:[candidate()]}))},items,d));
 d.assistance=decideReviewGroup(d,1,d.assistance.items[0].candidates[0].replacement);
 assert.deepEqual(d.assistance.items.map(i=>i.status),['accepted','accepted','review']);
});
test('账目SQLite和收件箱保存解释、复用解析，修改解释重置入账核对',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-ai-ledger-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const d=doc('新奥特肖牛鼠数各十五');d.assistance=assistanceFor(d,validateReply({items:[{line:1,candidates:[candidate()]}]},[lineItem(d)],d));d.assistance=decideReview(d,1,0);
 let ledger=await createLedger(dir);let saved=ledger.write({schemaVersion:1,documents:[d],activeId:d.id,storageRevision:0});ledger.close();ledger=await createLedger(dir);assert.equal(ledger.read().documents[0].text,d.text);assert.equal(ledger.read().documents[0].assistance.items[0].status,'accepted');ledger.close();
 let batch=createBatch({...d,player:'',kind:'text'},'d');assert.equal(inspectBatch(batch).summary.totalCents,12000);batch.review.source=true;
 batch=updateBatch(batch,{assistance:decideReview(d,1,'undo'),review:batch.review});assert.equal(batch.review.source,false);assert.equal(inspectBatch(batch).eligible,false);
});
test('AI接口按匿名片段调用、缓存命中不再发请求，密钥不出现在历史',async t=>{
 const requests=[];const h=await harness(t,async(_url,options)=>{requests.push(options);const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert(!options.body.includes('秘密玩家'));return response(input.items.map(i=>({line:i.line,candidates:[candidate()]})));});
 await h.setup();const d=doc('秘密玩家：新奥牛鼠数各十五');let r=await h.call('review',{document:d,mode:'all'});assert.equal(r.status,'completed');assert.equal(r.items[0].status,'agree');
 assert.equal(requests[0].headers.Authorization,'Bearer test-secret');r=await h.call('review',{document:d,mode:'all'});assert.equal(r.cached,true);assert.equal(requests.length,1);
 assert(!JSON.stringify(h.call('load')).includes('test-secret'));assert(!JSON.stringify(h.call('history',{id:d.id})).includes('test-secret'));
 await h.call('review',{document:{...d,businessDate:'2026-10-04'},mode:'all'});assert.equal(requests.length,2);
 assert.throws(()=>h.handlers.get('ai:load')({sender:{}}),/未知窗口/);
 await h.call('configure',{...(h.call('load')).settings,endpoint:'https://different.example.test/chat'});assert.equal(h.call('load').settings.hasKey,false);
});
test('429重试也扣请求预算；断网保留本地确定项与必核项的不同状态',async t=>{
 let calls=0;const h=await harness(t,async()=>{calls++;return new Response('',{status:429});});await h.setup({dailyLimit:1});
 const d=doc('特码1各10\n特肖牛鼠数各十五');const r=await h.call('review',{document:d,mode:'all'});assert.equal(calls,1);assert.equal(h.call('load').usage.requests,1);assert.equal(r.status,'failed');
 assert.deepEqual(r.items.map(i=>i.required),[false,true]);d.assistance=assistanceFor(d,r.items,r.id);const p=parseDocument(d.text,d);assert.equal(p.bets[0].status,'parsed');assert(p.issues.some(i=>i.line===2));
});
test('关闭会取消进行中核验且不在已关闭SQLite上写入；重启保留中断历史',async t=>{
 let started;const start=new Promise(r=>started=r);const h=await harness(t,async(_url,{signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));});await h.setup();
 const pending=h.call('review',{document:doc('新奥牛鼠数各十五'),mode:'all'});await start;h.service.close();const r=await pending;assert.equal(r.status,'cancelled');
});
test('已确认完整表达按玩家和上下文复用，重新按业务日期计算号码',async t=>{
 let calls=0;const h=await harness(t,async()=>{calls++;return response([{line:1,candidates:[candidate()]}]);});await h.setup();const d=doc('甲：新奥特肖牛鼠数各十五');const r=await h.call('review',{document:d});
 d.assistance=assistanceFor(d,r.items,r.id);d.assistance=decideReview(d,1,0);await h.call('remember',{document:d,runId:r.id,line:1,candidate:0,scope:'player'});
 const next={...d,id:'d2',assistance:undefined};const remembered=await h.call('review',{document:next});assert.equal(calls,1);assert.equal(remembered.items[0].status,'accepted');
 await h.call('review',{document:{...next,id:'d3',text:next.text.replace('甲','乙')}});assert.equal(calls,2);
});
test('网络响应无效、截断、拒绝和不安全配置不自动采用',async()=>{
 assert.throws(()=>validateSettings({endpoint:'http://remote.test/a'}),/HTTPS/);assert.throws(()=>validateSettings({endpoint:'https://a.test/?key=secret'}),/密钥/);
 for(const body of ['not json',JSON.stringify({choices:[{message:{refusal:'no'}}]}),JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]})])await assert.rejects(chatRequest({endpoint:'https://test',maxTokens:256},'secret',[],{fetcher:async()=>new Response(body)}));
});
test('玩家专用表达优先于通用表达，同范围按最近确认的规则复用',async t=>{
 const special=candidate({play:'特肖',basis:'每肖',evidence:{market:'新奥',play:'特肖',selection:'牛鼠',amount:'十五'}});
 const h=await harness(t,async()=>response([{line:1,candidates:[candidate(),special]}]));await h.setup();const d=doc('甲：新奥特肖牛鼠数各十五');const run=await h.call('review',{document:d});
 d.assistance=assistanceFor(d,run.items,run.id);d.assistance=decideReview(d,1,0);await h.call('remember',{document:d,runId:run.id,line:1,candidate:0,scope:'global'});
 d.assistance=decideReview(d,1,1);await h.call('remember',{document:d,runId:run.id,line:1,candidate:1,scope:'player'});
 let result=await h.call('review',{document:{...d,id:'new-player-scope',assistance:undefined}});assert.equal(result.items[0].candidates[0].totalCents,3000);
 d.assistance=decideReview(d,1,0);await h.call('remember',{document:d,runId:run.id,line:1,candidate:0,scope:'player'});
 result=await h.call('review',{document:{...d,id:'newest-player-scope',assistance:undefined}});assert.equal(result.items[0].candidates[0].totalCents,12000);
});
