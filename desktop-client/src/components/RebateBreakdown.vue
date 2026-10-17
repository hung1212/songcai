<script setup>
import {formatMoney as money} from '../core/rules.js';
import {rebatePercent} from '../core/rebates.js';
defineProps({players:{type:Array,default:()=>[]}});
</script>
<template>
  <details v-if="players.some(p=>p.rebateBreakdown?.length)" class="rebate-breakdown">
    <summary>按玩家／玩法查看退水明细</summary>
    <div class="rebate-breakdown-scroll"><table><thead><tr><th>玩家</th><th>玩法</th><th>有效流水</th><th>退水率</th><th>退水金额</th></tr></thead><tbody>
      <template v-for="p in players" :key="p.id"><tr v-for="r in p.rebateBreakdown||[]" :key="r.playKey"><td>{{p.name}}</td><td>{{r.name}}</td><td>¥ {{money(r.turnoverCents)}}</td><td>{{rebatePercent(r.perTenThousandCents)}}</td><td>¥ {{money(r.rebateCents)}}</td></tr></template>
    </tbody></table></div>
    <small>有效流水不含退本金及待结算。每账目按玩家合并各玩法精确退水后取整到分，分摊后的明细合计与应付一致。</small>
  </details>
</template>
<style scoped>
.rebate-breakdown{margin:14px 0;border:1px solid #d7e5e4;border-radius:8px;padding:14px;background:#f6faf9;font-size:12px;color:#426862}.rebate-breakdown summary{cursor:pointer;font-weight:600}.rebate-breakdown-scroll{overflow:auto;margin:12px 0}.rebate-breakdown table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}.rebate-breakdown th,.rebate-breakdown td{padding:10px 12px;border-bottom:1px solid #e0eae6}.rebate-breakdown th{font-size:11px;color:#718b82}.rebate-breakdown small{color:#7b9188;line-height:1.8}
</style>
