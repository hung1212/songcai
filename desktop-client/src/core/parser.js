import { ANIMALS, CN, MARKETS, WAVES, choose, chineseNumber, formatMoney, headNumbers, pad, ruleForDate, tailNumbers, toCents, today } from './rules.js';

import { CATEGORY_ALIASES, FIVE_ELEMENTS } from './classifications.js';
import { cleanBetText } from './bet-text.js';
import {normalizeDottedAmounts,zodiacNumberAmounts,packageAmounts,perZodiacPackages} from './text-format.js';
import { COUNT_PATTERN, PARSER_VERSION, MARKET_PATTERN_SOURCE, ISSUE_PATTERN_SOURCE, canonicalPlayText, senderHeader, marketInfo, marketTokens, statementEvidence, structuralConflicts, playTokens, leadingIssuePrefix, stripLeadingIssuePrefix } from './business-syntax.js';
export { senderHeader, marketInfo } from './business-syntax.js';
import { SEMANTIC_VERSION, numberBasisEvidence, normalizeFinancial, assistanceMatches, semanticReviewReasons, resolvedTotalDeclaration } from './semantic-rules.js';

const animalPattern = `[${ANIMALS.join('')}]`;
const countPattern = COUNT_PATTERN;
const amountPattern = `(?:\\d+(?:\\.\\d{1,2})?|[${CN}]+)`;
const headParityPattern = /(\d+(?:\s*[-,.、/]\s*\d|\s+\d)*)\s*头\s*([单双])/;
const explicitMoney = new RegExp(`(?:各(?:个?(?:号码?|数字|数)|肖|尾|组|注|连|买|写)?|每(?:个?(?:号码?|数字|数)|肖|尾|组|注|个)|组|个|买|下|落|加|[=＝])\\s*[（(]?\\s*(${amountPattern})`, 'g');
const units = '[元米块斤个钱]';
const cleanEdges = s => s.replace(/^[\s,，。;；:：.#＃·、!！\/]+|[\s,，。;；.#＃·、!！\/]+$/g, '').trim();

class ParseProblem extends Error {
  constructor(code, message, pending = false) { super(message); this.code = code; this.pending = pending; }
}
const problem = (code, message, pending) => { throw new ParseProblem(code, message, pending); };

export function normalize(input) {
  return normalizeDottedAmounts(canonicalPlayText(normalizeFinancial(stripLeadingIssuePrefix(input))).normalize('NFKC')).replace(/\uFEFF/g, '').replace(/[\u00a0\u200b]/g, ' ')
    // Keep number/group boundaries: dropping a slash would merge 05 and 14.
    .replace(/\\/g, '/')
    .replace(/[Oo\d]+/g, s => /\d/.test(s) ? s.replace(/[Oo]/g, '0') : s)
    .replace(/兔子/g, '兔').replace(/子鼠|老鼠/g, '鼠').replace(/免/g, '兔').replace(/猎/g, '猪').replace(/鸣/g, '鸡').replace(/奧/g, '奥')
    .replace(/(\d)\s*[一十]\s*(?=\d)/g, '$1-').replace(/[–—－]/g, '-')
    .replace(/([0-9])\uFE0F?\u20E3/g, '$1').replace(/([0-9])⃣️?/g, '$1')
    .replace(/复试|复实/g, '复式').replace(/各各/g, '各').replace(/个个/g, '个').replace(/兰/g, '蓝').replace(/🟰/g, '=');
}

function takePlay(input, inherited, allowDrag = false) {
  let text = input, plays = [], defaultBasisRule = '';
  // 数/号码/数字 explicitly prices each number, even after 包. Keep
  // bare 包猪40 as an equal-total package and diagnose explicit play conflicts.
  const numberedPackagePattern = new RegExp(`包\\s*((?:${animalPattern}\\s*)+(?:号码|数字|数))`, 'g');
  const numberedPackage = [...text.matchAll(numberedPackagePattern)][0];
  if (numberedPackage) {
    if (/(?:各|每)(?:肖|尾|组|注|连)/.test(text)) problem('BASIS_CONFLICT', '“包生肖数”按每号计费，不能同时按每肖或每组计费');
    text = text.replace(numberedPackagePattern, '$1');
  }
  const bigNumberPackage = text.match(new RegExp(`包大数(?=\\s*[:：]?\\s*(?:各(?:个?(?:号码?|数字|数))?|每(?:个?(?:号码?|数字|数)|个))\\s*[（(]?\\s*${amountPattern})`));
  if (bigNumberPackage) text = text.replace('包大数', '大数');
  const packagePattern = new RegExp(`包(单数|双数|${animalPattern})`, 'g');
  const packageSelection = [...text.matchAll(packagePattern)][0]?.[1];
  const packageZodiac = packageSelection && ANIMALS.includes(packageSelection);
  if (packageSelection) {
    if (/各|每/.test(text)) problem('BASIS_CONFLICT', `“包${packageSelection}”表示总额均分，与“各／每”金额冲突，请明确总额或每号金额`);
    text = text.replace(packagePattern, '$1');
  }
  const numberEvidence=numberedPackage ? {ruleId:'R35',field:'basis',quote:numberedPackage[0],start:numberedPackage.index,end:numberedPackage.index+numberedPackage[0].length} : numberBasisEvidence(text) || (bigNumberPackage ? {ruleId:'R17',field:'basis',quote:bigNumberPackage[0],start:bigNumberPackage.index,end:bigNumberPackage.index+bigNumberPackage[0].length} : null);
  if (/取消|作废|撤回|撤单|改成|改为|不要|不买|不算|减半|翻倍|加倍|一半|半价/.test(text)) problem('BET_INSTRUCTION', '含取消、修改或金额调整指令，请明确最终投注后再计入');
  if (/特肖|独肖|(?:一|1)肖/.test(text.replace(/平特(?:一肖|肖)/g, ' ')) && new RegExp(`(?:${countPattern}中${countPattern}|${countPattern}(?:连肖|连码|连尾|不中)|特串|二中特|两中特|平特|任中)`).test(text)) problem('PLAY_CONFLICT', '同一笔同时出现特肖和其他玩法，请明确玩法或拆成独立投注');
  if (/(?<![平中])(?:特码|特马)|单码|单调/.test(text) && new RegExp(`(?:特肖|独肖|平特|平码|任中|特串|${countPattern}(?:中${countPattern}|连肖|连码|连尾|不中|肖中特))`).test(text)) problem('PLAY_CONFLICT', '同一笔同时出现特码和其他玩法，请明确玩法或拆成独立投注');
  const add = (type, label, size = 1, basis = '每组') => {
    if (!plays.some(p => p.type === type && p.size === size)) plays.push({ type, label, size, basis });
  };
  let explicit = false;
  if (/拖/.test(text) && !allowDrag) problem('DAN_TUO', '拖号范围不明确，请按组列出；支持三中二双号拖尾数、二中二或特串单号拖生肖、二连肖单肖或三连肖双肖拖多个生肖');
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
    defaultBasisRule = 'R39';
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
    text = text.replace(/特串/g, () => {
      add('special-pair', '特串', 2);
      if (/复式/.test(input)) plays.find(play => play.type === 'special-pair').combinationRequested = true;
      return ' ';
    });
    text = text.replace(new RegExp(`(?:平特)?(${countPattern})(?:连肖|肖)全中`, 'g'), (_, n) => {
      const size=chineseNumber(n);
      if(size<2||size>12)problem('PLAY_SIZE','连肖组选数量无效');
      add('linked-zodiac',`${size}连肖`,size);return ' ';
    });
    const linked = new RegExp(`(${countPattern})(?:连肖|连码|肖连|连|友|有|肖)`, 'g');
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
    const attribute = /^(?:合单|合双|[大小单双](?:的?数|的)?)$/.test(selection);
    if (!packageSelection && !/各|每/.test(text) && (wave && (selection.includes('波') || wave[2]) || attribute)) {
      add(wave ? (wave[2] ? 'half-wave' : 'wave') : 'attribute', wave ? (wave[2] ? '半波' : '波色') : /^[大小单双]/.test(selection) ? `${/^[大小]/.test(selection)?'大小':'单双'}·${selection[0]}数` : '大小单双 / 合数', 1, '整项');
      if(attribute)defaultBasisRule='R21';
      text = text.replace(/波色|半波/g, ' ');
    } else if (/^[红蓝绿](?:波|[单双大小])/.test(text) || CATEGORY_ALIASES.some(c => text.startsWith(c.alias)) || /^[金木水火土](?:行)?/.test(text) || /^(?:合单|合双|大|小|单|双)/.test(text)) {
      // An explicit category with per-number wording starts a new special-number bet.
      add('special-number', '特码', 1, '每号');
    }
  }
  if(numberEvidence&&plays.some(p=>/zodiac|linked|not-hit|flat-any/.test(p.type)))problem('BASIS_CONFLICT','明确玩法与逐号“数／号码”计费冲突，请选择每号特码或保留原玩法');
  if(numberEvidence&&!plays.length)add('special-number','特码',1,'每号');
  if(packageSelection&&!plays.length)add('special-number','特码',1,'每号');
  if (!plays.length && headParityPattern.test(text)) { add('special-number','特码',1,'每号'); defaultBasisRule='R36'; }
  if (headParityPattern.test(text) && plays.some(p=>p.type==='special-number') && /(?:各|每)(?:肖|尾|组|注|连)/.test(text)) problem('BASIS_CONFLICT', '头数单双筛选按每号特码计费，请明确每号金额');
  explicit = plays.length > 0;
  if (!plays.length) {
    const compatible = inherited && (!/zodiac/.test(inherited.type) || new RegExp(animalPattern).test(text)) && (!/linked/.test(inherited.type) || inherited.type === 'linked-tail' || inherited.type === 'linked-number-3-2' && /拖/.test(text) || !/头|尾/.test(text));
    if (compatible && (inherited.declaration || /^(?:flat-zodiac|flat-tail|flat-number|flat-any|linked-tail|linked-zodiac|linked-number-|not-hit)/.test(inherited.type)) && !/各号|每号|各数/.test(text)) plays = [{ ...inherited, inherited: true }];
    else {
      let selection='';try{selection=cleanEdges(takeAmount(text).selection).replace(/[:：]\s*$/, '').trim();}catch{}
      if(!/各|每/.test(text)&&new RegExp(`^${animalPattern}$`).test(selection)){
        add('special-zodiac','特肖',1,'每肖');defaultBasisRule='R21';
      } else add('special-number', '特码', 1, '每号');
    }
  }
  if (plays.some(p => p.type === 'special-zodiac') && /各号|每号|每个号/.test(text)) problem('BASIS_CONFLICT', '特肖与“每号”计费单位冲突，请确认后修改');
  if (plays.some(p => p.type === 'special-zodiac-any') && /各肖|每肖/.test(text)) problem('BASIS_CONFLICT', '多肖中特整项计费与逐肖金额冲突');
  if (packageSelection && plays.some(p => p.type !== 'special-number')) problem('BASIS_CONFLICT', `“包${packageSelection}”是总额均分的特码投注，不能与其他玩法混用`);
  return { text: text.replace(/复式|复(?=\s*\d)|各连|连肖|包|特|彩|菜/g, ' '), plays, explicit, packageSelection, evidence:numberEvidence ? [numberEvidence] : [], semanticRule:packageSelection ? packageZodiac ? 'R25' : 'R12' : numberEvidence ? numberEvidence.ruleId : defaultBasisRule || (explicit ? 'R03' : 'R06') };
}

function takeAmount(input,packageSelection) {
  if(packageSelection){
    const front=input.match(new RegExp(`^\\s*(${amountPattern})\\s*[元米块斤钱]?\\s*[:：]?\\s*(${animalPattern}|单数|双数)\\s*$`));
    if(front)return {selection:front[2],cents:toCents(front[1]),explicit:true};
  }
  if (/各\s*\.\d/.test(input)) problem('DECIMAL_AMBIGUOUS', '“各.5”含义不明确，请写“各5”或“各0.5”');
  if (/(?:各|买|每组|组|=)\s*-/.test(input)) problem('INVALID_AMOUNT', '金额不能为负数');
  if (new RegExp(`${animalPattern}\\s*(?:号码|数字|数)\\s*[:：]?\\s*-`).test(input)) problem('INVALID_AMOUNT', '金额不能为负数');
  const front = input.match(new RegExp(`^\\s*(${amountPattern})\\s*[元米块斤钱]\\s*(${animalPattern}+)\\s*$`));
  if (front) return { selection: front[2], cents: toCents(front[1]), explicit: true };
  const marker = [...input.matchAll(explicitMoney)].pop();
  const named = zodiacNumberAmounts(input).at(-1);
  const price = named && (!marker || named.amountStart > marker.index)
    ? {index:named.amountStart,end:named.end,amount:named.amount}
    : marker && {index:marker.index,end:marker.index+marker[0].length,amount:marker[1]};
  if (price) {
    const rest = input.slice(price.end);
    if (/^[\d.]/.test(rest)) problem('INVALID_AMOUNT', '金额格式无效，最多支持两位小数');
    if (!new RegExp(`^[\\s${units.slice(1, -1)}()（）,，。#·;；]*$`).test(rest)) problem('EXTRA_TEXT', '金额后仍有未识别内容，请拆成独立投注');
    return { selection: input.slice(0, price.index), cents: toCents(price.amount), explicit: true };
  }
  const parenthetical = input.match(new RegExp(`[（(]\\s*(${amountPattern})\\s*[）)]\\s*[。.,，]*$`));
  if (parenthetical) return { selection: input.slice(0, parenthetical.index), cents: toCents(parenthetical[1]), explicit: true };
  if (/[)）]\s*$/.test(input)) problem('MISSING_AMOUNT', '缺少明确金额，不能把号码列表最后一项当作单价', true);
  // A decimal after a named category is unambiguous; dots between numeric
  // selections retain the legacy list-delimiter meaning without an amount marker.
  const categoryDecimal = input.match(/([大小单双]的?数|[鼠牛虎兔龙蛇马羊猴鸡狗猪波肖单双大小])\s*[:：]?\s*(\d+\.\d{1,2})\s*(?:[元米块斤钱])?\s*[，,。]*$/);
  if (categoryDecimal) return { selection: input.slice(0, categoryDecimal.index + categoryDecimal[1].length), cents: toCents(categoryDecimal[2]), explicit: false };
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
      const token = rest.match(play.type === 'attribute' ? /^(合单|合双|大|小|单|双)(?:的)?/ : /^([红蓝绿])(?:波)?([单双大小])?(?:波)?/);
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
    // A parity directly following heads filters that head range. It must not
    // become a second, full 01–49 odd/even selection appended to the heads.
    const headParity = rest.match(headParityPattern);
    if (headParity?.index === 0) {
      if (isZodiac || isFlatTail) problem('SELECTION_TYPE', '生肖或尾数玩法不能使用头数单双号码集合');
      const tail = rest.slice(headParity[0].length);
      if (/^\s*[单双]/.test(tail)) problem('HEAD_PARITY_CONFLICT', '同一头数后同时出现单和双，请分别写明单数、双数投注及金额');
      const heads = headParity[1].match(/\d/g).map(Number), parity = headParity[2];
      if (heads.some(head=>head>4)) problem('INVALID_HEAD', '号码范围01–49，头数只能为0–4');
      const numbers = heads.flatMap(head=>headNumbers(head).filter(n=>n%2===(parity==='单'?1:0)));
      values.push(...numbers);sawHeadTail=true;
      expansions.push({kind:'head-parity',source:headParity[0],heads,parity,numbers,fixed:true});
      rest=tail;continue;
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
    const remaining = text.replace(/[（(【〔\[『「]([^()（）【】〔〕\[\]『』「」]+)[）)】〕\]』」]/g, '').replace(/[\s,，、。;；:：\/]+/g, '');
    if (remaining) problem('GROUP_EXTRA', '括号组外还有选项，分组关系不明确');
  }
  return groups;
}

