// Frozen v0.4.4 implementation for local upgrade comparisons only.
export const SEMANTIC_VERSION = 'semantic-20261005-1';
export const STANDARD_RULES = [
  { id: 'R01', text: '生肖集合后跟数、号码、数字并逐号投注，展开为特码，每号计费。' },
  { id: 'R02', text: '每号、各号、各数等是逐号计费依据，必须与玩法相容。' },
  { id: 'R03', text: '明确且相容的玩法和计费单位优先；每肖、每组、整项分别计算。' },
  { id: 'R04', text: '明确玩法和逐号依据冲突时待确认，不静默改写。' },
  { id: 'R05', text: '新声明的逐号特码终止旧玩法继承，市场继承独立处理。' },
  { id: 'R06', text: '无新声明时按同一玩家上下文继承，默认新市场；换玩家重置。' },
  { id: 'R07', text: '缺金额、缺选号或撤改指令不能补造数字，须确认。' },
];
const financial = Object.fromEntries([...'壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬億圓圆'].map((c,i)=>[c,[...'一二二三三四五六六七八九十百千万亿元元'][i]]));
export function normalizeFinancial(text) { return String(text).replace(/[壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬億圓圆]/g,c=>financial[c]); }
export function numberBasisEvidence(text) {
  const zodiac = text.match(/[鼠牛虎兔龙蛇马羊猴鸡狗猪](?:[\s、,，]*[鼠牛虎兔龙蛇马羊猴鸡狗猪])*\s*(?:号码|数字|数)(?=\s*(?:各|每|[0-9零〇一二三四五六七八九十百千万两俩]))/);
  const unit = text.match(/(?:各|每)(?:个?(?:号码?|数字|数))/);
  const match = zodiac || unit;
  return match ? { ruleId: zodiac ? 'R01' : 'R02', field:'basis', quote:match[0], start:match.index, end:match.index+match[0].length } : null;
}
export function assistanceMatches(assistance, text, date, player='') {
  return !!assistance && assistance.version === SEMANTIC_VERSION && assistance.sourceText === text && assistance.businessDate === date && assistance.defaultPlayer === (player||'');
}
// Confirmations are versioned alongside the untouched original text. A changed
// date, player or byte of original text invalidates all previous decisions.
export function validateAssistance(value) {
  if (value == null) return undefined;
  if(typeof value!=='object'||typeof value.sourceText!=='string'||value.sourceText.length>5_000_000||typeof value.businessDate!=='string'||typeof value.defaultPlayer!=='string'||!Array.isArray(value.items)||value.items.length>5000)throw new Error('核验记录格式无效');
  const seen=new Set(),items=value.items.map(item=>{
    if(!Number.isInteger(item.line)||item.line<1||seen.has(item.line)||!['pending','agree','review','accepted','original','failed'].includes(item.status))throw new Error('核验行或状态无效');
    seen.add(item.line);
    if(typeof item.source!=='string'||typeof item.replacement!=='string'||item.replacement.length>10000||/[\r\n]/.test(item.replacement))throw new Error('核验解释无效');
    return JSON.parse(JSON.stringify(item));
  });
  const result={sourceText:value.sourceText,businessDate:value.businessDate,defaultPlayer:value.defaultPlayer,items,runId:String(value.runId||''),version:String(value.version||'')};
  if(JSON.stringify(result).length>8_000_000)throw new Error('核验记录过大');
  return result;
}
