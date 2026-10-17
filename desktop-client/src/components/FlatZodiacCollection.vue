<script setup>
import { computed, ref, watch } from 'vue';
import { flatZodiacCollection, flatZodiacAmount, sortFlatZodiacs } from '../core/flat-zodiac-collection.js';
import { MARKETS, formatMoney as money } from '../core/rules.js';
import { flatZodiacHighlights } from '../core/flat-zodiac-highlights.js';
import DrawBalls from './DrawBalls.vue';

const props = defineProps({ results: { type: Array, default: () => [] }, latest: Object, busy: Boolean, drawError: String });
defineEmits(['locate','sync','review']);
const marketNames = { 新: '新澳', 旧: '旧澳', 港: '香港' };
const date = ref(''), market = ref(''), sort = ref('amount-desc'), animal = ref(''), page = ref(1);
const dates = computed(() => [...new Set(props.results.map(doc => doc.rule?.date).filter(Boolean))].sort().reverse());
const data = computed(() => {
  try { return { ...flatZodiacCollection(props.results, { date: date.value, market: market.value }), error: '' }; }
  catch (error) { return { ...flatZodiacCollection([]), error: error.message }; }
});
const animals = computed(() => sortFlatZodiacs(data.value.animals, sort.value));
const highlights = computed(() => flatZodiacHighlights(data.value.bets, props.latest, market.value));
const drawMarkets = computed(() => MARKETS.filter(m => !market.value || market.value === m));
const hits = a => highlights.value[a] || [];
const confirmed = a => hits(a).some(h => !h.trial);
const hitTitle = a => hits(a).map(h => h.title).join('\n');
const sixOnly = m => props.latest?.odds?.[m]?.scopes?.['flat-zodiac'] === 'six';
const drawStatus = m => { const check = props.latest?.verification[m]; return check?.confirmed ? '已核对' : check?.status === 'conflict' ? '开奖不一致，待选择' : props.latest?.draws[m] ? '开奖待核对' : '暂无开奖'; };
const highest = computed(() => Math.max(1, ...data.value.animals.map(row => row.cents)));
const selected = computed(() => data.value.animals.find(row => row.animal === animal.value));
const entries = computed(() => data.value.bets.filter(bet => !animal.value || bet.values.includes(animal.value)));
const pages = computed(() => Math.max(1, Math.ceil(entries.value.length / 50)));
const current = computed(() => entries.value.slice((page.value - 1) * 50, page.value * 50));
const amount = bet => flatZodiacAmount(bet, { market: market.value, animal: animal.value });
const share = row => data.value.summary.totalCents ? (row.cents / data.value.summary.totalCents * 100).toFixed(1) : '0.0';
watch([date, market, animal], () => { page.value = 1; });
watch(pages, count => { page.value = Math.min(page.value, count); });
</script>

