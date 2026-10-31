<script setup>
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import {ledgerSegments,segmentWinningDetail,segmentCopyText} from '../core/ledger-segments.js';
import {segmentTableSvg} from '../core/segment-table.js';
import {receiptPng,exportReceiptImage} from '../receipt-image.js';
import {formatMoney as money} from '../core/rules.js';
import {drawBasisLabel,payoutTierLabel} from '../core/winning-display.js';
import {receiptMarketName} from '../core/ledger-receipt.js';
const props=defineProps({document:Object,parsed:Object,result:Object,basis:Object,fresh:Boolean});
const emit=defineEmits(['locate','draws']);
const page=ref(1),filter=ref('all'),notice=ref(''),exporting=ref(false),pageSize=10;
let alive=true;onBeforeUnmount(()=>{alive=false;});
const data=computed(()=>{try{return ledgerSegments(props.document,props.parsed,props.result,{fresh:props.fresh,history:props.basis?.history});}catch(e){return {rows:[],count:0,ready:false,error:e.message};}});
const trial=row=>row.entries.some(e=>e.status!=='pending'&&!(props.basis?.verification?.[e.market]?.confirmed&&props.basis?.odds?.[e.market]?.confirmed));
const rows=computed(()=>data.value.rows.filter(r=>filter.value==='all'||filter.value==='won'&&r.wins?.length||filter.value==='pending'&&(r.pending||r.issueCount)));
const pages=computed(()=>Math.max(1,Math.ceil(rows.value.length/pageSize)));
const current=computed(()=>rows.value.slice((page.value-1)*pageSize,page.value*pageSize));
const bets=computed(()=>new Map((props.parsed?.bets||[]).map(b=>[b.id,b])));
const details=row=>row.wins.map(entry=>({entry,detail:segmentWinningDetail(entry,bets.value.get(entry.betId),props.document,props.basis)}));
const visibleDetails=computed(()=>Object.fromEntries(data.value.ready?current.value.map(r=>[r.index,details(r)]):[]));
const drawLabel=computed(()=>drawBasisLabel(props.basis?.draws));
const summary=computed(()=>({wins:data.value.rows.reduce((s,r)=>s+(r.winCount||0),0),pending:data.value.rows.reduce((s,r)=>s+(r.pending||0),0),issues:data.value.rows.reduce((s,r)=>s+(r.issueCount||0),0)}));
const displayStatus=row=>!row.bets.length?(row.issueCount?'待处理':'说明段'):!data.value.settlementReady?'待计算中奖':!row.complete?'未结算完整':trial(row)?'试算':row.wins.length?'已中奖':'未中奖';
watch(()=>props.document.id,()=>{page.value=1;filter.value='all';notice.value='';});
watch(filter,()=>{page.value=1;});watch(pages,n=>{page.value=Math.min(page.value,n);});
const copyReady=computed(()=>data.value.ready&&data.value.count>0);
const copyKey=()=>JSON.stringify([props.document.id,props.document.text,props.fresh,data.value.ready,data.value.rows.map(r=>[r.index,r.stakeCents])]);
async function copy(row){
 if(!copyReady.value)return;
 const key=copyKey();notice.value='';
 try{
  await navigator.clipboard.writeText((row?[row]:data.value.rows).map(segmentCopyText).join('\n'));
  if(alive&&key===copyKey())notice.value=row?`已复制第${row.index}段投注金额`:'已复制全部段号和投注金额';
 }catch{if(alive&&key===copyKey())notice.value='复制失败，请重试';}
}
async function copyImage(){
 if(!copyReady.value||exporting.value)return;
 const key=copyKey();exporting.value=true;notice.value='';
 try{
  const png=await receiptPng(segmentTableSvg(data.value.rows));
  if(!alive)return;
  if(key!==copyKey())throw new Error('账目已更新，请重新复制图片');
  const result=await exportReceiptImage({dataUrl:png,name:'分段投注表.png',action:'copy'});
  if(alive&&key===copyKey())notice.value=result.copied?'表格图片已复制，可直接粘贴到微信':result.saved?'表格图片已下载，可发送到微信':'图片未复制，请重试';
 }catch(e){if(alive)notice.value=e.message||'图片复制失败，请重试';}
 finally{if(alive)exporting.value=false;}
}
</script>

