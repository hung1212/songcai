<script setup>
import { computed, ref, watch } from 'vue';
import { specialCollection } from '../core/special-collection.js';
import { MARKETS, formatMoney as money, pad, ruleForDate } from '../core/rules.js';
import { sortDistribution, NUMBER_SORTS } from '../core/number-distribution.js';
import {specialNumberHighlights,MARKET_NAMES} from '../core/special-number-highlights.js';
import DrawBalls from './DrawBalls.vue';
import SpecialTransferPanel from './SpecialTransferPanel.vue';
const props=defineProps({results:Array,referenceDate:String,latest:Object,busy:Boolean,drawError:String,settings:Object});
defineEmits(['locate','sync','review']);
const date=ref(''),market=ref(''),sort=ref('amount-desc'),number=ref(null),page=ref(1);
const dates=computed(()=>[...new Set(props.results.map(r=>r.rule?.date).filter(Boolean))].sort().reverse());
const data=computed(()=>{try{return {...specialCollection(props.results,{date:date.value,market:market.value}),error:''};}catch(e){return {...specialCollection([]),error:e.message};}});
const rule=computed(()=>{try{return ruleForDate(date.value||props.referenceDate);}catch{return null;}});
const numbers=computed(()=>sortDistribution(data.value.distribution.numbers,rule.value,sort.value));
const highlights=computed(()=>specialNumberHighlights(data.value.bets,props.latest,market.value));
const drawMarkets=computed(()=>MARKETS.filter(m=>!market.value||market.value===m));
const hits=n=>highlights.value[n]||[];
const confirmed=n=>hits(n).some(h=>!h.trial);
const hitTitle=n=>hits(n).map(h=>h.title).join('\n');
const drawStatus=m=>{const check=props.latest?.verification[m];return check?.confirmed?'已核对':check?.status==='conflict'?'开奖不一致，待选择':props.latest?.draws[m]?'开奖待核对':'暂无开奖';};
const entries=computed(()=>data.value.bets.filter(b=>number.value===null||b.values.includes(number.value)));
const pages=computed(()=>Math.max(1,Math.ceil(entries.value.length/50)));
const current=computed(()=>entries.value.slice((page.value-1)*50,page.value*50));
const amount=b=>(number.value===null?b.perMarketCents:b.values.filter(n=>n===number.value).length*b.unitCents)*(market.value?1:b.markets.length);
function prepareTransfer(){
  // Keep the visible amounts and transfer plan on the same date and market.
  if(!date.value)date.value=data.value.dates.at(-1)||dates.value[0]||props.referenceDate||'';
  if(!market.value){const scoped=specialCollection(props.results,{date:date.value});market.value=[...MARKETS].sort((a,b)=>scoped.summary.markets[b]-scoped.summary.markets[a])[0];}
  number.value=null;
}
watch([date,market,number],()=>{page.value=1;});
watch(pages,n=>{if(page.value>n)page.value=n;});
</script>

