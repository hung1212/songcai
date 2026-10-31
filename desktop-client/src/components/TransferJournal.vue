<script setup>
import {computed,ref,watch,onMounted,onBeforeUnmount} from 'vue';
import {useSpace} from '../space-context.js';
import {browserTransfers} from '../transfer-preview.js';
import {decimalUnits,incrementalPlan,transferPosition,transferRecordScope,validateTransferRecord} from '../core/transfer-journal.js';
import {formatMoney as money,pad} from '../core/rules.js';
import {MARKET_NAMES} from '../core/special-number-highlights.js';
const props=defineProps({book:Object,results:Array,allRecords:Boolean,enabled:Boolean,sourceError:String});
const emit=defineEmits(['change']);
const space=useSpace(),api=space.api?.settlement||browserTransfers(space.id);
const records=ref([]),loading=ref(true),saving=ref(false),error=ref(''),notice=ref('');
const mode=ref('average'),rate=ref('47.3'),rebate=ref('3.3'),maxLoss=ref('2000'),maxNew=ref(8),view=ref('proposal');
const draft=ref(null),voidId=ref(''),voidReason=ref(''),deleteId=ref(''),suggestionSort=ref('amount-desc');let token=0,alive=true;
const contextKey=computed(()=>`${props.book.date}:${props.book.market}:${props.allRecords?'all':props.results.map(d=>d.id).sort().join('|')}`);
const scope=computed(()=>{try{return {...transferRecordScope(records.value,{date:props.book.date,market:props.book.market,period:props.book.period,documentIds:props.allRecords?null:props.results.map(d=>d.id)}),error:''};}catch(e){return {records:[],sharedCount:0,error:e.message};}});
const position=computed(()=>{try{return {value:transferPosition(props.book,scope.value.records)};}catch(e){return {error:e.message};}});
const activeRecords=computed(()=>scope.value.records.filter(r=>!r.voidedAt));
const calculation=computed(()=>{
 if(loading.value||error.value||scope.value.error||!position.value.value)return {error:props.sourceError||error.value||scope.value.error||position.value.error||'正在读取已打出记录'};
 if(props.sourceError)return {error:props.sourceError};
 if(!props.enabled)return {};
 try{return incrementalPlan(props.book,scope.value.records,{rate:rate.value,rebatePercent:rebate.value,mode:mode.value,maxLossCents:decimalUnits(maxLoss.value),maxNewNumbers:Number(maxNew.value)});}catch(e){return {error:e.message};}
});
const signed=n=>(n<0?'−':'')+'¥ '+money(Math.abs(n));
const percent=n=>Number.isFinite(n)?n.toFixed(2)+'%':'—';
const suggestions=computed(()=>calculation.value.feasible?calculation.value.transferCents.flatMap((cents,i)=>cents?[{number:i+1,cents,newNumber:!position.value.value.amounts[i],risk:position.value.value.profitCents[i]}]:[]).sort((a,b)=>(suggestionSort.value==='amount-desc'?b.cents-a.cents:suggestionSort.value==='risk'?a.risk-b.risk:0)||a.number-b.number):[]);

