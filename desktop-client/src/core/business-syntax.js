import { ANIMALS, CN, MARKETS } from './rules.js';
import {dottedAmounts,zodiacNumberAmounts,packageAmounts,perZodiacPackages} from './text-format.js';
import { CATEGORY_ALIASES } from './classifications.js';

export const PARSER_VERSION = 'parser-20261020-1';
export const COUNT_PATTERN = '(?:十[一二]?|[一二三四五六七八九两俩]|1[0-2]|[1-9])';
const aliases = [];
const add = (phrase, types, size, basis, canonical) => aliases.push({ phrase, types, size, basis, ...(canonical ? {canonical} : {}) });
export const PACKAGE_NUMBER_PLAYS = ['包单数', '包双数', ...ANIMALS.map(animal=>'包'+animal)];
for (const phrase of PACKAGE_NUMBER_PLAYS) add(phrase, ['special-number'], 1, '每号');
add('包大数', ['special-number'], 1, '每号');
add('特包', ['special-number'], 1, '每号');
for (let n = 1; n <= 12; n++) {
  const names = [String(n), n < 10 ? '一二三四五六七八九'[n - 1] : n === 10 ? '十' : n === 11 ? '十一' : '十二', ...(n === 2 ? ['两', '俩'] : [])];
  for (const name of names) {
    add(`${name}肖中特`, ['special-zodiac-any'], n, '整项');
    if (n > 1) {
      // Compact compound-play titles must retain the current player, even
      // before a colon. Canonicalize before the parser consumes the play.
      for (const end of ['肖', '连肖']) add(`复${name}${end}`, ['linked-zodiac'], n, '每组', `${name}连肖`);
      for (const prefix of ['', '平特']) for (const end of ['肖全中', '连肖全中']) add(prefix+name+end,['linked-zodiac'],n,'每组');
      for (const end of ['连肖', '肖连']) { add(name + end, ['linked-zodiac'], n, '每组'); add('平特' + name + end, ['linked-zodiac'], n, '每组'); }
      add(`${name}连码`, [`linked-number-${n}-${n}`], n, '每组');
    }
    if (n >= 2 && n <= 4) { add(`${name}连尾`, ['linked-tail'], n, '每组'); add(`平特${name}连尾`, ['linked-tail'], n, '每组'); }
    // Recognize unsupported counts as business text too; the parser reports
    // the size limit instead of treating the title before a colon as a player.
    add(`${name}粒任中`, ['flat-any'], n, '每组'); add(`平特${name}粒任中`, ['flat-any'], n, '每组');
    // A Chinese suffix is the play size, not a sender or a selected number.
    // Bare Arabic numbers after 任中 retain the existing number-list meaning.
    for (const prefix of ['', '平特']) {
      add(`${prefix}任中${name}粒`, ['flat-any'], n, '每组', `${name}粒任中`);
      if (!/\d/.test(name)) add(`${prefix}任中${name}`, ['flat-any'], n, '每组', `${name}粒任中`);
    }
    if (n <= 10) add(`${name}不中`, ['not-hit'], n, '每组');
    for (let hits = 1; hits <= 5; hits++) {
      for (const h of [String(hits), '一二三四五'[hits - 1]]) add(`${name}中${h}`, [`linked-number-${n}-${hits}`], n, '每组');
    }
  }
}
for (const phrase of ['特码', '特马', '单码', '单调']) add(phrase, ['special-number'], 1, '每号');
for (const phrase of ['特肖', '独肖', '一肖', '1肖']) add(phrase, ['special-zodiac'], 1, '每肖');
for (const phrase of ['平特肖', '平特一肖', '平一肖', '平肖']) add(phrase, ['flat-zodiac'], 1, '每肖');
for (const phrase of ['平码', '平特号码', '平特码']) add(phrase, ['flat-number'], 1, '每号');
for (const phrase of ['平特尾', '平尾']) add(phrase, ['flat-tail'], 1, '每尾');
add('平特', ['flat-zodiac', 'flat-number', 'flat-tail'], 1);
add('平特任中', ['flat-any']); add('任中', ['flat-any']);
add('特串', ['special-pair'], 2, '每组');
add('特碰', ['special-pair'], 2, '每组', '特串');
for (const phrase of ['二中特', '两中特', '2中特']) add(phrase, ['linked-number-2-special'], 2, '每组');
for (const [phrase, size] of [['二尾',2], ['两尾',2], ['三尾',3], ['四尾',4]]) add(phrase, ['linked-tail'], size, '每组');