<template>
  <div class="page-body collection-page">
    <section class="page-heading"><div><div class="eyebrow">SPECIAL NUMBER COLLECTION</div><h1>特码集合</h1><p>所有已保存账目的特码，汇总到这里统一查看。</p></div></section>
    <div class="collection-toolbar"><label>业务日期<select v-model="date" aria-label="集合业务日期"><option value="">全部日期</option><option v-for="d in dates" :key="d">{{d}}</option></select></label><label>市场<select v-model="market" aria-label="集合市场"><option value="">全部市场</option><option v-for="m in MARKETS" :key="m" :value="m">{{m}}市场</option></select></label><span>{{data.documentCount}}份账目 · {{data.bets.length}}笔特码 · {{data.summary.players.length}}位玩家</span></div>
    <p class="collection-note">自动跟随原账目更新，不另存一份重复账目。包含“天肖各100”等展开到号码的特码；特肖、整项波色、连肖和连码按各自玩法单独统计。</p>
    <p v-if="data.error" class="collection-warning">{{data.error}}</p>
    <section class="metric-grid"><div class="metric-card total-card"><div class="metric-label">特码总金额</div><strong class="metric-value">¥ {{money(data.summary.totalCents)}}</strong><small>{{date||'全部日期'}} · {{market?market+'市场':'三个市场合计'}}</small></div><div v-for="m in MARKETS" :key="m" class="metric-card"><div class="metric-label">{{m}}市场</div><strong class="metric-value small">¥ {{money(data.summary.markets[m])}}</strong><small>当前筛选范围</small></div></section>
    <section class="panel collection-numbers">
      <div class="collection-draw-heading"><strong>最新特码</strong><span>按各市场最近已获取开奖</span><button class="text-button" :disabled="busy" @click="$emit('sync')">{{busy?'更新中…':'更新开奖'}}</button><button class="text-button" @click="$emit('review')">查看／核对开奖 ↗</button></div>
      <div class="collection-latest-draws" aria-label="特码集合最新开奖">
        <div v-for="m in drawMarkets" :key="m" class="collection-latest-draw" :data-draw-market="m">
          <DrawBalls v-if="latest?.draws[m]" :numbers="[latest.draws[m].numbers[6]]" :date="latest.draws[m].date" :start-index="6" compact />
          <div><strong>{{MARKET_NAMES[m]}}</strong><small v-if="latest?.draws[m]">{{latest.draws[m].date}} · {{latest.draws[m].issue}}期</small><small :class="{'draw-unconfirmed':!latest?.verification[m]?.confirmed}">{{drawStatus(m)}}</small></div>
        </div>
      </div>
      <p v-if="drawError" class="collection-draw-error" role="alert">{{drawError}}；下方保留最近已获取的开奖。</p>
      <p class="collection-draw-legend"><i></i>红框标记对应市场的命中号码；虚线表示开奖待核对。业务日期筛选仅影响投注范围。</p>
      <div class="number-summary"><div><span>49个号码平均金额</span><strong>¥ {{money(data.distribution.averageCents)}}</strong></div><small>{{data.distribution.aboveCount}}个号码高于平均</small></div>
      <SpecialTransferPanel :results="results" :settings="settings" :date="date" :market="market" @enable="prepareTransfer">
        <template #toolbar><label>排列方式<select v-model="sort" aria-label="集合号码排序"><option v-for="s in NUMBER_SORTS" :key="s.value" :value="s.value" :disabled="s.value==='zodiac'&&!rule">{{s.label}}</option></select></label></template>
        <template #toolbar-end><span v-if="rule">生肖按 {{date||referenceDate}} · {{rule.animal}}年</span></template>
        <template #default="{plan,enabled,transferByNumber,profitByNumber,profitLabel,signedMoney,actualByNumber,transferLabel,journalMode,showSupplement}">
      <p class="collection-note">点击号码查看各账目的投入明细。未投注号码也计入平均；跨日期汇总时，生肖标签按上方日期显示，金额仍按各账目原日期解析。</p>
      <div class="number-grid" :class="{'transfer-active':enabled}"><div v-for="n in numbers" :key="n.number" :data-number="n.number" :class="{funded:n.cents,'above-average':n.aboveAverage,'collection-selected':number===n.number,'number-won':confirmed(n.number),'number-win-pending':hits(n.number).length&&!confirmed(n.number)}"><button :title="hitTitle(n.number)" :aria-label="`查看${n.label}号来源${hits(n.number).length?'，'+hitTitle(n.number):''}${plan?'，建议打出'+money(transferByNumber[n.number])+'元，开出后'+profitLabel(profitByNumber[n.number])+money(Math.abs(profitByNumber[n.number]))+'元':''}`" :aria-pressed="number===n.number" @click="number=number===n.number?null:n.number"><div class="number-excess-slot"><small v-if="n.aboveAverage" class="number-excess">{{n.excessCents?`超出 +${money(n.excessCents)}`:'超出 <0.01'}}</small></div><small class="number-animal">{{n.animal||'—'}}</small><strong>{{n.label}}</strong><small class="number-wave" :class="{red:n.wave==='红',blue:n.wave==='蓝',green:n.wave==='绿'}">{{n.wave}}波</small><span>{{n.cents?money(n.cents):'—'}}</span><span v-if="journalMode&&actualByNumber[n.number]" class="number-transfer"><small>已打出</small><b>¥ {{money(actualByNumber[n.number])}}</b></span><span v-if="plan&&showSupplement" class="number-transfer" :data-transfer-cents="transferByNumber[n.number]"><small>{{transferLabel}}</small><b>¥ {{money(transferByNumber[n.number])}}</b></span><span v-if="plan" class="number-profit" :class="{'number-profit-gain':profitByNumber[n.number]>0,'number-profit-loss':profitByNumber[n.number]<0,'number-profit-flat':profitByNumber[n.number]===0}" :data-profit-cents="profitByNumber[n.number]"><small>{{profitLabel(profitByNumber[n.number])}}</small><b>{{signedMoney(profitByNumber[n.number])}}</b></span><div class="number-win-labels"><small v-for="hit in hits(n.number)" :key="hit.market" class="number-win-badge" :class="{pending:hit.trial}">{{hit.name}} · {{hit.trial?'待核对':'中'}}</small></div></button></div></div>
        </template>
      </SpecialTransferPanel>
    </section>
    <section class="panel collection-sources"><header><h2>{{number===null?'全部特码来源':pad(number)+'号的来源明细'}}</h2><button v-if="number!==null" class="text-button" @click="number=null">查看全部号码</button></header><div class="collection-scroll"><table><thead><tr><th>账目／玩家</th><th>日期／市场</th><th>号码</th><th>每号金额</th><th>{{number===null?'投注金额':'本号金额'}}</th><th>原文</th></tr></thead><tbody><tr v-for="b in current" :key="b.id"><td>{{b.fileName}}<small>{{b.player}}</small></td><td>{{b.businessDate}}<small>{{market||b.markets.join('、')}}</small></td><td>{{b.values.map(pad).join('、')}}</td><td>{{money(b.unitCents)}}</td><td>{{money(amount(b))}}</td><td><button class="text-button" @click="$emit('locate',b)">第{{b.line}}行 ↗</button></td></tr></tbody></table></div><div v-if="!entries.length" class="empty-state"><strong>当前范围没有特码记录</strong></div><div class="pagination"><span>{{entries.length}}笔来源明细</span><button :disabled="page===1" @click="page--">上一页</button>{{page}} / {{pages}}<button :disabled="page===pages" @click="page++">下一页</button></div></section>
    <details v-if="data.issues.length" class="collection-warning"><summary>{{data.issues.length}}项原文问题待核对，有歧义的投注未纳入集合</summary><button v-for="i in data.issues" :key="i.id" @click="$emit('locate',i)">{{i.fileName}} 第{{i.line}}行：{{i.message}} ↗</button></details>
  </div>
