<script setup>
import { computed, ref, watch } from 'vue';
import { specialCollection } from '../core/special-collection.js';
import { MARKETS, formatMoney as money, pad, ruleForDate } from '../core/rules.js';
import { sortDistribution, NUMBER_SORTS } from '../core/number-distribution.js';
import {specialNumberHighlights,MARKET_NAMES} from '../core/special-number-highlights.js';
import DrawBalls from './DrawBalls.vue';
import {specialTransferPlan,specialTransferScenarios} from '../core/special-transfer.js';
const props=defineProps({results:Array,referenceDate:String,latest:Object,busy:Boolean,drawError:String,settings:Object});
defineEmits(['locate','sync','review']);
const date=ref(''),market=ref(''),sort=ref('amount-desc'),number=ref(null),page=ref(1);
const transferEnabled=ref(false);
const selectedPlanId=ref('maximin'),customMode=ref('loss'),customPercent=ref('5');
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
const transferBook=computed(()=>{
  if(!transferEnabled.value)return {plan:null,error:''};
  try{return {plan:specialTransferPlan(props.results,props.settings,{date:date.value,market:market.value}),error:''};}
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
  if(!transferEnabled.value)return;
  // Start with the newest populated business date and its largest market.
  // These are visible collection filters, so displayed stakes share the plan scope.
  if(!date.value)date.value=data.value.dates.at(-1)||dates.value[0]||'';
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
      <div class="number-toolbar"><label>排列方式<select v-model="sort" aria-label="集合号码排序"><option v-for="s in NUMBER_SORTS" :key="s.value" :value="s.value" :disabled="s.value==='zodiac'&&!rule">{{s.label}}</option></select></label><button class="button transfer-toggle" :class="{primary:transferEnabled}" :aria-pressed="transferEnabled" @click="toggleTransfer">{{transferEnabled?'关闭稳定转出方案':'稳定转出方案'}}</button><span v-if="rule">生肖按 {{date||referenceDate}} · {{rule.animal}}年</span></div>
      <section v-if="transferEnabled" class="transfer-summary" aria-label="稳定转出方案" aria-live="polite">
        <header><strong>转出方案比较 · {{date||'请选择日期'}} · {{market?MARKET_NAMES[market]:'请选择市场'}}</strong><span>对方含本47.3倍 · 全额退水3.3% · 每号整元</span></header>
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
              <td><label><input v-model="selectedPlanId" type="radio" name="special-transfer-scenario" :value="p.id" :disabled="!p.feasible" :aria-label="`选择${p.custom?'自定义：':''}${p.label}`" />{{p.custom?'自定义 · ':''}}{{p.label}}</label><small v-if="p.targetProfitCents!==undefined">目标下限 {{signedMoney(p.targetProfitCents)}}</small><small v-if="p.id==='maximin'">尽量提高最差结果的利润</small></td>
              <template v-if="p.feasible"><td data-scenario-total>¥ {{money(p.totalCents)}}<small>占投注 {{percent(p.transferPercent)}}</small></td><td data-scenario-worst :class="{'transfer-loss':p.worstProfitCents<0}">{{signedMoney(p.worstProfitCents)}}</td><td data-scenario-expected>{{signedMoney(p.expectedProfitCents)}}</td><td data-scenario-margin>{{percent(p.expectedMarginPercent)}}</td><td>{{percent(p.nonLossPercent)}}<small>{{p.nonLossCount}} / 49 个结果</small></td></template>
              <td v-else colspan="5" class="transfer-warning" data-scenario-unavailable>{{p.error||'无法达到此目标'}}</td>
            </tr></tbody>
          </table></div>
          <p>平均收益率＝平均净利润÷特码总投注；按49个号码等概率计算。所有利润已扣玩家退水。不亏概率需结合最差亏损一起看。</p>
          <p v-if="selectedScenario&&!selectedScenario.feasible" class="transfer-warning" role="status" data-transfer-unavailable>{{selectedScenario.error||'当前目标无法达到。'}} 当前条件下最高可达到的最低利润为 {{signedMoney(transferBook.plan.worstProfitCents)}}（占总投注 {{percent(transferBook.plan.worstProfitCents/transferBook.plan.stakeCents*100)}}）。</p>
          <template v-if="transfer.plan">
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
      <p class="collection-note">点击号码查看各账目的投入明细。未投注号码也计入平均；跨日期汇总时，生肖标签按上方日期显示，金额仍按各账目原日期解析。</p>
      <div class="number-grid" :class="{'transfer-active':transferEnabled}"><div v-for="n in numbers" :key="n.number" :data-number="n.number" :class="{funded:n.cents,'above-average':n.aboveAverage,'collection-selected':number===n.number,'number-won':confirmed(n.number),'number-win-pending':hits(n.number).length&&!confirmed(n.number)}"><button :title="hitTitle(n.number)" :aria-label="`查看${n.label}号来源${hits(n.number).length?'，'+hitTitle(n.number):''}${transfer.plan?'，建议打出'+money(transferByNumber[n.number])+'元，开出后'+profitLabel(profitByNumber[n.number])+money(Math.abs(profitByNumber[n.number]))+'元':''}`" :aria-pressed="number===n.number" @click="number=number===n.number?null:n.number"><div class="number-excess-slot"><small v-if="n.aboveAverage" class="number-excess">{{n.excessCents?`超出 +${money(n.excessCents)}`:'超出 <0.01'}}</small></div><small class="number-animal">{{n.animal||'—'}}</small><strong>{{n.label}}</strong><small class="number-wave" :class="{red:n.wave==='红',blue:n.wave==='蓝',green:n.wave==='绿'}">{{n.wave}}波</small><span>{{n.cents?money(n.cents):'—'}}</span><span v-if="transfer.plan" class="number-transfer" :data-transfer-cents="transferByNumber[n.number]"><small>打出</small><b>¥ {{money(transferByNumber[n.number])}}</b></span><span v-if="transfer.plan" class="number-profit" :class="{'number-profit-gain':profitByNumber[n.number]>0,'number-profit-loss':profitByNumber[n.number]<0,'number-profit-flat':profitByNumber[n.number]===0}" :data-profit-cents="profitByNumber[n.number]"><small>{{profitLabel(profitByNumber[n.number])}}</small><b>{{signedMoney(profitByNumber[n.number])}}</b></span><div class="number-win-labels"><small v-for="hit in hits(n.number)" :key="hit.market" class="number-win-badge" :class="{pending:hit.trial}">{{hit.name}} · {{hit.trial?'待核对':'中'}}</small></div></button></div></div>
    </section>
    <section class="panel collection-sources"><header><h2>{{number===null?'全部特码来源':pad(number)+'号的来源明细'}}</h2><button v-if="number!==null" class="text-button" @click="number=null">查看全部号码</button></header><div class="collection-scroll"><table><thead><tr><th>账目／玩家</th><th>日期／市场</th><th>号码</th><th>每号金额</th><th>{{number===null?'投注金额':'本号金额'}}</th><th>原文</th></tr></thead><tbody><tr v-for="b in current" :key="b.id"><td>{{b.fileName}}<small>{{b.player}}</small></td><td>{{b.businessDate}}<small>{{market||b.markets.join('、')}}</small></td><td>{{b.values.map(pad).join('、')}}</td><td>{{money(b.unitCents)}}</td><td>{{money(amount(b))}}</td><td><button class="text-button" @click="$emit('locate',b)">第{{b.line}}行 ↗</button></td></tr></tbody></table></div><div v-if="!entries.length" class="empty-state"><strong>当前范围没有特码记录</strong></div><div class="pagination"><span>{{entries.length}}笔来源明细</span><button :disabled="page===1" @click="page--">上一页</button>{{page}} / {{pages}}<button :disabled="page===pages" @click="page++">下一页</button></div></section>
    <details v-if="data.issues.length" class="collection-warning"><summary>{{data.issues.length}}项原文问题待核对，有歧义的投注未纳入集合</summary><button v-for="i in data.issues" :key="i.id" @click="$emit('locate',i)">{{i.fileName}} 第{{i.line}}行：{{i.message}} ↗</button></details>
  </div>
</template>

<style scoped>
.number-grid .number-profit{display:flex;flex-direction:column;gap:3px;margin:5px 5px 0;padding:7px 2px;border-radius:5px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.number-profit small{font-size:10px}.number-profit b{font-size:13px}.number-grid .number-profit.number-profit-gain{background:#edf6ee;color:#276443}.number-grid .number-profit.number-profit-loss{background:#fff0eb;color:#a24029}.number-grid .number-profit.number-profit-flat{background:#f0f2ef;color:#677467}
.transfer-controls{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:14px 0}.transfer-controls label{display:flex;align-items:center;gap:8px;font-size:12px}.transfer-controls input{width:88px;min-width:0;padding:7px 8px;border:1px solid #b9cdb0;border-radius:5px;background:#fff;color:inherit;font:inherit}.transfer-controls select{max-width:180px}.transfer-controls .button{font-size:12px}.transfer-comparison-scroll{max-width:100%;overflow-x:auto;border:1px solid #d3e1ca;border-radius:6px;background:#fbfdf9}.transfer-comparison{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.transfer-comparison th,.transfer-comparison td{text-align:right;padding:10px 12px;white-space:nowrap;border-bottom:1px solid #e0e9da}.transfer-comparison th{font-size:11px;background:#f1f6ed;font-weight:500}.transfer-comparison th:first-child,.transfer-comparison td:first-child{text-align:left}.transfer-comparison td:first-child label{display:flex;align-items:center;gap:7px;cursor:pointer}.transfer-comparison input[type=radio]{accent-color:#477853;margin:0}.transfer-comparison small{display:block;font-size:10px;color:#74856b;margin-top:5px}.transfer-comparison td:first-child small{padding-left:20px}.transfer-comparison .transfer-chosen{background:#e4efdb}.transfer-comparison tr:last-child td{border-bottom:0}.transfer-comparison .transfer-loss{color:#a74a35}.transfer-comparison .transfer-warning{text-align:left;white-space:normal}.collection-numbers{min-width:0}
.number-toolbar{flex-wrap:wrap}.transfer-toggle{margin-left:auto}.transfer-summary{margin-top:16px;padding:16px;background:#edf5e8;border:1px solid #ccdfc2;border-radius:8px;font-size:12px;color:#49663e}.transfer-summary header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}.transfer-summary header>span{font-size:11px}.transfer-metrics{display:flex;flex-wrap:wrap;gap:18px 28px;margin:14px 0}.transfer-metrics small{display:block;font-size:11px}.transfer-metrics strong{display:block;font-size:17px;margin-top:5px;font-variant-numeric:tabular-nums}.transfer-summary p{margin:7px 0 0;line-height:1.8;font-size:11px}.transfer-summary .transfer-warning{color:#995b24}.number-grid.transfer-active{grid-template-columns:repeat(auto-fit,minmax(100px,1fr))}.number-grid .number-transfer{display:flex;flex-direction:column;gap:3px;padding:7px 2px;margin:8px 5px 0;background:#e5f0db;border-radius:5px;color:#355d2b;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.number-transfer small{font-size:10px}.number-transfer b{font-size:13px}@media(max-width:650px){.transfer-metrics{gap:12px}.transfer-metrics strong{font-size:14px}.number-toolbar .transfer-toggle{margin-left:0}}
.collection-draw-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:12px}.collection-draw-heading>span{font-size:11px;color:#7b8e7a;margin-right:auto}.collection-latest-draws{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.collection-latest-draw{display:flex;align-items:center;gap:12px;border:1px solid #e3e9df;background:#fafcf8;border-radius:7px;padding:9px 12px}.collection-latest-draw strong{font-size:12px}.collection-latest-draw small{display:block;font-size:10px;color:#7c8c75;margin-top:5px}.collection-latest-draw .draw-unconfirmed{color:#9c713e}.collection-draw-error{font-size:11px;color:#9b5d35;margin:10px 0}.collection-draw-legend{font-size:11px;color:#7d8778;line-height:1.8;margin:12px 0 18px}.collection-draw-legend i{display:inline-block;width:10px;height:10px;background:#fff0f1;border:1px solid #bf5166;border-radius:3px;margin-right:5px}.number-grid .number-won,.number-grid .number-win-pending{background:linear-gradient(145deg,#fff5f5,#ffe7ec);border-color:#c14e66;box-shadow:inset 0 0 0 1px #c14e66}.number-grid .number-win-pending{border-style:dashed;box-shadow:none;background:#fff5f5}.number-grid .number-won strong,.number-grid .number-win-pending strong{color:#a62644;font-weight:750}.number-grid .number-won button>span,.number-grid .number-win-pending button>span{color:#9f354c}.number-win-labels{min-height:20px;margin-top:7px;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px;padding:0 3px}.number-win-badge{font-size:10px;line-height:17px;background:#b63b57;color:#fff;border-radius:4px;padding:0 5px;white-space:nowrap}.number-win-badge.pending{background:#f4dce1;color:#95445a}
.collection-page{padding-bottom:30px}.collection-toolbar{display:flex;align-items:end;gap:20px;flex-wrap:wrap;font-size:12px}.collection-toolbar label{display:grid;gap:7px;color:#71876e}.collection-toolbar span{color:#8a9b81;padding-bottom:8px}.collection-note{font-size:11px;line-height:1.9;color:#819479;margin:16px 0}.collection-numbers,.collection-sources{padding:20px;margin-top:20px}.number-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;font-size:11px;color:#849879}.number-toolbar label{display:flex;gap:12px;align-items:center}.number-grid{grid-template-columns:repeat(7,minmax(65px,1fr));gap:9px}.number-grid>div{padding:0}.number-grid button{display:block;width:100%;padding:10px 2px}.number-grid strong{font-size:19px}.number-grid span{font-size:12px}.number-grid .collection-selected{outline:2px solid #477853}.collection-sources header{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.collection-sources h2{font-size:14px}.collection-scroll{overflow:auto}.collection-sources table{width:100%;border-collapse:collapse;font-size:11px}.collection-sources th,.collection-sources td{text-align:left;padding:12px 10px;border-bottom:1px solid #e7eee2}.collection-sources th{background:#f4f8f1;color:#839579;font-weight:500}.collection-sources td{max-width:280px;overflow-wrap:anywhere}.collection-sources td small{display:block;color:#94a189;font-size:10px;margin-top:5px}.collection-warning{background:#fff6e9;border-radius:6px;padding:15px;font-size:12px;color:#9e7948;margin-top:20px}.collection-warning button{display:block;text-align:left;margin-top:12px;font-size:11px}.metric-card small{display:block;color:#a2af96;margin-top:9px}
</style>