<template>
 <section class="ledger-segments" aria-label="分段对账">
  <header><div><strong>{{document.name||'当前账目'}} · 共 {{data.count}} 段</strong><small>以空白行分段，连续多条空白行只分隔一次；同段内的普通换行不拆段。</small></div><div class="segment-copy-actions"><button class="button" data-segment-copy-text :disabled="!copyReady" @click="copy()">复制金额文字</button><button class="button" data-segment-copy-image :disabled="!copyReady||exporting" @click="copyImage()">{{exporting?'生成图片中…':'复制表格图片'}}</button></div></header>
  <p class="segment-basis">开奖依据：{{drawLabel}} <button class="text-button" @click="emit('draws')">选择／核对开奖 ↗</button></p>
  <p class="segment-note">仅查看当前账目的完整原文；金额沿用本单解析和赔付，赔付不含退水。复制仅含全部段号和已计投注金额，不受筛选或分页影响。</p>
  <p v-if="data.error" class="segment-warning" role="status">{{data.error}}</p>
  <p v-else-if="basis?.history" class="segment-warning">正在查看历史赔付。当前原文只显示分段投注，返回当前账目中奖数据后再核对中奖。</p>
  <p v-else-if="!data.settlementReady" class="segment-warning">中奖数据尚未就绪；已计投注照常显示，不把尚未结算的投注当成未中奖。</p>
  <template v-if="data.ready">
   <div class="segment-totals"><div><small>分段已计投注合计</small><strong data-segment-total>¥ {{money(data.stakeCents)}}</strong></div><div><small>中奖注数</small><strong>{{data.settlementReady?summary.wins:'—'}}</strong></div><div><small>已算赔付 · 不含退水</small><strong data-segment-payout>{{data.settlementReady?'¥ '+money(data.payoutCents):'待计算'}}</strong></div></div>
   <div class="segment-toolbar"><label>显示<select v-model="filter" aria-label="分段筛选"><option value="all">全部段落</option><option value="won">有中奖的段落</option><option value="pending">待处理／待结算</option></select></label><span>{{rows.length}}段<template v-if="summary.issues"> · 原文待处理 {{summary.issues}}项</template></span></div>
   <article v-for="row in current" :key="document.id+':'+row.index" class="segment-card" :class="{'segment-won':row.wins.length}" :data-segment="row.index">
    <header><button class="segment-title" @click="emit('locate',row)" :aria-label="`定位第${row.index}段原文`"><b>第 {{row.index}} 段</b><small>第 {{row.line}}–{{row.endLine}} 行 ↗</small></button><span class="segment-state">{{displayStatus(row)}}</span><button class="text-button" @click="copy(row)">复制本段</button></header>
    <div class="segment-amounts"><div><small>{{row.issueCount?'已计投注':'投注金额'}}</small><strong :data-segment-stake="row.stakeCents">¥ {{money(row.stakeCents)}}</strong></div><div><small>中奖投注</small><strong>{{data.settlementReady?'¥ '+money(row.winningStakeCents):'待计算'}}</strong></div><div><small>{{row.pending?'已算赔付':'赔付'}} · 不含退水</small><strong :data-segment-payout="row.payoutCents">{{data.settlementReady?'¥ '+money(row.payoutCents):'待计算'}}</strong></div></div>
    <p class="segment-markets"><span v-for="m in row.markets" :key="m">{{receiptMarketName(m)}} {{money(row.marketAmounts[m])}}元</span><span>{{row.bets.length}}笔投注</span></p>
    <div v-if="row.wins.length" class="segment-winners"><div v-for="{entry,detail} in visibleDetails[row.index]" :key="entry.id"><button class="text-button" @click="emit('locate',entry)">{{receiptMarketName(entry.market)}} · {{entry.play}} · 第{{entry.line}}行 ↗</button><strong class="segment-winning-values">中：{{detail.text}}</strong><small v-if="detail.partial">明细较多或尚未完整展开，注数与金额以本单中奖汇总为准。</small><span>中奖投注 {{money(entry.winningStakeCents)}}元 · {{entry.winCount}}注 · 赔付 <b>{{money(entry.payoutCents)}}元</b></span><small v-for="(tier,i) in entry.tiers" :key="i">{{payoutTierLabel(tier)}} {{tier.count}}注 × {{money(entry.unitCents)}}元 · 赔率 {{tier.rate}} · 赔付 {{money(tier.payoutCents)}}元</small></div></div>
    <p v-else-if="row.complete&&row.bets.length" class="segment-note">{{trial(row)?'按当前开奖试算，本段暂未中奖。':'本段未中奖。'}}</p>
    <p v-if="row.refundCents" class="segment-note">赔付中含退本金 {{money(row.refundCents)}}元。</p>
    <p v-if="row.pending||row.issueCount" class="segment-warning">{{row.pending?`${row.pending}笔待结算`:'原文仍有待处理'}}{{row.issueCount?` · ${row.issueCount}项原文待处理` : ''}}，本段金额尚需核对。</p>
    <p v-for="e in row.entries.filter(e=>e.status==='pending')" :key="e.id" class="segment-note">{{receiptMarketName(e.market)}} 第{{e.line}}行：{{e.note}}</p>
    <button v-for="i in row.issues" :key="i.id" class="segment-issue" @click="emit('locate',{...i,fileId:document.id})">第{{i.line}}行：{{i.message}} ↗</button>
    <p v-if="row.crossBoundary.length" class="segment-warning">有 {{row.crossBoundary.length}}笔投注被原解析跨空行合并，完整金额只归入起始段，没有重复计算。请定位原文核对。</p>
    <details class="segment-source"><summary>查看本段原文</summary><pre>{{row.raw}}</pre><button class="text-button" @click="emit('locate',row)">定位编辑原文 ↗</button></details>
   </article>
   <p v-if="!rows.length" class="segment-note">{{data.count?'当前筛选没有段落。':'当前账目没有投注原文。'}}</p>
   <div v-if="pages>1" class="pagination"><span>每页 {{pageSize}}段</span><button :disabled="page===1" @click="page--">上一页</button><span>{{page}} / {{pages}}</span><button :disabled="page>=pages" @click="page++">下一页</button></div>
  </template>
  <p v-if="notice" class="segment-note" role="status">{{notice}}</p>
 </section>