function expandLinkedTailGroups(selection, play) {
  if (play.type !== 'linked-tail') return selection;
  // Only explicit brackets disambiguate compact tails. Numeric plays keep
  // their existing number tokens, and amounts were already removed.
  return selection.replace(/[（(【〔\[『「]([^()（）【】〔〕\[\]『』「」]+)[）)】〕\]』」]/g, (whole, body) => {
    const digits = body.trim();
    if (!/^\d+$/.test(digits)) return whole;
    if (digits.length !== play.size || new Set(digits).size !== play.size) problem('GROUP_SIZE', `连尾括号中每组应有${play.size}个不同尾数，“${digits}”不符合，请核对`);
    return whole[0] + [...digits].join(' ') + whole.at(-1);
  });
}

function expandLinkedZodiacGroups(selection, play) {
  if (play.type !== 'linked-zodiac' || !/[、/]/.test(selection) || /[()（）【】〔〕\[\]『』「」]/.test(selection)) return selection;
  const parts = selection.split(/[、,，/]+/).map(cleanEdges).filter(Boolean);
  const literalZodiacs = new RegExp(`^(?:${animalPattern}\\s*)+$`);
  if (parts.length < 2 || !parts.every(part => literalZodiacs.test(part))) return selection;
  // 单肖、单肖 is still a pool. Multi-zodiac chunks declare groups; keep
  // incomplete/duplicate chunks intact so explicitGroups diagnoses them.
  if (parts.every(part => part.replace(/\s/g, '').length === 1)) return selection;
  return parts.map(part => `(${part})`).join('');
}

