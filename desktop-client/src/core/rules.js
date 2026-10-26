import lunar from 'lunar-javascript';

export const MARKETS = ['新', '旧', '港'];
export const ANIMALS = [...'鼠牛虎兔龙蛇马羊猴鸡狗猪'];
export const RULE_VERSION = 'songcai-0.1.0-rules-20261005';
export const WAVES = {
  红: [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46],
  蓝: [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48],
  绿: [5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49],
};
export const CN = '零〇一二三四五六七八九十百千万两俩';
export const mod = (n, m) => ((n % m) + m) % m;
export const pad = n => String(n).padStart(2, '0');

export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = type => parts.find(p => p.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function ruleForDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效的业务日期');
  const [year, month, day] = date.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2100 || check.toISOString().slice(0, 10) !== date) throw new Error('业务日期须在1900–2100年之间且日期有效');
  const value = lunar.Solar.fromYmd(year, month, day).getLunar();
  const lunarYear = value.getYear();
  const current = mod(lunarYear - 4, 12);
  const zodiac = Object.fromEntries(ANIMALS.map(a => [a, []]));
  for (let n = 1; n <= 49; n++) zodiac[ANIMALS[mod(current - n + 1, 12)]].push(n);
  return { date, lunarYear, animal: ANIMALS[current], zodiac, version: RULE_VERSION, lunarDate: `${value.getMonthInChinese()}月${value.getDayInChinese()}` };
}

export function chineseNumber(value) {
  const s = String(value).replace(/[两俩]/g, '二').replace(/〇/g, '零');
  if (/^\d+(?:\.\d{1,2})?$/.test(s)) return Number(s);
  const mixed=s.match(/^(\d+(?:\.\d{1,2})?)([十百千万])$/);
  if(mixed)return Number(mixed[1])*({十:10,百:100,千:1000,万:10000}[mixed[2]]);
  if (!s || [...s].some(c => !CN.includes(c))) return NaN;
  const digits = Object.fromEntries([...'零一二三四五六七八九'].map((c, i) => [c, i]));
  if (!/[十百千万]/.test(s)) return Number([...s].map(c => digits[c]).join(''));
  let total = 0, section = 0, number = 0;
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  for (const c of s) {
    if (c in digits) number = digits[c];
    else if (c === '万') { total += (section + number || 1) * 10000; section = 0; number = 0; }
    else { section += (number || 1) * units[c]; number = 0; }
  }
  // Established shorthand such as 一千三 = 一千三百. Explicit 零 suppresses it.
  const shorthand = s.match(/([百千万])([一二三四五六七八九])$/);
  if (shorthand) number *= units[shorthand[1]] / 10;
  return total + section + number;
}

export function toCents(value) {
  const amount = chineseNumber(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(cents)) throw new Error('金额须为大于0、最多两位小数的有效数值');
  return cents;
}

export function choose(n, k) {
  if (!Number.isInteger(k) || k < 1 || n < k) return 0;
  let result = 1n;
  for (let i = 1; i <= Math.min(k, n - k); i++) result = result * BigInt(n - i + 1) / BigInt(i);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('组合数量过大，超出精确计数范围');
  return Number(result);
}

export function headNumbers(head) { return Array.from({ length: 49 }, (_, i) => i + 1).filter(n => Math.floor(n / 10) === Number(head)); }
export function tailNumbers(tail) { return Array.from({ length: 49 }, (_, i) => i + 1).filter(n => n % 10 === Number(tail)); }
export function formatMoney(cents) { return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function combinationPreview(values, k, limit = 60) {
  const results = [];
  const visit = (from, group) => {
    if (results.length >= limit) return;
    if (group.length === k) { results.push(group); return; }
    for (let i = from; i <= values.length - (k - group.length); i++) visit(i + 1, [...group, values[i]]);
  };
  visit(0, []);
  return results;
}
