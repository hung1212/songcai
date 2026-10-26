<script setup>
import {computed,ref,useId} from 'vue';
import {formatMoney as money} from '../core/rules.js';
import {MARKET_NAMES} from '../core/special-number-highlights.js';
import {specialTransferPlan,specialTransferScenarios} from '../core/special-transfer.js';
const props=defineProps({results:{type:Array,default:()=>[]},settings:Object,date:String,market:String,scopeLabel:String,sourceError:String});
const emit=defineEmits(['enable']);
const transferEnabled=ref(false);
const selectedPlanId=ref('maximin'),customMode=ref('loss'),customPercent=ref('5');
const scenarioGroup='special-transfer-'+useId();
const transferBook=computed(()=>{
  if(!transferEnabled.value)return {plan:null,error:''};
  if(props.sourceError)return {plan:null,error:props.sourceError};
  try{return {plan:specialTransferPlan(props.results,props.settings,{date:props.date,market:props.market}),error:''};}
  catch(e){return {plan:null,error:e.message};}
});
const transferScenarios=computed(()=>transferBook.value.plan?specialTransferScenarios(transferBook.value.plan,{mode:customMode.value,percent:customPercent.value}):[]);
const selectedScenario=computed(()=>transferScenarios.value.find(p=>p.id===selectedPlanId.value));
const transfer=computed(()=>{
  const book=transferBook.value.plan,scenario=selectedScenario.value;
  if(!book||!scenario?.feasible)return {plan:null};
  const numbers=book.numbers.map((n,i)=>({...n,transferCents:scenario.transferCents[i],profitCents:scenario.profitCents[i]}));
  return {plan:{...book,...scenario,numbers,exceedsStake:numbers.some(n=>n.transferCents>n.cents)}};
});
const percent=value=>Number.isFinite(value)?value.toFixed(2)+'%':'—';
const signedMoney=value=>(value<0?'−':'')+'¥ '+money(Math.abs(value));
const transferByNumber=computed(()=>Object.fromEntries((transfer.value.plan?.numbers||[]).map(n=>[n.number,n.transferCents])));
const profitByNumber=computed(()=>Object.fromEntries((transfer.value.plan?.numbers||[]).map(n=>[n.number,n.profitCents])));
const profitLabel=value=>value>0?'预计净盈利':value<0?'预计净亏损':'预计持平';
function toggleTransfer(){
  transferEnabled.value=!transferEnabled.value;
  if(transferEnabled.value)emit('enable');
}
function showAverageTransfer(){
  if(!transferEnabled.value)toggleTransfer();
  selectedPlanId.value='average-excess';
}
</script>

