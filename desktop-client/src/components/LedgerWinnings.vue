<script setup>
import {useSpace,readSpaceChoice,writeSpaceChoice} from "../space-context.js";
const space=useSpace(),songcai=space.api;
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { MARKETS, formatMoney as money, pad, today } from '../core/rules.js';
import { DRAW_SOURCES } from '../core/draws.js';
import { verifyDraws } from '../core/draw-verification.js';
import { browserSettlement } from '../settlement-preview.js';
import {ledgerDrawSelection} from '../core/draw-selection.js';
import DrawComparison from './DrawComparison.vue';
import DrawBalls from './DrawBalls.vue';
import LedgerReceipt from './LedgerReceipt.vue';
import RebateBreakdown from './RebateBreakdown.vue';
import {rebateRateLabel} from '../core/rebates.js';
import {latestNewDrawDate} from '../core/ledger-receipt.js';
import {settlementBalance} from '../core/ledger-overview.js';
import {winningEntryLabel} from '../core/winning-display.js';
const props=defineProps({document:Object,documents:Array,prepare:Function,receiptRequest:Number,settingsRevision:Number});
const receiptOpen=ref(false);

watch(()=>props.receiptRequest,value=>{if(value)receiptOpen.value=true;},{immediate:true});
const emit=defineEmits(['settings','updated','context','locate','rebates']);
const api=songcai?.settlement||browserSettlement(()=>props.documents,space.id);
const choiceKey=`songcai.winnings.choice:${props.document.id}:${props.document.businessDate}`,choice=readSpaceChoice(choiceKey,space.id);
const drawMode=ref(choice.mode||'latest'),drawDate=ref(choice.date||props.document.businessDate),selection=ref(null),manualDrawIds=ref(choice.ids||{});
const busy=ref(false),error=ref(''),loaded=ref(null),drawIds=ref({}),decisions=ref(choice.decisions||{}),trial=ref(null),saved=ref(null),reviewed=ref(false),showSources=ref(false),filter=ref('won'),page=ref(1);
watch([drawMode,drawDate,manualDrawIds,decisions],()=>writeSpaceChoice(choiceKey,space.id,{mode:drawMode.value,date:drawDate.value,ids:manualDrawIds.value,decisions:decisions.value}),{deep:true});
const request=()=>({date:props.document.businessDate,kind:'current',activeId:props.document.id,drawMode:drawMode.value,drawDate:drawDate.value,drawIds:{...drawIds.value},decisions:JSON.parse(JSON.stringify(decisions.value))});
const result=computed(()=>saved.value?.result||trial.value?.result);
const selectedDraws=computed(()=>saved.value?.inputs.draws||trial.value?.inputs.draws||{});
const receiptDate=computed(()=>latestNewDrawDate(loaded.value?.draws.新,loaded.value?.settings));
const verification=computed(()=>saved.value?.inputs.verification||(loaded.value?verifyDraws(loaded.value.draws,loaded.value.settings,selection.value?.drawDates||props.document.businessDate,drawIds.value,decisions.value,loaded.value.reports):null));
const balance=computed(()=>settlementBalance(result.value,verification.value,saved.value?.inputs.settings.odds||trial.value?.settings.odds||loaded.value?.settings.odds));
const markets=computed(()=>[...new Set(result.value?.entries.map(e=>e.market)||[])]);
const history=computed(()=>(loaded.value?.history||[]).filter(h=>h.kind==='current'&&h.selection===props.document.id));
const wins=computed(()=>result.value?.entries.filter(e=>e.status==='won')||[]);
const entries=computed(()=>(result.value?.entries||[]).filter(e=>!filter.value||e.status===filter.value));
const pages=computed(()=>Math.max(1,Math.ceil(entries.value.length/30)));
const visibleEntries=computed(()=>entries.value.slice((page.value-1)*30,page.value*30));
const basis=ref(null),viewingHistory=ref(false),needsRecalculate=ref(false);
let operation=0,loadOperation=0,alive=true,refreshTimer;
const snapshotBets=computed(()=>new Map((saved.value?.inputs.documents||trial.value?.inputs.documents||[]).flatMap(d=>d.bets).map(b=>[b.id,b])));
const entryLabel=e=>winningEntryLabel(e,snapshotBets.value.get(e.betId));
function publishContext(){
  if(!alive)return;
  const inputs=saved.value?.inputs||basis.value;
  emit('context',{documentId:props.document.id,businessDate:props.document.businessDate,ready:!!inputs,history:viewingHistory.value,
    draws:inputs?.draws||{},odds:inputs?.settings.odds||{},rebates:inputs?.settings.rebates,verification:inputs?.verification||{},drawDates:inputs?.drawDates});
}
function invalidateBasis(){operation++;basis.value=null;trial.value=null;saved.value=null;viewingHistory.value=false;publishContext();}
function queueRecalculate(){clearTimeout(refreshTimer);if(!alive||!needsRecalculate.value)return;refreshTimer=setTimeout(()=>{if(busy.value)return;action(calculate);},450);}
const canSave=computed(()=>trial.value?.result.complete&&markets.value.every(m=>trial.value.inputs.verification[m]?.confirmed&&trial.value.settings.odds[m]?.confirmed));
const labels={won:'中奖',lost:'未中奖',refund:'退本金',pending:'待结算'};
function clear(){operation++;trial.value=null;saved.value=null;viewingHistory.value=false;reviewed.value=false;page.value=1;needsRecalculate.value=true;publishContext();if(!busy.value)queueRecalculate();}
async function action(fn){if(busy.value)return;busy.value=true;error.value='';try{await fn();}catch(e){error.value=e.message;}finally{busy.value=false;if(needsRecalculate.value&&!error.value)queueRecalculate();}}
const documentKey=()=>JSON.stringify([props.document.id,props.document.businessDate,props.document.text,props.document.defaultPlayer,props.document.name,props.document.assistance,props.document.parserReview]);
async function calculate(){
  const current=++operation;await props.prepare?.();if(!alive||current!==operation)return;
  const key=documentKey(),preview=await api.preview(request());
  if(!alive||current!==operation||key!==documentKey())return;
  trial.value=preview;basis.value=preview.inputs;saved.value=null;viewingHistory.value=false;reviewed.value=false;page.value=1;needsRecalculate.value=false;publishContext();
}
async function load(preserve=true){
  const current=++loadOperation;const next=await api.load({date:props.document.businessDate,allDates:true});if(!alive||current!==loadOperation)return;loaded.value=next;
  selection.value=ledgerDrawSelection(loaded.value.draws,loaded.value.settings,{mode:drawMode.value,date:drawMode.value==='latest'?today():drawDate.value,previous:manualDrawIds.value,preserve,reports:loaded.value.reports});
  drawIds.value=selection.value.drawIds;await calculate();
  emit('updated');
}
async function changeDate(){invalidateBasis();decisions.value={};manualDrawIds.value={};drawMode.value='date';await load(false);}
async function latest(){invalidateBasis();decisions.value={};manualDrawIds.value={};drawMode.value='latest';await load(false);}
async function sync(){await api.sync({date:drawMode.value==='latest'?today():drawDate.value,latest:drawMode.value==='latest'});await load(false);}
async function selectDraw(m){invalidateBasis();manualDrawIds.value={...manualDrawIds.value,[m]:drawIds.value[m]};await calculate();}
async function adopt(m,id){invalidateBasis();manualDrawIds.value={...manualDrawIds.value,[m]:id};drawIds.value={...drawIds.value,[m]:id};decisions.value={...decisions.value,[m]:{drawId:id,reviewKey:verification.value[m].reviewKey}};await calculate();}
async function save(){
  const current=++operation,key=documentKey(),inputHash=trial.value?.inputHash,wasReviewed=reviewed.value;
  await props.prepare?.();if(!alive||current!==operation||key!==documentKey())return;
  const record=await api.save({...request(),inputHash,reviewed:wasReviewed});
  if(!alive||current!==operation||key!==documentKey())return;
  saved.value=record;viewingHistory.value=false;publishContext();
  const data=await api.load({date:props.document.businessDate,allDates:true});if(alive&&current===operation)loaded.value=data;
}
async function openHistory(id){const current=++operation,key=documentKey();const record=await api.get({id});if(!alive||current!==operation||key!==documentKey())return;if(record.inputs.kind!=='current'||record.inputs.selection!==props.document.id||record.inputs.date!==props.document.businessDate)throw new Error('该赔付版本不属于当前账目');saved.value=record;viewingHistory.value=true;needsRecalculate.value=false;clearTimeout(refreshTimer);page.value=1;publishContext();}
watch(()=>[props.document.text,props.document.defaultPlayer,props.document.name,props.document.assistance,props.document.parserReview],clear);
watch(()=>props.settingsRevision,value=>{if(loaded.value&&value!==loaded.value.settings.revision&&!viewingHistory.value){invalidateBasis();needsRecalculate.value=true;action(()=>load(true));}});
watch(filter,()=>{page.value=1;});
onBeforeUnmount(()=>{alive=false;operation++;loadOperation++;clearTimeout(refreshTimer);});
onMounted(()=>{publishContext();return action(async()=>{await load(true);if(songcai&&!songcai.isStartupCheck){await api.sync({date:today(),auto:true});await load(true);}});});
</script>

