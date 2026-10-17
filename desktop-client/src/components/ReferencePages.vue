<script setup>
import { computed, ref, watch } from 'vue';
import { ANIMALS, WAVES, formatMoney, pad, ruleForDate, today } from '../core/rules.js';
import { CATEGORIES, CATEGORY_GROUPS, FIVE_ELEMENTS, ODDS_SECTIONS, ODDS_YEAR, SPECIAL_ANIMAL, ZODIAC_DETAILS } from '../reference.js';
import oddsSource from '../assets/reference/play-odds-snake-source.jpg';
import zodiacSource from '../assets/reference/zodiac-2026-source.jpg';

const props = defineProps({ view: String });
const search = ref(''), lookupDate = ref(today()), selected = ref('天肖'), sourceDialog = ref();
const calendar = computed(() => {
  try { return { rule: ruleForDate(lookupDate.value), error: '' }; }
  catch (error) { return { rule: null, error: error.message }; }
});
const selectedCategory = computed(() => CATEGORIES.find(c => c.name === selected.value));
const selectedNumbers = computed(() => calendar.value.rule
  ? [...new Set(selectedCategory.value.members.flatMap(a => calendar.value.rule.zodiac[a]))].sort((a, b) => a - b) : []);
const filteredSections = computed(() => {
  const query = search.value.trim();
  return ODDS_SECTIONS.map(section => ({ ...section, rows: section.title.includes(query) ? section.rows
    : section.rows.filter(row => `${row.label} ${row.rate} ${row.horseRate ? '马 有马 ' + row.horseRate : ''}`.includes(query)) })).filter(s => s.rows.length);
});
const showSpecial = computed(() => !search.value.trim() || '特码 47 不退水'.includes(search.value.trim()));
const waveClass = n => WAVES.红.includes(n) ? 'red' : WAVES.蓝.includes(n) ? 'blue' : 'green';
const waveLabel = n => `${pad(n)} ${waveClass(n) === 'red' ? '红' : waveClass(n) === 'blue' ? '蓝' : '绿'}波`;
const sourceIsOdds = computed(() => props.view === 'odds');
watch(() => props.view, () => { search.value = ''; sourceDialog.value?.close(); });
</script>

