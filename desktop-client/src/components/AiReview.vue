<script setup>
import {useSpace} from "../space-context.js";
const space=useSpace(),songcai=space.api;
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {reviewInput,documentReviewKey,assistanceFor,decideReview,decideReviewGroup,currentReviewItems,reviewFailureMessage} from '../core/ai-review.js';
import {assistanceMatches,STANDARD_RULES} from '../core/semantic-rules.js';
import {formatMoney as money} from '../core/rules.js';
const props=defineProps({document:Object,prepare:Function,apply:Function});
const api=songcai?.ai,loaded=ref(null),settings=ref(null),apiKey=ref(''),clearKey=ref(false),error=ref(''),message=ref(''),busy=ref(false),configBusy=ref(false),showSettings=ref(false),history=ref([]),aliasScope=ref('player');
let timer,requestId='',disposed=false,lastAutomaticKey='',historyToken=0,cacheToken=0;
async function loadHistory(){const token=++historyToken,id=props.document.id;const result=await api.history({id});if(!disposed&&token===historyToken&&props.document.id===id)history.value=result;}
const current=computed(()=>assistanceMatches(props.document.assistance,props.document.text,props.document.businessDate,props.document.defaultPlayer)?props.document.assistance:null);
const items=computed(()=>currentReviewItems(props.document,local.value));
const local=computed(()=>{try{return reviewInput(props.document,'doubt');}catch{return {items:[],parsed:{bets:[]}};}});
const reviewPage=ref(1),onlyPending=ref(false);
const filteredItems=computed(()=>onlyPending.value?items.value.filter(i=>i.requiresAction):items.value);
const visibleItems=computed(()=>filteredItems.value.slice((reviewPage.value-1)*30,reviewPage.value*30));
const groupCounts=computed(()=>{
  if(!items.value.some(i=>i.status==='review'))return new Map();
  const contexts=new Map(reviewInput(props.document,'all').items.map(i=>[i.line,i])),counts=new Map(),keys=new Map();
  for(const i of items.value){const c=contexts.get(i.line);if(i.status!=='review'||!c)continue;for(const candidate of i.candidates||[]){const key=JSON.stringify([c.body,c.playerId,c.context,candidate.replacement]);counts.set(key,(counts.get(key)||0)+1);keys.set(JSON.stringify([i.line,candidate.replacement]),key);}}
  return new Map([...keys].map(([id,key])=>[id,counts.get(key)]));
});
const groupCount=(item,candidate)=>groupCounts.value.get(JSON.stringify([item.line,candidate.replacement]))||0;
watch([onlyPending,()=>props.document.id],()=>{reviewPage.value=1;});
watch(()=>filteredItems.value.length,()=>{reviewPage.value=Math.min(reviewPage.value,Math.max(1,Math.ceil(filteredItems.value.length/30)));});
const labels={pending:'核验中',agree:'解释一致',review:'待确认差异',accepted:'已采用解释',original:'已确认本地规则',failed:'核验未完成'};
async function action(fn){error.value='';try{return await fn();}catch(e){error.value=e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}}
async function load(){if(!api)return;loaded.value=await api.load();settings.value={...loaded.value.settings};await loadHistory();lastAutomaticKey='';await refreshCached();schedule();}
async function refreshCached(mode=settings.value?.mode){
  if(!api||!settings.value?.enabled||disposed)return;
  const token=++cacheToken,doc=JSON.parse(JSON.stringify(props.document)),key=documentReviewKey(doc);
  const cached=await api.cached({document:doc,mode});
  if(disposed||token!==cacheToken||documentReviewKey(props.document)!==key)return;
  if(cached.missing)lastAutomaticKey='';
  const assistance=cached.total?assistanceFor(doc,cached.items,cached.items[0]?.runId||'',cached):undefined;
  if(JSON.stringify(props.document.assistance)!==JSON.stringify(assistance))await props.apply(doc.id,key,assistance);
  if(cached.missing)schedule();
  return cached;
}
function schedule(){clearTimeout(timer);if(!api||!settings.value?.enabled||disposed||busy.value)return;const key=documentReviewKey(props.document);if(key===lastAutomaticKey)return;timer=setTimeout(()=>action(()=>run(settings.value.mode==='all')),1500);}
async function run(full=false,force=false,retryLine){
  if(!api)throw new Error('AI接口请在桌面客户端中配置');if(busy.value)return;
  await props.prepare();const doc=JSON.parse(JSON.stringify(props.document)),sourceKey=documentReviewKey(doc),mode=full?'all':'doubt';
  const cached=await api.cached({document:doc,mode});
  if(disposed||documentReviewKey(props.document)!==sourceKey){schedule();return;}
  lastAutomaticKey=sourceKey;
  if(!cached.total){message.value='标准规则已覆盖当前内容，无需请求AI。';return;}
  if(!cached.missing&&!cached.running&&!force&&retryLine===undefined){
    await props.apply(doc.id,sourceKey,assistanceFor(doc,cached.items,cached.items[0]?.runId||'',cached));
    message.value=cached.running?'已有核验正在进行，相同内容不会重复发送。':'已复用本账目的核验记录。';return;
  }
  busy.value=true;requestId=doc.id;message.value='';
  const prepared=reviewInput(doc,mode),pending=assistanceFor(doc,prepared.items.map(i=>cached.items.find(r=>r.fragmentKey===i.fragmentKey)||{line:i.line,source:i.source,fragmentKey:i.fragmentKey,status:'pending',required:i.required,reviewReasons:i.reviewReasons,localCents:i.localBets.reduce((n,b)=>n+b.totalCents,0),replacement:'',candidates:[],reason:'等待AI核验'}),'',cached);
  try{
    await props.apply(doc.id,sourceKey,pending);
    const result=await api.review({document:doc,mode,force,retryLine,generation:cached.generation});
    if(!result.invalidated&&!disposed&&props.document.id===doc.id){
      // The cache rebinds finished fragments to the latest text. Appending a
      // new bet must not discard the completed result for an earlier one.
      await refreshCached(mode);
      message.value=result.status==='completed'?`核验完成，未改动的内容已保存并复用。`:result.error;
    }
    loaded.value=await api.load();if(!disposed&&props.document.id===doc.id)await loadHistory();
  }catch(e){
    if(!disposed&&documentReviewKey(props.document)===sourceKey)await props.apply(doc.id,sourceKey,assistanceFor(doc,pending.items.map(i=>i.status==='pending'?{...i,status:'failed',reason:reviewFailureMessage(e)}:i),'',cached));
    throw e;
  }finally{busy.value=false;requestId='';if(!disposed)schedule();}
}
async function decide(item,choice){const doc=JSON.parse(JSON.stringify(props.document));await props.apply(doc.id,documentReviewKey(doc),decideReview(doc,item.line,choice));await refreshCached();}
async function decideGroup(item,candidate){const doc=JSON.parse(JSON.stringify(props.document));await props.apply(doc.id,documentReviewKey(doc),decideReviewGroup(doc,item.line,candidate.replacement));await refreshCached();}
async function saveSettings(){configBusy.value=true;try{loaded.value=await api.configure({...settings.value,apiKey:apiKey.value,clearKey:clearKey.value});settings.value={...loaded.value.settings};apiKey.value='';clearKey.value=false;message.value='设置已保存';lastAutomaticKey='';window.dispatchEvent(new CustomEvent('songcai:ai-settings'));schedule();}finally{configBusy.value=false;}}
async function remember(item,index){loaded.value=await api.remember({document:JSON.parse(JSON.stringify(props.document)),runId:item.runId||current.value.runId,line:item.line,candidate:index,scope:aliasScope.value});message.value='已保存完整表达规则；同样表达和上下文下复用，金额变化不会直接套用。';}
watch(()=>[props.document.id,props.document.text,props.document.businessDate,props.document.defaultPlayer],()=>{schedule();if(api){action(refreshCached);action(loadHistory);}});
function refreshSettings(){action(load);}
onMounted(()=>{window.addEventListener('songcai:ai-settings',refreshSettings);action(load);});onBeforeUnmount(()=>{window.removeEventListener('songcai:ai-settings',refreshSettings);disposed=true;cacheToken++;clearTimeout(timer);});
</script>