<template>
  <section class="ledger-winnings" aria-label="当前账目中奖数据">
    <header><strong>{{document.name||'当前账目'}} · {{document.businessDate}}</strong><small>仅计算这一份账目，包含其中所有玩家和玩法。原文生肖展开仍按账目业务日期。</small></header>
    <button class="receipt-entry" @click="receiptOpen=true"><span><strong>本账目结算单</strong><small>总投注 · 中奖金额 × 赔率 · 赔付 · 盈亏</small></span><b>查看 / 截图 ↗</b></button>
    <LedgerReceipt v-model:open="receiptOpen" :document="document" :result="result" :inputs="saved?.inputs||trial?.inputs" :history="viewingHistory" :loading="busy||needsRecalculate" :latest-new-date="receiptDate" />
    <button class="text-button rebate-settings-link" @click="$emit('rebates')">玩家退水设置 ↗</button>
    <div class="winning-date"><button :class="['button',{primary:drawMode==='latest'}]" :disabled="busy" @click="action(latest)">各市场最近开奖</button><label>选择开奖日期<input type="date" v-model="drawDate" :max="today()" :disabled="busy" aria-label="本单开奖日期" @change="action(changeDate)" /></label><small>{{drawMode==='latest'?'新、旧、港分别采用各自最近一期；多来源一致时自动选核对列表第一来源。':'仅使用所选日期的开奖，缺期保留待结算。'}}</small></div>
    <div class="winning-actions"><button class="button primary" :disabled="busy" @click="action(load)">{{busy?'计算中…':'刷新本单中奖数据'}}</button><button class="button" :disabled="busy" @click="action(sync)">获取开奖</button><button class="text-button" @click="$emit('settings')">赔率／开奖设置 ↗</button></div>
    <p v-if="error" class="winning-notice">{{error}}</p><p v-if="loaded&&!result&&!busy&&!error" class="winning-note">{{needsRecalculate?'原文已变更，正在更新本单中奖数据…':'请选择开奖并刷新本单中奖数据。'}}</p>
    <p v-if="saved" class="winning-saved">本账目已保存版本 · {{new Date(saved.createdAt).toLocaleString('zh-CN')}}。保存后修改原文不会改写这个版本。<button class="text-button" :disabled="busy" @click="action(load)">返回当前账目</button></p>
    <div v-if="result" class="winning-metrics"><div><small>本单投注</small><strong>¥ {{money(result.stakeCents)}}</strong></div><div><small>中奖笔数／注数</small><strong>{{wins.length}} / {{wins.reduce((n,e)=>n+e.winCount,0)}}</strong></div><div><small>{{result.complete?'应付合计':'已算应付（未完成）'}}</small><strong>¥ {{money(result.payableCents??result.payoutCents)}}</strong></div><div><small>其中退水</small><strong>¥ {{money(result.rebateCents||0)}}</strong></div><div class="winning-net"><small>玩家净输赢{{balance.status==='trial'?'（试算）':''}}</small><strong :class="{'profit-positive':balance.netCents>0,'profit-negative':balance.netCents<0}">{{balance.netCents===null?'待结算':`${balance.netCents>0?'赢 +':balance.netCents<0?'输 −':'持平 '}${money(Math.abs(balance.netCents))}`}}</strong><small>应付金额 − 投注总额</small></div><div><small>待结算／原文问题</small><strong>{{result.pending}} / {{result.issues.length}}</strong></div></div>
    <template v-if="result"><p class="winning-note">其中退本金 {{money(result.refundCents)}}元。应付＝赔付＋退水，不代表已经付款。</p><div class="winning-markets"><div v-for="m in markets" :key="m"><strong>{{m}}市场</strong><span>投注 {{money(result.entries.filter(e=>e.market===m).reduce((n,e)=>n+e.stakeCents,0))}}</span><span>已算赔付 {{money(result.entries.filter(e=>e.market===m).reduce((n,e)=>n+(e.payoutCents||0),0))}}<small v-if="result.entries.some(e=>e.market===m&&e.status==='pending')"> · {{result.entries.filter(e=>e.market===m&&e.status==='pending').length}}笔待结算</small></span></div></div><p v-if="!saved&&markets.some(m=>!verification?.[m]?.confirmed)" class="winning-notice">尚有市场缺少开奖或未完成多站核对，当前为试算。请核对并采用所选期的结果。</p><p v-if="!saved&&markets.some(m=>!loaded?.settings.odds[m]?.confirmed)" class="winning-notice">赔率与中奖范围尚未确认，请到“赔率／开奖设置”中核对后保存设置。</p><p v-for="i in result.issues.slice(0,8)" :key="i.id" class="winning-notice">第{{i.line}}行：{{i.message}}</p></template>
    <div v-if="result?.players.some(p=>p.perTenThousandCents||Object.keys(p.playRates||{}).length)" class="winning-rebates"><p v-for="p in result.players.filter(p=>p.perTenThousandCents||Object.keys(p.playRates||{}).length)" :key="p.id">{{p.name}} · 有效流水 {{money(p.turnoverCents)}} · {{rebateRateLabel(p)}}＝退水 <strong>{{money(p.rebateCents)}}元</strong></p></div>
    <RebateBreakdown v-if="result" :players="result.players" />
    <div v-if="result" class="winning-draws">
      <div v-for="m in markets" :key="m" class="winning-draw">
        <div class="winning-draw-heading"><strong>{{m}}市场 · {{selectedDraws[m]?.issue||'未开奖'}}<template v-if="selectedDraws[m]">期</template></strong><small v-if="selectedDraws[m]">{{selectedDraws[m].date}} · {{selectedDraws[m].sourceName}}</small></div>
        <DrawBalls v-if="selectedDraws[m]" :numbers="selectedDraws[m].numbers" :date="selectedDraws[m].date" />
        <span v-else>所选日期／最近一期缺少可采用的开奖</span>
      </div>
    </div>
    <button class="text-button source-toggle" @click="showSources=!showSources">{{showSources?'收起开奖依据':'核对／选择开奖依据'}} ▾</button>
    <div v-if="showSources&&loaded" class="winning-sources"><template v-for="m in (markets.length?markets:MARKETS)" :key="m"><label v-if="!saved">{{m}}市场<select v-model="drawIds[m]" :aria-label="'本单'+m+'市场开奖'" :disabled="busy" @change="action(()=>selectDraw(m))"><option value="">请选择本期结果</option><option v-for="d in selection?.choices[m]||[]" :key="d.id" :value="d.id">{{d.date}} · {{d.issue}} · {{d.numbers.map(pad).join(' ' )}} · {{d.sourceName}}</option></select></label><DrawComparison :comparison="verification[m]" :readonly="!!saved" :busy="busy" @adopt="id=>action(()=>adopt(m,id))" @open="id=>action(()=>api.openSource({id}))" /></template></div>
    <template v-if="result"><div class="winning-detail-toolbar"><strong>本单中奖明细</strong><select v-model="filter" aria-label="本单中奖筛选"><option value="won">只看中奖</option><option value="">全部投注</option><option value="lost">未中奖</option><option value="pending">待结算</option><option value="refund">退本金</option></select></div><details v-for="e in visibleEntries" :key="e.id" class="winning-entry"><summary><span class="winning-entry-player">{{e.player}} · {{e.market}}市场</span><span class="winning-entry-outcome"><em>{{labels[e.status]}}</em><span v-if="e.status==='won'" class="winning-entry-stake">{{entryLabel(e)}}</span><span v-else>{{e.play}} · 投注{{money(e.stakeCents)}}元</span><strong>{{e.status==='refund'?'退回':'赔付'}} {{e.payoutCents===null?'待结算':money(e.payoutCents)+'元'}}</strong><small v-if="e.status==='won'&&e.winCount>1">中{{e.winCount}}注</small></span><button v-if="!viewingHistory" class="text-button winning-locate" @click.stop.prevent="$emit('locate',{fileId:document.id,line:e.line,endLine:e.endLine||e.line})">第{{e.line}}行 · 定位原文 ↗</button></summary><p>{{e.raw}}</p><small>第{{e.line}}行 · {{e.drawDate||'缺少开奖'}} · {{e.issue||'—'}}期 · 投注{{money(e.stakeCents)}}元 · 中{{e.winCount??'—'}}注</small><p>{{e.note}}</p><button v-if="!viewingHistory" class="text-button" @click="$emit('locate',{fileId:document.id,line:e.line,endLine:e.endLine||e.line})">定位原文 →</button><p v-for="(t,i) in e.tiers" :key="i">{{t.count}}注 × {{money(t.unitPayoutCents)}}元（{{t.rate}}倍）＝ {{money(t.payoutCents)}}元</p></details><p v-if="!entries.length" class="winning-note">{{filter==='won'?'当前没有已确认中奖的记录；如有待结算项，请先补齐开奖或处理原文。':'当前筛选无记录。'}}</p><div class="pagination"><span>{{entries.length}}笔</span><button :disabled="page===1" @click="page--">上一页</button>{{page}} / {{pages}}<button :disabled="page===pages" @click="page++">下一页</button></div><div v-if="!saved" class="winning-confirm"><label><input v-model="reviewed" type="checkbox" :disabled="busy||!canSave" />已核对本账目开奖、赔率与金额</label><button class="button primary" :disabled="busy||!canSave||!reviewed" @click="action(save)">保存本账目赔付</button></div></template>
    <div v-if="saved?.parserReview?.required" class="winning-notice">{{saved.parserReview.message}}<p v-if="saved.parserReview.beforePayoutCents!=null">原应付 {{money(saved.parserReview.beforePayoutCents)}}元 → 新解释应付 {{saved.parserReview.afterPayoutCents==null?'待处理':money(saved.parserReview.afterPayoutCents)+'元'}}</p><details v-if="saved.parserReview.documents"><summary>查看受影响原文</summary><div v-for="d in saved.parserReview.documents" :key="d.id">{{d.name}}：<p v-for="c in d.changes" :key="c.line">第{{c.line}}行 · {{c.before.map(b=>b.play+'／'+b.basis+'／'+money(b.totalCents)+'元').join('；')||'无投注'}} → {{c.after.map(b=>b.play+'／'+b.basis+'／'+money(b.totalCents)+'元').join('；')||'待处理'}}</p></div></details></div><div class="winning-history"><strong>本账目的赔付记录</strong><button v-for="h in history" :key="h.id" :disabled="busy" @click="action(()=>openHistory(h.id))">{{new Date(h.createdAt).toLocaleString('zh-CN')}} · 应付 {{money(h.payableCents??h.payoutCents)}}元 <small v-if="h.parserReviewRequired">· 解析变化待复核</small></button><small v-if="!history.length">尚无保存记录</small></div>
  </section>
