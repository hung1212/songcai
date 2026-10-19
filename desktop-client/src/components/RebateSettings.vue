<script setup>
import {computed,onMounted,ref,watch} from 'vue';
import {useSpace} from '../space-context.js';
import {browserSettlement} from '../settlement-preview.js';
import {today,MARKETS,ruleForDate} from '../core/rules.js';
import {RATE_ROWS} from '../core/odds.js';
import {playerOddsDraft,mergePlayerOddsEdits} from '../core/player-odds.js';
import {rebateInput,rebatePercent,settlementPlayers} from '../core/rebates.js';
import {rebateDraft,mergeRebateEdits} from '../core/rebate-edits.js';
import {REBATE_PLAYS} from '../core/rebate-plays.js';
const props=defineProps({documents:{type:Array,default:()=>[]},active:Boolean});
const emit=defineEmits(['saved']);
const space=useSpace(),api=space.api?.settlement||browserSettlement(()=>[],space.id);
const busy=ref(false),error=ref(''),message=ref(''),settings=ref(null),values=ref(Object.create(null)),baseline=ref('{}'),search=ref(''),selectedId=ref(''),inboxPlayers=ref([]),playSearch=ref(''),overridesOnly=ref(false),reloadPrompt=ref(false);
const section=ref('rebates'),oddsMarket=ref('新'),oddsSearch=ref(''),oddsOnly=ref(false),oddsValues=ref(Object.create(null)),oddsBaseline=ref('{}');
const yearAnimal=computed(()=>ruleForDate(today()).animal);
const oddsDraft=computed(()=>oddsValues.value[selectedId.value]?.[oddsMarket.value]);
const oddsRows=computed(()=>RATE_ROWS.filter(r=>r.label.includes(oddsSearch.value.trim())&&(!oddsOnly.value||Object.values(oddsDraft.value?.[r.key]||{}).some(v=>String(v).trim()!==''))));
const oddsCount=id=>Object.values(oddsValues.value[id]||{}).reduce((count,rows)=>count+Object.values(rows).reduce((n,fields)=>n+Object.values(fields).filter(v=>String(v).trim()!=='').length,0),0);
const inherited=(key,field)=>settings.value?.odds[oddsMarket.value]?.rates[key]?.[field]||'待配置';
const playerNames=()=>Object.fromEntries(players.value.map(p=>[p.id,p.name]));
const dirty=computed(()=>!!settings.value&&(JSON.stringify(values.value)!==baseline.value||JSON.stringify(oddsValues.value)!==oddsBaseline.value));
const players=computed(()=>{
  const people=new Map();
  for(const p of [...settlementPlayers(props.documents,{includeEmpty:true}),...inboxPlayers.value]) {
    if(!people.has(p.id))people.set(p.id,{...p,documents:[...(p.documents||[])]});
    else people.get(p.id).documents=[...new Set([...people.get(p.id).documents,...p.documents||[]])];
  }
  for(const [id,r] of Object.entries(settings.value?.rebates||{}))if(!people.has(id))people.set(id,{id,name:r.name||(id.startsWith('document:')?'已保存玩家（原账目已移除）':id),documents:[],savedOnly:true});
  for(const [id,r] of Object.entries(settings.value?.playerOdds||{}))if(!people.has(id))people.set(id,{id,name:r.name||id,documents:[],savedOnly:true});
  return [...people.values()];
});
const filtered=computed(()=>players.value.filter(p=>`${p.name} ${p.documents.join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())));
const selected=computed(()=>players.value.find(p=>p.id===selectedId.value));
const draft=computed(()=>values.value[selectedId.value]);
const groups=computed(()=>[...new Set(REBATE_PLAYS.map(p=>p.group))].map(name=>({name,plays:REBATE_PLAYS.filter(p=>p.group===name&&`${p.name} ${p.group}`.includes(playSearch.value.trim())&&(!overridesOnly.value||String(draft.value?.plays[p.id]??'').trim()!==''))})).filter(g=>g.plays.length));
const percentage=value=>{try{return rebatePercent(rebateInput(value??''));}catch{return '格式有误';}};
const overrideCount=id=>Object.values(values.value[id]?.plays||{}).filter(v=>String(v).trim()!=='').length;
const configured=computed(()=>players.value.filter(p=>{try{return rebateInput(values.value[p.id]?.default||'')>0||overrideCount(p.id)>0||oddsCount(p.id)>0;}catch{return true;}}).length);
const effective=key=>String(draft.value?.plays[key]??'').trim()!==''?percentage(draft.value.plays[key]):percentage(key==='flat-zodiac-year'&&String(draft.value?.plays['flat-zodiac']??'').trim()!==''?draft.value.plays['flat-zodiac']:draft.value?.default);
function addPlayers(){
  const before=JSON.parse(baseline.value);
  for(const p of players.value)if(!Object.hasOwn(values.value,p.id)){
    const item=rebateDraft(settings.value?.rebates?.[p.id]);values.value[p.id]=item;
    Object.defineProperty(before,p.id,{value:structuredClone(item),enumerable:true,writable:true,configurable:true});
  }
  const previousOdds=JSON.parse(oddsBaseline.value);
  for(const p of players.value)if(!Object.hasOwn(oddsValues.value,p.id)){
    const item=playerOddsDraft(settings.value?.playerOdds?.[p.id]);oddsValues.value[p.id]=item;
    Object.defineProperty(previousOdds,p.id,{value:structuredClone(item),enumerable:true,writable:true,configurable:true});
  }
  oddsBaseline.value=JSON.stringify(previousOdds);
  baseline.value=JSON.stringify(before);
  if(!selected.value)selectedId.value=players.value[0]?.id||'';
}
function hydrate(loaded){
  settings.value=loaded;
  values.value=Object.assign(Object.create(null),Object.fromEntries(Object.entries(loaded.rebates||{}).map(([id,r])=>[id,rebateDraft(r)])));
  oddsValues.value=Object.assign(Object.create(null),Object.fromEntries(Object.entries(loaded.playerOdds||{}).map(([id,r])=>[id,playerOddsDraft(r)])));
  oddsBaseline.value=JSON.stringify(oddsValues.value);
  baseline.value=JSON.stringify(values.value);addPlayers();
}
async function load(){
  if(busy.value)return;
  busy.value=true;error.value='';message.value='';reloadPrompt.value=false;
  try{const loaded=await api.load({date:today()});inboxPlayers.value=await api.players?.()||[];hydrate(loaded.settings);}
  catch(e){error.value=e.message;}finally{busy.value=false;}
}
async function save(){
  if(busy.value)throw new Error('玩家设置正在处理，请稍候');
  if(!dirty.value)return;
  busy.value=true;error.value='';message.value='';
  try{
    const latest=(await api.load({date:today()})).settings;
    const rebates=mergeRebateEdits(settings.value.rebates,latest.rebates,JSON.parse(baseline.value),JSON.parse(JSON.stringify(values.value)),Object.fromEntries(players.value.map(p=>[p.id,p.name])));
    const playerOdds=mergePlayerOddsEdits(settings.value.playerOdds,latest.playerOdds,JSON.parse(oddsBaseline.value),JSON.parse(JSON.stringify(oddsValues.value)),playerNames());
    hydrate(await api.settings({...latest,rebates,playerOdds}));
    message.value='所有退水与赔率修改已保存，当前结算已更新。';emit('saved');
  }catch(e){error.value=e.message;throw e;}finally{busy.value=false;}
}
watch(players,()=>{if(settings.value)addPlayers();});
watch(()=>props.active,value=>{if(value&&!dirty.value)load();});
onMounted(load);
defineExpose({flush:save});
</script>
<template>
  <div class="page-body rebate-page" aria-label="玩家退水管理">
    <section class="page-heading rebate-page-heading"><div><h1>玩家退水与赔率</h1><p>选择玩家，分别设置退水和各市场赔率；未单独设置的赔率跟随市场默认。</p></div><div class="rebate-page-actions"><span>{{dirty?'有未保存修改':'已保存到本地'}}</span><button class="button" :disabled="busy" @click="dirty?reloadPrompt=true:load()">重新载入</button><button class="button primary rebate-save" :disabled="busy||!dirty" @click="save().catch(()=>{})">{{busy?'处理中…':'保存所有修改'}}</button></div></section>
    <div v-if="reloadPrompt" class="rebate-reload-prompt">重新载入会放弃尚未保存的退水与赔率修改。<button class="text-button" @click="reloadPrompt=false">保留修改</button><button class="button" @click="load">放弃修改并载入</button></div>
    <p v-if="error" class="rebate-error" role="alert">{{error}}</p><p v-if="message" class="rebate-success" role="status">{{message}}</p>
    <div class="rebate-layout">
      <aside class="panel rebate-people"><div class="rebate-people-heading"><strong>全部玩家 <small>{{players.length}}</small></strong><span>{{configured}}位已设置</span></div><input v-model="search" type="search" aria-label="搜索退水玩家" placeholder="搜索玩家或账目" />
        <div class="rebate-player-list"><button v-for="p in filtered" :key="p.id" :data-player-id="p.id" :aria-label="'设置'+p.name+'退水'" :aria-pressed="selectedId===p.id" :class="['rebate-player',{selected:selectedId===p.id}]" @click="selectedId=p.id"><span><strong>{{p.name}}</strong><small>{{p.documents.join('、')||'已保存的退水设置'}}</small></span><span class="rebate-player-rate">{{percentage(values[p.id]?.default)}}<small>{{overrideCount(p.id)}}项退水 · {{oddsCount(p.id)}}项赔率</small></span></button></div>
        <p v-if="!filtered.length" class="rebate-empty">{{players.length?'没有匹配的玩家':'创建账目或从收件箱入账后，即可设置玩家退水。'}}</p>
      </aside>
      <section v-if="selected&&draft" class="panel rebate-editor" :aria-label="selected.name+'的退水设置'">
        <header><div><h2>{{selected.name}}</h2><p>{{selected.documents.join('、')||'本空间已保存玩家'}}</p></div><small>{{overrideCount(selected.id)}}项玩法单独设置</small></header>
        <div class="player-setting-tabs" role="tablist" aria-label="玩家设置类型"><button role="tab" :aria-selected="section==='rebates'" class="button" @click="section='rebates'">玩家退水</button><button role="tab" :aria-selected="section==='odds'" class="button" @click="section='odds'">玩家赔率</button></div>
        <template v-if="section==='rebates'">
        <div class="rebate-default"><div><strong>玩家默认退水</strong><small>未单独设置的玩法使用这个值</small></div><label>每10,000元流水退 <input v-model="draft.default" :aria-label="selected.name+'每万元退水'" inputmode="decimal" placeholder="0 · 不退水" :disabled="busy||!settings" /> 元</label><b>{{percentage(draft.default)}}</b></div>
        <p class="rebate-explanation">例如每万元退100元＝1%，有效流水15,000元退150元。默认留空或填0为不退水。</p>
        <div class="rebate-play-toolbar"><strong>按玩法单独设置</strong><input v-model="playSearch" aria-label="搜索退水玩法" type="search" placeholder="搜索玩法" /><label><input v-model="overridesOnly" type="checkbox" />只看单独设置</label></div>
        <p class="rebate-explanation">下方留空＝跟随玩家默认；填写0＝此玩法不退水。金额单位均为“每万元流水退多少元”。平特肖（本命年）留空时跟随“平特肖”退水；按所选开奖日期的农历年识别，今年本命生肖为{{yearAnimal}}。</p>
        <section v-for="g in groups" :key="g.name" class="rebate-play-group"><h3>{{g.name}}</h3><div class="rebate-play-grid"><label v-for="play in g.plays" :key="play.id" :class="['rebate-play-row',{'overridden':String(draft.plays[play.id]??'').trim()!==''}]"><span>{{play.name}}<small>{{String(draft.plays[play.id]??'').trim()!==''?'单独设置':play.id==='flat-zodiac-year'?'跟随平特肖':'跟随默认'}} · {{effective(play.id)}}</small></span><input v-model="draft.plays[play.id]" :aria-label="selected.name+' '+play.name+'每万元退水'" inputmode="decimal" :placeholder="play.id==='flat-zodiac-year'?'跟随平特肖':'默认 '+(draft.default||'0')" :disabled="busy||!settings" /></label></div></section>
        <p v-if="!groups.length" class="rebate-empty">没有符合条件的玩法。</p>
        </template>
        <section v-else class="player-odds-editor" aria-label="玩家赔率设置">
          <div class="rebate-play-toolbar"><label>市场 <select v-model="oddsMarket" aria-label="玩家赔率市场"><option v-for="market in MARKETS" :key="market" :value="market">{{market}}市场</option></select></label><input v-model="oddsSearch" aria-label="搜索玩家赔率玩法" placeholder="搜索玩法" /><label><input v-model="oddsOnly" type="checkbox" />只看单独赔率</label></div>
          <p class="rebate-explanation">留空继承该市场默认赔率，修改后仅对{{selected.name}}生效；清空即可恢复继承。赔率口径、中奖范围及和局规则沿用市场设置。当前为{{settings.odds[oddsMarket].includePrincipal?'含本金':'净赢赔率，另返本金'}}。</p>
          <p class="rebate-explanation">本命年档适用于特肖、平特肖等特殊生肖玩法，连肖为“有当年生肖”档。当前市场：{{settings.odds[oddsMarket].specialAnimal==='lunar'?'随开奖日期的农历年切换（今年'+yearAnimal+'）':'固定使用马'}}。</p>
          <div class="player-odds-table"><table><thead><tr><th>玩法</th><th>普通赔率</th><th>本命年／有当年生肖赔率</th></tr></thead><tbody><tr v-for="r in oddsRows" :key="r.key"><th>{{r.label}}</th><td><input v-model="oddsDraft[r.key].rate" :aria-label="selected.name+' '+oddsMarket+' '+r.label+'普通赔率'" inputmode="decimal" :placeholder="'继承 '+inherited(r.key,'rate')" :disabled="busy" /><small>市场默认 {{inherited(r.key,'rate')}} · 生效 {{oddsDraft[r.key].rate||inherited(r.key,'rate')}}</small></td><td v-if="r.specialRate"><input v-model="oddsDraft[r.key].specialRate" :aria-label="selected.name+' '+oddsMarket+' '+r.label+'本命年赔率'" inputmode="decimal" :placeholder="'继承 '+inherited(r.key,'specialRate')" :disabled="busy" /><small>市场默认 {{inherited(r.key,'specialRate')}} · 生效 {{oddsDraft[r.key].specialRate||inherited(r.key,'specialRate')}}</small></td><td v-else>—</td></tr></tbody></table></div>
          <p v-if="!oddsRows.length" class="rebate-empty">没有符合条件的赔率。</p>
        </section>
        <footer class="rebate-editor-footer"><span>{{dirty?'有未保存修改':'退水和赔率均已保存'}}</span><button class="button primary" :disabled="busy||!dirty" @click="save().catch(()=>{})">保存所有修改</button></footer>
      </section>
      <section v-else class="panel rebate-editor rebate-empty">{{busy?'正在载入玩家退水…':'从左侧选择玩家，即可设置退水和赔率。'}}</section>
    </div>
    <p class="rebate-page-note">退水按有效流水计算，扣除退本金，待处理及待结算暂不计入；计入每天结算、账目应付、净输赢和结算截图。各空间独立保存，清空投注保留设置，已保存历史结算保留原金额。</p>
  </div>
</template>
<style scoped>
.player-setting-tabs{display:flex;gap:10px;margin-bottom:18px}.player-setting-tabs [aria-selected="true"]{background:#e3f1e8;border-color:#9fc3af;color:#215e45}.player-odds-table{overflow:auto}.player-odds-table table{width:100%;border-collapse:collapse;font-size:12px}.player-odds-table th,.player-odds-table td{text-align:left;padding:12px 8px;border-bottom:1px solid #e3ece1}.player-odds-table input{width:130px;max-width:100%}.player-odds-table small{display:block;color:#7b9083;font-size:10px;margin-top:6px}.player-odds-table thead{background:#f2f7f3}

.rebate-editor-footer{position:sticky;bottom:0;display:flex;justify-content:space-between;align-items:center;gap:12px;margin:20px -8px -10px;padding:12px 8px;border-top:1px solid #e0e9dc;background:#fffffff2;font-size:11px;color:#819281;z-index:1}
.rebate-page{padding-top:22px;padding-bottom:30px}.rebate-page-heading{flex-wrap:wrap;gap:14px;margin-bottom:20px}.rebate-page-heading h1{font-size:24px}.rebate-page-actions{display:flex;align-items:center;gap:10px}.rebate-page-actions>span{font-size:11px;color:#839485}.rebate-layout{display:grid;grid-template-columns:minmax(230px,300px) minmax(0,1fr);align-items:start;gap:18px}.rebate-people{padding:16px;position:sticky;top:80px}.rebate-people-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;font-size:13px}.rebate-people-heading small{color:#7c9585;margin-left:5px}.rebate-people-heading>span{font-size:10px;color:#7c9585}.rebate-people>input{width:100%;font-size:12px}.rebate-player-list{max-height:65vh;overflow:auto;margin-top:12px}.rebate-player{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;padding:13px 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:#476453;margin:4px 0}.rebate-player:hover{background:#f3f8f2}.rebate-player.selected{background:#edf5eb;border-color:#b1c9ae}.rebate-player>span{min-width:0}.rebate-player strong{display:block;font-size:12px;overflow-wrap:anywhere}.rebate-player small{display:block;font-size:10px;line-height:1.8;color:#7e9481;margin-top:4px;overflow-wrap:anywhere}.rebate-player-rate{text-align:right;flex:none;font-size:15px;font-weight:600}.rebate-player-rate small{font-weight:400}.rebate-editor{padding:22px;min-width:0}.rebate-editor>header{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e3ece1;padding-bottom:16px;margin-bottom:18px}.rebate-editor h2{font-size:18px;margin:0;overflow-wrap:anywhere}.rebate-editor header p{font-size:11px;color:#7a9181;margin:7px 0 0}.rebate-editor header>small{color:#7a9181;font-size:11px;white-space:nowrap}.rebate-default{display:flex;align-items:center;gap:16px;flex-wrap:wrap;border:1px solid #c9dce2;background:#f2f8fa;border-radius:8px;padding:16px}.rebate-default strong{font-size:13px;color:#3b6476}.rebate-default small{display:block;font-size:10px;color:#7d929b;margin-top:6px}.rebate-default label{display:flex;align-items:center;gap:8px;font-size:11px;color:#63818c;margin-left:auto}.rebate-default input{width:105px;font-size:15px}.rebate-default b{color:#3a7086;font-size:19px}.rebate-explanation{font-size:11px;line-height:1.9;color:#7b9083;margin:10px 0 20px}.rebate-play-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:26px}.rebate-play-toolbar strong{font-size:14px;margin-right:auto}.rebate-play-toolbar>input{width:160px;font-size:12px}.rebate-play-toolbar label{display:flex;align-items:center;gap:6px;font-size:11px;color:#6e8778}.rebate-play-group{margin-top:22px}.rebate-play-group h3{font-size:12px;color:#6a8674;margin:0 0 9px}.rebate-play-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.rebate-play-row{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #e3eae0;border-radius:7px;padding:11px 12px;font-size:12px;color:#496951;background:#fbfcfa}.rebate-play-row.overridden{border-color:#a9c4ac;background:#f1f7ee}.rebate-play-row small{display:block;color:#8a9b88;font-size:10px;margin-top:5px}.rebate-play-row input{width:95px;min-width:65px;font-size:13px}.rebate-page-note{font-size:11px;line-height:1.9;color:#819281;margin:18px 0}.rebate-error,.rebate-success,.rebate-reload-prompt{padding:12px 16px;border-radius:7px;font-size:12px;margin:12px 0;line-height:1.8}.rebate-error{color:#a33f2f;background:#fff2ed}.rebate-success{color:#2b6c4e;background:#edf6ee}.rebate-reload-prompt{background:#fff7e9;color:#9c7948}.rebate-reload-prompt button{margin-left:12px}.rebate-empty{font-size:12px;color:#8b9b8b;line-height:1.8;padding:18px 8px}@media(max-width:1150px){.rebate-layout{grid-template-columns:230px minmax(0,1fr)}.rebate-play-grid{grid-template-columns:1fr}.rebate-default label{margin-left:0}}@media(max-width:750px){.rebate-layout{grid-template-columns:1fr}.rebate-people{position:static}.rebate-player-list{max-height:250px}.rebate-editor{padding:16px}}
</style>