// One lexicon supplies the parser's canonical phrases, header classification,
// highlighting and the independent original-text checks. Digits are never
// joined across spaces; only whitespace inside an already known word is allowed.
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrasePattern = phrase => [...phrase].map((c, i, chars) => escape(c) + (i < chars.length - 1 && !(/\d/.test(c) && /\d/.test(chars[i + 1])) ? '[ \\t]*' : '')).join('');
const definitions = new Map(aliases.map(a => [a.phrase, a]));
const playPattern = [...definitions.keys()].sort((a,b) => b.length-a.length).map(phrasePattern).join('|');
const playRegex = () => new RegExp(playPattern, 'g');
export const PLAY_NAMES = ['特码','特肖','平码','平特号码','平特肖','平尾','特串','二中二','三中三','三中二','二中特', ...PACKAGE_NUMBER_PLAYS,
  ...['红','蓝','绿'].flatMap(c=>['波','单','双','大','小'].map(s=>c+s)), '大','小','单','双','合单','合双',
  ...Array.from({length:12},(_,i)=>`${i+1}肖中特`), ...Array.from({length:11},(_,i)=>`${i+2}连肖`),
  ...Array.from({length:3},(_,i)=>`${i+2}连尾`), ...Array.from({length:5},(_,i)=>`${i+1}粒任中`), ...Array.from({length:10},(_,i)=>`${i+1}不中`)];

export function sourceView(raw) {
  let text = ''; const offsets = [];
  for (let i = 0; i < raw.length;) {
    const c = String.fromCodePoint(raw.codePointAt(i)), normalized = c.normalize('NFKC');
    for (let k=0;k<normalized.length;k++) offsets.push({start:i,end:i+c.length});
    text += normalized; i += c.length;
  }
  return { text, span(start,end) { return { start:offsets[start]?.start ?? raw.length, end:offsets[end-1]?.end ?? raw.length }; } };
}
export function playTokens(raw) {
  const view = sourceView(raw);
  const packages=perZodiacPackages(view.text);
  const tokens = [...view.text.matchAll(playRegex())].map(m => {
    const phrase=m[0].replace(/[ \t]/g,''), span=view.span(m.index,m.index+m[0].length);
    const perZodiac=packages.some(p=>m.index>=p.start&&m.index+m[0].length<=p.end)&&['一肖','1肖'].includes(phrase);
    return {...definitions.get(phrase),...(perZodiac?{types:['special-number'],basis:'每号'}:{}),...span,quote:raw.slice(span.start,span.end),field:'play'};
  });
  // T: is a special-number label, not a new sender. Keep the boundary so
  // letters inside real names (Tom, Matt, etc.) never become play evidence.
  for(const m of view.text.matchAll(/(?<![\p{Script=Han}A-Za-z0-9])[Tt](?=\s*[:：])/gu)) {
    const span=view.span(m.index,m.index+1);
    tokens.push({...definitions.get('特码'),...span,quote:raw.slice(span.start,span.end),field:'play'});
  }
  return tokens.sort((a,b)=>a.start-b.start);
}
export function canonicalPlayText(raw) {
  const tokens=playTokens(raw); let value=raw;
  for(const t of tokens.reverse()) value=value.slice(0,t.start)+(t.canonical||t.phrase)+value.slice(t.end);
  return value;
}