<template>
  <div class="special-transfer">
    <div class="number-toolbar"><slot name="toolbar" /><button class="button transfer-toggle" :class="{primary:transferEnabled}" :aria-pressed="transferEnabled" @click="toggleTransfer">{{transferEnabled?'关闭转出方案':'稳定转出方案'}}</button><button class="button average-transfer-toggle" :class="{primary:transferEnabled&&selectedPlanId==='average-excess'}" :aria-pressed="transferEnabled&&selectedPlanId==='average-excess'" @click="showAverageTransfer">超出平均转出</button><slot name="toolbar-end" /></div>
      <section v-if="transferEnabled" class="transfer-summary" aria-label="特码转出方案" aria-live="polite">
        <header><strong>转出方案比较<span v-if="scopeLabel"> · {{scopeLabel}}</span> · {{date||'请选择日期'}} · {{market?MARKET_NAMES[market]:'请选择市场'}}</strong><span>对方含本47.3倍 · 全额退水3.3% · {{selectedPlanId==='average-excess'?'超额按分转出':'每号整元'}}</span></header>
        <p v-if="transferBook.error" class="transfer-warning" role="status">{{transferBook.error}}</p>
        <template v-else-if="transferBook.plan">
          <p>百分比基准：当前范围的特码总投注 <b data-transfer-basis>¥ {{money(transferBook.plan.stakeCents)}}</b>（扣退水前）。指定盈亏目标后，求满足目标的最少转出金额。</p>
          <div class="transfer-controls">
            <label>自定义目标<select v-model="customMode" aria-label="转出目标类型" @change="selectedPlanId='custom'"><option value="loss">允许最大亏损</option><option value="profit">要求最低盈利</option></select></label>
            <label>占总投注<input v-model="customPercent" aria-label="转出目标百分比" type="number" min="0" max="100" step="0.01" @input="selectedPlanId='custom'" />%</label>
            <button class="button" :aria-pressed="selectedPlanId==='custom'" @click="selectedPlanId='custom'">查看自定义方案</button>
          </div>
          <div class="transfer-comparison-scroll"><table class="transfer-comparison" aria-label="转出方案对比">
            <thead><tr><th>选择方案</th><th>转出总额</th><th>最差净利润</th><th>平均净利润</th><th>平均收益率</th><th>不亏概率</th></tr></thead>
            <tbody><tr v-for="p in transferScenarios" :key="p.id" :data-transfer-scenario="p.id" :class="{'transfer-chosen':selectedPlanId===p.id}">
              <td><label><input v-model="selectedPlanId" type="radio" :name="scenarioGroup" :value="p.id" :disabled="!p.feasible" :aria-label="`选择${p.custom?'自定义：':''}${p.label}`" />{{p.custom?'自定义 · ':''}}{{p.label}}</label><small v-if="p.targetProfitCents!==undefined">目标下限 {{signedMoney(p.targetProfitCents)}}</small><small v-if="p.id==='maximin'">尽量提高最差结果的利润</small><small v-if="p.id==='average-excess'">只转出高于49号平均的部分</small></td>
              <template v-if="p.feasible"><td data-scenario-total>¥ {{money(p.totalCents)}}<small>占投注 {{percent(p.transferPercent)}}</small></td><td data-scenario-worst :class="{'transfer-loss':p.worstProfitCents<0}">{{signedMoney(p.worstProfitCents)}}</td><td data-scenario-expected>{{signedMoney(p.expectedProfitCents)}}</td><td data-scenario-margin>{{percent(p.expectedMarginPercent)}}</td><td>{{percent(p.nonLossPercent)}}<small>{{p.nonLossCount}} / 49 个结果</small></td></template>
              <td v-else colspan="5" class="transfer-warning" data-scenario-unavailable>{{p.error||'无法达到此目标'}}</td>
            </tr></tbody>
          </table></div>
          <p>平均收益率＝平均净利润÷特码总投注；按49个号码等概率计算。所有利润已扣玩家退水。不亏概率需结合最差亏损一起看。</p>
          <p v-if="selectedScenario&&!selectedScenario.feasible" class="transfer-warning" role="status" data-transfer-unavailable>{{selectedScenario.error||'当前目标无法达到。'}} 当前条件下最高可达到的最低利润为 {{signedMoney(transferBook.plan.worstProfitCents)}}（占总投注 {{percent(transferBook.plan.worstProfitCents/transferBook.plan.stakeCents*100)}}）。</p>
          <template v-if="transfer.plan">
            <p v-if="selectedPlanId==='average-excess'" class="average-transfer-explanation" data-average-transfer-explanation>按转出前的49号平均 <b>¥ {{money(transfer.plan.averageCents)}}</b> 计算，低于平均的号码不转出。超额四舍五入到分，与号码上的“超出”金额一致；本方案共转出 {{transfer.plan.transferNumberCount}} 个号码。下方红色金额表示开出该号时整盘预计亏损。</p>
            <div class="transfer-metrics"><div><small>已选：{{selectedScenario.custom?'自定义 · ':''}}{{selectedScenario.label}}</small><strong data-transfer-total>¥ {{money(transfer.plan.totalCents)}}</strong></div><div><small>测算利润范围</small><strong data-transfer-profit>{{signedMoney(transfer.plan.worstProfitCents)}} ～ {{signedMoney(transfer.plan.bestProfitCents)}}</strong></div><div><small>平均收益率</small><strong data-transfer-margin>{{percent(transfer.plan.expectedMarginPercent)}}</strong></div><div><small>已扣玩家退水</small><strong>¥ {{money(transfer.plan.playerRebateCents)}}</strong></div></div>
            <p>下方49个号码显示已选方案的打出金额，以及开出该号时当前范围的整盘净盈亏；已计入玩家赔付、玩家退水、全部转出成本及对方赔付和退水。打出0元的号码无需转出，也会显示开出后的盈亏。</p>
            <p v-if="transfer.plan.worstProfitCents<0" class="transfer-warning">所选方案仍可能亏损，最差 {{signedMoney(transfer.plan.worstProfitCents)}}；“允许亏损”目标会优先减少转出。</p>
            <p v-if="transfer.plan.exceedsStake" class="transfer-warning">部分玩家赔付较高，建议打出金额超过该号收到的投注，需额外资金。</p>
          </template>
          <p>按当前日期、当前市场同一期测算；账目或已保存赔率、退水变化后自动重算。利润取决于完整账目及实际转出、结算。</p>
          <p v-if="transferBook.plan.zeroRebateStakeCents" class="transfer-warning">其中 ¥ {{money(transferBook.plan.zeroRebateStakeCents)}} 投注按当前玩家设置退水0%，请确认与实际一致。</p>
          <p v-if="!transferBook.plan.confirmedOdds" class="transfer-warning">当前市场赔率尚未确认，请先核对。</p>
          <p v-if="transferBook.plan.issueCount" class="transfer-warning">有 {{transferBook.plan.issueCount}} 项原文问题待核对，方案仅包含已解析的特码。</p>
        </template>
      </section>
    <slot :plan="transfer.plan" :enabled="transferEnabled" :transfer-by-number="transferByNumber" :profit-by-number="profitByNumber" :profit-label="profitLabel" :signed-money="signedMoney" />
  </div>
</template>

<style src="../special-transfer.css"></style>