<template>
  <div class="page-body flat-zodiac-page">
    <section class="page-heading flat-collection-heading"><div><h1>平特肖集合</h1><p>本空间 {{data.documentCount}}份账目 · {{data.bets.length}}笔平特肖 · {{data.summary.players.length}}位玩家</p></div>
    <div class="flat-collection-toolbar">
      <label>业务日期<select v-model="date" aria-label="平特肖业务日期"><option value="">全部日期</option><option v-for="day in dates" :key="day">{{day}}</option></select></label>
      <label>市场<select v-model="market" aria-label="平特肖市场"><option value="">全部市场</option><option v-for="m in MARKETS" :key="m" :value="m">{{marketNames[m]}}</option></select></label>
    </div></section>
    <p class="flat-collection-note">按实际平特肖投注累加，多市场分别计算。点击生肖查看来源、定位原文。</p>
    <p v-if="data.error" class="flat-collection-warning" role="alert">{{data.error}}</p>
    <section class="metric-grid" aria-label="平特肖金额汇总">
      <div class="metric-card total-card"><div class="metric-label">平特肖总金额</div><strong class="metric-value">¥ {{money(data.summary.totalCents)}}</strong><small>{{date||'全部日期'}} · {{marketNames[market]||'三个市场合计'}}</small></div>
      <div v-for="m in MARKETS" :key="m" class="metric-card"><div class="metric-label">{{marketNames[m]}}</div><strong class="metric-value small">¥ {{money(data.summary.markets[m])}}</strong><small>当前筛选范围</small></div>
    </section>
    <section class="panel flat-collection-animals" aria-label="十二生肖投注分布">
      <div class="flat-draw-heading"><strong>最新开奖</strong><span>按各市场最近已获取开奖</span><button class="text-button" :disabled="busy" @click="$emit('sync')">{{busy ? '更新中…' : '更新开奖'}}</button><button class="text-button" @click="$emit('review')">查看／核对开奖 ↗</button></div>
      <div class="flat-latest-draws" aria-label="平特肖集合最新开奖">
        <div v-for="m in drawMarkets" :key="m" class="flat-latest-draw" :data-draw-market="m">
          <div class="flat-draw-meta"><strong>{{marketNames[m]}}</strong><small v-if="latest?.draws[m]">{{latest.draws[m].date}} · {{latest.draws[m].issue}}期</small></div>
          <DrawBalls v-if="latest?.draws[m]" :numbers="latest.draws[m].numbers" :date="latest.draws[m].date" compact />
          <div class="flat-draw-status"><small>{{sixOnly(m) ? '仅正码算中' : '正码＋特码算中'}}</small><small :class="{'draw-unconfirmed':!latest?.verification[m]?.confirmed}">{{drawStatus(m)}}</small></div>
        </div>
      </div>
      <p v-if="drawError" class="flat-draw-error" role="alert">{{drawError}}；下方保留最近已获取的开奖。</p>
      <p class="flat-draw-legend"><i></i>红框标记对应市场的命中生肖；虚线表示开奖待核对。同肖开出多号只中一份，业务日期筛选仅影响投注范围。</p>
      <div class="flat-distribution-heading"><div><h2>每个生肖投了多少</h2><p>十二生肖平均 <strong>¥ {{money(data.averageCents)}}</strong> · {{data.aboveCount}}肖高于平均 · 含未投注生肖</p></div>
        <label>排列方式<select v-model="sort" aria-label="平特肖排序"><option value="amount-desc">金额从高到低</option><option value="amount-asc">金额从低到高</option><option value="zodiac">生肖顺序（鼠→猪）</option></select></label>
      </div>
      <div class="flat-zodiac-grid">
        <button v-for="row in animals" :key="row.animal" :data-animal="row.animal" :class="['flat-zodiac-card', { selected: animal === row.animal, funded: row.cents, 'zodiac-won': confirmed(row.animal), 'zodiac-win-pending': hits(row.animal).length && !confirmed(row.animal) }]" :title="hitTitle(row.animal)" :aria-label="`查看${row.animal}肖来源${hits(row.animal).length ? '，'+hitTitle(row.animal) : ''}`" :aria-pressed="animal === row.animal" @click="animal = animal === row.animal ? '' : row.animal">
          <span class="flat-zodiac-card-heading"><b>{{row.animal}}</b><small>{{share(row)}}%</small></span>
          <strong class="flat-zodiac-amount">¥ {{money(row.cents)}}</strong>
          <span class="flat-win-labels"><small v-for="hit in hits(row.animal)" :key="hit.market" class="flat-win-badge" :class="{pending:hit.trial}">{{hit.name}} · {{hit.trial ? '待核对' : '中'}}</small></span>
          <span class="flat-zodiac-bar" aria-hidden="true"><i :style="{width: (row.cents / highest * 100) + '%'}"></i></span>
          <span class="flat-zodiac-count">{{row.documentCount}}份账目 · {{row.betCount}}笔</span>
          <small class="flat-zodiac-excess">{{row.aboveAverage ? (row.excessCents ? `超出平均 +${money(row.excessCents)}` : '超出平均 <0.01') : '\u00a0'}}</small>
        </button>
      </div>
    </section>
    <p class="flat-collection-note">随原账目自动更新，仅统计已解析的平特肖（含平肖、平特一肖）；特肖、连肖、平特尾及特码另按对应玩法统计。</p>
    <section class="panel flat-collection-sources">
      <header><div><h2>{{animal ? animal+'肖的来源明细' : '全部平特肖来源'}}</h2><p v-if="selected">本肖投注 <strong>¥ {{money(selected.cents)}}</strong> · {{selected.documentCount}}份账目</p></div><button v-if="animal" class="text-button" @click="animal = ''">查看全部生肖</button></header>
      <div class="flat-collection-scroll"><table><thead><tr><th>账目／玩家</th><th>日期／市场</th><th>生肖</th><th>每肖金额</th><th>{{animal ? '本肖金额' : '投注金额'}}</th><th>原文</th></tr></thead>
        <tbody><tr v-for="bet in current" :key="bet.id"><td>{{bet.fileName}}<small>{{bet.player}}</small></td><td>{{bet.businessDate}}<small>{{market ? marketNames[market] : bet.markets.map(m => marketNames[m]).join('、')}}</small></td><td>{{bet.values.join('、')}}</td><td>¥ {{money(bet.unitCents)}}</td><td class="flat-source-amount">¥ {{money(amount(bet))}}</td><td><button class="text-button" :aria-label="`定位${bet.fileName}第${bet.line}行平特肖`" @click="$emit('locate',bet)">第{{bet.line}}{{bet.endLine !== bet.line ? '–'+bet.endLine : ''}}行 ↗</button><small class="flat-source-text" :title="bet.raw">{{bet.raw}}</small></td></tr></tbody>
      </table></div>
      <div v-if="!entries.length" class="empty-state"><strong>{{animal ? '当前范围没有'+animal+'肖的平特肖投注' : '当前范围没有平特肖记录'}}</strong></div>
      <div class="pagination"><span>{{entries.length}}笔来源明细</span><button :disabled="page === 1" @click="page--">上一页</button>{{page}} / {{pages}}<button :disabled="page === pages" @click="page++">下一页</button></div>
    </section>
    <details v-if="data.issues.length" class="flat-collection-warning"><summary>本范围有{{data.issues.length}}项原文问题待核对，待处理投注未计入统计</summary><button v-for="issue in data.issues" :key="issue.id" @click="$emit('locate',issue)">{{issue.fileName}} 第{{issue.line}}行：{{issue.message}} ↗</button></details>
  </div>