</template>

<style scoped>
.receipt-entry{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;text-align:left;margin:14px 0;padding:15px;border:1px solid #c8dece;border-radius:10px;background:#f0f7f2;color:#2d6144;cursor:pointer}.receipt-entry strong{font-size:15px}.receipt-entry small{display:block;font-size:11px;color:#789280;margin-top:6px}.receipt-entry b{font-size:12px;white-space:nowrap}
.ledger-winnings{padding:0 17px 20px;max-height:800px;overflow:auto;font-size:11px}.ledger-winnings header strong,.ledger-winnings header small{display:block}.ledger-winnings header strong{font-size:12px}.ledger-winnings header small{color:#819879;margin:8px 0 15px;line-height:1.8}.winning-date{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.winning-date label{display:flex;align-items:center;gap:7px;font-size:10px}.winning-date input{font-size:11px}.winning-date small{width:100%;color:#86977c;line-height:1.8}.winning-date .button{font-size:10px;padding:7px 9px}.winning-actions{display:flex;gap:8px;flex-wrap:wrap}.winning-actions .button,.winning-confirm .button{font-size:10px;padding:8px 10px}.winning-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}.winning-metrics>div{padding:13px;background:#f1f7ed;border-radius:6px}.winning-metrics small{display:block;color:#849475;font-size:10px}.winning-metrics strong{font-size:18px;display:block;color:#467346;margin-top:8px}.winning-note{font-size:10px;color:#879778;line-height:1.9;margin:12px 0}.winning-notice{background:#fff5e8;color:#9c7443;padding:10px;line-height:1.8;margin:12px 0;border-radius:5px}.winning-saved{background:#edf5ed;color:#467b4e;padding:10px;line-height:1.8;margin:12px 0}.winning-markets>div{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf1e8}.winning-draws{margin-top:12px;border:1px solid #e8eee2;border-radius:7px;padding:4px 12px}.winning-draw{padding:12px 0}.winning-draw+.winning-draw{border-top:1px solid #e8eee2}.winning-draw-heading{display:flex;align-items:baseline;gap:5px 12px;flex-wrap:wrap;margin-bottom:10px;line-height:1.8}.winning-draw-heading strong{font-size:11px}.winning-draw-heading small{color:#7e8e73;font-size:10px}.source-toggle{margin:14px 0}.winning-sources label{display:grid;gap:7px}.winning-sources select{width:100%;font-size:10px}.winning-sources :deep(.draw-comparison){padding:12px}.winning-sources :deep(.draw-comparison header){flex-wrap:wrap}.winning-detail-toolbar{display:flex;align-items:center;justify-content:space-between;margin:12px 0}.winning-detail-toolbar select{font-size:10px}.winning-entry{border-bottom:1px solid #e9eee4}.winning-entry summary{display:flex;gap:9px;align-items:center;cursor:pointer;padding:12px 0}.winning-entry summary{flex-wrap:wrap;gap:8px}.winning-entry summary .winning-entry-player{width:100%;font-size:12px;color:#526e57}.winning-entry-outcome{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 10px;width:100%;font-size:13px}.winning-entry summary .winning-entry-stake{flex:none;color:#315940}.winning-entry-outcome strong{margin-left:auto;font-size:14px;white-space:nowrap}.winning-entry-outcome small{font-size:11px}.winning-entry-outcome em{font-weight:600}.winning-entry em{font-style:normal;color:#749365}.winning-entry strong{color:#45804b}.winning-entry p{margin:8px 0;color:#77916a;line-height:1.8;white-space:pre-wrap}.winning-entry small{color:#9aa78f;font-size:9px}.winning-confirm{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:14px 0}.winning-confirm label{display:flex;gap:7px;align-items:center;font-size:10px}.winning-history{border-top:1px solid #e3ebdc;margin-top:15px;padding-top:15px}.winning-history button{display:block;text-align:left;padding:10px 0;color:#648853}.winning-history small{display:block;margin-top:10px;color:#9dab90}
</style>
