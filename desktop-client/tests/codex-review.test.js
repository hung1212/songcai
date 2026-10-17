import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';
import {codexRequest,codexArguments} from '../electron/codex-review.cjs';
import installAI,{validateSettings} from '../electron/ai-review-service.cjs';

test('默认本机Codex无需密钥；显式自定义API保留原校验',()=>{
 const local=validateSettings({});assert.equal(local.transport,'codex');assert.equal(local.enabled,true);assert.equal(local.endpoint,'');assert.equal(validateSettings({transport:'codex',consent:false}).consent,true);
 assert.throws(()=>validateSettings({transport:'api',enabled:true,endpoint:'https://example.test/chat',model:'',consent:true}),/完整/);
 const args=codexArguments('/tmp/work','/tmp/schema','/tmp/result');assert(args.includes('--ephemeral'));assert(args.includes('read-only'));assert(args.includes('features.shell_tool=false'));assert(args.includes('features.plugins=false'));assert(args.includes('web_search="disabled"'));assert(!args.includes('--dangerously-bypass-approvals-and-sandbox'));assert(!args.includes('--model'));
});
test('Codex子进程通过stdin接收数据，无shell拼接，临时输出会清理',async()=>{
 let directory,received='';
 const spawnProcess=(command,args,options)=>{
  assert.equal(options.shell,false);assert.equal(command,process.execPath);assert(!args.some(a=>a.includes('$(touch')));directory=options.cwd;
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};
  child.stdin.end=prompt=>{received=prompt;fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({ok:true}));queueMicrotask(()=>{child.stdout.emit('data',Buffer.from('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":4}}\n'));child.emit('close',0);});};return child;
 };
 const reply=await codexRequest({codexPath:process.execPath,connectionTest:true},[{role:'user',content:'$(touch /tmp/nope) is data'}],{spawnProcess});
 assert.equal(reply.result.ok,true);assert.equal(reply.usage.inputTokens,10);assert(received.includes('$(touch /tmp/nope)'));assert.equal(fs.existsSync(directory),false);
});
test('停止和超时终止Codex，不把空响应当成成功',async()=>{
 for(const abort of [false,true]){
  const controller=new AbortController();let killed=0;
  const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>{if(abort)setTimeout(()=>controller.abort(),5);};child.kill=()=>{killed++;queueMicrotask(()=>child.emit('close',null));};return child;};
  const keepAlive=setTimeout(()=>{},1000);
  try{await assert.rejects(codexRequest({codexPath:process.execPath},[],{spawnProcess,signal:controller.signal,timeoutMs:20}),abort?/停止/:/超时/);assert.equal(killed,1);}finally{clearTimeout(keepAlive);}
 }
});
test('默认Codex核验完整前缀，计入请求上限并缓存，不走自定义API',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'songcai-codex-service-')),webContents={};let calls=0;
 const service=await installAI({electron:{app:{getPath:()=>directory},ipcMain:{handle(){}},safeStorage:{}},window:()=>({webContents}),fetcher:()=>{throw new Error('不应调用API');},codexRunner:async(settings,messages,{onAttempt})=>{
  onAttempt();calls++;assert.equal(settings.transport,'codex');const data=JSON.parse(messages[1].content);assert.equal(data.items[0].body,'旧 四肖中特：龙牛狗蛇200');assert(!JSON.stringify(data).includes('秘密玩家'));
  return {result:{items:[{line:1,candidates:[{bets:[{markets:['旧'],play:'4肖中特',selection:'龙牛狗蛇',basis:'整项',amount:'200',evidence:{market:'旧',play:'四肖中特',selection:'龙牛狗蛇',amount:'200'}}]}]}]},usage:{inputTokens:50,outputTokens:30}};
 }});
 t.after(()=>{service.close();fs.rmSync(directory,{recursive:true,force:true});});
 const doc={id:'test',name:'测试',text:'秘密玩家：旧 四肖中特：龙牛狗蛇200',businessDate:'2026-10-06',defaultPlayer:''};
 const first=await service.handlers.review({document:doc,mode:'all'});assert.equal(first.status,'completed');assert.equal(first.items[0].status,'agree');assert.equal(first.items[0].candidates[0].totalCents,20000);assert.equal(service.handlers.load().usage.requests,1);
 assert.equal((await service.handlers.review({document:doc,mode:'all'})).cached,true);assert.equal(calls,1);
});
