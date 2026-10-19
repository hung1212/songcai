<script setup>
import {computed,nextTick,onMounted,ref,shallowRef} from 'vue';
import LedgerWorkspace from './LedgerWorkspace.vue';
import {browserSpaces} from './space-preview.js';
import {today} from './core/rules.js';
import './spaces.css';
const service=window.songcai?.spaces||browserSpaces();
const registry=ref(null),workspace=ref(),api=shallowRef(),busy=ref(false),error=ref(''),menu=ref(),query=ref(''),dialog=ref(),dialogMode=ref('create'),name=ref(''),copyNames=ref(false),businessDate=ref(today()),initialView=ref('ledger');
const active=computed(()=>registry.value?.spaces.find(s=>s.id===registry.value.activeId));
const recoveries=ref([]),closing=ref(false);
const visibleSpaces=computed(()=>registry.value?.spaces.filter(s=>!s.archived&&s.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))||[]);
let operation=Promise.resolve(),startupDelivered=false;
function bind(id){
  if(!window.songcai)return undefined;
  const value={...window.songcai,...window.songcai.forSpace(id),onBeforeClose:undefined,isStartupCheck:!!window.songcai.reportStartup};
  // Existing startup checks run once, using an isolated database.
  if(startupDelivered)delete value.reportStartup;
  else if(value.reportStartup){startupDelivered=true;value.reportStartup=async report=>{try{const {checkSpaces}=await import('./space-startup-check.js');report.spacesUI=await checkSpaces({service,workspace:()=>workspace.value,switchSpace,ready:()=>!!workspace.value?.ready(),refreshRegistry:async()=>{accept(await service.list());await nextTick();}});const {checkRecovery}=await import('./recovery-startup-check.js');report.recoveryUI=await checkRecovery({service,workspace:()=>workspace.value,switchSpace,refreshRegistry:async()=>{await load();await nextTick();}});}catch(e){report.spacesUI=false;report.spacesError=e.message;}window.songcai.reportStartup(report);};}
  return value;
}
function accept(value){const changed=value.activeId!==registry.value?.activeId;if(changed)api.value=bind(value.activeId);registry.value=value;}
async function load(){error.value='';try{accept(await service.list());recoveries.value=await window.songcai?.recovery?.list()||[];}catch(e){error.value=e.message;}}
async function restoreDraft(id){await run(async()=>{accept(await window.songcai.recovery.restore(id));recoveries.value=await window.songcai.recovery.list();});}
function run(fn){
  if(busy.value)return operation;
  busy.value=true;error.value='';
  operation=(async()=>{try{await workspace.value?.flush();initialView.value=workspace.value?.currentView()||'ledger';await fn();}catch(e){error.value=e.message;}finally{busy.value=false;}})();return operation;
}
async function switchSpace(id){if(id===active.value.id){menu.value?.removeAttribute('open');return;}await run(async()=>{accept(await service.activate({id}));menu.value?.removeAttribute('open');query.value='';});}
function showDialog(mode){dialogMode.value=mode;name.value=mode==='rename'?active.value.name:'';copyNames.value=false;businessDate.value=today();error.value='';menu.value?.removeAttribute('open');dialog.value.showModal();}
async function submit(){await run(async()=>{accept(await service[dialogMode.value](dialogMode.value==='rename'?{id:active.value.id,name:name.value}:{name:name.value,copyFrom:active.value.id,copyNames:copyNames.value,businessDate:businessDate.value}));dialog.value.close();});}
async function archive(space){await run(async()=>{accept(await service.archive({id:space.id,archived:true}));});}
async function restore(space){await run(async()=>{accept(await service.archive({id:space.id,archived:false}));accept(await service.activate({id:space.id}));dialog.value.close();});}
function countChanged(count){const current=active.value;if(current)current.count=count;}
onMounted(()=>{load();window.songcai?.onBeforeClose(async()=>{closing.value=true;await operation;await nextTick();if(!workspace.value)throw new Error('空间尚未加载');await workspace.value.flush();},async()=>{if(!workspace.value)throw new Error('空间尚未加载，无法取得原文');return workspace.value.backup();},()=>{closing.value=false;});});
</script>
<template>
  <LedgerWorkspace v-if="active" ref="workspace" :key="active.id" :space="active" :api="api" :initial-view="initialView" :switching="busy" :inert="closing" @count="countChanged">
    <template #space-picker>
      <details ref="menu" class="space-picker" @keydown.esc="menu.removeAttribute('open')">
        <summary aria-label="切换空间" :aria-disabled="busy" @click="busy&&$event.preventDefault()"><span class="space-icon">▦</span><span class="space-current" :title="active.name">{{active.name}}</span><span>⌄</span></summary>
        <div class="space-popover"><header><strong>切换空间</strong><small>账目与统计独立</small></header><input v-model="query" type="search" placeholder="搜索空间" aria-label="搜索空间" />
          <div class="space-options"><button v-for="space in visibleSpaces" :key="space.id" :data-space-option="space.id" :class="{selected:space.id===active.id}" :disabled="busy" @click="switchSpace(space.id)"><span>{{space.name}}</span><small>{{space.count}} 份账目</small><b>{{space.id===active.id?'✓':''}}</b></button><p v-if="!visibleSpaces.length">没有匹配的空间</p></div>
          <footer><button :disabled="busy" @click="showDialog('create')">＋ 新建空间</button><button :disabled="busy" @click="showDialog('manage')">管理空间</button></footer>
        </div>
      </details>
    </template>
  </LedgerWorkspace>
  <aside v-if="recoveries.length" class="draft-recovery-banner" role="status" :inert="closing"><strong>发现未保存的原文副本</strong><span>恢复到独立空间，原账目保持原样。</span><div v-for="item in recoveries" :key="item.id"><span>{{item.spaceName}} · {{item.count}}份账目 · {{new Date(item.updatedAt).toLocaleString()}}</span><button class="button" :disabled="busy" @click="restoreDraft(item.id)">打开恢复副本</button></div></aside>
  <div v-if="!active" class="space-loading"><h1>松财</h1><p>{{error||'正在打开空间…'}}</p><button v-if="error" class="button" @click="load">重新加载</button></div>
  <div v-if="busy" class="space-switch-status" role="status">正在保存并切换…</div>
  <div v-if="error&&active&&!dialog?.open" class="space-error" role="alert">{{error}}<button @click="error=''" aria-label="关闭空间提示">×</button></div>
  <dialog ref="dialog" class="space-dialog" aria-label="空间管理" @cancel="busy&&$event.preventDefault()">
    <template v-if="dialogMode==='manage'"><header><h2>管理空间</h2><button :disabled="busy" @click="dialog.close()" aria-label="关闭空间管理">×</button></header><p>归档后从切换列表收起，原有数据保留，恢复后可继续使用。</p>
      <div class="space-manage-list"><div v-for="space in registry?.spaces" :key="space.id"><span><strong>{{space.name}}</strong><small>{{space.count}} 份账目 · {{space.archived?'已归档':space.id===active.id?'当前空间':'使用中'}}</small></span><button v-if="space.id===active.id" class="text-button" :disabled="busy" @click="showDialog('rename')">重命名</button><button v-if="space.archived" class="text-button" :disabled="busy" @click="restore(space)">恢复并打开</button><button v-else class="text-button" :disabled="busy||registry.spaces.filter(s=>!s.archived).length===1" @click="archive(space)">归档</button></div></div>
    </template>
    <form v-else @submit.prevent="submit"><header><h2>{{dialogMode==='rename'?'重命名空间':'新建空间'}}</h2><button type="button" :disabled="busy" @click="dialog.close()" aria-label="关闭空间管理">×</button></header><label>空间名称<input v-model="name" name="space-name" maxlength="60" placeholder="例如：今日账目、二组" required autofocus :disabled="busy" /></label>
      <template v-if="dialogMode==='create'"><p>创建后拥有独立账目、全部统计、特码集合和平特肖集合。赔率从当前空间复制，后续各自调整。</p><label class="space-copy"><input v-model="copyNames" type="checkbox" :disabled="busy" />复制“{{active?.name}}”的账目名单</label><p class="space-hint">仅保留名称、玩家绑定和手动顺序，投注内容为空。</p><label v-if="copyNames">新账目业务日期<input type="date" v-model="businessDate" min="2000-01-01" max="2100-12-31" required /></label></template>
      <footer><button type="button" class="button" :disabled="busy" @click="dialog.close()">取消</button><button type="submit" class="button primary" :disabled="busy||!name.trim()">{{dialogMode==='rename'?'保存名称':copyNames?'复制名单并创建':'创建空白空间'}}</button></footer>
    </form><p v-if="error" class="space-dialog-error" role="alert">{{error}}</p>
  </dialog>
</template>