// Store drags as explicit groups. Settlement must never recombine the fixed
// and trailing selections into an unrestricted pool.
function selectionDrag(selection, play, input, rule) {
  if (!/拖/.test(input)) return null;
  const unsupported = '当前支持三中二双号拖尾数、二中二或特串单号拖生肖、二连肖单肖拖生肖及三连肖双肖拖生肖；其他拖法请明确列出每组';
  if (/复式|胆拖/.test(input)) problem('DAN_TUO', unsupported);
  if (play.type === 'linked-number-3-2') {
    const match = cleanEdges(selection).match(/^(\d{1,2})\s*号?[\s,，.、\/·-]+(\d{1,2})\s*号?\s*拖\s*(\d{1,2})\s*尾\s*[:：]?$/);
    if (!match) problem('DAN_TUO', '三中二拖尾需两个固定号码拖一个0至9尾数，例如“11.33拖5尾，组10米”；请核对固定号码和尾数');
    const anchors = [Number(match[1]),Number(match[2])], tail = Number(match[3]);
    if (anchors.some(n=>n<1||n>49)) problem('NUMBER_RANGE', '三中二固定号码须在01–49范围内');
    if (anchors[0]===anchors[1]) problem('DAN_TUO', '三中二拖尾的两个固定号码不能相同，请列出两个不同号码');
    if (tail<0||tail>9) problem('INVALID_TAIL', '拖尾的尾数须为0–9，不能将两位数字拆成多个尾数');
    if (/(?:各|每)(?:肖|尾|个?(?:号码?|数字|数))/.test(input)) problem('BASIS_CONFLICT', '三中二拖尾按每组计费，请写“组10”“每组10”或“各10”，不能按每号、每尾或每肖计费');
    const all = tailNumbers(tail), numbers = all.filter(n=>!anchors.includes(n)), excluded = all.filter(n=>anchors.includes(n));
    return {ruleId:'R40',anchors,tail,numbers,excluded,groups:numbers.map(n=>[...anchors,n])};
  }
  if (play.type === 'linked-zodiac' && [2,3].includes(play.size)) {
    const list = `${animalPattern}(?:[\\s、,，.·/]*${animalPattern})*`;
    const match = cleanEdges(selection).match(new RegExp(`^(${list})\\s*拖\\s*(.+?)\\s*[:：]?$`));
    if (!match) problem('DAN_TUO', unsupported);
    const anchors = match[1].match(new RegExp(animalPattern,'g'));
    if (anchors.length!==play.size-1 || new Set(anchors).size!==anchors.length) problem('DAN_TUO', `${play.label}拖法需要${play.size-1}个不同的固定生肖，请核对拖字前的生肖`);
    let body = match[2].trim();
    const brackets = {'(':')','[':']','【':'】','〔':'〕','『':'』','「':'」'};
    if (brackets[body[0]]) {
      if (body.at(-1) !== brackets[body[0]]) problem('DAN_TUO', '拖肖括号未配对，请将要拖的生肖放在同一对括号内');
      body = body.slice(1, -1).trim();
    }
    if (!new RegExp(`^${list}$`).test(body)) problem('DAN_TUO', `${play.label}拖法需要明确的被拖生肖列表，请核对括号、选号或额外文字`);
    const animals = body.match(new RegExp(animalPattern, 'g'));
    if (animals.some(animal=>anchors.includes(animal))) problem('DAN_TUO', `拖肖列表含固定生肖，会造成组内重复；请列出每组${play.size}个不同生肖`);
    if (/(?:各|每)(?:肖|尾|个?(?:号码?|数字|数))/.test(input)) problem('BASIS_CONFLICT', `${play.label}拖法按每组计费，请写“各10”或“每组10”，不能按每肖或每号计费`);
    // A repeated trailing item is another purchased group, not a duplicate
    // inside one group. Keep its order and multiplicity for stake and payout.
    const repeatedAnimals=[...new Set(animals)].filter(animal=>animals.filter(a=>a===animal).length>1);
    return {...(play.size===2?{ruleId:'R33',anchor:anchors[0]}:{ruleId:'R41',anchors}),animals,
      ...(repeatedAnimals.length?{repeatedAnimals}:{}),groups:animals.map(animal=>[...anchors,animal])};
  }
  const match = cleanEdges(selection).match(new RegExp(`^(\\d{1,2})\\s*(?:号)?\\s*拖\\s*(${animalPattern})\\s*(?:肖)?\\s*[:：]?$`));
  if (!['linked-number-2-2', 'special-pair'].includes(play.type) || !match) {
    problem('DAN_TUO', unsupported);
  }
  if (/(?:各|每)(?:肖|尾|个?(?:号码?|数字|数))/.test(input)) problem('BASIS_CONFLICT', `${play.label}拖号按每组计费，请写“各10”或“每组10”，不能按每肖或每号计费`);
  const anchor = Number(match[1]), animal = match[2];
  if (anchor < 1 || anchor > 49) problem('NUMBER_RANGE', `“${match[1]}”超出01–49号码范围`);
  const numbers = rule.zodiac[animal].filter(number => number !== anchor);
  return { ruleId: play.type === 'special-pair' ? 'R34' : 'R30', anchor, animal, numbers, excluded: rule.zodiac[animal].includes(anchor) ? [anchor] : [],
    groups: numbers.map(number => [anchor, number]) };
}