</template>
<style scoped>
.segment-copy-actions{display:flex;gap:8px;flex-wrap:wrap}.ledger-segments{padding:0 16px 20px;font-size:12px;min-width:0;max-height:900px;overflow:auto}.ledger-segments>header,.segment-card>header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.ledger-segments>header strong{font-size:16px}.ledger-segments>header small{display:block;line-height:1.8;margin-top:7px;color:#718371}.ledger-segments .button{font-size:11px;padding:8px 12px}.segment-basis,.segment-note{font-size:11px;color:#6b806d;line-height:1.8;margin:10px 0}.segment-totals,.segment-amounts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0}.segment-totals>div{padding:11px;background:#eff5f0;border-radius:7px}.segment-totals small,.segment-amounts small{display:block;font-size:10px;color:#728774;margin-bottom:6px}.segment-totals strong,.segment-amounts strong{font-size:17px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;color:#35583e}.segment-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0;color:#718374}.segment-toolbar label{display:flex;align-items:center;gap:8px}.segment-toolbar select{font-size:12px}.segment-card{border:1px solid #dce5dd;border-radius:8px;background:#fff;padding:13px;margin:12px 0}.segment-card.segment-won{border-color:#ceb57a;background:#fffef8}.segment-title{text-align:left;display:flex;gap:9px;align-items:center;cursor:pointer}.segment-title b{font-size:15px;color:#355d46}.segment-title small,.segment-state{font-size:10px;color:#798a78}.segment-state{margin-left:auto}.segment-markets{display:flex;gap:8px 15px;flex-wrap:wrap;color:#78907a;font-size:11px;margin:10px 0}.segment-winners>div{padding:10px;background:#fff5d9;border-radius:6px;margin:8px 0;display:grid;gap:6px;line-height:1.6;overflow-wrap:anywhere}.segment-winners .text-button{text-align:left;font-size:11px}.segment-winning-values{font-size:14px;color:#85612b}.segment-winners small{font-size:10px;color:#887656}.segment-warning{background:#fff4e7;color:#946739;border-radius:5px;padding:9px;font-size:11px;line-height:1.8;margin:10px 0}.segment-source{border-top:1px solid #e8ece5;padding-top:9px;margin-top:12px;color:#708371;font-size:11px}.segment-source summary{cursor:pointer}.segment-source pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.8;padding:10px;background:#f7f9f5;max-height:260px;overflow:auto}.segment-issue{display:block;text-align:left;font-size:11px;color:#976b38;line-height:1.8;margin:6px 0}
</style>
