const {DatabaseSync}=require('node:sqlite');
const {createHash,randomUUID}=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const {codexRequest,findCodex,codexConfigKey}=require('./codex-review.cjs');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const DEFAULTS={enabled:true,transport:'codex',codexPath:'',mode:'doubt',endpoint:'',model:'',dailyLimit:50,maxTokens:3000,consent:true};
function validateSettings(input){
  const value={...DEFAULTS,...input,transport:input.transport||(input.endpoint?'api':'codex')};
  if(value.transport==='codex')value.consent=true;
  if(!['codex','api'].includes(value.transport))throw new Error('核验入口无效');
  value.codexPath=String(value.codexPath||'').trim();if(value.codexPath&&!path.isAbsolute(value.codexPath))throw new Error('Codex程序路径须为绝对路径');
  if(!['doubt','all'].includes(value.mode)||!Number.isInteger(value.dailyLimit)||value.dailyLimit<1||value.dailyLimit>5000||!Number.isInteger(value.maxTokens)||value.maxTokens<256||value.maxTokens>16000)throw new Error('核验模式或用量上限无效');
  value.endpoint=String(value.endpoint||'').trim();value.model=String(value.model||'').trim();
  if(value.endpoint){const u=new URL(value.endpoint);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('接口须使用HTTPS，或本机localhost地址；地址不能包含密钥');}
  if(value.enabled&&value.transport==='api'&&(!value.endpoint||!value.model||value.consent!==true))throw new Error('请填写完整接口地址和模型，并确认发送范围');
  if(value.model.length>150)throw new Error('模型名称过长');
  return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,value[k]]));
}
async function chatRequest(settings,key,messages,{fetcher,signal,onAttempt=()=>{}}={}){
  let response;
  for(let attempt=0;attempt<2;attempt++){
    signal?.throwIfAborted();onAttempt();
    response=await fetcher(settings.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(25000)]),headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model:settings.model,messages,response_format:{type:'json_object'},max_tokens:settings.maxTokens,stream:false})});
    if(![429,502,503].includes(response.status)||attempt===1)break;
    await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!response.ok){await response.body?.cancel();throw new Error(`AI接口返回HTTP ${response.status}，请检查接口、模型及密钥`);}
  if(Number(response.headers.get('content-length'))>2_000_000)throw new Error('AI响应过大');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2_000_000)throw new Error('AI响应过大');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('AI接口没有返回有效JSON');}
  const message=data.choices?.[0]?.message;
  if(message?.refusal||data.choices?.[0]?.finish_reason==='length')throw new Error('AI没有完整返回解释，请拆分内容或提高输出上限');
  if(typeof message?.content!=='string')throw new Error('AI接口不符合Chat Completions响应格式');
  let result;try{result=JSON.parse(message.content);}catch{throw new Error('AI解释不是有效JSON，未采用');}
  return {result,usage:{inputTokens:Number(data.usage?.prompt_tokens)||0,outputTokens:Number(data.usage?.completion_tokens)||0}};
}