const draftTotal=computed(()=>{try{return draft.value?.entries.filter(e=>e.checked).reduce((s,e)=>s+decimalUnits(e.amount),0)||0;}catch{return null;}});
watch([calculation,position,loading,error,scope,()=>props.enabled,view],()=>{
 const p=position.value.value,blocked=loading.value||error.value||scope.value.error||props.sourceError||!p;
 if(!props.enabled){emit('change',{hasRecords:scope.value.records.length>0,loading:loading.value,error:blocked?error.value||scope.value.error||position.value.error||'正在读取已打出记录':''});return;}
 if(blocked){emit('change',{hasRecords:scope.value.records.length>0,plan:null,error:props.sourceError||error.value||scope.value.error||position.value.error||'正在读取已打出记录'});return;}
 const show=view.value==='proposal'&&calculation.value.feasible,plan=show?calculation.value:{...p,transferCents:Array(49).fill(0),totalCents:0};
 emit('change',{hasRecords:scope.value.records.length>0,plan:{...props.book,...plan,numbers:props.book.numbers.map((n,i)=>({...n,transferCents:plan.transferCents[i],profitCents:plan.profitCents[i]}))},actualByNumber:p.amounts,showProposal:show,error:''});
},{immediate:true});
async function reload(){const current=++token;loading.value=true;error.value='';try{if(!api.transferList)throw new Error('请重新启动最新版客户端以启用转出记录');const list=await api.transferList({date:props.book.date,market:props.book.market});if(alive&&current===token)records.value=list;}catch(e){if(alive&&current===token)error.value=e.message;}finally{if(alive&&current===token)loading.value=false;}}
watch(contextKey,()=>{records.value=[];draft.value=null;voidId.value='';deleteId.value='';notice.value='';reload();},{immediate:true});
const changed=()=>reload();
onMounted(()=>{window.addEventListener('focus',changed);window.addEventListener('songcai-transfers-changed',changed);window.addEventListener('storage',changed);});
onBeforeUnmount(()=>{alive=false;token++;window.removeEventListener('focus',changed);window.removeEventListener('songcai-transfers-changed',changed);window.removeEventListener('storage',changed);});
function openDraft(fromPlan=false){
 if(saving.value)return;
 const documents=props.results.filter(d=>d.rule?.date===props.book.date);
 const documentId=!props.allRecords&&documents.length===1?documents[0].id:'';
 draft.value={id:crypto.randomUUID(),date:props.book.date,market:props.book.market,period:props.book.period,documentId,ownerName:documents.find(d=>d.id===documentId)?.name||'集合公共',rate:rate.value,rebatePercent:rebate.value,counterparty:'',note:'',entries:fromPlan?suggestions.value.map(e=>({number:e.number,amount:(e.cents/100).toFixed(2),checked:true})):[{number:1,amount:'',checked:true}],source:JSON.stringify(props.book.numbers)};
 notice.value='';
}
async function save(){
 if(saving.value)return;saving.value=true;notice.value='';
 try{
  const d=draft.value;if(!d)throw new Error('请先填写实际打出金额');
  const record=validateTransferRecord({...d,entries:d.entries.filter(e=>e.checked).map(e=>({number:Number(e.number),cents:decimalUnits(e.amount)}))});
  await api.transferAdd(record);if(!alive)return;draft.value=null;notice.value='已保存实际打出批次；后续方案只计算补打差额。';window.dispatchEvent(new Event('songcai-transfers-changed'));
 }catch(e){notice.value='保存失败：'+e.message;}finally{saving.value=false;}
}
async function voidRecord(){if(saving.value)return;saving.value=true;try{await api.transferVoid({id:voidId.value,reason:voidReason.value});voidId.value='';voidReason.value='';notice.value='已保留作废记录，请按实际情况重新录入。';window.dispatchEvent(new Event('songcai-transfers-changed'));}catch(e){notice.value=e.message;}finally{saving.value=false;}}
async function deleteRecord(){
 if(saving.value)return;
 const record=scope.value.records.find(r=>r.id===deleteId.value);if(!record)return;
 const context=contextKey.value;saving.value=true;notice.value='';
 try{
  if(!api.transferDelete)throw new Error('请重新启动最新版客户端以启用删除记录');
  await api.transferDelete({id:record.id,date:record.date,market:record.market});
  window.dispatchEvent(new Event('songcai-transfers-changed'));
  if(alive&&context===contextKey.value){deleteId.value='';notice.value='记录已删除，已打出金额和补打方案已重新计算。';}
 }catch(e){if(alive&&context===contextKey.value)notice.value='删除失败：'+e.message;}
 finally{if(alive)saving.value=false;}
}
async function copySuggestions(){try{const text=suggestions.value.map(e=>`${pad(e.number)}号 ${money(e.cents)}元`).join('\n');await navigator.clipboard.writeText(`${MARKET_NAMES[props.book.market]} ${props.book.date}\n${text}\n含本${rate.value}倍，退水${rebate.value}%`);notice.value='已复制补打清单；复制不会记为已打出。';}catch{notice.value='复制失败，可直接按下方清单操作。';}}
</script>