</template>

<style scoped>
.collection-numbers{min-width:0}
.collection-draw-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:12px}.collection-draw-heading>span{font-size:11px;color:#7b8e7a;margin-right:auto}.collection-latest-draws{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.collection-latest-draw{display:flex;align-items:center;gap:12px;border:1px solid #e3e9df;background:#fafcf8;border-radius:7px;padding:9px 12px}.collection-latest-draw strong{font-size:12px}.collection-latest-draw small{display:block;font-size:10px;color:#7c8c75;margin-top:5px}.collection-latest-draw .draw-unconfirmed{color:#9c713e}.collection-draw-error{font-size:11px;color:#9b5d35;margin:10px 0}.collection-draw-legend{font-size:11px;color:#7d8778;line-height:1.8;margin:12px 0 18px}.collection-draw-legend i{display:inline-block;width:10px;height:10px;background:#fff0f1;border:1px solid #bf5166;border-radius:3px;margin-right:5px}.number-grid .number-won,.number-grid .number-win-pending{background:linear-gradient(145deg,#fff5f5,#ffe7ec);border-color:#c14e66;box-shadow:inset 0 0 0 1px #c14e66}.number-grid .number-win-pending{border-style:dashed;box-shadow:none;background:#fff5f5}.number-grid .number-won strong,.number-grid .number-win-pending strong{color:#a62644;font-weight:750}.number-grid .number-won button>span,.number-grid .number-win-pending button>span{color:#9f354c}.number-win-labels{min-height:20px;margin-top:7px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px;padding:0 3px}.number-win-badge{font-size:10px;line-height:17px;background:#b63b57;color:#fff;border-radius:4px;padding:0 5px;white-space:nowrap}.number-win-badge.pending{background:#f4dce1;color:#95445a}
.collection-page{padding-bottom:30px}.collection-toolbar{display:flex;align-items:end;gap:20px;flex-wrap:wrap;font-size:12px}.collection-toolbar label{display:grid;gap:7px;color:#71876e}.collection-toolbar span{color:#8a9b81;padding-bottom:8px}.collection-note{font-size:11px;line-height:1.9;color:#819479;margin:16px 0}.collection-numbers,.collection-sources{padding:20px;margin-top:20px}.number-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;font-size:11px;color:#849879}.number-toolbar label{display:flex;gap:12px;align-items:center}.number-grid{grid-template-columns:repeat(7,minmax(65px,1fr));gap:9px}.number-grid>div{padding:0}.number-grid button{display:block;width:100%;padding:10px 2px}.number-grid strong{font-size:19px}.number-grid span{font-size:12px}.number-grid .collection-selected{outline:2px solid #477853}.collection-sources header{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.collection-sources h2{font-size:14px}.collection-scroll{overflow:auto}.collection-sources table{width:100%;border-collapse:collapse;font-size:11px}.collection-sources th,.collection-sources td{text-align:left;padding:12px 10px;border-bottom:1px solid #e7eee2}.collection-sources th{background:#f4f8f1;color:#839579;font-weight:500}.collection-sources td{max-width:280px;overflow-wrap:anywhere}.collection-sources td small{display:block;color:#94a189;font-size:10px;margin-top:5px}.collection-warning{background:#fff6e9;border-radius:6px;padding:15px;font-size:12px;color:#9e7948;margin-top:20px}.collection-warning button{display:block;text-align:left;margin-top:12px;font-size:11px}.metric-card small{display:block;color:#a2af96;margin-top:9px}
</style>