<template>
 <div class="page-body ai-page">
  <section class="page-heading"><div><div class="eyebrow">RULES & AI REVIEW</div><h1>AI 核验</h1><p>{{document.name||'当前账目'}} · 原文保留，规则判断与AI解释逐项核对。</p></div><button class="button" @click="showSettings=!showSettings">{{showSettings?'收起接口设置':'接口设置'}}</button></section>
  <p v-if="!api" class="ai-note">浏览器预览只展示本地规则。桌面客户端默认调用本机 Codex，复用其配置和登录。</p>
  <section v-if="showSettings" class="panel ai-settings">
   <template v-if="settings"><h2>AI 核验设置</h2><label>核验入口<select v-model="settings.transport" aria-label="AI核验入口"><option value="codex">本机 Codex（默认）</option><option value="api">自定义 API</option></select></label><template v-if="settings.transport==='codex'"><p class="ai-note">复用本机 Codex 的模型、连接配置和登录，无需在松财填写 API 密钥。核验需要联网，会使用 Codex 对应服务的额度。</p><label>Codex 程序路径<input v-model="settings.codexPath" :placeholder="loaded?.codex.path||'自动检测；找不到时填写绝对路径'" aria-label="Codex程序路径" /></label><p class="ai-note">{{loaded?.codex.available?'已找到本机 Codex；可点击测试连接':'尚未找到 Codex，请安装或填写程序路径'}}</p></template><template v-else><p class="ai-note">支持 Chat Completions 兼容接口及JSON响应。请填写完整请求地址和服务商提供的模型名称。</p>
    <label>接口请求地址<input v-model="settings.endpoint" placeholder="https://你的服务商/v1/chat/completions" aria-label="AI接口请求地址" /></label>
    <label>模型名称<input v-model="settings.model" placeholder="填写服务商模型名称" aria-label="AI模型名称" /></label>
    <label>API密钥<input v-model="apiKey" type="password" autocomplete="off" :placeholder="settings.hasKey?'已安全保存；留空保留':'填写API密钥（本机服务可留空）'" aria-label="AI API密钥" /></label>
    <label class="check"><input v-model="clearKey" type="checkbox" />清除已保存密钥</label>
    </template><div class="ai-options"><label>自动核验范围<select v-model="settings.mode"><option value="doubt">疑难与可疑表达</option><option value="all">全部投注</option></select></label><label>每日请求上限<input v-model.number="settings.dailyLimit" type="number" min="1" max="5000" /></label><label>单次输出Token上限<input v-model.number="settings.maxTokens" type="number" min="256" max="16000" /></label></div>
    <label v-if="settings.transport==='api'" class="check"><input v-model="settings.consent" type="checkbox" />允许向上述服务商发送待核验文字、必要投注上下文及业务日期；不主动附带玩家姓名和原图；片段中原有的文字仍会发送。</label>
    <label class="check"><input v-model="settings.enabled" type="checkbox" />启用自动核验</label>
    <div class="ai-actions"><button class="button primary" :disabled="busy||configBusy" @click="action(saveSettings)">保存AI设置</button><button class="button" :disabled="busy||configBusy" @click="action(async()=>{await api.test();loaded=await api.load();message='连接测试通过，未发送投注内容';})">测试连接</button></div>
    <p class="ai-note">今日请求 {{loaded?.usage.requests||0}} 次 · 输入 {{loaded?.usage.input_tokens||0}} / 输出 {{loaded?.usage.output_tokens||0}} Token。Codex模式沿用其默认模型；自定义API更换地址时需要重新填写密钥。</p>
   </template><p v-else class="ai-note">接口设置在桌面版提供。</p>
  </section>
  <p v-if="error" class="ai-error">{{error}}</p><p v-if="message" class="ai-message" role="status">{{message}}</p>
  <p v-if="settings?.transport==='codex'" class="ai-note">当前入口：本机 Codex · 仅核验业务片段，明确玩家姓名使用匿名标识。</p><div class="ai-actions"><button class="button primary" :disabled="busy||!api||!settings?.enabled" @click="action(()=>run(false))">核验疑难表达</button><button class="button" :disabled="busy||!api||!settings?.enabled" @click="action(()=>run(true))">核验整单</button><button v-if="busy" class="button" @click="action(()=>api.cancel({id:requestId}))">停止核验</button><button v-else-if="items.some(i=>i.status==='failed'&&i.requiresAction)" class="button" @click="action(()=>run(false,true))">重试失败核验</button><span class="ai-note">{{busy?'正在核验…':current?`${items.filter(i=>i.requiresAction).length}项待处理`:`${local.items.length}行需要进一步核对`}}</span></div>
  <p v-if="!current&&document.assistance" class="ai-note">正在检查改动范围，未改变含义的投注会复用已有核验结果。</p>
  <label v-if="items.length" class="ai-note"><input type="checkbox" v-model="onlyPending" /> 只显示待处理差异</label>
  <section v-for="item in visibleItems" :key="item.line" class="panel ai-item"><header><strong>第{{item.line}}行 · {{item.localResolved?'本地规则已确定':labels[item.status]}}</strong><span>核验前本地金额 {{money(item.localCents||0)}}元</span></header><blockquote>{{item.source}}</blockquote><button class="text-button" :disabled="busy||item.status==='pending'" @click="action(()=>run(true,false,item.line))">重新核验此条</button><p>{{item.localResolved?'AI核验未完成；当前本地规则已可确定，正常计账，无需确认。':item.status==='accepted'?'已采用确认后的解释计算，原文仍保留。':item.status==='original'?'已确认沿用本地规则；原有解析问题仍需处理。':item.reason}}</p>
   <p v-if="item.requiresAction&&item.reviewReasons?.length"><b>待处理原因：</b>{{item.reviewReasons.join('；')}}</p>
   <p v-if="item.localResolved&&item.reason"><b>上次核验状态：</b>{{item.reason}}</p>
   <div v-for="(candidate,i) in item.candidates" :key="i" class="ai-candidate"><strong>候选{{i+1}} · {{money(candidate.totalCents)}}元</strong><p>{{candidate.replacement}}</p><p>{{candidate.explanation}}</p><details><summary>查看原文依据</summary><p v-for="(e,k) in candidate.evidence" :key="k">玩法：{{e.play.quote||'依据上下文'}}；选号：{{e.selection.quote}}；金额：{{e.amount.quote}}；市场：{{e.market.quote||'继承市场'}}</p></details><button class="button" :disabled="busy" @click="action(()=>decide(item,i))">采用这个解释</button><button v-if="groupCount(item,candidate)>1" class="button" :disabled="busy" @click="action(()=>decideGroup(item,candidate))">同玩家同上下文的 {{groupCount(item,candidate)}} 行一起采用</button><button v-if="item.status==='accepted'&&item.replacement===candidate.replacement" class="text-button" :disabled="busy||!api" @click="action(()=>remember(item,i))">保存为表达规则</button></div>
   <div v-if="!item.localResolved&&item.status!=='agree'&&item.status!=='pending'" class="ai-actions"><button class="text-button" :disabled="busy" @click="action(()=>decide(item,'original'))">已核对，采用本地规则</button><button v-if="['accepted','original'].includes(item.status)" class="text-button" :disabled="busy" @click="action(()=>decide(item,'undo'))">撤销本次确认</button></div>
  </section>
  <div v-if="filteredItems.length>30" class="pagination"><span>{{filteredItems.length}}项 · 每页30项</span><button :disabled="reviewPage===1" @click="reviewPage--">上一页</button>{{reviewPage}} / {{Math.ceil(filteredItems.length/30)}}<button :disabled="reviewPage>=Math.ceil(filteredItems.length/30)" @click="reviewPage++">下一页</button></div>
  <p v-if="items.length&&!filteredItems.length" class="ai-note">没有待处理差异；取消勾选可查看已确认解释。</p>
  <section v-if="!items.length" class="panel ai-item"><h2>本地解析依据</h2><p v-if="!local.items.length" class="ai-note">当前没有疑难项。标准规则可确定的写法直接在本地计算。</p><p v-for="i in local.items.slice(0,50)" :key="i.line" class="ai-note">第{{i.line}}行：{{i.source}}<br />待处理原因：{{i.reviewReasons.join('；')}}</p></section>
  <details class="panel ai-item"><summary>标准规则</summary><p v-for="r in STANDARD_RULES" :key="r.id">{{r.id}} · {{r.text}}</p></details>
  <details class="panel ai-item"><summary>已确认的表达规则（{{loaded?.aliases.length||0}}）</summary><label>新增规则适用范围<select v-model="aliasScope"><option value="player">仅本玩家</option><option value="global">所有玩家</option></select></label><p class="ai-note">完整表达和上下文一致时复用；金额、玩家或日期改变时重新校验。不会把一次猜测自动推广到所有玩家。</p><div v-for="a in loaded?.aliases" :key="a.id"><p>{{a.body}} → {{a.replacement}} · {{a.playerId?'仅本玩家':'通用'}}</p><button class="text-button" @click="action(async()=>{loaded=await api.removeAlias({id:a.id});})">停用此规则</button></div></details>
  <details class="panel ai-item"><summary>本账目核验历史（{{history.length}}）</summary><p v-for="h in history" :key="h.id">{{new Date(h.createdAt).toLocaleString('zh-CN')}} · {{h.model}} · {{h.items.length}}项 · {{h.status==='completed'?'已完成':h.status==='cancelled'?'已停止':'未完成'}}<small v-if="h.error">{{h.error}}</small></p></details>
 </div>
