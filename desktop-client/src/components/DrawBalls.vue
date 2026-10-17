<script setup>
import { computed } from 'vue';
import { WAVES, pad, ruleForDate } from '../core/rules.js';

const props = defineProps({
  numbers: { type: Array, required: true },
  date: { type: String, required: true },
  compact: Boolean,
  startIndex: { type: Number, default: 0 },
});
const waveNames = { 红: 'red', 蓝: 'blue', 绿: 'green' };
const waves = new Map(Object.entries(WAVES).flatMap(([wave, numbers]) => numbers.map(n => [n, wave])));
const zodiac = computed(() => {
  try {
    return new Map(Object.entries(ruleForDate(props.date).zodiac).flatMap(([animal, numbers]) => numbers.map(n => [n, animal])));
  } catch { return new Map(); }
});
const balls = computed(() => props.numbers.map((n, i) => ({
  number: pad(n), wave: waves.get(n), animal: zodiac.value.get(n), special: props.startIndex + i === 6,
})));
</script>

<template>
  <div :class="['draw-balls', { compact }]" role="group" :aria-label="`开奖号码，生肖按开奖日期 ${date}`">
    <div class="draw-ball-row">
      <template v-for="(ball, i) in balls" :key="i">
        <span v-if="ball.special && i > 0" class="draw-ball-plus" aria-hidden="true">＋</span>
        <div :class="['draw-ball-item', { 'is-special': ball.special }]" role="img" :aria-label="`${ball.special ? '特码' : '正码'} ${ball.number}，${ball.wave || '未知'}波，${ball.animal || '生肖日期无效'}`" :title="`${ball.wave || '未知'}波 · ${ball.special ? '特码' : '正码'} · ${date}`">
          <span :class="['draw-ball', waveNames[ball.wave]]" aria-hidden="true">{{ ball.number }}</span>
          <span class="draw-ball-zodiac" aria-hidden="true">{{ ball.animal || '—' }}<span v-if="ball.special" class="draw-ball-special">特</span></span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.draw-balls{--ball-size:36px;--ball-gap:6px;--ball-font:17px;--plus-size:16px;max-width:100%;min-width:0;overflow-x:auto;padding:4px 3px}
.draw-balls.compact{--ball-size:28px;--ball-gap:5px;--ball-font:14px;--plus-size:12px}
.draw-ball-row{display:flex;align-items:flex-start;gap:var(--ball-gap);width:max-content}
.draw-ball-item{display:flex;flex-direction:column;align-items:center;gap:7px;width:var(--ball-size);flex:none}
.draw-ball{display:flex;align-items:center;justify-content:center;width:var(--ball-size);height:var(--ball-size);border-radius:50%;box-sizing:border-box;color:#fff;font-size:var(--ball-font);font-weight:750;line-height:1;font-variant-numeric:tabular-nums;font-family:Arial,sans-serif;background:radial-gradient(circle at 32% 22%,var(--ball-light,#aaa) 0%,var(--ball-color,#666) 48%,var(--ball-dark,#444) 100%);border:1px solid var(--ball-dark,#444);box-shadow:inset 0 1px 2px #ffffff85,inset 0 -2px 3px #00000018,0 2px 3px #233b251a;text-shadow:0 1px 1px #00000038}
.draw-ball.red{--ball-light:#f88487;--ball-color:#d93143;--ball-dark:#a61930}
.draw-ball.blue{--ball-light:#78b8f6;--ball-color:#2876d1;--ball-dark:#1752a1}
.draw-ball.green{--ball-light:#75c79d;--ball-color:#208857;--ball-dark:#12633d}
.draw-ball-zodiac{display:flex;align-items:center;justify-content:center;gap:3px;color:#50634e;font-size:11px;line-height:15px;white-space:nowrap}
.draw-ball-special{padding:0 2px;border-radius:3px;background:#f4e4cc;color:#8b591e;font-size:9px;line-height:13px}
.is-special .draw-ball{outline:1px solid #bc9254;outline-offset:2px}
.draw-ball-plus{display:flex;align-items:center;justify-content:center;width:var(--plus-size);height:var(--ball-size);flex:none;color:#8c9784;font-size:16px;line-height:1}
</style>