<template>
 <section v-if="enabled" class="transfer-journal" aria-label="分批打出记录">
  <header><strong>分批打出与补打</strong><button class="text-button" :disabled="loading||saving" @click="reload">刷新记录</button></header>
  <p>记录实际打出的金额；每批赔率和退水独立保存。后续投注变化只计算补打，不撤回已打出金额。当前：{{book.date}} · {{MARKET_NAMES[book.market]}}。</p>
  <p v-if="!space.api" class="transfer-warning">浏览器预览记录仅保存在此浏览器；桌面版使用本地数据库。</p>
  <p v-if="scope.sharedCount" class="transfer-warning">本市场另有 {{scope.sharedCount}} 批集合公共转出，未分摊到此玩家；请到特码集合查看整体收益。</p>
  <p v-if="loading||error||scope.error" class="transfer-warning" role="status">{{error||scope.error||'正在读取已打出记录…'}}</p>
  <template v-if="!loading&&!error&&!scope.error&&position.value">
   <p v-if="sourceError" class="transfer-warning">{{sourceError}}。暂不显示风险和补打金额，已打开的实际打出清单仍可保存。</p>
   <div v-if="!sourceError" class="journal-metrics" aria-label="已打出后的实际持仓测算">
    <div><small>累计实际打出 · {{activeRecords.length}}批</small><strong>¥ {{money(position.value.totalCents)}}</strong></div>
    <div><small>当前最差净盈亏</small><strong :class="{'transfer-loss':position.value.worstProfitCents<0}">{{signed(position.value.worstProfitCents)}}</strong></div>
    <div><small>理论平均净收益</small><strong>{{signed(position.value.expectedProfitCents)}}</strong></div>
    <div><small>理论收益率 · 按当前特码流水</small><strong>{{percent(position.value.expectedMarginPercent)}}</strong></div>
   </div>
   <div class="transfer-controls">
    <label>补打方式<select v-model="mode" aria-label="补打方式"><option value="average">超出平均，只补差额</option><option value="few">限亏，优先已有号码</option><option value="minimum">限亏，最少补打金额</option></select></label>
    <label>本次含本赔率<input v-model="rate" inputmode="decimal" aria-label="本次补打赔率" /></label>
    <label>本次退水 %<input v-model="rebate" inputmode="decimal" aria-label="本次补打退水" /></label>
    <label v-if="mode!=='average'">最多亏（元）<input v-model="maxLoss" inputmode="decimal" aria-label="补打最大亏损" /></label>
    <label v-if="mode==='few'">最多新增号码<input v-model="maxNew" type="number" min="0" max="49" aria-label="最多新增号码" /></label>
   </div>
   <p v-if="mode==='average'">平均方案按目前累计投注的原始平均计算，减去同号已打出的本金，只补正差额；降赔率后不保证达到亏损上限。</p>
   <p v-else-if="mode==='few'">先尝试只补已有号码；必须增加时按风险从高到低加入，先尽量减少新增号码，再减少补打金额。额度仅适用于当前日期、市场的已解析特码。</p>
   <p v-else>不限制号码数量，优先求达到亏损上限的最少补打金额；补打按整元计算。</p>
   <p v-if="!sourceError&&(calculation.error||!calculation.feasible)" class="transfer-warning" role="alert">{{calculation.error||'当前无法生成补打方案'}}。下方号码只显示已打出后的当前盈亏。</p>
   <div v-if="calculation.feasible" class="journal-proposal">
    <strong>还需补打 ¥ {{money(calculation.totalCents)}} · {{calculation.numberCount}}个号码，其中新增 {{calculation.newNumbers.length}}个</strong>
    <p>全部补打完成后：最差 {{signed(calculation.worstProfitCents)}} · 理论平均 {{signed(calculation.expectedProfitCents)}} · 收益率 {{percent(calculation.expectedMarginPercent)}}</p>
    <p v-if="mode!=='average'&&calculation.newNumbers.length" class="transfer-warning">达到当前亏损上限需要新增：{{calculation.newNumbers.map(pad).join('、')}}。尚未打出，当前风险不会因此减少。</p>
    <div class="journal-actions"><button class="button" :disabled="saving||!suggestions.length||!!draft" @click="openDraft(true)">核对清单并记录已打出</button><button class="button" :disabled="!suggestions.length" @click="copySuggestions">复制补打清单</button></div>
    <label class="journal-sort">补打排序<select v-model="suggestionSort" aria-label="补打清单排序"><option value="amount-desc">需补打金额从高到低</option><option value="number">号码从小到大</option><option value="risk">当前风险从高到低</option></select></label>
    <div class="journal-chips"><span v-for="e in suggestions" :key="e.number" :data-supplement-number="e.number" :data-supplement-cents="e.cents"><b>{{pad(e.number)}}</b> ¥ {{money(e.cents)}} <small>{{e.newNumber?'新增号码':'已有号码补打'}}</small></span></div>
   </div>
   <div class="journal-actions"><button class="button" :disabled="!!draft||saving" @click="openDraft()">手动记录实际打出</button><label>下方号码盈亏<select v-model="view" aria-label="号码盈亏口径"><option value="proposal">预计补打完成后</option><option value="actual">仅已打出，当前风险</option></select></label></div>
   <p>按49个号码等概率测算，已扣玩家退水并计入每批转出成本、对方赔付与退水；不包含其他玩法。建议不代表实际成交，需按真实成交条件记录。</p>
   <section v-if="draft" class="journal-draft" aria-label="记录实际打出">
    <h4>核对实际打出 · {{draft.date}} · {{MARKET_NAMES[draft.market]}}</h4>
    <p v-if="draft.source!==JSON.stringify(book.numbers)" class="transfer-warning">投注已变化，以下仍是打开时的清单；请只保存实际已打出的金额，保存后会重新算补打。</p>
    <div class="transfer-controls"><label>归属账目<select v-model="draft.documentId" :disabled="saving" @change="draft.ownerName=results.find(d=>d.id===draft.documentId)?.name||'集合公共'"><option v-if="allRecords||results.length!==1" value="">集合公共（不分摊到玩家）</option><option v-for="d in results.filter(d=>d.rule?.date===book.date)" :key="d.id" :value="d.id">{{d.name||'未命名账目'}}</option></select></label><label>实际含本赔率<input v-model="draft.rate" :disabled="saving" aria-label="实际打出赔率" /></label><label>实际退水 %<input v-model="draft.rebatePercent" :disabled="saving" aria-label="实际打出退水" /></label><label>接收方（可选）<input v-model="draft.counterparty" :disabled="saving" maxlength="200" /></label></div>
    <div class="journal-entry-grid"><label v-for="(e,i) in draft.entries" :key="i"><input v-model="e.checked" type="checkbox" :disabled="saving" /><select v-model="e.number" :disabled="saving" :aria-label="`第${i+1}项号码`"><option v-for="n in 49" :key="n" :value="n">{{pad(n)}}</option></select><input v-model="e.amount" :disabled="saving" inputmode="decimal" :aria-label="`${pad(e.number)}号实际金额`" />元</label></div>
    <button class="text-button" :disabled="saving||draft.entries.length>=49" @click="draft.entries.push({number:Array.from({length:49},(_,i)=>i+1).find(n=>!draft.entries.some(e=>Number(e.number)===n)),amount:'',checked:true})">＋添加号码</button>
    <label class="journal-note">备注<input v-model="draft.note" :disabled="saving" maxlength="1000" /></label>
    <p>勾选合计：{{draftTotal===null?'金额格式有误':'¥ '+money(draftTotal)}}。仅记录已实际完成的转出，不会自动发送给接收方。</p>
    <div class="journal-actions"><button class="button primary" :disabled="saving||!draftTotal" @click="save">{{saving?'保存中…':'确认已打出并保存'}}</button><button class="button" :disabled="saving" @click="draft=null">取消</button></div>
   </section>
   <p v-if="notice" role="status">{{notice}}</p>
   <details class="journal-history"><summary>已打出记录（含作废）· {{scope.records.length}}批</summary>
    <article v-for="r in scope.records" :key="r.id" :data-transfer-record="r.id" :class="{'journal-voided':r.voidedAt}"><header><strong>{{r.ownerName}} · {{r.counterparty||'未填接收方'}}</strong><span>{{new Date(r.createdAt).toLocaleString()}}</span><button v-if="!r.voidedAt" class="text-button" :disabled="saving" @click="voidId=r.id;voidReason='';deleteId=''">记录有误，作废</button><button class="text-button journal-delete" :disabled="saving" @click="deleteId=r.id;voidId=''">删除记录</button></header><p>{{r.entries.map(e=>pad(e.number)+'号 '+money(e.cents)+'元').join('；')}} · 合计 ¥ {{money(r.entries.reduce((s,e)=>s+e.cents,0))}}</p><p>含本 {{r.rate}}倍 · 退水 {{r.rebatePercent}}% {{r.note?'· '+r.note:''}}</p><p v-if="r.voidedAt">已作废：{{r.voidReason}}（{{new Date(r.voidedAt).toLocaleString()}}）</p><div v-if="deleteId===r.id" class="journal-delete-confirm"><p>删除这批记录（¥ {{money(r.entries.reduce((s,e)=>s+e.cents,0))}}）？删除后无法恢复，将重新计算已打出金额和补打差额；仅删除软件记录，不会撤回实际转出。</p><button class="button journal-delete" :disabled="saving" @click="deleteRecord">{{saving?'删除中…':'确认删除记录'}}</button><button class="text-button" :disabled="saving" @click="deleteId=''">取消删除</button></div><div v-if="voidId===r.id"><p class="transfer-warning">只更正软件记录，不会撤回实际转出。真实已打出的金额不能直接作废来降低风险。</p><input v-model="voidReason" placeholder="填写录入错误的原因" maxlength="500" :disabled="saving" /><button class="button" :disabled="saving||!voidReason.trim()" @click="voidRecord">确认作废记录</button><button class="text-button" :disabled="saving" @click="voidId=''">取消</button></div></article>
   </details>
  </template>
 </section>
