// Frozen v0.4.4 implementation for local upgrade comparisons only.
import { ANIMALS, CN, MARKETS, WAVES, choose, chineseNumber, headNumbers, pad, ruleForDate, tailNumbers, toCents, today } from '../rules.js';

import { CATEGORY_ALIASES, FIVE_ELEMENTS } from '../classifications.js';
import { cleanBetText } from './bet-text-v044.js';
import { SEMANTIC_VERSION, numberBasisEvidence, normalizeFinancial, assistanceMatches } from './semantic-rules-v044.js';

const animalPattern = `[${ANIMALS.join('')}]`;
const countPattern = '(?:十[一二]?|[一二三四五六七八九两俩]|1[0-2]|[1-9])';
const amountPattern = `(?:\\d+(?:\\.\\d{1,2})?|[${CN}]+)`;
const explicitMoney = new RegExp(`(?:各(?:个?(?:号码?|数字|数)|肖|尾|组|注|连|买|写)?|每(?:个?(?:号码?|数字|数)|肖|尾|组|注|个)|个|买|下|落|加|[=＝])\\s*[（(]?\\s*(${amountPattern})`, 'g');
const units = '[元米块斤个钱]';
const cleanEdges = s => s.replace(/^[\s,，。;；:：.#＃·、!！]+|[\s,，。;；.#＃·、!！]+$/g, '').trim();

class ParseProblem extends Error {
  constructor(code, message, pending = false) { super(message); this.code = code; this.pending = pending; }
}
const problem = (code, message, pending) => { throw new ParseProblem(code, message, pending); };

export function normalize(input) {
  return normalizeFinancial(input).normalize('NFKC').replace(/\uFEFF/g, '').replace(/[\u00a0\u200b]/g, ' ')
    .replace(/[Oo\d]+/g, s => /\d/.test(s) ? s.replace(/[Oo]/g, '0') : s)
    .replace(/兔子/g, '兔').replace(/子鼠|老鼠/g, '鼠').replace(/免/g, '兔').replace(/猎/g, '猪').replace(/鸣/g, '鸡').replace(/奧/g, '奥')
    .replace(/(\d)\s*[一十]\s*(?=\d)/g, '$1-').replace(/[–—－]/g, '-')
    .replace(/([0-9])\uFE0F?\u20E3/g, '$1').replace(/([0-9])⃣️?/g, '$1')
    .replace(/复试|复实/g, '复式').replace(/各各/g, '各').replace(/个个/g, '个').replace(/兰/g, '蓝').replace(/🟰/g, '=');
}

export function senderHeader(raw) {
  const m = raw.match(/^\s*([^:：\n]{1,32})[:：]\s*(.*)$/u);
  if (!m) return null;
  const name = m[1].trim();
  if (/[\d/+*=。;；]/.test(name) || /(?:特码|特肖|平特|平码|连肖|连尾|任中|二中特|两中特|特串|不中|中[一二三四五六七八九十\d]|复式)/.test(name)) return null;
  if (/^(?:[新老旧港香澳奥门粤]+|澳门[新旧]?|新澳门|老澳门|旧澳门|香港|三边|两边|[一二三四五六七八九十\d]+[肖连友有]|[鼠牛虎兔龙蛇马羊猴鸡狗猪])$/.test(name)) return null;
  if (CATEGORY_ALIASES.some(c => c.alias === name) || /^(?:[金木水火土](?:行)?|[红蓝绿](?:波)?[单双大小]?(?:波)?|[二三四两]尾|[一二三四五两\d]+(?:连尾|粒任中)|合[单双]|[大小单双])$/.test(name)) return null;
  return { name, body: m[2] };
}

export function marketInfo(input) {
  const found = new Set();
  const pattern = /三边|3边|两边|二边|2边|新旧|新老|旧新|老新|香港|澳门新旧|澳门新|澳门旧|新(?:澳门|噢门|澳|奥|门|凹)?|(?:老|旧)(?:澳门|澳|奥|门)?|港|香/g;
  const text = input.replace(pattern, token => {
    if (/三边|3边/.test(token)) MARKETS.forEach(m => found.add(m));
    else if (/两边|二边|2边|新旧|新老|旧新|老新/.test(token)) { found.add('新'); found.add('旧'); }
    else if (/新/.test(token)) found.add('新');
    else if (/旧|老/.test(token)) found.add('旧');
    else found.add('港');
    return ' ';
  }).replace(/澳门|奥门|澳彩|奥彩|澳|奥/g, ' ');
  return { text, markets: MARKETS.filter(m => found.has(m)) };
}

function takePlay(input, inherited) {
  let text = input, plays = [];
  const numberEvidence=numberBasisEvidence(text);
  if (/取消|作废|撤回|撤单|改成|改为|不要|不买|不算|减半|翻倍|加倍|一半|半价/.test(text)) problem('BET_INSTRUCTION', '含取消、修改或金额调整指令，请明确最终投注后再计入');
  if (/特肖|独肖|(?:一|1)肖/.test(text.replace(/平特(?:一肖|肖)/g, ' ')) && new RegExp(`(?:${countPattern}中${countPattern}|${countPattern}(?:连肖|连码|连尾|不中)|特串|二中特|两中特|平特|任中)`).test(text)) problem('PLAY_CONFLICT', '同一笔同时出现特肖和其他玩法，请明确玩法或拆成独立投注');
  if (/(?<![平中])(?:特码|特马)|单码|单调/.test(text) && new RegExp(`(?:特肖|独肖|平特|平码|任中|特串|${countPattern}(?:中${countPattern}|连肖|连码|连尾|不中|肖中特))`).test(text)) problem('PLAY_CONFLICT', '同一笔同时出现特码和其他玩法，请明确玩法或拆成独立投注');
  const add = (type, label, size = 1, basis = '每组') => {
    if (!plays.some(p => p.type === type && p.size === size)) plays.push({ type, label, size, basis });
  };
  let explicit = false;
  if (/拖|胆拖/.test(text)) problem('DAN_TUO', '胆拖/生肖交叉配对的业务口径待确认，暂不计入金额');
  const combined = new RegExp(`(${countPattern})肖中特`, 'g');
  text = text.replace(combined, (_, n) => { add('special-zodiac-any', `${n}肖中特`, chineseNumber(n), '整项'); return ' '; });
  if (!plays.length && /任中/.test(text)) {
    let size = 0;
    text = text.replace(new RegExp(`(${countPattern})\\s*粒`, 'g'), (_, n) => {
      if (size) problem('PLAY_AMBIGUOUS', '任中粒数重复声明，请拆成独立投注');
      size = chineseNumber(n); return ' ';
    }).replace(/平特|任中/g, ' ');
    if (size > 5) problem('PLAY_SIZE', '平特任中支持一至五粒');
    add('flat-any', size ? `${size}粒任中` : '平特任中', size);
  }
  if (!plays.length) {
    text = text.replace(/(?:二|两|2)中特/g, () => { add('linked-number-2-special', '二中特', 2); return ' '; });
    text = text.replace(/([二三四两])(?:连)?尾|([234])连尾/g, (_, cn, digit) => {
      const size = chineseNumber(cn || digit); add('linked-tail', `${size}连尾`, size); return ' ';
    });
    text = text.replace(new RegExp(`(${countPattern})\\s*不中`, 'g'), (_, n) => { add('not-hit', `${n}不中`, chineseNumber(n)); return ' '; });
    text = text.replace(new RegExp(`(${countPattern})中(${countPattern})`, 'g'), (_, a, b) => {
      const size = chineseNumber(a), hits = chineseNumber(b);
      if (![[2, 2], [3, 2], [3, 3], [4, 4], [5, 5]].some(([x, y]) => x === size && y === hits)) problem('PLAY_UNKNOWN', `暂不支持${a}中${b}，请确认玩法`);
      add(`linked-number-${size}-${hits}`, `${a}中${b}`, size); return ' ';
    });
    text = text.replace(/死|活/g, token => { add(token === '死' ? 'linked-number-3-3' : 'linked-number-3-2', token === '死' ? '三中三' : '三中二', 3); return ' '; });
    text = text.replace(/特串/g, () => { add('special-pair', '特串', 2); return ' '; });
    const linked = new RegExp(`(${countPattern})(?:连肖|肖连|连|友|有|肖)`, 'g');
    text = text.replace(linked, (whole, n, offset, all) => {
      if (all.slice(Math.max(0, offset - 2), offset).includes('平') && !whole.includes('连') || n === '一' || n === '1') return whole;
      const size = chineseNumber(n);
      if (size < 2 || size > 12) problem('PLAY_SIZE', '连肖/连码的组选数量无效');
      const zodiac = whole.includes('肖') || new RegExp(animalPattern).test(all) || CATEGORY_ALIASES.some(c => all.includes(c.alias));
      add(zodiac ? 'linked-zodiac' : `linked-number-${size}-${size}`, `${size}连${zodiac ? '肖' : '码'}`, size);
      return ' ';
    });
    if (plays.length) text = text.replace(/平特/g, ' ');
  }
  if (!plays.length) {
    if (/平特[二三四五六七八九十\d]+肖/.test(text)) problem('PLAY_AMBIGUOUS', '“平特几肖”是连肖还是逐肖计费尚待确认');
    if (/平(?:特)?(?:一肖|肖|尾|码)?/.test(text)) {
      const zodiac = /平(?:特)?(?:一肖|肖)/.test(text) || !/平码/.test(text) && (new RegExp(animalPattern).test(text) || CATEGORY_ALIASES.some(c => text.includes(c.alias)));
      const tail = /尾/.test(text);
      add(zodiac ? 'flat-zodiac' : tail ? 'flat-tail' : 'flat-number', zodiac ? '平特肖' : tail ? '平特尾' : /平码/.test(text) ? '平码' : '平特号码', 1, zodiac ? '每肖' : tail ? '每尾' : '每号');
      text = text.replace(/平(?:特)?(?:一肖|肖|尾|码)?/g, ' ');
    } else if (/特肖|独肖|一肖|1肖/.test(text)) {
      add('special-zodiac', '特肖', 1, '每肖');
      text = text.replace(/特肖|独肖|一肖|1肖/g, ' ');
    } else if (/包/.test(text) && !/各号|每号|各数|每个号码/.test(text)) {
      problem('PACKAGE_AMBIGUOUS', '“包”按号还是按生肖计费尚待确认，请补写“特肖”或“各号”');
    } else if (/特码|特马|单码|单调|特/.test(text)) {
      add('special-number', '特码', 1, '每号'); text = text.replace(/特码|特马|单码|单调|特/g, ' ');
    }
  }
  if (!plays.length) {
    let selection = '';
    try { selection = cleanEdges(takeAmount(text).selection).replace(/[:：]\s*$/, '').trim(); } catch { /* Missing amount is diagnosed below. */ }
    const wave = selection.match(/^(?:波色|半波)?([红蓝绿])(?:波)?([单双大小])?(?:波)?$/);
    const attribute = /^(?:合单|合双|大|小|单|双)$/.test(selection);
    if (!/各|每/.test(text) && (wave && (selection.includes('波') || wave[2]) || attribute)) {
      add(wave ? (wave[2] ? 'half-wave' : 'wave') : 'attribute', wave ? (wave[2] ? '半波' : '波色') : '大小单双 / 合数', 1, '整项');
      text = text.replace(/波色|半波/g, ' ');
    } else if (/^[红蓝绿](?:波|[单双大小])/.test(text) || CATEGORY_ALIASES.some(c => text.startsWith(c.alias)) || /^[金木水火土](?:行)?/.test(text) || /^(?:合单|合双|大|小|单|双)/.test(text)) {
      // An explicit category with per-number wording starts a new special-number bet.
      add('special-number', '特码', 1, '每号');
    }
  }
  if(numberEvidence&&plays.some(p=>/zodiac|linked|not-hit|flat-any/.test(p.type)))problem('BASIS_CONFLICT','明确玩法与逐号“数／号码”计费冲突，请选择每号特码或保留原玩法');
  if(numberEvidence&&!plays.length)add('special-number','特码',1,'每号');
  explicit = plays.length > 0;
  if (!plays.length) {
    const compatible = inherited && (!/zodiac/.test(inherited.type) || new RegExp(animalPattern).test(text)) && (!/linked/.test(inherited.type) || inherited.type === 'linked-tail' || !/头|尾/.test(text));
    if (compatible && /^(?:flat-zodiac|flat-tail|flat-number|flat-any|linked-tail|linked-zodiac|linked-number-|not-hit)/.test(inherited.type) && !/各号|每号|各数/.test(text)) plays = [{ ...inherited }];
    else add('special-number', '特码', 1, '每号');
  }
  if (plays.some(p => p.type === 'special-zodiac') && /各号|每号|每个号/.test(text)) problem('BASIS_CONFLICT', '特肖与“每号”计费单位冲突，请确认后修改');
  if (plays.some(p => p.type === 'special-zodiac-any') && /各肖|每肖/.test(text)) problem('BASIS_CONFLICT', '多肖中特整项计费与逐肖金额冲突');
  return { text: text.replace(/复式|复(?=\s*\d)|各连|连肖|包|特|彩|菜/g, ' '), plays, explicit, evidence:numberEvidence ? [numberEvidence] : [], semanticRule:numberEvidence ? numberEvidence.ruleId : explicit ? 'R03' : 'R06' };
}

function takeAmount(input) {
  if (/各\s*\.\d/.test(input)) problem('DECIMAL_AMBIGUOUS', '“各.5”含义不明确，请写“各5”或“各0.5”');
  if (/(?:各|买|每组|=)\s*-/.test(input)) problem('INVALID_AMOUNT', '金额不能为负数');
  const front = input.match(new RegExp(`^\\s*(${amountPattern})\\s*[元米块斤钱]\\s*(${animalPattern}+)\\s*$`));
  if (front) return { selection: front[2], cents: toCents(front[1]), explicit: true };
  const marker = [...input.matchAll(explicitMoney)].pop();
  if (marker) {
    const end = marker.index + marker[0].length;
    const rest = input.slice(end);
    if (/^[\d.]/.test(rest)) problem('INVALID_AMOUNT', '金额格式无效，最多支持两位小数');
    if (!new RegExp(`^[\\s${units.slice(1, -1)}()（）,，。#·;；]*$`).test(rest)) problem('EXTRA_TEXT', '金额后仍有未识别内容，请拆成独立投注');
    return { selection: input.slice(0, marker.index), cents: toCents(marker[1]), explicit: true };
  }
  const parenthetical = input.match(new RegExp(`[（(]\\s*(${amountPattern})\\s*[）)]\\s*[。.,，]*$`));
  if (parenthetical) return { selection: input.slice(0, parenthetical.index), cents: toCents(parenthetical[1]), explicit: true };
  if (/[)）]\s*$/.test(input)) problem('MISSING_AMOUNT', '缺少明确金额，不能把号码列表最后一项当作单价', true);
  // A decimal after a named category is unambiguous; dots between numeric
  // selections retain the legacy list-delimiter meaning without an amount marker.
  const categoryDecimal = input.match(/([波肖单双大小])\s*(\d+\.\d{1,2})\s*(?:[元米块斤钱])?\s*[，,。]*$/);
  if (categoryDecimal) return { selection: input.slice(0, categoryDecimal.index + 1), cents: toCents(categoryDecimal[2]), explicit: false };
  const last = input.match(new RegExp(`(\\d+|[${CN}]+)\\s*(?:${units})?\\s*[。.,，#·;；]*$`));
  if (!last) problem('MISSING_AMOUNT', '缺少金额，请补充“各100”等明确写法', true);
  const selection = input.slice(0, last.index);
  if (!selection.trim()) problem('MISSING_SELECTION', '只有金额，缺少号码或生肖', true);
  const noUnit = !new RegExp(units).test(last[0]);
  if (noUnit && /[.、,，]\s*$/.test(selection) && !/[鼠牛虎兔龙蛇马羊猴鸡狗猪头尾]/.test(selection)) {
    // Explicit combination context can resolve trailing amount by arity later.
    return { selection, cents: toCents(last[1]), explicit: false, ambiguousList: true };
  }
  return { selection, cents: toCents(last[1]), explicit: false };
}

function parseSelections(input, play, rule) {
  const warnings = [], expansions = [];
  let text = input.replace(/各(?:个?(?:号码?|数字|数)|肖|尾|组|注)?|每(?:个?(?:号码?|数字|数)|肖|尾|组|注|个)|号码|数字|号|一个|一组|组|注|数|买|下|落|加|个|码/g, ' ')
    .replace(new RegExp(`(${animalPattern})肖`, 'g'), '$1').replace(/^[元米斤块钱]\s*[,，。]/, '')
    .replace(/[（(]\s*共\s*[)）]/g, '');
  if (/羊子/.test(text)) problem('ALIAS_AMBIGUOUS', '“羊子”的“子”含义不明确，请使用标准生肖名称');
  text = text.replace(/子/g, '鼠');
  const isZodiac = /zodiac/.test(play.type);
  const isFlatTail = play.type === 'flat-tail' || play.type === 'linked-tail';
  const values = [];
  let rest = text, sawHeadTail = false;
  while (rest.length) {
    const sep = rest.match(/^[\s,，。、.·\/\-+*@#＃:：;；()（）【】〔〕\[\]{}『』「」!！~～='’′]+/);
    if (sep) { rest = rest.slice(sep[0].length); continue; }
    if (['wave', 'half-wave', 'attribute'].includes(play.type)) {
      const token = rest.match(play.type === 'attribute' ? /^(合单|合双|大|小|单|双)/ : /^([红蓝绿])(?:波)?([单双大小])?(?:波)?/);
      if (!token) problem('SELECTION_TYPE', '独立波色、半波或大小单双不能混入号码和其他分类，请拆行');
      values.push(play.type === 'attribute' ? token[1] : token[1] + (token[2] || '波'));
      rest = rest.slice(token[0].length); continue;
    }
    const zodiacCategory = CATEGORY_ALIASES.find(c => rest.startsWith(c.alias));
    if (zodiacCategory) {
      if (isFlatTail) problem('SELECTION_TYPE', '尾数玩法不能混入生肖分类');
      const numbers = zodiacCategory.members.flatMap(a => rule.zodiac[a]);
      values.push(...(isZodiac ? zodiacCategory.members : numbers));
      expansions.push({ kind: 'zodiac-category', source: zodiacCategory.alias, category: zodiacCategory.name,
        members: [...zodiacCategory.members], numbers, businessDate: rule.date });
      rest = rest.slice(zodiacCategory.alias.length); continue;
    }
    const element = rest.match(/^([金木水火土])(?:行)?/);
    if (element) {
      if (isZodiac || isFlatTail) problem('SELECTION_TYPE', '五行号码只能用于号码玩法');
      const numbers = FIVE_ELEMENTS[element[1]];
      values.push(...numbers);
      expansions.push({ kind: 'five-element', source: element[0], numbers: [...numbers], fixed: true });
      rest = rest.slice(element[0].length); continue;
    }
    const headTail = rest.match(/^(\d+(?:\s*[-,.]\s*\d)*)(头|尾)/);
    if (headTail) {
      if (isZodiac) problem('SELECTION_TYPE', '生肖玩法不能混入头尾');
      if (isFlatTail && headTail[2] === '头') problem('SELECTION_TYPE', '尾数玩法不能使用头数');
      if (isFlatTail && /^\d{2,}/.test(headTail[1])) problem('TAIL_AMBIGUOUS', '尾数请用0–9，并以空格或逗号分隔');
      sawHeadTail = true;
      const digits = headTail[1].match(/\d/g).map(Number);
      for (const digit of digits) {
        if (headTail[2] === '头' && digit > 4) problem('INVALID_HEAD', '号码范围01–49，头数只能为0–4');
        values.push(...(isFlatTail ? [digit] : headTail[2] === '头' ? headNumbers(digit) : tailNumbers(digit)));
      }
      rest = rest.slice(headTail[0].length); continue;
    }
    const wave = rest.match(/^(红|蓝|绿)(?:波)?([单双大小])?(?:波)?/);
    if (wave) {
      if (isZodiac || isFlatTail) problem('SELECTION_TYPE', '该玩法不能使用波色号码集合');
      const filter = wave[2];
      values.push(...WAVES[wave[1]].filter(n => !filter || filter === '单' && n % 2 === 1 || filter === '双' && n % 2 === 0 || filter === '大' && n >= 25 || filter === '小' && n <= 24));
      rest = rest.slice(wave[0].length); continue;
    }
    const category = rest.match(/^(合单|合双|小单|小双|大单|大双|单数|双数|单的|双的|大的数?|小的数?|大|小|单|双)/);
    if (category) {
      if (isZodiac || isFlatTail) problem('SELECTION_TYPE', '该玩法不能使用大小单双号码集合');
      const t = category[1];
      for (let n = 1; n <= 49; n++) if ((!t.includes('大') || n >= 25) && (!t.includes('小') || n <= 24) && (!t.includes('单') || (t.includes('合') ? Math.floor(n / 10) + n % 10 : n) % 2 === 1) && (!t.includes('双') || (t.includes('合') ? Math.floor(n / 10) + n % 10 : n) % 2 === 0)) values.push(n);
      rest = rest.slice(t.length); continue;
    }
    if (ANIMALS.includes(rest[0])) {
      const a = rest[0];
      if (isFlatTail) problem('SELECTION_TYPE', '平特尾不能混入生肖');
      if (isZodiac) values.push(a); else values.push(...rule.zodiac[a]);
      rest = rest.slice(1); continue;
    }
    const number = rest.match(/^\d+/);
    if (number) {
      const n = Number(number[0]);
      if (isZodiac) problem('SELECTION_TYPE', '生肖玩法中出现数字号码，请核对玩法或拆行');
      if (!Number.isInteger(n) || (isFlatTail ? n < 0 || n > 9 : n < 1 || n > 49)) problem('NUMBER_RANGE', `“${number[0]}”超出${isFlatTail ? '0–9尾数' : '01–49号码'}范围，不自动丢弃或拆分`);
      values.push(n); rest = rest.slice(number[0].length); continue;
    }
    problem('UNKNOWN_TEXT', `未识别“${rest.slice(0, 16)}”，请补充或改为标准写法`);
  }
  if (!values.length) problem('MISSING_SELECTION', '缺少号码或生肖；若沿用上一笔，请明确补写', true);
  if (new Set(values).size < values.length) warnings.push('含重复选项：特码按出现份数累计；组合池按不同选项计数');
  return { values, warnings, expansions, text, sawHeadTail };
}

function explicitGroups(text, play, rule) {
  const bracketGroups = [...text.matchAll(/[（(【〔\[『「]([^()（）【】〔〕\[\]『』「」]+)[）)】〕\]』」]/g)].map(m => m[1]);
  let parts = bracketGroups;
  if (parts.length < 2) parts = text.split(/[。;；\n]+/).map(cleanEdges).filter(Boolean);
  if (parts.length < 2 && /linked-zodiac/.test(play.type)) parts = text.split(/[,，]/).map(cleanEdges).filter(Boolean);
  if (parts.length < 2) {
    const chunks = text.trim().split(/\s+/);
    if (chunks.length > 1 && chunks.every(p => /\d[-.,/]/.test(p))) parts = chunks;
  }
  if (parts.length < 2) return null;
  const groups = parts.map(part => parseSelections(part, play, rule).values);
  if (groups.some(g => g.length !== play.size || new Set(g).size !== play.size)) problem('GROUP_SIZE', `显式分组中每组应有${play.size}个不同选项，请核对分组`);
  // Every token must be covered by the selected bracket groups.
  if (bracketGroups.length >= 2) {
    const remaining = text.replace(/[（(【〔\[『「]([^()（）【】〔〕\[\]『』「」]+)[）)】〕\]』」]/g, '').replace(/[\s,，。;；]+/g, '');
    if (remaining) problem('GROUP_EXTRA', '括号组外还有选项，分组关系不明确');
  }
  return groups;
}

function resolveBet(input, state, rule) {
  const parsed = takePlay(input, state.play);
  const { selection, cents, ambiguousList } = takeAmount(parsed.text);
  const result = [];
  for (const declaredPlay of parsed.plays) {
    const play = { ...declaredPlay };
    if (ambiguousList && play.type === 'special-number') problem('MISSING_AMOUNT', '号码列表缺少明确单价，请补写“各金额”', true);
    const selected = parseSelections(selection, play, rule);
    let values = selected.values, groups = null, count, mode = 'individual';
    const warnings = [...selected.warnings];
    if (play.type === 'flat-any') {
      if (!play.size) {
        const firstGroup = selection.match(/[（(【〔\[『「]([^()（）【】〔〕\[\]『』「」]+)[）)】〕\]』」]/);
        play.size = new Set(firstGroup ? parseSelections(firstGroup[1], play, rule).values : values).size;
      }
      if (play.size < 1 || play.size > 5) problem('PLAY_SIZE', '平特任中每组只能选一至五个不同号码');
      play.label = `${play.size}粒任中`;
    }
    if (play.basis === '每组') {
      if (play.type === 'not-hit' && (play.size < 1 || play.size > 10)) problem('PLAY_SIZE', '不中暂支持1–10个号码');
      groups = explicitGroups(selection, play, rule);
      values = [...new Set(values)];
      if (groups) { count = groups.length; mode = 'groups'; }
      else {
        if (play.type === 'flat-any' && values.length > play.size && !/复式/.test(input)) problem('ANY_GROUP_AMBIGUOUS', '任中号码超过声明粒数，请写“复式”或用括号明确列组');
        count = choose(values.length, play.size); mode = values.length === play.size ? 'single' : 'combination';
        if (!count) problem('INSUFFICIENT_SELECTION', `需要至少${play.size}个不同选项，当前只有${values.length}个`);
        if (mode === 'combination' && !/复/.test(input)) warnings.push('按单一选项池的复式计算；可用括号明确列组');
      }
    } else if (play.type === 'special-zodiac-any') {
      values = [...new Set(values)];
      if (play.size < 1 || play.size > 12 || values.length !== play.size) problem('ZODIAC_COUNT', `声明${play.size}肖，实际${values.length}个不同生肖`);
      count = 1; mode = 'any';
    } else if (['wave', 'half-wave', 'attribute'].includes(play.type)) {
      if (values.length !== 1) problem('SELECTION_TYPE', '独立分类投注请每项单独填写金额');
      count = 1; mode = 'category';
    } else count = values.length;
    const perMarketCents = cents * count;
    const totalCents = perMarketCents * state.markets.length;
    if (!Number.isSafeInteger(totalCents)) problem('AMOUNT_OVERFLOW', '金额超出精确计算范围');
    result.push({ play: play.label, playType: play.type, size: play.size, basis: play.basis, values, groups, mode, count, unitCents: cents, perMarketCents, totalCents, warnings, expansions: selected.expansions, semantic:{version:SEMANTIC_VERSION,ruleId:parsed.semanticRule,evidence:parsed.evidence,inherited:!parsed.explicit&&!!state.play} });
  }
  return { result, play: parsed.explicit ? parsed.plays[parsed.plays.length - 1] : state.play };
}

function splitClauses(text) {
  // Amount terminators, not arbitrary punctuation, define a bet boundary.
  if (new RegExp(`(?:特肖|独肖)\\s*包?\\s*${amountPattern}\\s*[元米块斤钱]\\s*${animalPattern}+[，,。]?\\s*$`).test(text)) return [text];
  const endings = [];
  const addEnds = re => { for (const m of text.matchAll(re)) endings.push(m.index + m[0].length); };
  addEnds(new RegExp(explicitMoney.source + `\\s*[)）]?\\s*(?:${units})?`, 'g'));
  addEnds(new RegExp(`(?:\\d+|[${CN}]+)\\s*[元米块斤钱]`, 'g'));
  addEnds(new RegExp(`${animalPattern}\\s*\\d+(?:\\.\\d{1,2})?(?![\\d.]|连|有|友|肖|中)`, 'g'));
  addEnds(new RegExp(`(?:[红蓝绿](?:波[单双大小]?|[单双大小])(?:波)?|合[单双]|[大小单双])\\s*\\d+(?:\\.\\d{1,2})?(?![\\d.])`, 'g'));
  // A written currency unit completes an amount even when the next selection
  // starts immediately with a digit. Bare amounts still need the decimal guard.
  const points = [...new Set(endings)].sort((a, b) => a - b).filter(end => end >= text.length || /[元米块斤钱]/.test(text[end - 1]) || !/[\d.]/.test(text[end]));
  const chunks = []; let from = 0;
  for (const end of points) {
    if (end <= from || !cleanEdges(text.slice(from, end))) continue;
    chunks.push(text.slice(from, end)); from = end;
  }
  if (cleanEdges(text.slice(from))) chunks.push(text.slice(from));
  return chunks.length ? chunks : [text];
}

const nonBet = text => /^(?:\[.*\]|S|i|œ|无|外面|\p{Extended_Pictographic}+)$|这条(?:是)?\d|加个提示|一起买$/u.test(text);
const onlyNoise = text => /^[\s。.,，:：;；#＃·()（）\[\]元米斤块个钱外!！]*$/.test(text);

export function parseDocument(rawText, options = {}) {
  const rule = ruleForDate(options.businessDate || today());
  const fileId = options.id || options.name || 'document';
  const fileName = options.name || '未命名文本';
  const bets = [], issues = [], metadata = [], contexts = [];
  const assistance=assistanceMatches(options.assistance,String(rawText),rule.date,options.defaultPlayer)?options.assistance:null;
  const lines = String(rawText).split(/\r\n|\n|\r/);
  const coverage = lines.map((raw, index) => ({ line: index + 1, raw, status: raw.trim() ? 'unhandled' : 'empty' }));
  const defaultSender = options.defaultPlayer?.trim() || (options.name?.trim() ? `本单玩家（${options.name.trim()}）` : '本单玩家');
  const state = { sender: defaultSender, playerId: options.defaultPlayer?.trim() || `document:${fileId}:player`, markets: ['新'], marketSource: null, play: null, senderSegment: 0 };
  let pending = null, messageBets = [], sinceCheck = [], messageIndex = 0;
  const mark = (start, end, status) => {
    const rank = { empty: 0, unhandled: 0, metadata: 1, parsed: 2, review: 3 };
    for (let n = start; n <= end; n++) if (coverage[n - 1]?.raw.trim() && rank[status] >= rank[coverage[n - 1].status]) coverage[n - 1].status = status;
  };
  const addIssue = (line, endLine, raw, code, message, severity = 'error') => {
    issues.push({ id: `${fileId}:issue:${issues.length}`, fileId, fileName, line, endLine, raw, player: state.sender, playerId: state.playerId, code, message, severity });
    mark(line, endLine, severity === 'warning' ? 'parsed' : 'review');
  };
  const flush = () => {
    if (pending) { addIssue(pending.line, pending.endLine, pending.raw, pending.error.code, pending.error.message); pending = null; }
  };
  const meta = (line, text, kind = '说明') => { metadata.push({ line, text, kind }); mark(line, line, 'metadata'); };
  const process = (text, line, endLine, raw) => {
    try {
      const parsed = resolveBet(text, state, rule);
      for (const item of parsed.result) {
        const id = `${fileId}:${line}:${bets.length}`;
        if(item.semantic.evidence.length){const rawEvidence=numberBasisEvidence(raw);item.semantic.evidence=rawEvidence?[{...rawEvidence,source:'original'}]:item.semantic.evidence.map(e=>({...e,source:'normalized'}));}
        const bet = { ...item, id, fileId, fileName, player: state.sender, playerId: state.playerId, assigned: true, senderSegment: state.senderSegment,
          messageIndex, markets: [...state.markets], marketSource: state.marketSource, raw, normalized: text, line, endLine, businessDate: rule.date, lunarYear: rule.lunarYear, ruleVersion: rule.version, status: 'parsed',
          marketEntries: state.markets.map(market => ({ id: `${id}:${market}`, market, amountCents: item.perMarketCents, settlementStatus: 'unsettled', payoutCents: null })) };
        bets.push(bet); messageBets.push(bet); sinceCheck.push(bet);
      }
      state.play = parsed.play;
      mark(line, endLine, 'parsed');
      return null;
    } catch (e) {
      if (!(e instanceof ParseProblem)) { addIssue(line, endLine, raw, 'INVALID_AMOUNT', e.message); return null; }
      if (e.pending) return { text, line, endLine, raw, error: e };
      addIssue(line, endLine, raw, e.code, e.message); return null;
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1, original = lines[index];
    if (!original.trim()) continue;
    const header = senderHeader(original);
    const confirmation=assistance?.items.find(item=>item.line===line&&item.source===original);
    const body=confirmation?.status==='accepted'?confirmation.replacement:(header?header.body:original);
    const prepared = cleanBetText(normalizeFinancial(body));
    let text = normalize(prepared.text).trim();
    if (header) {
      flush(); messageIndex++; messageBets = []; sinceCheck = []; state.play = null;
      if (header.name !== state.sender || state.playerId !== header.name) { state.sender = header.name; state.playerId = header.name; state.markets = ['新']; state.marketSource = null; state.senderSegment++; }
      meta(line, header.name, '发送人');
    }
    contexts.push({line,playerId:state.playerId,markets:[...state.markets],play:state.play?.label||'',body:header?header.body:original});
    if(confirmation?.status==='accepted')meta(line,confirmation.replacement,'已确认解释');
    if (prepared.ignored.length) meta(line, prepared.ignored.join(' '), '无关文字');
    if (!text) continue;
    if (onlyNoise(text) || nonBet(text)) { meta(line, original); continue; }
    if (/取消|作废|撤回|撤单|改成|改为|不要|不买|不算|减半|翻倍|加倍|一半|半价/.test(text)) {
      flush();
      messageBets.forEach(b => { b.status = 'review'; mark(b.line, b.endLine, 'review'); });
      addIssue(line, line, original, 'BET_INSTRUCTION', '含取消、修改或金额调整指令，请明确本段最终投注后再计入'); continue;
    }
    // Count declarations are metadata, never selections.
    text = text.replace(/(?:第)?\d+期/g, t => { meta(line, t, '期号'); return ' '; });
    const counts = [];
    text = text.replace(/[（(]?\s*(?:一共|共)\s*([\d一二三四五六七八九十]+)\s*(码|个|组)\s*[）)]?/g, (_, n, kind) => { counts.push({ n: chineseNumber(n), kind }); return ' '; });
    const sum = text.match(new RegExp(`(?:总合计|合计|总共|共计|一共|共|等于|总|计|合)\\s*[:：=]?\\s*(${amountPattern})\\s*(?:${units})?`));
    const bareSum = text.match(new RegExp(`^[\\s。.,，]*[=＝]\\s*(${amountPattern})\\s*(?:${units})?[\\s。.,，]*$`));
    const declared = sum || bareSum;
    if (sum) text = text.slice(0, sum.index) + text.slice(sum.index + sum[0].length);
    if (bareSum) text = '';
    if (/六合彩/.test(text)) { meta(line, original, '标题'); text = text.replace(/六合彩/g, ' '); }
    const m = marketInfo(text);
    const rest = cleanEdges(m.text);
    if (m.markets.length && onlyNoise(rest)) {
      flush();
      // A trailing market label has a different, not-yet-confirmed backward scope.
      if (onlyNoise(rest) && messageBets.length) {
        const conflicting = messageBets.filter(b => b.markets.join() !== m.markets.join());
        if (conflicting.length) {
          conflicting.forEach(b => { b.status = 'review'; mark(b.line, b.endLine, 'review'); });
          addIssue(line, line, original, 'TRAILING_MARKET', '消息尾部市场的回填范围待确认；前面市场有差异的投注暂不计入，请把市场移到对应投注前');
        } else meta(line, original, '市场');
      }
      state.markets = m.markets; state.marketSource = line;
    }
    if (onlyNoise(rest)) meta(line, original, '声明');
    else {
      // A standalone play header governs following lines.
      let headerPlay = null;
      try { const p = takePlay(rest, null); if (p.explicit && onlyNoise(p.text)) headerPlay = p.plays[0]; } catch { /* Full statement reports its own diagnostic. */ }
      if (headerPlay) { flush(); if (m.markets.length) { state.markets = m.markets; state.marketSource = line; } state.play = headerPlay; meta(line, original, '玩法'); }
      else {
        for (const chunk of splitClauses(text)) {
          const clauseMarket = marketInfo(chunk);
          if (clauseMarket.markets.length) { flush(); state.markets = clauseMarket.markets; state.marketSource = line; }
          const cleaned = cleanEdges(clauseMarket.text);
          if (!cleaned || onlyNoise(cleaned)) continue;
          if (/取消|作废|撤回|撤单|改成|改为|不要|不买|不算|减半|翻倍|加倍|一半|半价/.test(cleaned)) {
            flush(); addIssue(line, line, original, 'BET_INSTRUCTION', '含取消、修改或金额调整指令，请明确最终投注后再计入'); continue;
          }
          if (pending) {
            // Explicit new play starts a new statement; incomplete prior input stays visible.
            if (/特码|特肖|平特|任中|不中|中特|中[一二三四五\d]|连肖|连尾|[二三四]尾/.test(cleaned)) flush();
            else { const previous = pending; pending = null; pending = process(previous.text + '\n' + cleaned, previous.line, line, previous.endLine === line ? previous.raw : previous.raw + '\n' + original); continue; }
          }
          pending = process(cleaned, line, line, original);
        }
      }
    }
    if (declared) {
      meta(line, declared[0], '金额声明');
      const expected = Math.round(chineseNumber(declared[1]) * 100);
      const scope = /合计|总/.test(declared[0]) ? messageBets : sinceCheck;
      const actual = scope.reduce((n, b) => n + (b.status === 'parsed' ? b.totalCents : 0), 0);
      if (!Number.isSafeInteger(expected) || expected < 0) addIssue(line, line, original, 'TOTAL_INVALID', '声明的合计金额无效或超出精确计算范围');
      else if (!scope.length) addIssue(line, line, original, 'TOTAL_SCOPE', '识别到合计金额，但没有可核对的投注范围', 'warning');
      else if (actual !== expected) addIssue(line, line, original, 'TOTAL_MISMATCH', `原文合计${expected / 100}，当前已解析${actual / 100}，相差${(actual - expected) / 100}`, 'warning');
      sinceCheck = [];
    }
    for (const c of counts) {
      meta(line, `共${c.n}${c.kind}`, '数量声明');
      const local = bets.filter(b => b.line <= line && b.endLine >= line && b.messageIndex === messageIndex);
      const count = local.reduce((n, b) => n + b.count, 0);
      if (local.length && count !== c.n) addIssue(line, line, original, 'COUNT_MISMATCH', `原文声明${c.n}${c.kind}，当前计费份数${count}，请核对`, 'warning');
    }
  }
  flush();
  for (const item of coverage) if (item.status === 'unhandled') addIssue(item.line, item.line, item.raw, 'UNHANDLED', '未识别内容，请核对');
  if(assistance)for(const item of assistance.items){
    if((item.status==='review'||['pending','failed'].includes(item.status)&&item.required!==false)&&lines[item.line-1]===item.source){
      bets.filter(b=>b.line<=item.line&&b.endLine>=item.line).forEach(b=>{b.status='review';mark(b.line,b.endLine,'review');});
      addIssue(item.line,item.line,item.source,'AI_REVIEW',item.status==='pending'?'投注含义正在核验':'AI与本地解释有差异，请在AI核验中确认');
    }
  }
  return { id: fileId, name: fileName, rule, bets, issues, metadata, coverage, contexts, assistance:assistance||undefined, nonemptyLines: coverage.filter(l => l.raw.trim()).length };
}

export function summarize(documents, filters = {}) {
  const bets = documents.flatMap(d => d.bets || []).filter(b => b.status === 'parsed' && (!filters.player || b.playerId === filters.player));
  const players = new Map(), markets = Object.fromEntries(MARKETS.map(m => [m, 0])), plays = new Map(), numbers = Array(50).fill(0);
  let totalCents = 0, marketEntryCount = 0;
  for (const bet of bets) {
    for (const entry of bet.marketEntries) {
      if (filters.market && entry.market !== filters.market) continue;
      if (!players.has(bet.playerId)) players.set(bet.playerId, { name: bet.player, id: bet.playerId, 新: 0, 旧: 0, 港: 0, totalCents: 0, count: 0, assigned: bet.assigned });
      const player = players.get(bet.playerId);
      player[entry.market] += entry.amountCents; player.totalCents += entry.amountCents; player.count++;
      markets[entry.market] += entry.amountCents;
      plays.set(bet.play, (plays.get(bet.play) || 0) + entry.amountCents);
      totalCents += entry.amountCents; marketEntryCount++;
      if (bet.playType === 'special-number') bet.values.forEach(n => { numbers[n] += bet.unitCents; });
      if (!Number.isSafeInteger(totalCents)) throw new Error('汇总金额超出精确计算范围，请缩小记账范围');
    }
  }
  return { totalCents, marketEntryCount, markets, players: [...players.values()].sort((a, b) => b.totalCents - a.totalCents), plays: [...plays].map(([name, cents]) => ({ name, cents })), numbers: numbers.slice(1).map((cents, index) => ({ number: index + 1, label: pad(index + 1), cents })) };
}