// Consume qualified names before the bare 澳／奥 aliases, so 旧澳 and
// 澳门旧 remain one old-market declaration rather than adding a new market.
export const MARKET_PATTERN_SOURCE = /三边|3边|两边|二边|2边|(?:澳|奥)(?:门)?[ \t]*(?:新旧|新老|旧新|老新|旧|老|新)|(?:新旧|新老|旧新|老新)(?:[ \t]*(?:澳门|奥门|澳|奥))?|香港|新(?:[ \t]*(?:澳门|奥门|噢门|澳奥|澳|奥|门|凹))?|(?:老|旧)(?:[ \t]*(?:澳门|奥门|澳奥|澳|奥|门))?|港|香|澳门|奥门|澳|奥|门/.source;
const marketPattern = new RegExp(MARKET_PATTERN_SOURCE, 'g');
// Only an unlabelled three-digit prefix before a market is an issue remark.
// Do not discard 01–49, numbers inside selections, or arbitrary long numbers.
export function leadingIssuePrefix(raw) {
  const view=sourceView(raw);
  const match=view.text.match(new RegExp(`^[ \\t]*(\\d{3})(?=[ \\t]*(?:[,、:.][ \\t]*)?(?:${MARKET_PATTERN_SOURCE}))`));
  if(!match)return null;
  const start=match[0].length-match[1].length,span=view.span(start,start+match[1].length);
  return {...span,field:'issue',quote:raw.slice(span.start,span.end),ruleId:'R37'};
}
export function stripLeadingIssuePrefix(raw) {
  const token=leadingIssuePrefix(raw);
  return token?raw.slice(0,token.start)+' '+raw.slice(token.end):raw;
}
export const ISSUE_PATTERN_SOURCE = /(?:第[ \t]*)?\d+[ \t]*期/.source;
export function explicitIssueTokens(raw) {
  const view=sourceView(raw);
  return [...view.text.matchAll(new RegExp(ISSUE_PATTERN_SOURCE,'g'))].map(m=>{
    const span=view.span(m.index,m.index+m[0].length);
    return {...span,field:'issue',quote:raw.slice(span.start,span.end),ruleId:'R44'};
  });
}
export const COURTESY_PATTERN=/谢谢老板|谢谢|辛苦了|辛苦|麻烦你|麻烦|请帮我|帮我|收到|好的|好嘞|您好|你好|晚安|早上好|晚上好|祝好运/g;
const businessCharacters=new Set([...aliases.map(a=>a.phrase).join(''),...CATEGORY_ALIASES.map(c=>c.alias).join(''),...ANIMALS.join(''),...CN,...'三两二边新老旧港香港澳门澳奥噢凹红蓝绿金木水火土大小单双合头尾特彩菜复式拖每各个号数字肖组注元米块斤钱买下落加第期']);
export function marketInfo(input) {
  const found=new Set();
  const text=input.replace(marketPattern,token=>{
    token=token.replace(/[ \t]/g,'');
    if(/三边|3边/.test(token))MARKETS.forEach(m=>found.add(m));
    else if(/两边|二边|2边|新旧|新老|旧新|老新/.test(token)){found.add('新');found.add('旧');}
    else if(/旧|老/.test(token))found.add('旧');else if(/新|澳|奥|门/.test(token))found.add('新');else found.add('港');
    return ' ';
  }).replace(/澳门|奥门|澳彩|奥彩|澳|奥/g,' ');
  return {text,markets:MARKETS.filter(m=>found.has(m))};
}
export function marketTokens(raw) {
  const view=sourceView(raw);
  const courtesy=[...view.text.matchAll(COURTESY_PATTERN)];
  return [...view.text.matchAll(marketPattern)].filter(m=>{
    if(courtesy.some(c=>c.index<=m.index&&c.index+c[0].length>m.index))return false;
    const run=(view.text.slice(0,m.index).match(/[\p{Script=Han}A-Za-z]+$/u)?.[0]||'')+m[0]+(view.text.slice(m.index+m[0].length).match(/^[\p{Script=Han}A-Za-z]+/u)?.[0]||'');
    return [...run.replace(COURTESY_PATTERN,'').replace(/[ \t]/g,'')].every(c=>businessCharacters.has(c));
  }).map(m=>{const span=view.span(m.index,m.index+m[0].length);return {...span,quote:raw.slice(span.start,span.end),field:'market',markets:marketInfo(m[0]).markets};});
}

const selectionWords=[...new Set(CATEGORY_ALIASES.map(c=>c.alias))].sort((a,b)=>b.length-a.length).map(escape).join('|');
const selectionPrefix=new RegExp(`^(?:${selectionWords}|[红蓝绿](?:波)?[单双大小]?(?:波)?|合[单双]|[金木水火土](?:行)?|[大小单双]|[${ANIMALS.join('')}](?:肖)?|\\d+(?:头|尾)?)`);
const separators=/^[\s:：,，、。;；.()（）\[\]【】/+\-=]+/;
function businessPrefix(name) {
  let rest=canonicalPlayText(name.normalize('NFKC')).replace(/\\/g, '/'), meaningful=false;
  if(/^[Tt]$/.test(rest))return true;
  while(rest) {
    const sep=rest.match(separators);if(sep){rest=rest.slice(sep[0].length);continue;}
    const p=playTokens(rest).find(t=>t.start===0);
    const issue=rest.match(new RegExp('^'+ISSUE_PATTERN_SOURCE));
    const market=rest.match(new RegExp('^(?:'+marketPattern.source+'|澳门|奥门|澳|奥)'));
    const selection=rest.match(selectionPrefix);
    const other=rest.match(new RegExp(`^(?:拖|复式|复试|复实|每号|各号|每肖|各肖|每组|各组|各|每|数|号码|数字|特|彩|菜|[${CN}]+(?:连|肖|友|有)|[元米块斤钱])`));
    const token=p?.quote||market?.[0]||issue?.[0]||selection?.[0]||other?.[0];
    if(!token)return false;
    meaningful=true;rest=rest.slice(token.length);
  }
  return meaningful;
}
export function senderHeader(raw, knownPlayer='') {
  const match=raw.match(/^\s*([^:：\n]{1,32})[:：]\s*(.*)$/u);
  if(!match)return null;
  const name=match[1].trim();
  if(knownPlayer&&name===knownPlayer.trim())return {name,body:match[2]};
  if(businessPrefix(name))return null;
  // Do not hide an incomplete/unknown numbered play behind a fictitious name.
  if(/[/+*=。;；]/.test(name)||/^[新旧老港澳奥\s]*[一二三四五六七八九十两\d０-９]+(?:肖|连|中|粒|尾)/.test(name))return null;
  return {name,body:match[2]};
}