</template>

<style scoped>
.journal-sort{display:flex;align-items:center;gap:8px;font-size:12px;margin-top:12px}.journal-sort select{font-size:12px}.journal-delete{color:#b7434a}.journal-delete-confirm{padding:10px;background:#fff4f2;border-radius:6px}.journal-delete-confirm button{margin-right:12px}.transfer-journal{padding:18px;margin-top:15px;border:1px solid #b9cdbf;background:#f7faf7;border-radius:10px;color:#294634}.transfer-journal>header,.journal-history header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.transfer-journal p{font-size:12px;line-height:1.8}.journal-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0}.journal-metrics>div{background:white;padding:13px;border-radius:6px}.journal-metrics small{display:block;color:#607566;font-size:11px}.journal-metrics strong{display:block;font-size:20px;margin-top:8px}.journal-proposal{background:#eef3ff;border:1px solid #cbd8ed;padding:14px;border-radius:7px;margin:14px 0}.journal-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.journal-actions label{font-size:12px}.journal-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.journal-chips>span{padding:7px 9px;border-radius:5px;background:white;font-size:13px}.journal-chips small{font-size:10px;color:#5b6d89}.journal-draft{border:2px solid #718d79;border-radius:8px;background:white;padding:16px;margin:15px 0}.journal-draft h4{margin:0 0 12px}.journal-entry-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:15px 0}.journal-entry-grid label{display:flex;align-items:center;gap:7px;font-size:12px}.journal-entry-grid input:not([type=checkbox]){width:95px;min-width:0}.journal-entry-grid select{width:65px}.journal-note{display:flex;gap:10px;align-items:center;font-size:12px;margin-top:12px}.journal-note input{flex:1;min-width:0}.journal-history{margin-top:16px}.journal-history summary{cursor:pointer;font-size:13px}.journal-history article{background:white;border:1px solid #dce5dd;border-radius:6px;padding:12px;margin-top:10px;font-size:12px}.journal-history header span{font-size:11px;color:#69766b}.journal-voided{opacity:.6}.transfer-loss{color:#b7434a}
</style>