<template>
  <div class="page-body reference-page">
    <section class="page-heading reference-heading">
      <div><div class="eyebrow">{{ view === 'odds' ? 'PLAY & ODDS' : 'ZODIAC & NUMBERS' }}</div>
        <h1>{{ view === 'odds' ? '玩法赔率' : '生肖分类' }}</h1>
        <p>{{ view === 'odds' ? '按参考图整理，马年特殊生肖赔率一目了然。' : '从生肖、分类到号码，随时查阅对应关系。' }}</p>
      </div>
      <button class="button" @click="sourceDialog.showModal()">▧ 查看原图</button>
    </section>

    <template v-if="view === 'odds'">
      <div class="reference-toolbar">
        <span class="reference-year">{{ ODDS_YEAR }} · {{ SPECIAL_ANIMAL }}年参考</span>
        <span class="reference-caption">特殊生肖：马 · 赔率含本金</span>
        <input v-model="search" type="search" aria-label="搜索玩法或赔率" placeholder="搜索玩法或赔率…" />
      </div>
      <div class="reference-callout"><span>ⓘ</span><p>“有蛇”已按马年改为“有马”，特肖与平肖的特殊赔率也已对应调整。此页保留参考图；实际赔付使用“开奖与赔付”中各市场保存的赔率和规则。</p></div>
      <section v-if="showSpecial" class="special-odds-card" aria-label="特码赔率">
        <div><span class="reference-kicker">SPECIAL NUMBER</span><h2>特码</h2><p>不退水 · 按特码号码投注</p></div>
        <div class="special-rate"><small>1 赔</small><strong>47</strong><span>倍</span></div>
      </section>
      <div class="odds-grid">
        <section v-for="section in filteredSections" :key="section.id" class="reference-card odds-card" :aria-label="section.title + '赔率'">
          <header><h2>{{ section.title }}</h2><span v-if="section.horse" class="horse-tag">马年已更新</span><span v-else class="reference-caption">1 赔 · 倍数</span></header>
          <table class="odds-table"><thead><tr><th scope="col">玩法</th><th scope="col">{{ section.horse ? '不含马' : '赔率' }}</th><th v-if="section.horse" scope="col" class="horse-column">马 / 有马</th></tr></thead>
            <tbody><tr v-for="row in section.rows" :key="row.label"><th scope="row">{{ row.label }}</th><td>{{ row.rate }}<small>倍</small></td><td v-if="section.horse" class="horse-column">{{ row.horseRate }}<small>倍</small></td></tr></tbody>
          </table><p v-if="section.note" class="reference-footnote">{{ section.note }}</p>
        </section>
      </div>
      <div v-if="!filteredSections.length && !showSpecial" class="reference-empty">没有找到匹配的玩法。<button class="text-button" @click="search = ''">清除搜索</button></div>
      <section class="reference-card input-examples" aria-label="输入与计费规则">
        <header><h2>输入与计费</h2><span class="reference-caption">示例均为单市场 · 2026马年</span></header>
        <table class="odds-table"><thead><tr><th>输入示例</th><th>计费方式</th><th>金额</th></tr></thead><tbody>
          <tr><th>天肖各100</th><td>25个特码号码 × 100</td><td>2500元</td></tr>
          <tr><th>红波100</th><td>独立红波一项</td><td>100元</td></tr>
          <tr><th>红波各100</th><td>17个特码号码 × 100</td><td>1700元</td></tr>
          <tr><th>二中特 01 02 03 各100</th><td>两两组合，共3组</td><td>300元</td></tr>
          <tr><th>二连尾 0 1 2 各100</th><td>尾数组合，共3组</td><td>300元</td></tr>
          <tr><th>三粒任中 01 02 03 100</th><td>三个号码任中一组</td><td>100元</td></tr>
          <tr><th>三粒任中复式 01 02 03 04 各100</th><td>每组三个号码，共4组</td><td>400元</td></tr>
        </tbody></table>
        <div class="reference-footnote"><p>未写粒数的“平特任中”按所列1–5个不同号码作为一组；超过声明粒数请明确写“复式”，或写成“(01 02 03)(04 05 06)各100”。含义不明的投注会列入待处理。</p>
          <p>蓝/绿波、半波、大小单双及合单/合双按同类写法区分整项与逐号；合数单双按号码十位与个位之和判断。“红肖”是生肖分类，不是红波。</p>
          <p>“二尾/三尾/四尾”是连尾；数字“2尾各100”表示2尾号码逐号投注。尾数请用空格或逗号分隔。分类及五行默认展开为特码，显式特肖/连肖则保留生肖选项。</p>
          <p>默认新市场；两边为新、旧，三边为新、旧、港，每个市场分别计费。同一发送人继承市场，换人重置为新。农历新年只切换生肖号码，五行固定。</p>
        </div>
      </section>
      <details class="reference-notes"><summary>参考图中的时间与约定</summary>
        <div class="deadline-grid"><span>新市场<strong>21:10</strong></span><span>旧市场<strong>21:20</strong></span><span>港市场<strong>21:28</strong></span></div>
        <p>原图注明上述截止时间；同一天开港、新、旧市场时需备注清楚，没有备注的无效退回本金。</p>
        <p>原图注明赔率全含本金；开奖前收到款项生效，开奖后按顺序结清；受注号不收款，收付款通过扫码。</p>
        <p>这些内容为原图约定的摘录，供核对查看。</p>
      </details>
    </template>

    <template v-else>
      <div class="reference-toolbar">
        <span class="reference-year" v-if="calendar.rule">{{ calendar.rule.lunarYear }} · {{ calendar.rule.animal }}年</span>
        <label class="lookup-date">查表日期<input v-model="lookupDate" type="date" min="1900-01-01" max="2100-12-31" aria-label="生肖查表日期" /></label>
        <span class="reference-caption">按农历新年换表 · 不修改账单日期</span>
      </div>
      <p v-if="calendar.error" class="reference-error" role="alert">{{ calendar.error }}</p>
      <template v-else>
        <div class="reference-section-title"><h2>生肖号码</h2><span>{{ calendar.rule.animal }}：01、13、25、37、49</span></div>
        <div class="zodiac-grid">
          <article v-for="animal in ANIMALS" :key="animal" :class="['zodiac-card', { current: animal === calendar.rule.animal }]" :aria-label="animal + '的号码'">
            <header><strong>{{ animal }}</strong><span>{{ animal === calendar.rule.animal ? '当年生肖 · ' : '' }}{{ calendar.rule.zodiac[animal].length }}码</span></header>
            <div class="reference-balls"><span v-for="n in calendar.rule.zodiac[animal]" :key="n" :class="['number-ball', waveClass(n)]" :aria-label="waveLabel(n)">{{ pad(n) }}</span></div>
            <p>{{ ZODIAC_DETAILS[animal].join(' · ') }}</p>
          </article>
        </div>
        <div class="reference-section-title"><h2>生肖分类</h2><span>点击分类，查看其成员和展开号码</span></div>
        <div class="category-workbench">
          <div class="category-picker reference-card">
            <div v-for="group in CATEGORY_GROUPS" :key="group.title" class="category-group"><h3>{{ group.title }}</h3>
              <div><button v-for="[name] in group.entries" :key="name" :aria-pressed="selected === name" :class="{ active: selected === name }" @click="selected = name">{{ name }}</button></div>
            </div>
          </div>
          <section class="reference-card category-preview" aria-label="分类对应号码" aria-live="polite">
            <header><div><span class="reference-kicker">{{ calendar.rule.lunarYear }} · {{ calendar.rule.animal }}年</span><h2>{{ selected }}</h2></div><span class="category-count">{{ selectedNumbers.length }}<small>码</small></span></header>
            <div class="animal-members"><span v-for="animal in selectedCategory.members" :key="animal">{{ animal }}</span><small>共 {{ selectedCategory.members.length }} 个生肖</small></div>
            <p class="reference-caption">对应的特码号码</p>
            <div class="reference-balls"><span v-for="n in selectedNumbers" :key="n" :class="['number-ball', waveClass(n)]" :aria-label="waveLabel(n)">{{ pad(n) }}</span></div>
            <div class="category-example"><span>每号 100 元时</span><strong>¥ {{ formatMoney(selectedNumbers.length * 10000) }}</strong></div>
            <p class="reference-footnote">分类先对应生肖，再按查表日期展开为号码。红肖不等于红波，单笔生肖也不等于单数号码。</p>
          </section>
        </div>
      </template>
      <div class="reference-section-title"><h2>波色号码</h2><span>颜色按号码划分，单双分别列示</span></div>
      <div class="wave-reference-grid">
        <section v-for="(numbers, color) in WAVES" :key="color" class="reference-card wave-reference-card" :aria-label="color + '波号码'">
          <header><h2><i :class="['color-dot', waveClass(numbers[0])]"></i>{{ color }}波</h2><span>{{ numbers.length }}码</span></header>
          <div v-for="parity in [1, 0]" :key="parity" class="wave-number-row"><small>{{ parity ? '单' : '双' }}</small><div class="reference-balls"><span v-for="n in numbers.filter(n => n % 2 === parity)" :key="n" :class="['number-ball', waveClass(n)]" :aria-label="waveLabel(n)">{{ pad(n) }}</span></div></div>
        </section>
      </div>
      <div class="reference-section-title"><h2>五行号码</h2><span class="fixed-table-tag">固定表 · 全年份通用</span></div>
      <section class="reference-card elements-card" aria-label="固定五行号码表">
        <div v-for="(numbers, element) in FIVE_ELEMENTS" :key="element" class="element-row"><div class="element-name"><strong>{{ element }}</strong><small>{{ numbers.length }}码</small></div><div class="reference-balls"><span v-for="n in numbers" :key="n" :class="['number-ball', waveClass(n)]" :aria-label="waveLabel(n)">{{ pad(n) }}</span></div></div>
        <p class="reference-footnote">按你确认的口径，五行固定使用图中这套号码，不随农历年轮转；地支五行与这里的号码五行分别查阅。</p>
      </section>
    </template>
    <footer class="reference-footer">本机可查 · 原图可核对<span>{{ view === 'odds' ? '2026 马年赔率参考' : '生肖随农历年切换 · 五行固定' }}</span></footer>

    <dialog ref="sourceDialog" class="reference-source" aria-label="原始参考图" @click="event => { if (event.target === sourceDialog) sourceDialog.close(); }">
      <header><div><h2>{{ sourceIsOdds ? '玩法赔率原图 · 蛇年档案' : '2026 马年生肖与分类原图' }}</h2><p>{{ sourceIsOdds ? '原图保留供核对，马年特殊生肖赔率请以页面中的整理表为准。' : '原图注明2月17日启用；五行号码按已确认的口径全年份固定。' }}</p></div><button class="button" @click="sourceDialog.close()" aria-label="关闭原图">关闭 ×</button></header>
      <img :src="sourceIsOdds ? oddsSource : zodiacSource" :alt="sourceIsOdds ? '用户提供的蛇年玩法赔率原图' : '用户提供的2026马年生肖分类、波色和五行号码原图'" />
    </dialog>
  </div>