export function statementEvidence(raw) {
  const view=sourceView(raw), tokens=[...playTokens(raw),...marketTokens(raw),...explicitIssueTokens(raw)];
  const issue=leadingIssuePrefix(raw);if(issue)tokens.push(issue);
  const basis=/各(?:个?(?:号码?|数字|数)|肖|尾|组|注)?|每(?:个?(?:号码?|数字|数)|肖|尾|组|注|个)|整项/g;
  for(const m of view.text.matchAll(basis)){const span=view.span(m.index,m.index+m[0].length);tokens.push({...span,quote:raw.slice(span.start,span.end),field:'basis'});}
  const amount=/(?:各(?:号|肖|尾|组|注)?|每(?:号|肖|尾|组|注)?|组|买|下|落|加|=)\s*([\d零〇一二三四五六七八九十百千万两壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬]+(?:\.\d{1,2})?)|([\d零〇一二三四五六七八九十百千万两壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬]+(?:\.\d{1,2})?)\s*(?:[元米块斤钱圆圓]|(?=[\s。.,，#＃;；]*$))/g;
  for(const m of view.text.matchAll(amount)) {
    const quote=m[1]||m[2],start=m.index+m[0].indexOf(quote),span=view.span(start,start+quote.length);
    if(!tokens.some(t=>['play','issue'].includes(t.field)&&t.start<span.end&&span.start<t.end))tokens.push({...span,quote:raw.slice(span.start,span.end),field:'amount'});
  }
  for(const m of [...dottedAmounts(raw),...zodiacNumberAmounts(raw),...packageAmounts(raw).filter(m=>m.reversed)])tokens.push({start:m.amountStart,end:m.amountStart+m.amount.length,quote:m.amount,field:'amount'});
  const selection=new RegExp(`${selectionWords}|[${ANIMALS.join('')}]|[红蓝绿](?:波)?[单双大小]?(?:波)?|合[单双]|[金木水火土](?:行)?|\\d+(?:头|尾)?|[大小单双]`,'g');
  for(const m of view.text.matchAll(selection)){const span=view.span(m.index,m.index+m[0].length);if(!tokens.some(t=>t.start<span.end&&span.start<t.end))tokens.push({...span,quote:raw.slice(span.start,span.end),field:'selection'});}
  return tokens.sort((a,b)=>a.start-b.start);
}

// Match original explicit evidence to the result, independently of takePlay's
// defaults/cleanup. More than one clause on a line may legitimately differ.
export function structuralConflicts(raw, bets) {
  const problems=playTokens(raw).filter(t=>!bets.some(b=>t.types.includes(b.playType)&&(t.size==null||t.size===b.size)&&(t.basis==null||t.basis===b.basis)))
    .map(t=>({code:'EXPLICIT_PLAY_LOST',message:`原文“${t.quote}”与解析玩法或计费不一致，请核对`,evidence:t}));
  // A diagnosed trailing market is preserved as an unresolved alternative.
  // Do not expand its review scope to unrelated clauses on the same line.
  for(const t of marketTokens(raw))if(!t.markets.every(m=>bets.some(b=>b.markets.includes(m)||b.marketAmbiguity?.markets.includes(m))))problems.push({code:'EXPLICIT_MARKET_LOST',message:`原文“${t.quote}”声明的市场未被完整保留，请核对`,evidence:t});
  return problems;
}