// Two named zodiac pools in a special pair cross with each other. Keep each
// actual pair for settlement; flattening them would add same-zodiac wagers.
// Explicit 复式 and explicit number groups retain their existing semantics.
function specialPairZodiacCross(selection, play, input, rule) {
  if (play.type !== 'special-pair' || play.combinationRequested || /复式|拖/.test(input)) return null;
  const match = cleanEdges(selection).match(new RegExp(`^(${animalPattern})[\\s,，.、/·]*(${animalPattern})$`));
  if (!match) return null;
  const animals = match.slice(1);
  if (animals[0] === animals[1]) problem('GROUP_SIZE', '特串生肖对碰需要两个不同生肖，请核对生肖或明确列出号码分组');
  if (/(?:各|每)(?:肖|尾|个?(?:号码?|数字|数))/.test(input)) problem('BASIS_CONFLICT', '特串生肖对碰按每组号码计费，请写“每组2”或“各2”，不能按每肖或每号计费');
  const numbers = animals.map(animal => [...rule.zodiac[animal]]);
  return { ruleId:'R43', animals, numbers, groups:numbers[0].flatMap(left => numbers[1].map(right => [left, right])) };
}

function resolveBet(input, state, rule) {
  const perZodiac=perZodiacPackages(input).find(p=>p.start===0&&!cleanEdges(input.slice(p.end)));
  if(perZodiac){
    const packages=perZodiac.animals.map(animal=>resolveBet(`包${animal}${perZodiac.amount}`,state,rule));
    const result=packages.flatMap(p=>p.result).map(b=>({...b,semantic:{...b.semantic,ruleId:'R28'}}));
    return {result,play:packages.at(-1).play};
  }
  const parsed = takePlay(input, state.play, true);
  const { selection: amountSelection, cents, ambiguousList } = takeAmount(parsed.text,parsed.packageSelection);
  if (parsed.packageSelection && amountSelection.replace(/[\s:：,，。()（）]/g, '') !== parsed.packageSelection) problem('PACKAGE_SELECTION', `包${parsed.packageSelection}请单独写总额，其他号码或分类请另写一笔`);
  // Explicit number categories joined by + share the price but remain separate
  // stakes. Their overlap is intentional and must be added, not deduplicated.
  const numberCategories = amountSelection.split('+').map(cleanEdges);
  const numberCategory = new RegExp(`^(?:${animalPattern}(?:\\s*${animalPattern})*|[红蓝绿]波)\\s*(?:号码|数字|数)\\s*[:：]?$`);
  if (numberCategories.length > 1 && numberCategories.every(part => numberCategory.test(part))) {
    if (parsed.plays.length !== 1 || parsed.plays[0].type !== 'special-number' || /(?:各|每)(?:肖|尾|组|注|连)/.test(input)) problem('BASIS_CONFLICT', '生肖数与波色数按每号特码计费，请保留每号金额');
    const price = `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
    const result = numberCategories.flatMap(part => resolveBet(`特码 ${part} 每号${price}元`, state, rule).result)
      .map(b => ({...b,semantic:{...b.semantic,ruleId:'R35',evidence:parsed.evidence}}));
    return {result,play:parsed.plays[0]};
  }
  const result = [];
  for (const declaredPlay of parsed.plays) {
    const play = { ...declaredPlay };
    const tailSelection = expandLinkedTailGroups(amountSelection, play);
    const selection = expandLinkedZodiacGroups(tailSelection, play);
    const drag = selectionDrag(selection, play, input, rule);
    const cross = specialPairZodiacCross(selection, play, input, rule);
    const grouped = drag || cross;
    if (drag && parsed.plays.length !== 1) problem('DAN_TUO', '拖号请单独声明一种玩法，不混合其他玩法');
    let dragDetail;
    if (drag) {const {groups,...detail}=drag;dragDetail=detail;}
    let crossDetail;
    if (cross) {const {groups,...detail}=cross;crossDetail=detail;}
    if (ambiguousList && play.type === 'special-number' && !parsed.packageSelection) problem('MISSING_AMOUNT', '号码列表缺少明确单价，请补写“各金额”', true);
    const selected = grouped ? {values: [...new Set(grouped.groups.flat())], warnings: [], expansions: []} : parseSelections(selection, play, rule);
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
    if (grouped) {
      groups = grouped.groups; count = groups.length; mode = 'groups';
    } else if (play.basis === '每组') {
      if (play.type === 'not-hit' && (play.size < 1 || play.size > 10)) problem('PLAY_SIZE', '不中暂支持1–10个号码');
      groups = explicitGroups(selection, play, rule);
      values = [...new Set(values)];
      if (groups) {
        count = groups.length; mode = 'groups';
        // Reusing a tail/number in separate explicit groups is intentional;
        // group-local duplicates have already been rejected above.
        const duplicateWarning = warnings.findIndex(w => w.startsWith('含重复选项：'));
        if (duplicateWarning >= 0) warnings.splice(duplicateWarning, 1);
      }
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
    const unitCents = parsed.packageSelection ? cents / count : cents;
    if (!Number.isSafeInteger(unitCents)) problem('PACKAGE_SPLIT_PRECISION', `包号总额无法按${count}个号码平均到分，请调整总额或明确每号金额`);
    const perMarketCents = unitCents * count;
    const totalCents = perMarketCents * state.markets.length;
    if (!Number.isSafeInteger(totalCents)) problem('AMOUNT_OVERFLOW', '金额超出精确计算范围');
    result.push({ play: play.label, playType: play.type, size: play.size, basis: play.basis, values, groups, mode, count, unitCents, perMarketCents, totalCents, ...(drag ? {drag:dragDetail} : {}), ...(cross ? {zodiacCross:crossDetail} : {}), ...(parsed.packageSelection ? {allocation:{method:'equal-total',source:'包'+parsed.packageSelection,totalCents:cents,count}} : {}), warnings, expansions: selected.expansions, semantic:{version:SEMANTIC_VERSION,ruleId:grouped?grouped.ruleId:selection!==tailSelection?'R32':tailSelection!==amountSelection?'R20':selected.expansions.some(e=>e.kind==='head-parity')?'R36':parsed.semanticRule,evidence:parsed.evidence,inherited:!!declaredPlay.inherited, origin:parsed.explicit?'explicit':declaredPlay.inherited?'inherited':'default'} });
  }
  return { result, play: parsed.explicit ? parsed.plays[parsed.plays.length - 1] : state.play ? {...state.play, declaration:false} : null };
}

function splitClauses(text) {
  // Amount terminators, not arbitrary punctuation, define a bet boundary.
  if (new RegExp(`(?:特肖|独肖)\\s*包?\\s*${amountPattern}\\s*[元米块斤钱]\\s*${animalPattern}+[，,。]?\\s*$`).test(text)) return [text];
  const packages=packageAmounts(text);
  const perZodiac=perZodiacPackages(text);
  const endings = [];
  const addEnd = end => {
    // In “特包龙虎各二十一肖”, a generic Chinese amount greedily reads
    // 二十一. The recognized package, including its suffix, is one whole bet.
    const packageBet=perZodiac.find(p=>end>p.start&&end<p.end);
    if(packageBet)end=packageBet.end;
    const front=packages.find(p=>p.reversed&&end>p.start&&end<p.end);
    if(front)end=front.end;
    // "虎猪兔各十米一肖" declares the completed bet's special-zodiac
    // basis. Keep it attached; "一肖牛各20" starts a different bet.
    const suffix = text.slice(end).match(/^\s*(?:一肖|1肖)(?=\s*(?:[,，;；。/]|$))/);
    if (suffix) end += suffix[0].length;
    endings.push(end);
  };
  const addEnds = re => { for (const m of text.matchAll(re)) addEnd(m.index + m[0].length); };
  for(const m of packages)if(m.reversed)addEnd(m.end);
  for (const m of zodiacNumberAmounts(text)) addEnd(m.end);
  addEnds(new RegExp(explicitMoney.source + `\\s*[)）]?\\s*(?:${units})?`, 'g'));
  addEnds(new RegExp(`(?:\\d+|[${CN}]+)\\s*[元米块斤钱]`, 'g'));
  addEnds(new RegExp(`${animalPattern}\\s*\\d+(?:\\.\\d{1,2})?(?![\\d.]|连|有|友|肖|中)`, 'g'));
  addEnds(new RegExp(`(?:[红蓝绿](?:波[单双大小]?|[单双大小])(?:波)?|合[单双]|[大小单双])\\s*\\d+(?:\\.\\d{1,2})?(?![\\d.])`, 'g'));
  // A written currency unit completes an amount even when the next selection
  // starts immediately with a digit. Bare amounts still need the decimal guard.
  const slashAmountTail = new RegExp(`^\\s*/[\\s/]*${amountPattern}\\s*(?:${units}|(?=[,，;；]|$))`);
  const points = [...new Set(endings)].sort((a, b) => a - b).filter(end => {
    if (end >= text.length || /[元米块斤钱]/.test(text[end - 1])) return true;
    if(packages.some(p=>p.reversed&&p.end===end)){
      const tail=text.slice(end);
      return /^\s*[,，;；。]/.test(tail)||packages.some(p=>p.start>=end&&/^\s*$/.test(text.slice(end,p.start)))||playTokens(tail).some(t=>/^\s*$/.test(tail.slice(0,t.start)));
    }
    // A bare package total must not consume the first number of an extra
    // selection (包龙01/03 40). Split only at a clear next-bet boundary.
    if(new RegExp(`包${animalPattern}\\s*\\d+(?:\\.\\d{1,2})?$`).test(text.slice(0,end))) {
      const tail=text.slice(end);
      if(cleanEdges(tail)&&!/^\s*[,，;；]/.test(tail)&&!new RegExp(explicitMoney.source).test(tail)&&!playTokens(tail).length&&!marketInfo(tail).markets.length)return false;
    }
    // Keep "各1/2米" together so takeAmount rejects the ambiguous price.
    // "各1 / 06各2米" still has two complete, explicit amounts.
    return !/[\d.]/.test(text[end]) && !slashAmountTail.test(text.slice(end));
  });
  const chunks = []; let from = 0;
  for (const end of points) {
    if (end <= from || !cleanEdges(text.slice(from, end))) continue;
    chunks.push(text.slice(from, end)); from = end;
  }
  if (cleanEdges(text.slice(from))) chunks.push(text.slice(from));
  return chunks.length ? chunks : [text];
}

const nonBet = text => /^(?:\[.*\]|S|i|œ|无|外面|\p{Extended_Pictographic}+)$|这条(?:是)?\d|加个提示|一起买$/u.test(text);
// 彩／菜 are filler already ignored inside a bet; ignore them in headings too.
const onlyNoise = text => /^[\s。.,，:：;；#＃·()（）\[\]元米斤块个钱外彩菜!！\/]*$/.test(text);
function declaredPlay(text) {
  try { const p=takePlay(text,null); return p.explicit&&onlyNoise(p.text)?p.plays[0]:null; }
  catch { return null; }
}

// Only the complete, immediately adjacent source entry is a local subtotal
// candidate. Never search arbitrary trailing combinations for a matching sum.
function adjacentSubtotal(bets, line, issues, pending, contexts, metadata) {
  const last=bets.at(-1);
  if(!last||last.endLine<line-1||last.endLine>line||pending)return [];
  if(last.endLine<line&&metadata.some(m=>m.line===line&&['玩法','市场标题'].includes(m.kind)))return [];
  const scope=[];let first=last.line;
  for(let i=bets.length-1;i>=0&&bets[i].endLine>=first;i--){scope.unshift(bets[i]);first=Math.min(first,bets[i].line);}
  if(scope.some(b=>b.status!=='parsed')||issues.some(i=>i.line<=line&&i.endLine>=first))return [];
  if(contexts.some(c=>c.line>=first&&c.line<=line&&structuralConflicts(c.body,scope.filter(b=>b.line<=c.line&&b.endLine>=c.line)).length))return [];
  return scope;
}

function hasFollowingBet(lines, index, defaultPlayer) {
  for (const raw of lines.slice(index + 1)) {
    if (!raw.trim()) return false;
    if (senderHeader(raw, defaultPlayer)) return false;
    const text = normalize(cleanBetText(normalizeFinancial(raw)).text).trim();
    if (!text || onlyNoise(text) || nonBet(text)) continue;
    if (/^(?:总合计|合计|总共|共计|一共|共|总)\s*[:：=]?\s*[\d零〇一二三四五六七八九十百千万两]/.test(text)) return false;
    const body = cleanEdges(marketInfo(text).text);
    if (onlyNoise(body) || declaredPlay(body)) continue;
    return bareNumberList(body) || statementEvidence(body).some(e => e.field === 'selection' || e.field === 'play');
  }
  return false;
}

// A market after the price belongs to the just-completed entry for review,
// not to all earlier bets. Keep totals on their existing closing-block path.
function trailingMarket(text) {
  let start = text.length;
  for (const token of marketTokens(text).reverse()) {
    if (!onlyNoise(text.slice(token.end, start))) break;
    start = token.start;
  }
  const body = text.slice(0, start);
  if (start === text.length || !statementEvidence(body).some(e => e.field === 'amount')) return null;
  return { body, ...marketInfo(text.slice(start)), quote: text.slice(start).trim() };
}

// A total followed by a market closes a consecutive betting block. Keep the
// original lines intact and never cross a sender, blank line, or prior total.
function closingMarketScopes(lines,defaultPlayer) {
  const scopes=new Map();
  for(let i=0;i<lines.length;i++) {
    const header=senderHeader(lines[i],defaultPlayer),body=normalize(header?header.body:lines[i]);
    const close=body.match(new RegExp(`(?:总合计|合计|总共|共计|一共|共)\\s*[:：=]?\\s*(${amountPattern})\\s*(?:${units})?[\\s,，。;；.]*(${MARKET_PATTERN_SOURCE})[\\s,，。;；.]*$`));
    if(!close)continue;
    let first=i;
    if(!header)while(first>0){
      const raw=lines[first-1];
      if(!raw.trim())break;
      const h=senderHeader(raw,defaultPlayer),previous=normalize(h?h.body:raw);
      if(/总合计|合计|总共|共计|一共|共/.test(previous)||!new RegExp(explicitMoney.source).test(previous))break;
      first--;if(h)break;
    }
    const markets=marketInfo(close[2]).markets;
    const before=lines.slice(first,i).concat(body.slice(0,close.index));
    if(!before.some(l=>new RegExp(explicitMoney.source).test(normalize(l))))continue;
    // A footer cannot silently override explicit markets in the same block.
    if(before.some(l=>{const h=senderHeader(l,defaultPlayer),m=marketInfo(normalize(h?h.body:l)).markets;return m.length&&m.join()!==markets.join();}))continue;
    for(let n=first;n<=i;n++)scopes.set(n,{markets,line:i+1,firstLine:first+1});
  }
  return scopes;
}

// A separate market at the end of a paragraph can close the preceding block.
// Compute its scope before parsing so totals, settlement and AI all agree.
function paragraphMarketScopes(lines, defaultPlayer) {
  const scopes = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (senderHeader(lines[i], defaultPlayer) || i + 1 < lines.length && lines[i + 1].trim()) continue;
    const market = marketInfo(normalize(lines[i]));
    if (!market.markets.length || !onlyNoise(market.text)) continue;
    let first = i, priced = false, conflict = false, firstMarkets = [];
    while (first > 0) {
      const raw = lines[first - 1], header = senderHeader(raw, defaultPlayer);
      const text = normalize(header ? header.body : raw), info = marketInfo(text);
      const body = cleanEdges(info.text);
      if (!raw.trim() || /总合计|合计|总共|共计|一共|共|总/.test(text) || onlyNoise(body) || declaredPlay(body)) break;
      const hasPrice = statementEvidence(body).some(e => e.field === 'amount');
      if (!hasPrice && !bareNumberList(body)) break;
      priced ||= hasPrice;
      conflict ||= !!info.markets.length && info.markets.join() !== market.markets.join();
      firstMarkets = info.markets;
      first--;
      if (header) break;
    }
    if (first === i || !priced || conflict) continue;
    const scope = { markets: market.markets, firstLine: first + 1, line: i + 1, firstMarkets, enabled: false };
    for (let n = first; n <= i; n++) scopes.set(n, scope);
  }
  return scopes;
}

// Number-only lines ending in a written price (with or without more numbers)
// are a wrapped selection. Precompute the consecutive scope once, rather than
// reinterpreting the last number as a price before the next line is read.
function bareNumberList(text) {
  if(!/^[\d\s.,，、/\\·-]+$/.test(text))return false;
  const numbers=text.split(/[\s.,，、/\\·-]+/).filter(Boolean);
  return numbers.length>0&&numbers.every(n=>/^\d{1,2}$/.test(n)&&Number(n)>=1&&Number(n)<=49);
}
function numberContinuationScopes(lines,defaultPlayer) {
  const scopes=new Map();let amountLine=null;
  for(let i=lines.length-1;i>=0;i--){
    const raw=lines[i],header=senderHeader(raw,defaultPlayer),text=normalize(header?header.body:raw).trim();
    const market=marketInfo(text),body=cleanEdges(market.text);
    if(bareNumberList(body)){
      if(amountLine!==null)scopes.set(i,amountLine);
    }else{
      amountLine=null;
      // A new player, market, or named play on the price line is a boundary.
      if(!header&&!market.markets.length&&!playTokens(text).length){
        const first=splitClauses(text)[0];
        try{
          const priced=takeAmount(first||'');
          const selection=cleanEdges(priced.selection);
          if((bareNumberList(selection)||!selection&&priced.explicit)&&(priced.explicit||/[元米块斤钱]\s*[，,。.]*$/.test(first)))amountLine=i+1;
        }catch{ /* No complete numeric price; keep normal parsing diagnostics. */ }
      }
    }
    // Do not carry the scope across blank lines, messages, or market headings.
    if(!text||header||market.markets.length)amountLine=null;
  }
  return scopes;
}

export function parseDocument(rawText, options = {}) {
  const rule = ruleForDate(options.businessDate || today());
  const fileId = options.id || options.name || 'document';
  const fileName = options.name || '未命名文本';
  const bets = [], issues = [], metadata = [], contexts = [];
  const assistance=assistanceMatches(options.assistance,String(rawText),rule.date,options.defaultPlayer)?options.assistance:null;
  const lines = String(rawText).split(/\r\n|\n|\r/);
  const closingMarkets=closingMarketScopes(lines,options.defaultPlayer);
  const paragraphMarkets=paragraphMarketScopes(lines,options.defaultPlayer);
  const continuations=numberContinuationScopes(lines,options.defaultPlayer);
  const coverage = lines.map((raw, index) => ({ line: index + 1, raw, status: raw.trim() ? 'unhandled' : 'empty' }));
  const defaultSender = options.defaultPlayer?.trim() || (options.name?.trim() ? `本单玩家（${options.name.trim()}）` : '本单玩家');
  const state = { sender: defaultSender, playerId: options.defaultPlayer?.trim() || `document:${fileId}:player`, markets: ['新'], marketSource: null, play: null, playSource:null, senderSegment: 0 };
  let pending = null, messageBets = [], sinceCheck = [], sectionBets = [], marketBets = [], lastEntry = [], messageIndex = 0;
  const mark = (start, end, status) => {
    const rank = { empty: 0, unhandled: 0, metadata: 1, parsed: 2, review: 3 };
    for (let n = start; n <= end; n++) if (coverage[n - 1]?.raw.trim() && rank[status] >= rank[coverage[n - 1].status]) coverage[n - 1].status = status;
  };
  const addIssue = (line, endLine, raw, code, message, severity = 'error', details = {}) => {
    issues.push({ id: `${fileId}:issue:${issues.length}`, fileId, fileName, line, endLine, raw, player: state.sender, playerId: state.playerId, code, message, severity, ...details });
    mark(line, endLine, severity === 'warning' ? 'parsed' : 'review');
  };
  const flush = () => {
    if (pending) { addIssue(pending.line, pending.endLine, pending.raw, pending.error.code, pending.error.message); pending = null; lastEntry = []; }
  };
  const meta = (line, text, kind = '说明') => { metadata.push({ line, text, kind }); mark(line, line, 'metadata'); };
  const reviewTrailingMarket = (scope, markets, line, quote) => {
    const conflicting = scope.filter(b => b.markets.join() !== markets.join());
    if (!conflicting.length) return;
    const first = Math.min(...conflicting.map(b => b.line));
    const label = list => list.map(m => ({新:'新澳',旧:'旧澳',港:'香港'}[m])).join('／');
    const inherited = [...new Set(conflicting.map(b => label(b.markets)))].join('、');
    const affectedBetIds = conflicting.map(b => b.id);
    conflicting.forEach(b => {
      b.status = 'review'; b.marketAmbiguity = {ruleId:'R27',markets:[...markets],line,quote};
      mark(b.line, b.endLine, 'review');
    });
    addIssue(first, line, lines.slice(first - 1, line).join('\n'), 'TRAILING_MARKET',
      `第${first}行${scope === messageBets ? '起的合计范围' : '这笔投注'}原属${inherited}，投注后出现“${quote}”（${label(markets)}），市场归属有争议；请将市场写在这笔投注前`,
      'error', {affectedBetIds,marketLine:line,marketChoices:[...new Set(conflicting.flatMap(b=>b.markets).concat(markets))],ruleId:'R27'});
  };
  const process = (text, line, endLine, raw) => {
    lastEntry = [];
    try {
      if(continuations.has(endLine-1)&&bareNumberList(text)&&takePlay(text,state.play).plays.every(p=>['special-number','flat-number'].includes(p.type))) {
        return {text,line,endLine,raw,error:new ParseProblem('MISSING_AMOUNT','号码续行等待明确单价',true)};
      }
      const parsed = resolveBet(text, state, rule);
      for (const item of parsed.result) {
        const id = `${fileId}:${line}:${bets.length}`;
        if(item.semantic.evidence.length){const rawEvidence=numberBasisEvidence(raw);item.semantic.evidence=rawEvidence?[{...rawEvidence,source:'original'}]:item.semantic.evidence.map(e=>({...e,source:'normalized'}));}
        const bet = { ...item, ...(continuations.get(line-1)===endLine&&endLine>line?{continuation:{ruleId:'R19',amountLine:endLine}}:{}), id, fileId, fileName, player: state.sender, playerId: state.playerId, assigned: true, senderSegment: state.senderSegment,
          messageIndex, markets: [...state.markets], marketSource: state.marketSource, raw, normalized: text, line, endLine, businessDate: rule.date, lunarYear: rule.lunarYear, ruleVersion: rule.version, status: 'parsed',
          marketEntries: state.markets.map(market => ({ id: `${id}:${market}`, market, amountCents: item.perMarketCents, settlementStatus: 'unsettled', payoutCents: null })) };
        bets.push(bet); messageBets.push(bet); sinceCheck.push(bet); sectionBets.push(bet); marketBets.push(bet); lastEntry.push(bet);
      }
      if(parsed.result.some(b=>b.semantic.origin==='explicit'))state.playSource={line,body:contexts.find(c=>c.line===line)?.body||raw};
      state.play = parsed.play;
      mark(line, endLine, 'parsed');
      return null;
    } catch (e) {
      if (!(e instanceof ParseProblem)) { addIssue(line, endLine, raw, 'INVALID_AMOUNT', e.message); return null; }
      // A standalone per-selection price belongs to preceding selections. If
      // none are pending, report just this line; do not consume the next bet.
      if (e.pending && !(e.code==='MISSING_SELECTION'&&/^(?:各|每)/.test(text))) return { text, line, endLine, raw, error: e };
      addIssue(line, endLine, raw, e.code, e.message); return null;
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1, original = lines[index];
    if (!original.trim()) {
      // R38/R42: a physical blank line starts a fresh market/play context.
      // Preserve the player and total-check scopes. An unfinished bet cannot
      // borrow a price from the next group; a normal newline is a continuation.
      flush();
      state.markets = ['新']; state.marketSource = null;
      state.play = null; state.playSource = null;
      continue;
    }
    const header = senderHeader(original,options.defaultPlayer);
    const confirmation=assistance?.items.find(item=>item.line===line&&item.source===original);
    const body=confirmation?.status==='accepted'?confirmation.replacement:(header?header.body:original);
    const prepared = cleanBetText(normalizeFinancial(body));
    let text = normalize(prepared.text).trim();
    if (header) {
      flush(); messageIndex++; messageBets = []; sinceCheck = []; sectionBets = []; marketBets = []; lastEntry = []; state.play = null; state.playSource = null;
      if (header.name !== state.sender || state.playerId !== header.name) { state.sender = header.name; state.playerId = header.name; state.markets = ['新']; state.marketSource = null; state.senderSegment++; }
      meta(line, header.name, '发送人');
    }
    const closing=closingMarkets.get(index);
    const paragraph=paragraphMarkets.get(index);
    if(paragraph?.firstLine===line)paragraph.enabled=!state.marketSource||state.markets.join()===paragraph.markets.join()||paragraph.firstMarkets.join()===paragraph.markets.join();
    if(paragraph?.enabled){state.markets=[...paragraph.markets];state.marketSource=paragraph.line;}
    if(closing){state.markets=[...closing.markets];state.marketSource=closing.line;}
    contexts.push({line,playerId:state.playerId,markets:[...state.markets],play:state.play?.label||'',playDeclaration:!!state.play?.declaration,playSource:state.playSource,marketSource:state.marketSource,messageIndex,body:header?header.body:original});
    if(confirmation?.status==='accepted')meta(line,confirmation.replacement,'已确认解释');
    const issuePrefix=leadingIssuePrefix(body);
    if(issuePrefix){meta(line,issuePrefix.quote,'期号备注');Object.assign(metadata.at(-1),{ruleId:'R37',ignored:true});}
    if (prepared.ignored.length) meta(line, prepared.ignored.join(' '), '无关文字');
    if (!text) continue;
    if (onlyNoise(text) || nonBet(text)) { meta(line, original); continue; }
    if (/取消|作废|撤回|撤单|改成|改为|不要|不买|不算|减半|翻倍|加倍|一半|半价/.test(text)) {
      flush();
      messageBets.forEach(b => { b.status = 'review'; mark(b.line, b.endLine, 'review'); });
      addIssue(line, line, original, 'BET_INSTRUCTION', '含取消、修改或金额调整指令，请明确本段最终投注后再计入'); continue;
    }
    // Count declarations are metadata, never selections.
    const issueMarkets=marketInfo(text).markets;
    text = text.replace(new RegExp(ISSUE_PATTERN_SOURCE,'g'), t => {
      meta(line, t, '期号');
      // A market-qualified issue belongs to this player's following entries
      // in that market, not other markets/players elsewhere in the ledger.
      if(issueMarkets.length)Object.assign(metadata.at(-1),{ruleId:'R44',markets:issueMarkets,playerId:state.playerId,messageIndex});
      return ' ';
    });
    const counts = [];
    text = text.replace(/[（(]?\s*(?:一共|共)\s*([\d一二三四五六七八九十]+)\s*(码|个|组)\s*[）)]?/g, (_, n, kind) => { counts.push({ n: chineseNumber(n), kind }); return ' '; });
    const sum = text.match(new RegExp(`(?:总合计|合计|总共|共计|一共|共|等于|总|计|合)\\s*[:：=]?\\s*(${amountPattern})\\s*(?:${units})?`));
    const bareSum = text.match(new RegExp(`^[\\s。.,，]*[=＝]\\s*(${amountPattern})\\s*(?:${units})?[\\s。.,，]*$`));
    const declared = sum || bareSum;
    if (sum) text = text.slice(0, sum.index) + text.slice(sum.index + sum[0].length);
    if (bareSum) text = '';
    if (/六合彩/.test(text)) { meta(line, original, '标题'); text = text.replace(/六合彩/g, ' '); }
    const suffix = !declared && trailingMarket(text);
    if (suffix) text = suffix.body;
    const m = marketInfo(text);
    const rest = cleanEdges(m.text);
    // An explicit business header starts a subtotal section, not a new player
    // or message. Never search arbitrary preceding rows for a matching amount.
    const prefix=text.match(/^([^:：]+)[:：]/)?.[1];
    if(prefix) {
      const p=marketInfo(prefix);
      if(declaredPlay(cleanEdges(p.text)) || onlyNoise(p.text)&&(p.markets.length||/澳|奥/.test(prefix)))sectionBets=[];
    }
    // A leading market starts a new section with or without a colon. Clear
    // the old play before parsing, so 香港33各5 cannot inherit 二中二.
    const leadingMarket=marketTokens(text).find(token=>onlyNoise(text.slice(0,token.start)));
    if(leadingMarket&&!onlyNoise(rest)) {
      flush();sectionBets=[];marketBets=[];state.play=null;state.playSource=null;
      Object.assign(contexts.at(-1),{play:'',playDeclaration:false,playSource:null,markets:[...m.markets],marketSource:line});
      meta(line,leadingMarket.quote,'市场标题');metadata.at(-1).ruleId='R31';
    }
    if (m.markets.length && onlyNoise(rest)) {
      flush();
      sectionBets=[];
      // Resolved paragraph footers take precedence over looking past blanks
      // for a later bet. Explicit conflicting market contexts remain guarded.
      const forwardHeader = !declared && (index > 0 && !lines[index - 1].trim() || hasFollowingBet(lines, index, options.defaultPlayer));
      if (paragraph?.enabled && paragraph.line === line) {
        meta(line, original, '市场段尾');
        Object.assign(metadata.at(-1), {ruleId:'R29',fromLine:paragraph.firstLine,toLine:line-1,markets:[...m.markets]});
      } else if (forwardHeader || !declared && !sinceCheck.length) {
        marketBets=[]; lastEntry=[]; state.play=null; state.playSource=null;
        meta(line, original, '市场标题');
        metadata.at(-1).ruleId='R27';
      } else if (messageBets.length && !closing) {
        const scope = declared ? messageBets : lastEntry.filter(b => b.endLine === line - 1);
        reviewTrailingMarket(scope, m.markets, line, original.trim());
        meta(line, original, '市场');
      }
      state.markets = m.markets; state.marketSource = line;
    }
    if (onlyNoise(rest)) meta(line, original, '声明');
    else {
      // A standalone play header governs following lines.
      const headerPlay = declaredPlay(rest);
      if (headerPlay) { flush(); sectionBets=[]; if (m.markets.length) { state.markets = m.markets; state.marketSource = line; } state.play = {...headerPlay,declaration:true}; state.playSource={line,body:header?header.body:original}; meta(line, original, '玩法'); }
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
            if (playTokens(cleaned).length || /特码|特肖|平特|任中|不中|中特|中[一二三四五\d]|连肖|连尾|[二三四]尾/.test(cleaned)) flush();
            else { const previous = pending; pending = null; pending = process(previous.text + '\n' + cleaned, previous.line, line, previous.endLine === line ? previous.raw : previous.raw + '\n' + original); continue; }
          }
          pending = process(cleaned, line, line, original);
        }
      }
    }
    if (suffix) {
      flush();
      reviewTrailingMarket(lastEntry.filter(b => b.endLine === line), suffix.markets, line, suffix.quote);
      state.markets = suffix.markets; state.marketSource = line;
      meta(line, suffix.quote, '尾部市场');
    }
    if (declared) {
      meta(line, declared[0], '金额声明');
      const expected = Math.round(chineseNumber(declared[1]) * 100);
      const amount = scope => scope.reduce((n,b)=>n+(b.status==='parsed'?b.totalCents:0),0);
      const marketTotal = new RegExp(`^总\\s*[:：=]?\\s*(?:\\d|[${CN}])`).test(declared[0]);
      const scopes = closing ? [bets.filter(b=>b.line>=closing.firstLine&&b.endLine<=closing.line)] : marketTotal ? [marketBets] : /合计|总/.test(declared[0]) ? [messageBets] : [sectionBets,sinceCheck];
      const adjacent=!closing&&!marketTotal&&!/合计|总/.test(declared[0])?adjacentSubtotal(sinceCheck,line,issues,pending,contexts,metadata):[];
      const localMatch=adjacent.length>0&&amount(adjacent)===expected;
      const scope = localMatch ? adjacent : scopes.find(s=>s.length&&amount(s)===expected) || scopes.find(s=>s.length) || [];
      const actual = amount(scope);
      Object.assign(metadata.at(-1),{fromLine:scope[0]?.line,toLine:scope.at(-1)?.endLine,expectedCents:expected,actualCents:actual,...(localMatch?{subtotalRule:'R22',scopeKind:'adjacent-entry'}:{}),...(closing?{closingMarket:[...closing.markets]}:{})});
      if (!Number.isSafeInteger(expected) || expected < 0) addIssue(line, line, original, 'TOTAL_INVALID', '声明的合计金额无效或超出精确计算范围');
      else if (!scope.length) addIssue(line, line, original, 'TOTAL_SCOPE', '识别到合计金额，但没有可核对的投注范围', 'warning');
      else if (actual !== expected) addIssue(line, line, original, 'TOTAL_MISMATCH', `原文合计${expected / 100}，第${scope[0].line}–${scope.at(-1).endLine}行已解析${actual / 100}，相差${(actual - expected) / 100}`, 'warning');
      sinceCheck = []; sectionBets = [];
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
  // Inspect untouched business text, including text ignored by cleanup. A
  // deliberate, versioned human decision may resolve a known conflict.
  for(const context of contexts) {
    const local=bets.filter(b=>b.line<=context.line&&b.endLine>=context.line);
    const accepted=assistance?.items.some(i=>i.line===context.line&&i.status==='accepted');
    if(local.length&&!accepted)for(const conflict of structuralConflicts(context.body,local)) {
      local.forEach(b=>{b.status='review';mark(b.line,b.endLine,'review');});
      addIssue(context.line,context.line,lines[context.line-1],conflict.code,conflict.message);
    }
    for(const bet of local) {
      const tokens=statementEvidence(context.body).map(e=>({...e,line:context.line,source:'original-body'}));
      bet.semantic.fields=[...(bet.semantic.fields||[]),...tokens];
      if(bet.semantic.inherited&&context.playSource)bet.semantic.declaration=context.playSource;
    }
  }
  const ruleIssues=[...issues];
  if(assistance)for(const item of assistance.items){
    const local=bets.filter(b=>b.line<=item.line&&b.endLine>=item.line);
    if(resolvedTotalDeclaration({bets,issues:ruleIssues,metadata},item.line))continue;
    const lineIssues=ruleIssues.filter(i=>i.line<=item.line&&i.endLine>=item.line);
    const reviewReasons=semanticReviewReasons({bets:local,issues:lineIssues});
    if((item.status==='review'||['pending','failed'].includes(item.status)&&item.required!==false&&reviewReasons.length>0)&&lines[item.line-1]===item.source){
      const affected=local.filter(b=>!lineIssues.length||lineIssues.some(i=>!i.affectedBetIds||i.affectedBetIds.includes(b.id)));
      affected.forEach(b=>{b.status='review';mark(b.line,b.endLine,'review');});
      addIssue(item.line,item.line,item.source,'AI_REVIEW',item.status==='pending'?'投注含义正在核验':item.status==='failed'?'AI核验未完成，以下疑点仍需核对':'AI解释尚待确认', 'error', {
        reviewReasons, aiStatus:item.status, aiReason:item.reason||'', affectedBetIds:affected.map(b=>b.id),
        localExplanation:local.map(b=>`${b.markets.join('／')}市场 · ${b.play} · ${b.count}${b.basis==='每组'?'组':'份'} × ${formatMoney(b.unitCents)}元／${b.basis.replace('每','')} · 合计${formatMoney(b.totalCents)}元`).join('；'),
      });
    }
  }
  return { id: fileId, name: fileName, parserVersion:PARSER_VERSION, defaultPlayer:options.defaultPlayer||'', rule, bets, issues, metadata, coverage, contexts, assistance:assistance||undefined, nonemptyLines: coverage.filter(l => l.raw.trim()).length };
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