module.exports=async function installAI({electron,window:getWindow,fetcher,codexRunner=codexRequest,startupCheck=false,spaces,directory,settingsDb,register=true}){
  if(spaces){
    let sharedSettings;
    return require('./scoped-service.cjs').scopedService({name:'ai',electron,getWindow,spaces,idleOnly:['configure'],methods:['load','configure','test','cached','review','cancel','history','remember','removeAlias'],readOnly:['load','cancel','history'],
      create:async id=>{const service=await installAI({electron,window:getWindow,fetcher,codexRunner,startupCheck,directory:spaces.dataDirectory(id),settingsDb:sharedSettings,register:false});if(id==='default')sharedSettings=service.settingsDb;return service;}});
  }
  const core=await import('../src/core/ai-review.js'),{today}=await import('../src/core/rules.js');
  directory ||= electron.app.getPath('userData');fs.mkdirSync(directory,{recursive:true});
  const db=new DatabaseSync(path.join(directory,'ai-review.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS ai_settings(id INTEGER PRIMARY KEY,payload TEXT NOT NULL,secret TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_runs(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,cache_key TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_cache ON ai_runs(cache_key);
    CREATE TABLE IF NOT EXISTS ai_usage(day TEXT PRIMARY KEY,requests INTEGER NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_aliases(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_fragments(document_id TEXT NOT NULL,cache_key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(document_id,cache_key));
    CREATE TABLE IF NOT EXISTS ai_generations(document_id TEXT PRIMARY KEY,generation INTEGER NOT NULL);`);
  const configDb=settingsDb||db;
  if(!configDb.prepare('SELECT id FROM ai_settings').get())configDb.prepare('INSERT INTO ai_settings VALUES(1,?,?)').run(JSON.stringify({...DEFAULTS,enabled:!startupCheck}),'');
  const previous=JSON.parse(configDb.prepare('SELECT payload FROM ai_settings').get().payload);
  if(!previous.transport){const migrated={...DEFAULTS,...previous,transport:previous.endpoint?'api':'codex'};if(!previous.endpoint){migrated.enabled=!startupCheck;migrated.consent=true;}configDb.prepare('UPDATE ai_settings SET payload=? WHERE id=1').run(JSON.stringify(migrated));}
  let closing=false;
  for(const row of db.prepare('SELECT id,payload FROM ai_runs').all()){const run=JSON.parse(row.payload);if(run.status==='running'){run.status='cancelled';run.error='上次核验被中断，请重新核验';db.prepare('UPDATE ai_runs SET payload=? WHERE id=?').run(JSON.stringify(run),row.id);}}
  for(const row of db.prepare('SELECT document_id,cache_key,payload FROM ai_fragments').all()){
    const item=JSON.parse(row.payload);if(item.status==='pending'){item.status='failed';item.reason='上次核验被中断，可手动重试';db.prepare('UPDATE ai_fragments SET payload=? WHERE document_id=? AND cache_key=?').run(JSON.stringify(item),row.document_id,row.cache_key);}
  }
  const pendingRequests=new Set(),running=new Map(),completions=new Map(),network=fetcher||((url,options)=>electron.net.fetch(url,options));
  const generation=id=>db.prepare('SELECT generation FROM ai_generations WHERE document_id=?').get(id)?.generation||0;
  const fragmentKey=(profile,item)=>hash([profile,item.fragmentKey]);
  const readFragment=(id,profile,item)=>{const row=db.prepare('SELECT payload FROM ai_fragments WHERE document_id=? AND cache_key=?').get(id,fragmentKey(profile,item));return row?JSON.parse(row.payload):null;};
  const writeFragment=(id,profile,item)=>db.prepare('INSERT OR REPLACE INTO ai_fragments VALUES(?,?,?)').run(id,fragmentKey(profile,item),JSON.stringify(item));
  function clearDocuments(ids){
    db.exec('BEGIN IMMEDIATE');
    try{for(const id of new Set(ids)){
      db.prepare('INSERT INTO ai_generations VALUES(?,1) ON CONFLICT(document_id) DO UPDATE SET generation=generation+1').run(id);
      db.prepare('DELETE FROM ai_fragments WHERE document_id=?').run(id);
      db.prepare('DELETE FROM ai_runs WHERE document_id=?').run(id);
    }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    for(const id of ids)running.get(id)?.abort();
  }
  function prepareCache(doc,mode){
    const settings=config(),dictionary=aliases().sort((a,b)=>Number(!!b.playerId)-Number(!!a.playerId));
    const profile=hash([core.FRAGMENT_VERSION,settings.transport,settings.transport==='codex'?codexConfigKey(settings):null,settings.codexPath,settings.endpoint,settings.model,core.REVIEW_VERSION,dictionary]);
    const prepared=core.reviewInput(doc,mode),epoch=generation(doc.id);
    const firstUse=!db.prepare('SELECT 1 FROM ai_generations WHERE document_id=?').get(doc.id);
    if(firstUse){
      db.prepare('INSERT INTO ai_generations VALUES(?,0)').run(doc.id);
      const old=doc.assistance;
      if(old&&old.cacheGeneration===undefined&&old.version===core.assistanceFor(doc,[]).version&&old.sourceText===doc.text&&old.businessDate===doc.businessDate&&old.defaultPlayer===(doc.defaultPlayer||'')){
        for(const item of prepared.items){
          const saved=old.items.find(r=>r.line===item.line&&r.source===item.source&&r.status!=='pending');
          if(!saved)continue;
          if(saved.status==='accepted')try{core.validateCandidate(saved.candidates.find(c=>c.replacement===saved.replacement).proposal,item,doc);}catch{continue;}
          writeFragment(doc.id,profile,core.relocateReview({...saved,runId:old.runId},item));
        }
      }
    }
    // Preserve explicit decisions across edits, but only for a stored result
    // in the current cache generation and identical semantic context.
    if(doc.assistance?.cacheGeneration===epoch&&doc.assistance?.cacheProfile===profile){
      for(const item of prepared.items){
        const decision=doc.assistance.items.find(r=>r.fragmentKey===item.fragmentKey&&r.confirmedAt);
        const previous=decision&&readFragment(doc.id,profile,item);
        if(previous&&(!previous.decisionResetAt||decision.confirmedAt>previous.decisionResetAt)&&(!previous.confirmedAt||decision.confirmedAt>=previous.confirmedAt)){
          if(decision.status==='accepted'){
            const candidate=decision.candidates?.find(c=>c.replacement===decision.replacement);
            if(!candidate?.proposal)continue;
            try{core.validateCandidate(candidate.proposal,item,doc);}catch{continue;}
          }
          writeFragment(doc.id,profile,core.relocateReview({...previous,...decision},item));
        }
      }
    }
    const items=[],missing=[];
    for(const item of prepared.items){const saved=readFragment(doc.id,profile,item);if(saved)items.push(core.relocateReview(saved,item));else missing.push(item);}
    return {settings,dictionary,prepared,profile,generation:epoch,items,missing};
  }
  function config(){const r=configDb.prepare('SELECT * FROM ai_settings').get();return {...DEFAULTS,...JSON.parse(r.payload),hasKey:!!r.secret};}
  function key(){const s=configDb.prepare('SELECT secret FROM ai_settings').get().secret;return s?electron.safeStorage.decryptString(Buffer.from(s,'base64')):'';}
  function usage(){return configDb.prepare('SELECT * FROM ai_usage WHERE day=?').get(today())||{day:today(),requests:0,input_tokens:0,output_tokens:0};}
  function aliases(){return db.prepare('SELECT payload FROM ai_aliases ORDER BY rowid DESC').all().map(r=>JSON.parse(r.payload));}
  function reserve(settings){if(usage().requests>=settings.dailyLimit)throw new Error('今日AI请求已达上限，本地解析仍可使用');configDb.prepare('INSERT INTO ai_usage VALUES(?,1,0,0) ON CONFLICT(day) DO UPDATE SET requests=requests+1').run(today());}
  async function request(settings,messages,signal){
    const controller=new AbortController(),abort=()=>controller.abort();pendingRequests.add(controller);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try {
      const options={fetcher:network,signal:controller.signal,onAttempt:()=>{if(closing)throw new Error('应用正在关闭');reserve(settings);}};
      const result=settings.transport==='codex'?await codexRunner(settings,messages,options):await chatRequest(settings,key(),messages,options);
      if(closing)throw new Error('应用正在关闭');
      configDb.prepare('UPDATE ai_usage SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE day=?').run(result.usage.inputTokens,result.usage.outputTokens,today());return result.result;
    }finally{pendingRequests.delete(controller);signal?.removeEventListener('abort',abort);}
  }

  function safeDoc(doc){
    if(!doc||typeof doc.id!=='string'||typeof doc.text!=='string'||doc.text.length>5_000_000||typeof doc.businessDate!=='string')throw new Error('账目数据无效');
    return {id:doc.id,text:doc.text,businessDate:doc.businessDate,defaultPlayer:doc.defaultPlayer||'',name:doc.name||'',assistance:doc.assistance};
  }
  const handlers={
    load:()=>({settings:config(),codex:{available:!!findCodex(config().codexPath),path:findCodex(config().codexPath)?.command||''},usage:usage(),aliases:aliases(),running:[...running.keys()]}),
    configure:input=>{
      if(running.size)throw new Error('请先停止核验再修改接口设置');
      const settings=validateSettings(input),old=configDb.prepare('SELECT * FROM ai_settings').get();let secret=old.secret;
      if(input.clearKey)secret='';
      if(input.apiKey){if(!electron.safeStorage.isEncryptionAvailable())throw new Error('系统凭据保护暂不可用，无法安全保存密钥');if(typeof input.apiKey!=='string'||input.apiKey.length>4096)throw new Error('密钥格式无效');secret=electron.safeStorage.encryptString(input.apiKey).toString('base64');}
      if(settings.endpoint!==JSON.parse(old.payload).endpoint&&!input.apiKey)secret='';
      configDb.prepare('UPDATE ai_settings SET payload=?,secret=? WHERE id=1').run(JSON.stringify(settings),secret);return handlers.load();
    },
    test:async()=>{const s=config();if(s.transport==='api'&&(!s.endpoint||!s.model))throw new Error('请先保存接口地址和模型');const checked=await request({...s,connectionTest:true},[{role:'user',content:'Return a JSON object {"ok":true}. This is a connection test with no user data.'}]);if(checked?.ok!==true)throw new Error('连接测试响应无效');return {ok:true};},
    cancel:({id})=>{running.get(id)?.abort();return true;},
    history:({id})=>db.prepare('SELECT payload FROM ai_runs WHERE document_id=? ORDER BY created_at DESC LIMIT 20').all(id).map(r=>JSON.parse(r.payload)),
    cached:input=>{
      const doc=safeDoc(input.document),mode=input.mode==='all'?'all':'doubt',cached=prepareCache(doc,mode);
      return {items:cached.items,missing:cached.missing.length,total:cached.prepared.items.length,generation:cached.generation,profile:cached.profile,running:running.has(doc.id)};
    },
    review:async input=>{
      const doc=safeDoc(input.document),requestedGeneration=input.generation??generation(doc.id);
      // Two callers for the same ledger share the first run. Its unchanged
      // fragments are cached before the second caller considers new work.
      if(completions.has(doc.id))await completions.get(doc.id);
      if(closing)throw new Error('应用正在关闭');
      if(requestedGeneration!==generation(doc.id))return {invalidated:true,status:'cancelled',items:[]};
      const mode=['all','doubt'].includes(input.mode)?input.mode:config().mode;
      const cached=prepareCache(doc,mode),{settings,dictionary,prepared,profile}=cached,epoch=cached.generation;
      if(!settings.enabled||!settings.consent)throw new Error('请先在AI核验设置中启用接口并确认发送范围');
      const retryKeys=new Set(cached.items.filter(i=>input.retryLine===i.line||input.force&&i.status==='failed').map(i=>i.fragmentKey));
      const unique=new Map(prepared.items.filter(i=>input.retryLine!==undefined?retryKeys.has(i.fragmentKey):cached.missing.some(m=>m.fragmentKey===i.fragmentKey)||retryKeys.has(i.fragmentKey)).map(i=>[i.fragmentKey,i]));
      if(!unique.size)return {id:cached.items[0]?.runId||'',documentId:doc.id,sourceKey:core.documentReviewKey(doc),items:cached.items,
        status:cached.items.some(i=>i.status==='failed')?'failed':'completed',cached:true,generation:epoch,profile,
        error:cached.items.find(i=>i.status==='failed')?.reason};
      if(running.size>=2)throw new Error('已有两份账目正在核验，请稍后重试');
      const controller=new AbortController();running.set(doc.id,controller);
      let finish;completions.set(doc.id,new Promise(resolve=>{finish=resolve;}));
      const record={id:randomUUID(),documentId:doc.id,sourceKey:core.documentReviewKey(doc),createdAt:new Date().toISOString(),mode,model:settings.transport==='codex'?'本机 Codex 默认模型':settings.model,transport:settings.transport,status:'running',items:[],total:prepared.items.length,generation:epoch,profile};
      const valid=()=>!closing&&generation(doc.id)===epoch;
      const persist=()=>valid()&&db.prepare('INSERT OR REPLACE INTO ai_runs VALUES(?,?,?,?,?)').run(record.id,doc.id,hash([record.sourceKey,profile,epoch]),JSON.stringify(record),record.createdAt);
      const save=(item,result)=>{if(valid())writeFragment(doc.id,profile,core.relocateReview({...result,runId:record.id,...(retryKeys.has(item.fragmentKey)?{decisionResetAt:record.createdAt}: {})},item));};
      const work=[...unique.values()];
      for(const item of work)save(item,{status:'pending',replacement:'',candidates:[],reason:'等待AI核验'});
      persist();
      try{
        for(let start=0;start<work.length;start+=5){
          controller.signal.throwIfAborted();const batch=work.slice(start,start+5);
          if(batch.some(i=>i.body.length>4000))throw new Error('存在过长输入行，请拆行后核验');
          const items=[];
          for(const item of batch){
            const alias=dictionary.find(a=>a.version===core.REVIEW_VERSION&&(a.playerId===''||a.playerId===item.playerId)&&a.body===item.body&&JSON.stringify(a.context)===JSON.stringify(item.context));
            if(alias){
              const candidate=core.validateCandidate(alias.proposal,item,doc);
              save(item,{status:'accepted',replacement:candidate.replacement,candidates:[candidate],reason:'已确认的表达规则',aliasId:alias.id});
            }else items.push(item);
          }
          if(items.length){
            const reply=await request(settings,[{role:'system',content:core.REVIEW_INSTRUCTIONS},{role:'user',content:JSON.stringify({businessDate:doc.businessDate,playNames:core.PLAY_NAMES,items:core.reviewPayload(items)})}],controller.signal);
            controller.signal.throwIfAborted();
            for(const result of core.validateReply(reply,items,doc))save(items.find(i=>i.line===result.line),result);
          }
          if(valid())record.items=prepared.items.flatMap(item=>{const saved=readFragment(doc.id,profile,item);return saved?[core.relocateReview(saved,item)]:[];});
          persist();
        }
        record.status='completed';
      }catch(error){
        record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'核验已停止':/Codex|HTTP|JSON|候选|上限|过长|完整|响应|接口/.test(error.message)?error.message:'AI连接失败或超时，请检查网络后重试';
        if(valid())for(const item of work)if(readFragment(doc.id,profile,item)?.status==='pending')save(item,{status:'failed',replacement:'',candidates:[],reason:record.error});
      }finally{
        if(valid())record.items=prepared.items.flatMap(item=>{const saved=readFragment(doc.id,profile,item);return saved?[core.relocateReview(saved,item)]:[];});
        else if(!closing){record.invalidated=true;record.items=[];}
        running.delete(doc.id);persist();completions.delete(doc.id);finish();
      }
      return record;
    },
    remember:input=>{
      const row=db.prepare('SELECT payload FROM ai_runs WHERE id=?').get(input.runId);if(!row)throw new Error('核验记录不存在');
      const doc=safeDoc(input.document),run=JSON.parse(row.payload);
      const accepted=doc.assistance?.items.find(i=>i.line===input.line&&i.status==='accepted');
      const stored=run.items.find(i=>accepted?.fragmentKey?i.fragmentKey===accepted.fragmentKey:i.line===input.line);
      if(run.sourceKey!==core.documentReviewKey(doc)&&(!accepted?.fragmentKey||!stored))throw new Error('原文已改变，不能保存旧表达');
      const candidate=stored?.candidates?.[input.candidate];
      if(!accepted||!candidate||accepted.replacement!==candidate.replacement)throw new Error('请先采用该解释');
      const item=core.reviewInput(doc,'all').items.find(i=>i.line===input.line);if(!item)throw new Error('没有可复用的表达');
      const alias={id:randomUUID(),version:core.REVIEW_VERSION,body:item.body,context:item.context,playerId:input.scope==='player'?item.playerId:'',replacement:candidate.replacement,proposal:candidate.proposal,createdAt:new Date().toISOString()};
      if(!alias.proposal)throw new Error('该解释不支持保存表达规则');
      db.prepare('INSERT INTO ai_aliases VALUES(?,?)').run(alias.id,JSON.stringify(alias));return handlers.load();
    },
    removeAlias:({id})=>{db.prepare('DELETE FROM ai_aliases WHERE id=?').run(id);return handlers.load();},
  };
  if(register)for(const [name,fn] of Object.entries(handlers))electron.ipcMain.handle(`ai:${name}`,(event,input)=>{if(event.sender!==getWindow()?.webContents)throw new Error('未知窗口');return fn(input);});
  return {clearDocuments,settingsDb:configDb,busy:()=>running.size>0||pendingRequests.size>0,close(){if(closing)return;for(const c of pendingRequests)c.abort();for(const c of running.values())c.abort();for(const row of db.prepare('SELECT id,payload FROM ai_runs').all()){const run=JSON.parse(row.payload);if(run.status==='running'){run.status='cancelled';run.error='应用关闭，核验已停止';db.prepare('UPDATE ai_runs SET payload=? WHERE id=?').run(JSON.stringify(run),row.id);}}closing=true;db.close();},handlers};
};
module.exports.chatRequest=chatRequest;module.exports.validateSettings=validateSettings;
