import { ANIMALS, WAVES } from './rules.js';

export const NUMBER_SORTS = [
  { value: 'number', label: '号码从小到大', hint: '按 01–49 排列。' },
  { value: 'amount-desc', label: '金额从高到低', hint: '投注最多的号码在前；同金额按号码从小到大。' },
  { value: 'amount-asc', label: '金额从低到高', hint: '未投注的号码在前；同金额按号码从小到大。' },
  { value: 'zodiac', label: '生肖顺序（鼠→猪）', hint: '鼠、牛、虎、兔、龙、蛇、马、羊、猴、鸡、狗、猪；同生肖按号码从小到大。' },
  { value: 'wave', label: '波色顺序（红→蓝→绿）', hint: '红波、蓝波、绿波依次排列；同波色按号码从小到大。' },
  { value: 'tail', label: '尾数顺序（0→9）', hint: '按 0–9 尾归类；同尾按号码从小到大。' },
];

// Sorting only changes presentation; keep all 49 entries and their amounts.
export function sortDistribution(numbers, rule, order = 'number') {
  const animals = new Map(Object.entries(rule?.zodiac || {}).flatMap(([animal, values]) => values.map(n => [n, animal])));
  const waves = new Map(Object.entries(WAVES).flatMap(([wave, values]) => values.map(n => [n, wave])));
  const entries = numbers.map(n => ({ ...n, animal: animals.get(n.number) || '', wave: waves.get(n.number) }));
  const compare = {
    'amount-desc': (a, b) => b.cents - a.cents,
    'amount-asc': (a, b) => a.cents - b.cents,
    zodiac: (a, b) => ANIMALS.indexOf(a.animal) - ANIMALS.indexOf(b.animal),
    wave: (a, b) => ['红', '蓝', '绿'].indexOf(a.wave) - ['红', '蓝', '绿'].indexOf(b.wave),
    tail: (a, b) => a.number % 10 - b.number % 10,
  }[order];
  return entries.sort((a, b) => (compare?.(a, b) || 0) || a.number - b.number);
}

// The distribution has 49 entries, including zero-stake numbers. Compare against
// the exact mean before rounding display amounts to cents; multiplication in
// BigInt also preserves the existing safe-integer monetary limit.
export function numberDistribution(numbers) {
  if (numbers.length !== 49 || numbers.some(n => !Number.isSafeInteger(n.cents) || n.cents < 0)) throw new Error('号码分布金额无效');
  const total = numbers.reduce((sum, n) => sum + BigInt(n.cents), 0n);
  const entries = numbers.map(n => {
    const difference = BigInt(n.cents) * 49n - total;
    return { ...n, aboveAverage: difference > 0n, excessCents: difference > 0n ? Number((difference + 24n) / 49n) : 0 };
  });
  return { averageCents: Number((total + 24n) / 49n), aboveCount: entries.filter(n => n.aboveAverage).length, numbers: entries };
}
