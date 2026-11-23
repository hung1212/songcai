<script setup>
import {computed,ref,shallowRef,watch,nextTick,onBeforeUnmount} from 'vue';
const props=defineProps({documents:Array,activeId:String,spaceName:String,locate:Function});
const emit=defineEmits(['close']);
const query=ref(''),scope=ref('current'),caseSensitive=ref(false),input=ref(),busy=ref(false),locating=ref(false),error=ref(''),selected=ref(-1);
const result=shallowRef({total:0,documentCount:0,matches:[]}),page=ref(1),pageSize=40;
const pages=computed(()=>Math.max(1,Math.ceil(result.value.matches.length/pageSize)));
const visible=computed(()=>result.value.matches.slice((page.value-1)*pageSize,page.value*pageSize));
const chosen=computed(()=>props.documents.filter(d=>scope.value==='all'||d.id===props.activeId).map(d=>({id:d.id,name:d.name,text:d.text})));
let timer,worker,request=0,alive=true,texts=new Map();
function reset(){result.value={total:0,documentCount:0,matches:[]};selected.value=-1;page.value=1;}
function schedule(){
 clearTimeout(timer);request++;reset();error.value='';busy.value=!!query.value;
 if(!query.value)return;
 const id=request;
 timer=setTimeout(()=>{
  if(!alive||id!==request)return;
  const docs=chosen.value;texts=new Map(docs.map(d=>[d.id,d.text]));
  try{
   // Cancel obsolete searches rather than queueing large account snapshots.
   worker?.terminate();worker=new Worker(new URL('../content-search.worker.js',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{if(!alive||id!==request||data.id!==id)return;busy.value=false;error.value=data.error||'';if(data.result)result.value=data.result;};
   worker.onerror=()=>{if(alive&&id===request){busy.value=false;error.value='搜索暂时不可用，请修改关键词重试';}};
   worker.postMessage({id,documents:docs,query:query.value,options:{caseSensitive:caseSensitive.value}});
  }catch(e){busy.value=false;error.value=e.message;}
 },160);
}
watch([query,scope,caseSensitive,chosen],schedule,{flush:'sync'});
async function open(mode='current',seed=''){
 scope.value=mode;if(seed)query.value=seed;
 await nextTick();input.value?.focus();input.value?.select();
}
async function choose(index){
 if(busy.value||locating.value)return;
 const match=result.value.matches[index];if(!match)return;
 const id=request;locating.value=true;error.value='';
 try{
  const ok=await props.locate({...match,sourceText:texts.get(match.fileId)});
  if(!alive||id!==request)return;
  if(ok===false){error.value='无法定位，请检查原文是否已变化或账目是否保存成功';return;}
  selected.value=index;page.value=Math.floor(index/pageSize)+1;
 }catch(e){if(alive&&id===request)error.value=e.message;}
 finally{if(alive)locating.value=false;}
}
function step(direction){const n=result.value.matches.length;if(n)choose(selected.value<0?(direction>0?0:n-1):(selected.value+direction+n)%n);}
function keydown(e){if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();step(e.shiftKey?-1:1);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();emit('close');}}
onBeforeUnmount(()=>{alive=false;request++;clearTimeout(timer);worker?.terminate();});
defineExpose({open,step});
</script>
<template>
 <section class="content-find" aria-label="投注原文搜索" @keydown="keydown">
  <div class="content-find-bar"><input ref="input" v-model="query" aria-label="搜索投注原文" placeholder="搜索投注原文，例如：预备号" /><button class="find-case" :aria-pressed="caseSensitive" title="区分大小写" @click="caseSensitive=!caseSensitive">Aa</button><select v-model="scope" aria-label="原文搜索范围"><option value="current">当前账目</option><option value="all">当前空间全部账目</option></select><button :disabled="busy||locating||!result.total" aria-label="上一处匹配" title="上一处 · Shift+Enter" @click="step(-1)">↑</button><button :disabled="busy||locating||!result.total" aria-label="下一处匹配" title="下一处 · Enter" @click="step(1)">↓</button><button aria-label="关闭原文搜索" title="关闭 · Esc" @click="emit('close')">×</button></div>
  <p class="find-status" role="status"><span v-if="busy">搜索中…</span><span v-else-if="error">{{error}}</span><span v-else-if="query" data-find-count>{{result.total?`${selected>=0?selected+1+' / ':''}${result.total} 处匹配 · ${result.documentCount} 个账目`:'没有匹配结果'}}</span><span v-else>按原文查找 · Enter 下一处 · Shift+Enter 上一处</span><small>{{scope==='all'?spaceName+' · 全部账目':documents.find(d=>d.id===activeId)?.name||'当前账目'}}</small></p>
  <p v-if="result.truncated" class="find-status">共 {{result.total}} 处，仅列出前 {{result.matches.length}} 处；请增加关键词缩小范围。</p>
  <div v-if="!busy&&result.matches.length" class="find-results">
   <button v-for="m in visible" :key="m.index" class="find-result" :class="{'find-selected':selected===m.index-1}" :disabled="locating" :data-find-index="m.index" @click="choose(m.index-1)"><span class="find-result-meta"><b>#{{m.index}}</b><span>{{m.name}}</span><small>本账目第{{m.documentIndex}}处 · 第{{m.line}}行:{{m.column}}</small></span><span class="find-snippet">{{m.leading?'…':''}}{{m.before}}<mark>{{m.quote}}</mark>{{m.after}}{{m.trailing?'…':''}}</span></button>
  </div>
  <div v-if="!busy&&pages>1" class="find-pages"><button :disabled="page<=1" @click="page--">上一页</button><span>{{page}} / {{pages}}</span><button :disabled="page>=pages" @click="page++">下一页</button></div>
 </section>
</template>
<style scoped>
.content-find{margin:0 12px 8px;border:1px solid #bacddc;border-radius:7px;background:#f6f9fc;flex-shrink:0;min-width:0}.content-find-bar{display:flex;gap:5px;padding:8px;align-items:center;flex-wrap:wrap}.content-find-bar input{flex:1;min-width:140px;font-size:13px;padding:7px}.content-find-bar select{font-size:11px;max-width:160px;padding:6px}.content-find-bar button{padding:5px 8px;color:#315979;border-radius:4px}.find-case[aria-pressed=true]{background:#dcecff;box-shadow:inset 0 0 0 1px #729fc3}.find-status{display:flex;justify-content:space-between;gap:8px;margin:0;padding:3px 10px 7px;font-size:11px;color:#55718a;flex-wrap:wrap}.find-status small{font-size:10px;color:#76848e}.find-results{max-height:168px;overflow:auto;border-top:1px solid #dce6ee}.find-result{display:block;width:100%;text-align:left;padding:7px 10px;border-bottom:1px solid #e2eaf0;font-size:12px}.find-result:hover,.find-selected{background:#e1edf8}.find-result-meta{display:flex;align-items:center;gap:9px;color:#3b5c78}.find-result-meta>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%}.find-result-meta small{color:#75828d;font-size:10px}.find-snippet{display:block;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;color:#435c6b}.find-snippet mark{background:#ffe4a3;color:#694b14;border-radius:2px}.find-pages{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:5px 10px;font-size:11px}.find-pages button{color:#426987}
</style>