</template>

<style scoped>
.reference-page{padding-bottom:10px}.reference-heading{margin-bottom:22px}.reference-heading p{font-size:12px}.reference-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px}.reference-toolbar input[type=search]{margin-left:auto;min-width:210px;font-size:12px;padding:10px 12px}.reference-year{padding:8px 12px;border:1px solid #d4e4d9;border-radius:6px;background:#eaf3ed;color:#32694e;font-size:12px;font-weight:600}.reference-caption{font-size:11px;color:#7d8f85;line-height:1.7}.reference-callout{display:flex;align-items:flex-start;gap:10px;background:#f0f5f2;border:1px solid #dce7df;border-radius:8px;padding:13px 16px;margin-bottom:20px;color:#628070;font-size:12px;line-height:1.8}.reference-callout>span{font-size:15px}.special-odds-card{display:flex;justify-content:space-between;align-items:center;padding:24px 30px;background:linear-gradient(115deg,#294e3c,#3f7055);border-radius:12px;margin-bottom:20px;color:#fff}.reference-kicker{display:block;font-size:9px;letter-spacing:1.6px;color:#9bb5a7;margin-bottom:9px}.special-odds-card h2{font-size:24px;letter-spacing:3px}.special-odds-card p{font-size:12px;color:#c1d3c6;margin-top:9px}.special-rate{display:flex;align-items:baseline;gap:10px}.special-rate strong{font-size:52px;line-height:1;font-weight:600;letter-spacing:-2px}.special-rate small,.special-rate span{font-size:13px;color:#d4e3d8}.odds-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}.reference-card{border:1px solid #e0e7e2;border-radius:10px;background:#fff;overflow:hidden}.reference-card>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 20px;border-bottom:1px solid #eaf0eb}.reference-card h2{font-size:14px;font-weight:600}.horse-tag,.fixed-table-tag{background:#edf4e9;color:#69844e;border:1px solid #dee9d4;font-size:10px;padding:4px 7px;border-radius:4px;white-space:nowrap}.odds-table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}.odds-table th,.odds-table td{padding:13px 20px;border-bottom:1px solid #edf1ed;line-height:1.8}.odds-table thead th{background:#fafbf9;color:#8a978d;font-size:10px;font-weight:400;padding-top:9px;padding-bottom:9px}.odds-table tbody th{font-weight:400;color:#526a5b}.odds-table td{font-size:16px;font-weight:600;color:#315540;font-variant-numeric:tabular-nums;white-space:nowrap}.odds-table td small{font-size:10px;font-weight:400;color:#94a092;margin-left:4px}.odds-table .horse-column{background:#f7faf2;color:#6d8654}.odds-table tr:last-child th,.odds-table tr:last-child td{border-bottom:0}.reference-footnote{padding:13px 20px;color:#8b9a90;font-size:11px;line-height:1.9;background:#fafcf9;border-top:1px solid #edf1eb}.reference-empty{padding:55px;text-align:center;color:#8a9e8e}.reference-empty button{margin-left:12px}.reference-notes{margin-top:22px;border:1px solid #e1e7e0;border-radius:8px;padding:16px 20px;color:#778b7d;font-size:12px;line-height:1.9}.reference-notes summary{cursor:pointer;font-weight:500}.reference-notes p{margin-top:10px;font-size:11px}.deadline-grid{display:flex;gap:25px;margin-top:14px}.deadline-grid>span{font-size:11px}.deadline-grid strong{display:block;font-size:17px;font-weight:500;color:#4c6d56;margin-top:3px}.reference-footer{display:flex;justify-content:space-between;gap:10px;padding:25px 0;color:#9eaaa1;font-size:10px}.lookup-date{display:flex;align-items:center;gap:9px;font-size:12px;color:#6a7e70}.lookup-date input{padding:7px 9px;font-size:12px}.reference-error{background:#fff5ef;color:#a85e42;padding:16px;border-radius:8px;margin-bottom:20px}.reference-section-title{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:27px 0 14px}.reference-section-title h2{font-size:15px;letter-spacing:.6px}.reference-section-title>span{font-size:11px;color:#879b8c}.zodiac-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.zodiac-card{background:#fff;border:1px solid #e1e7e2;border-radius:9px;padding:16px}.zodiac-card.current{border-color:#8eaf95;background:#f5faf2;box-shadow:inset 0 3px #8eaf95}.zodiac-card header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:5px}.zodiac-card header strong{font-size:22px;font-weight:500;color:#3f644a}.zodiac-card header span{font-size:9px;color:#8b9c8d}.reference-balls{display:flex;flex-wrap:wrap;gap:7px}.number-ball{height:27px;min-width:27px;padding:0 3px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;border:1px solid;flex-shrink:0}.number-ball.red{background:#fff0ef;border-color:#eed7d4;color:#ad5b57}.number-ball.blue{background:#edf3fb;border-color:#d9e2f0;color:#6280ad}.number-ball.green{background:#eff6ea;border-color:#dce8d0;color:#7b9863}.zodiac-card p{font-size:9px;color:#98a69b;margin-top:13px;line-height:1.7}.category-workbench{display:grid;grid-template-columns:minmax(290px,.9fr) minmax(320px,1.1fr);gap:18px;align-items:start}.category-picker{padding:3px 20px 18px}.category-group h3{font-size:10px;font-weight:500;color:#96a197;margin:16px 0 10px;letter-spacing:1px}.category-group>div{display:flex;flex-wrap:wrap;gap:7px}.category-group button{font-size:11px;background:#f8faf7;border:1px solid #e2e9df;color:#7c8f77;border-radius:5px;padding:7px 10px}.category-group button.active{background:#316c50;border-color:#316c50;color:#fff}.category-preview>header{padding:20px 23px}.category-preview h2{font-size:23px;font-weight:500}.category-preview .reference-kicker{margin-bottom:6px}.category-count{font-size:30px;font-weight:500;color:#507953;font-variant-numeric:tabular-nums}.category-count small{font-size:11px;margin-left:6px}.animal-members{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:20px 23px 14px}.animal-members>span{background:#eff5eb;padding:5px 7px;border-radius:4px;color:#66885a;font-size:15px}.animal-members small{font-size:10px;color:#a0ac98}.category-preview>p.reference-caption{padding:0 23px 10px}.category-preview>.reference-balls{padding:0 23px 20px;gap:9px}.category-example{display:flex;justify-content:space-between;align-items:center;margin:0 23px 20px;background:#f1f6eb;border-radius:6px;padding:12px;color:#879878;font-size:11px}.category-example strong{font-size:18px;color:#5c7f4b;font-weight:600;font-variant-numeric:tabular-nums}.wave-reference-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.wave-reference-card>header{padding:14px 16px}.wave-reference-card>header>span{font-size:10px;color:#94a18c}.color-dot{height:8px;width:8px;border-radius:50%;display:inline-block}.color-dot.red{background:#b8716c}.color-dot.blue{background:#7c96ba}.color-dot.green{background:#92ad77}.wave-number-row{display:flex;gap:10px;padding:13px 16px;border-top:1px solid #f0f3ec}.wave-number-row>small{font-size:10px;color:#a3ae98;line-height:27px}.wave-number-row .reference-balls{gap:6px}.element-row{display:flex;align-items:center;gap:25px;padding:17px 22px;border-bottom:1px solid #edf1e9}.element-name{display:flex;align-items:center;gap:12px;min-width:65px}.element-name strong{font-size:19px;font-weight:500;color:#79915b}.element-name small{font-size:10px;color:#99aa89}.elements-card .reference-footnote{border-top:0}.reference-source{border:1px solid #dae4dc;border-radius:12px;padding:0;width:min(1200px,94vw);max-height:92vh;overflow:auto;background:#f5f7f4;color:#304735;box-shadow:0 20px 90px #10291940}.reference-source::backdrop{background:#162a25a6}.reference-source>header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:15px;background:#fff;padding:16px 22px;border-bottom:1px solid #e1e7df}.reference-source h2{font-size:15px}.reference-source p{font-size:11px;color:#8a9b8b;margin-top:6px;line-height:1.7}.reference-source img{display:block;width:100%;height:auto;margin:auto}.reference-source:has(img[alt*="蛇年"]) img{max-width:810px}
@media(max-width:1250px){.zodiac-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.odds-table th,.odds-table td{padding-left:15px;padding-right:15px}.reference-card>header{padding-left:15px;padding-right:15px}.wave-reference-grid{grid-template-columns:1fr}.wave-number-row .reference-balls{gap:8px}.category-workbench{grid-template-columns:minmax(260px,.9fr) minmax(300px,1.1fr)}}
@media(max-width:850px){.odds-grid,.category-workbench{grid-template-columns:1fr}.zodiac-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.reference-toolbar input[type=search]{margin-left:0;flex:1}.reference-caption{font-size:10px}.reference-section-title{align-items:flex-start}.reference-section-title>span{text-align:right}.special-odds-card{padding:20px}.special-rate strong{font-size:42px}}
</style>
