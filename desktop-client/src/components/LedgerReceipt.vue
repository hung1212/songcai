<script setup>
import {useSpace} from "../space-context.js";
const space=useSpace();
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {ledgerReceipt,receiptPages,receiptSvg,receiptMoney,receiptFormula,receiptFilename,receiptMarketName,receiptRebateFormula} from '../core/ledger-receipt.js';
import {receiptPng,exportReceiptImage} from '../receipt-image.js';
import {receiptPreferences} from '../receipt-preferences.js';
const showName=receiptPreferences.showName,showPlayStakes=receiptPreferences.showPlayStakes;
const props=defineProps({open:Boolean,document:Object,result:Object,inputs:Object,history:Boolean,loading:Boolean,latestNewDate:String});
const emit=defineEmits(['update:open']);
const dialog=ref(null),page=ref(0),exporting=ref(false),message=ref(''),error=ref('');let alive=true;
const state=computed(()=>{try{return {card:ledgerReceipt(props)};}catch(e){return {error:e.message};}});
const cards=computed(()=>state.value.card?receiptPages(state.value.card,{showPlayStakes:showPlayStakes.value}):[]);
const card=computed(()=>cards.value[Math.min(page.value,cards.value.length-1)]);
const rendered=computed(()=>card.value?receiptSvg(card.value,{showName:showName.value,showPlayStakes:showPlayStakes.value}):null);
const playStakeDescription=computed(()=>showPlayStakes.value?(card.value?.playStakeRows||[]).map(row=>`${row.name}投注${receiptMoney(row.stakeCents)}元`).join('，'):'');
const preview=computed(()=>rendered.value?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(rendered.value.svg):'');
const exportKey=()=>JSON.stringify([props.loading,props.document.id,rendered.value?.svg]);
watch(()=>[props.open,props.document.id],async()=>{message.value='';error.value='';page.value=0;await nextTick();if(props.open&&!dialog.value.open)dialog.value.showModal();else if(!props.open&&dialog.value.open)dialog.value.close();},{immediate:true});
watch(()=>rendered.value,()=>{message.value='';error.value='';});
watch(()=>cards.value.length,count=>{page.value=Math.max(0,Math.min(page.value,count-1));});
function close(){if(exporting.value)return;emit('update:open',false);}
function changeNameVisibility(event){
  try{receiptPreferences.setShowName(event.target.checked);error.value='';}
  catch(e){event.target.checked=showName.value;error.value='显示设置保存失败：'+e.message;}
}
function changePlayStakeVisibility(event){
  try{receiptPreferences.setShowPlayStakes(event.target.checked);error.value='';}
  catch(e){event.target.checked=showPlayStakes.value;error.value='显示设置保存失败：'+e.message;}
}
async function capture(action){
  if(!rendered.value||props.loading||exporting.value)return;
  const key=exportKey(),snapshot=rendered.value,name=space.name.replace(/[\\/:*?"<>|]/g,"_")+"-"+receiptFilename(card.value);exporting.value=true;error.value='';message.value='';
  try{
    const dataUrl=await receiptPng(snapshot);if(!alive||key!==exportKey())throw new Error('账目或开奖已更新，请重新截图');
    const result=await exportReceiptImage({dataUrl,name,action});
    if(alive)message.value=result.copied?'截图已复制，可直接粘贴到微信':result.saved?'图片已保存':'';
  }catch(e){if(alive)error.value=e.message+(action==='copy'?'，也可以使用“保存图片”。':'');}
  finally{if(alive)exporting.value=false;}
}
onBeforeUnmount(()=>{alive=false;dialog.value?.close();});
</script>

<template>
  <Teleport to="body"><dialog ref="dialog" class="receipt-dialog" aria-label="本账目结算单" @cancel.prevent="close" @close="emit('update:open',false)">
    <header class="receipt-toolbar"><div><strong>账目结算单</strong><small>仅包含当前账目，可截图发给对应负责人</small></div><button class="receipt-close" aria-label="关闭结算单" :disabled="exporting" @click="close">×</button></header>
    <div class="receipt-display-settings"><label><input type="checkbox" :checked="showName" :disabled="exporting" @change="changeNameVisibility" />显示账单名</label><label><input type="checkbox" :checked="showPlayStakes" :disabled="exporting" @change="changePlayStakeVisibility" />显示各玩法投注金额</label><small>统一应用于所有账单，自动保存</small></div>
    <div class="receipt-preview-scroll">
      <p v-if="loading" class="receipt-empty" role="status">正在更新本账目的金额…</p>
      <p v-else-if="state.error" class="receipt-error" role="alert">{{state.error}}</p>
      <template v-else-if="card">
        <img class="receipt-preview" :src="preview" :width="rendered.width" :height="rendered.height" :alt="`${showName?card.name+'，':''}${card.markets.map(m=>receiptMarketName(m.market)+(m.date?' '+m.date:'')).join('，')}，总投注${receiptMoney(card.stakeCents)}元${playStakeDescription?'，'+playStakeDescription:''}，赔付${receiptMoney(card.payoutCents)}元${card.hasRebate?'，退水'+receiptMoney(card.rebateCents)+'元，应付'+receiptMoney(card.payableCents)+'元':''}，${card.netLabel}${card.netCents===null?'':receiptMoney(Math.abs(card.netCents))+'元'}`" />
        <div class="receipt-accessible"><p><span v-if="showName">{{card.name}} · </span>{{card.date}} · {{card.statusLabel}}</p><p>总：{{receiptMoney(card.stakeCents)}}，赔付：{{receiptMoney(card.payoutCents)}}</p><template v-if="showPlayStakes"><p v-for="row in card.playStakeRows" :key="row.key">{{row.name}}投注{{receiptMoney(row.stakeCents)}}元</p></template><p v-for="market in card.markets" :key="market.market">{{receiptMarketName(market.market)}} {{market.date}} {{market.issue}}：{{market.balls.length?market.balls.map(b=>`${b.special?'特码':'正码'}${b.number} ${b.animal}`).join('、'):market.drawState==='missing'?'暂无开奖':'开奖资料不完整'}}</p><p v-for="row in card.rows" :key="row.key">{{receiptMarketName(row.market)}} {{row.play}} {{row.detail}}：{{receiptFormula(row)}}＝{{receiptMoney(row.payoutCents)}}</p><p v-if="card.hasRebate">退水：{{receiptMoney(card.rebateCents)}}，应付：{{receiptMoney(card.payableCents)}}</p><p v-for="row in card.rebateRows" :key="row.key">{{row.name}}退水：{{receiptMoney(row.rebateCents)}}元，{{receiptRebateFormula(row)}}</p><p>{{card.netLabel}}：{{card.netCents===null?'待结算':receiptMoney(Math.abs(card.netCents))}}</p><p v-for="warning in card.warnings" :key="warning">{{warning}}</p></div>
      </template>
      <p v-else class="receipt-empty">尚无结算数据，请先获取开奖并计算本账目。</p>
    </div>
    <footer class="receipt-controls"><div v-if="cards.length>1" class="receipt-pages"><button class="button" :disabled="page===0||exporting" @click="page--">上一页</button><span>第 {{page+1}} / {{cards.length}} 页 · 每页均含全单总额</span><button class="button" :disabled="page===cards.length-1||exporting" @click="page++">下一页</button></div><p v-if="error" role="alert" class="receipt-error">{{error}}</p><p v-if="message" role="status" class="receipt-success">{{message}}</p><div class="receipt-export-actions"><span>完整{{cards.length>1?'本页':'账单'}} · 高清 PNG</span><button class="button" :disabled="loading||!card||exporting" @click="capture('save')">保存图片</button><button class="button primary" :disabled="loading||!card||exporting" @click="capture('copy')">{{exporting?'正在生成…':'截图并复制'}}</button></div></footer>
  </dialog></Teleport>
</template>

<style scoped>
.receipt-display-settings{display:flex;align-items:center;flex-wrap:wrap;gap:8px 18px;padding:12px 24px;background:#fff;border-bottom:1px solid #e3eae4}.receipt-display-settings label{display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}.receipt-display-settings input{accent-color:#28674e;width:16px;height:16px}.receipt-display-settings small{font-size:12px;color:#788c80}

.receipt-dialog{padding:0;border:1px solid #d8e3dc;border-radius:18px;width:min(720px,calc(100vw - 48px));max-width:none;max-height:calc(100vh - 48px);color:#244835;box-shadow:0 24px 90px #173d3933;background:#f3f6f4;overflow:hidden}.receipt-dialog[open]{display:flex;flex-direction:column}.receipt-dialog::backdrop{background:#162d2b80;backdrop-filter:blur(3px)}.receipt-toolbar{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:18px 24px;background:#fff;border-bottom:1px solid #e3eae4}.receipt-toolbar strong{font-size:18px}.receipt-toolbar small{display:block;color:#788c80;font-size:12px;margin-top:5px}.receipt-close{font-size:28px;color:#688273;border:0;background:transparent;cursor:pointer;width:36px;height:36px}.receipt-preview-scroll{overflow:auto;min-height:120px;padding:22px 30px}.receipt-preview{display:block;width:100%;height:auto;box-shadow:0 5px 24px #314c3512;border-radius:10px}.receipt-controls{padding:14px 24px 18px;background:#fff;border-top:1px solid #e3eae4}.receipt-export-actions,.receipt-pages{display:flex;align-items:center;justify-content:space-between;gap:10px}.receipt-export-actions>span{margin-right:auto;color:#839183;font-size:12px}.receipt-export-actions .button{font-size:14px;padding:10px 17px}.receipt-pages{margin-bottom:14px;font-size:12px;color:#738374}.receipt-empty{padding:35px 20px;text-align:center;color:#7a8b7e}.receipt-error{color:#ab603b;font-size:13px;line-height:1.6}.receipt-success{color:#286448;font-size:13px;margin:0 0 12px}.receipt-accessible{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}@media(max-width:700px){.receipt-preview-scroll{padding:12px}.receipt-toolbar,.receipt-controls{padding:14px}.receipt-export-actions{flex-wrap:wrap}.receipt-export-actions>span{width:100%}}
</style>