</template>

<style scoped>
.flat-draw-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:12px}.flat-draw-heading>span{font-size:11px;color:#7b8e7a;margin-right:auto}.flat-latest-draws{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}.flat-latest-draw{border:1px solid #e3e9df;background:#fafcf8;border-radius:7px;padding:10px 12px;min-width:0}.flat-draw-meta,.flat-draw-status{display:flex;align-items:center;justify-content:space-between;gap:8px}.flat-draw-meta{margin-bottom:8px}.flat-draw-meta strong{font-size:12px}.flat-latest-draw small{font-size:10px;color:#7c8c75}.flat-draw-status{margin-top:8px}.flat-latest-draw .draw-unconfirmed{color:#9c713e}.flat-draw-error{font-size:11px;color:#9b5d35;margin:10px 0}.flat-draw-legend{font-size:11px;color:#7d8778;line-height:1.8;margin:12px 0 18px}.flat-draw-legend i{display:inline-block;width:10px;height:10px;background:#fff0f1;border:1px solid #bf5166;border-radius:3px;margin-right:5px}.flat-zodiac-grid .zodiac-won,.flat-zodiac-grid .zodiac-win-pending{background:linear-gradient(145deg,#fff5f5,#ffe7ec);border-color:#c14e66;box-shadow:inset 0 0 0 1px #c14e66}.flat-zodiac-grid .zodiac-win-pending{border-style:dashed;box-shadow:none;background:#fff5f5}.flat-zodiac-grid .zodiac-won .flat-zodiac-card-heading b,.flat-zodiac-grid .zodiac-win-pending .flat-zodiac-card-heading b{background:#f8dce4;color:#a62644}.flat-zodiac-grid .zodiac-won .flat-zodiac-amount,.flat-zodiac-grid .zodiac-win-pending .flat-zodiac-amount{color:#9f354c}.flat-zodiac-grid .zodiac-won .flat-zodiac-bar i,.flat-zodiac-grid .zodiac-win-pending .flat-zodiac-bar i{background:#ce7b8d}.flat-win-labels{min-height:20px;margin:-3px 0 9px;display:flex;align-items:center;flex-wrap:wrap;gap:4px}.flat-win-badge{font-size:10px;line-height:17px;background:#b63b57;color:#fff;border-radius:4px;padding:0 5px;white-space:nowrap}.flat-win-badge.pending{background:#f4dce1;color:#95445a}
.flat-zodiac-page{padding-top:22px;padding-bottom:30px}.flat-collection-heading{margin-bottom:12px;flex-wrap:wrap}.flat-collection-heading h1{font-size:24px}.flat-collection-toolbar select{min-width:120px}.flat-collection-toolbar{display:flex;align-items:end;gap:20px;flex-wrap:wrap;font-size:12px}.flat-collection-toolbar label{display:grid;gap:7px;color:#607b69}.flat-collection-toolbar span{color:#798c7d;padding-bottom:8px}.flat-collection-note{font-size:11px;line-height:1.9;color:#778b77;margin:16px 0}.metric-card small{display:block;color:#7e917d;margin-top:9px}.flat-collection-animals,.flat-collection-sources{padding:20px;margin-top:20px}.flat-distribution-heading,.flat-collection-sources header{display:flex;align-items:center;justify-content:space-between;gap:16px}.flat-distribution-heading h2,.flat-collection-sources h2{font-size:15px;margin:0}.flat-distribution-heading p,.flat-collection-sources header p{font-size:11px;line-height:1.8;color:#7a8e79;margin:8px 0 0}.flat-distribution-heading p strong,.flat-collection-sources header p strong{color:#426c50;font-variant-numeric:tabular-nums}.flat-distribution-heading label{display:flex;align-items:center;gap:10px;font-size:11px;color:#69816b}.flat-zodiac-grid{margin-top:18px;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.flat-zodiac-card{border:1px solid #e3eae0;border-radius:9px;padding:14px 12px;text-align:left;min-width:0;background:#fbfcfa;transition:background .15s,border-color .15s}.flat-zodiac-card:hover{border-color:#8bb494;background:#f2f8ef}.flat-zodiac-card.selected{outline:2px solid #477853;outline-offset:1px;background:#eff6e9}.flat-zodiac-card:focus-visible{outline:2px solid #477853;outline-offset:2px}.flat-zodiac-card-heading{display:flex;align-items:center;justify-content:space-between;gap:6px}.flat-zodiac-card-heading b{display:grid;place-items:center;width:33px;height:33px;border-radius:50%;background:#ecf2e8;color:#61795d;font-size:20px}.funded .flat-zodiac-card-heading b{background:#e0edda;color:#477448}.flat-zodiac-card-heading small{font-size:10px;color:#899782;font-variant-numeric:tabular-nums}.flat-zodiac-amount{display:block;font-size:20px;font-weight:600;color:#476b48;margin:15px 0 12px;line-height:1.35;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.flat-zodiac-bar{display:block;background:#e9efe6;border-radius:4px;height:4px;overflow:hidden}.flat-zodiac-bar i{display:block;background:#86ad77;height:100%;border-radius:4px}.flat-zodiac-count{display:block;color:#809078;font-size:10px;line-height:1.8;margin-top:10px}.flat-zodiac-excess{display:block;color:#a16d3f;font-size:10px;line-height:1.6;min-height:16px;margin-top:5px}.flat-collection-sources header{margin-bottom:15px}.flat-collection-scroll{overflow:auto}.flat-collection-sources table{width:100%;border-collapse:collapse;font-size:12px}.flat-collection-sources th,.flat-collection-sources td{text-align:left;padding:12px 10px;border-bottom:1px solid #e7eee2}.flat-collection-sources th{background:#f4f8f1;color:#738a70;font-weight:500;white-space:nowrap}.flat-collection-sources td{max-width:250px;overflow-wrap:anywhere}.flat-collection-sources td small{display:block;color:#899881;font-size:10px;margin-top:5px}.flat-source-amount{font-weight:600;color:#486c47;font-variant-numeric:tabular-nums}.flat-source-text{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.flat-collection-warning{background:#fff6e9;border-radius:6px;padding:15px;font-size:12px;color:#9e7948;margin-top:20px}.flat-collection-warning button{display:block;text-align:left;margin-top:12px;font-size:11px}@media(max-width:1000px){.flat-zodiac-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.flat-distribution-heading{align-items:start;flex-wrap:wrap}}@media(max-width:650px){.flat-zodiac-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.flat-collection-animals,.flat-collection-sources{padding:14px}}
</style>