</template>

<style scoped>
.ai-page{padding-bottom:30px}.ai-settings,.ai-item{padding:20px;margin:16px 0}.ai-settings label{display:grid;gap:8px;margin:13px 0;font-size:12px}.ai-settings input{width:100%}.ai-settings .check{display:flex;align-items:center;line-height:1.8}.check input{width:auto}.ai-options{display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px}.ai-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:15px 0}.ai-note{color:#7d8e7b;font-size:11px;line-height:1.9;margin:10px 0}.ai-error{background:#fff1e6;color:#9b603d;padding:14px;font-size:12px}.ai-message{background:#edf5ed;padding:12px;color:#446d47;font-size:12px}.ai-item{font-size:12px;line-height:1.9}.ai-item header{display:flex;justify-content:space-between;gap:12px}.ai-item header span{color:#84937a}.ai-item blockquote{margin:14px 0;padding:12px;border-left:3px solid #a2baa0;background:#f5f8f1;white-space:pre-wrap}.ai-item p{margin:10px 0}.ai-candidate{border:1px solid #e3eadf;border-radius:6px;padding:14px;margin-top:12px}.ai-candidate .text-button{margin-left:16px}.ai-item small{display:block}.ai-item summary{cursor:pointer}@media(max-width:850px){.ai-options{grid-template-columns:1fr}}
</style>
