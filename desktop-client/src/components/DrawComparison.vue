<script setup>
import { computed } from 'vue';
import DrawBalls from './DrawBalls.vue';
const props=defineProps({comparison:Object,busy:Boolean,readonly:Boolean});
defineEmits(['adopt','open']);
const labels={consistent:'多来源号码一致',conflict:'开奖不一致 · 待用户选择',single:'仅一个数据来源',manual:'仅人工录入记录',missing:'暂无当日开奖'};
const stateLabels={failed:'读取失败',available:'有本期记录',missing:'没有本期记录',unchecked:'尚未获取'};
const title=computed(()=>props.comparison.confirmed&&props.comparison.method==='user'?'已由用户确定结果':labels[props.comparison.status]);
const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—';
const sourceId=d=>d.sourceId.startsWith('manual-')?d.sourceId.slice(7):d.sourceId;
</script>

<template>
  <section class="panel draw-comparison" :data-market="comparison.market">
    <header><h2>{{comparison.market}}市场 · 网站核对</h2><span :class="['comparison-badge',comparison.status]">{{title}}</span></header>
    <p class="comparison-note">{{comparison.issue?`当前核对 ${comparison.issue} 期`:'先获取开奖记录或手动录入'}}。前6个正码按号码集合比对，最后1个特码单独比对。网站引用同一接口时合并计数。</p>
    <p v-if="comparison.status==='conflict'" class="conflict-notice">{{readonly?'保存时存在不同号码或日期，已保留各站记录和用户采用的结果。':'本期有不同号码或日期，已逐站列出。请核对后点击“采用此结果”；不会按多数网站自动决定。'}}</p>
    <p v-else-if="['single','manual'].includes(comparison.status)" class="comparison-note caution">{{readonly?'保存时来源不足以交叉核实，采用结果按“用户确定”留档。':'尚不足以交叉核实。你可以打开来源核对后人工采用，记录会标为“用户确定”，不会标成多来源一致。'}}</p>
    <div v-if="comparison.records.length" class="comparison-scroll"><table><thead><tr><th>网站／来源</th><th>期号／日期</th><th>前6个正码</th><th>特码</th><th>与所选结果</th><th>{{readonly?'保存时选择':'本次选择'}}</th></tr></thead><tbody>
      <tr v-for="d in comparison.records" :key="d.id" :class="{chosen:d.id===comparison.selectedId,excluded:d.excluded}">
        <td><button v-if="d.sourceUrl" class="source-link" @click="$emit('open',sourceId(d))">{{d.sourceName}} ↗</button><span v-else>{{d.sourceName}}</span><small>{{d.manual?'人工录入':d.provider?`数据来源组：${d.provider}`:'来源未知'}}{{!d.enabled&&!d.manual?' · 未启用':''}}</small><small>获取 {{time(d.observedAt)}}</small></td>
        <td>{{d.issue}}<small>{{d.date}}{{!d.sameDate?' · 日期不同':''}}</small></td>
        <td><DrawBalls :numbers="d.numbers.slice(0,6)" :date="d.date" compact /></td>
        <td><DrawBalls :numbers="d.numbers.slice(6)" :date="d.date" :start-index="6" compact /></td>
        <td><span :class="{difference:!d.matchesSelected&&d.sameIssue&&!d.excluded}">{{d.excluded?'非用户旧频道 · 排除':!d.sameIssue?'不同期号 · 不混比':!comparison.selectedId?'待选择':d.matchesSelected?'一致':'不一致'}}</span></td>
        <td><span v-if="readonly">{{d.id===comparison.selectedId?'采用此项':'—'}}</span><button v-else class="button" :disabled="busy||!d.sameDate||d.excluded" @click="$emit('adopt',d.id)">{{d.id===comparison.selectedId&&comparison.confirmed?'已采用':'采用此结果'}}</button></td>
      </tr>
    </tbody></table></div>
    <p v-else class="comparison-note">还没有可比对的号码；读取失败不会被当作号码一致。</p>
    <details v-if="comparison.sourceStates.length" class="source-progress" :open="comparison.sourceStates.some(s=>s.state==='failed')"><summary>各网站读取状态（{{comparison.sourceStates.length}}个频道，{{comparison.providers.length}}组本期数据）</summary><div v-for="s in comparison.sourceStates" :key="s.sourceId"><strong>{{s.sourceName}} · {{stateLabels[s.state]}}</strong><span>{{s.message}}{{s.state==='failed'&&s.found?'；本期仍显示上次缓存':''}}</span><small>{{s.note}}</small><small>{{s.latest?`来源最近 ${s.latest.date}／${s.latest.issue} · `:''}}查询 {{time(s.checkedAt)}}</small></div></details>
  </section>
</template>

<style scoped>
.draw-comparison{padding:20px;margin:18px 0}.draw-comparison header{display:flex;gap:16px;align-items:center;justify-content:space-between}.draw-comparison h2{font-size:14px;font-weight:600}.comparison-badge{font-size:11px;border-radius:20px;padding:5px 11px;background:#f1f3ee;color:#6a7a65}.comparison-badge.consistent{background:#e5f3e7;color:#387447}.comparison-badge.conflict{background:#fff0e3;color:#ae6032}.comparison-note{font-size:11px;line-height:1.9;color:#7b8a73;margin:12px 0}.caution{color:#a8783c}.conflict-notice{font-size:12px;line-height:1.8;background:#fff2e8;padding:12px;color:#a45a2c;border-radius:6px;margin:12px 0}.comparison-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:11px}th,td{text-align:left;padding:12px 9px;border-bottom:1px solid #e7eee2}th{background:#f4f8f1;font-weight:500;color:#75866a}td:first-child{min-width:175px}td:nth-child(3){min-width:205px}td:nth-child(4){min-width:50px}small{display:block;font-size:9px;color:#8b9984;line-height:1.8;margin-top:4px}.source-link{text-align:left;color:#416c48;font-size:11px}.chosen{background:#f0f7ed}.difference{color:#af663d}.excluded{opacity:.65}.source-progress{font-size:11px;color:#738368;margin-top:15px}.source-progress summary{cursor:pointer}.source-progress>div{margin-top:12px;padding-left:10px;border-left:2px solid #dee7d8}.source-progress strong,.source-progress span{display:block;line-height:1.8}.source-progress strong{font-weight:500}.button{font-size:10px;white-space:nowrap}
</style>
