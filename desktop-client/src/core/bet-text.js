import { ANIMALS, CN } from './rules.js';
import { COURTESY_PATTERN, canonicalPlayText } from './business-syntax.js';
import { CATEGORY_ALIASES } from './classifications.js';

const words = [
  '新凹',
  ...CATEGORY_ALIASES.map(c => c.alias), '三边','两边','二边','新旧','新老','旧新','老新','香港','澳门新旧','澳门新','澳门旧','新澳门','老澳门','旧澳门','澳门','奥门','澳彩','奥彩','噢门',
  '串','对打','对','打','和','全中','平特号码','平特任中','单笔生肖','双笔生肖','连肖','肖连','连码','连尾','肖中特','中特','不中','任中','特码','特马','特肖','独肖','一肖','平码','平肖','平尾','平特','特串','单码','单调','复式','复试','复实',
  '每个号码','每个数字','每个数','各个号码','各号码','各数字','各个数','每号','各号','各肖','每肖','各尾','每尾','各组','每组','各注','每注','各连','各买','各写','号码','数字','一个','一组','总合计','合计','总共','共计','一共','等于','六合彩',
  '波色','半波','红波','蓝波','绿波','合单','合双','单数','双数','单的','双的','大的数','小的数','大的','小的','生肖','复','死','活','中','粒','连','肖','友','有',
  ...ANIMALS, ...CN, ...'新老旧港香澳奥门特彩菜金木水火土红蓝绿兰单双大小头尾子各每个买下落加元米块斤钱号数码组注总共合计第期包拖的行', '免','猎','鸣','奧',
].sort((a,b) => b.length-a.length);
const word = new RegExp(`^(?:${[...new Set(words)].join('|')})`);
const recoverStart = /^(?:新|旧|老|港|香|澳|三边|两边|二边|特|平|独肖|复式|复试|复实|[一二三四五六七八九十两]+(?:中|连|肖|尾|粒)|各|每|买|下|落|加|合计|总|共|红波|蓝波|绿波)/;
const sensitive = /特|肖|码|连|中|平|复|包|拖|串|对打|头|尾|取消|作废|撤回|撤单|改成|改为|不要|不买|不算|减|翻倍|加倍|一半|半价|倍|赔率|分别|或者|还是/;
const courtesy = COURTESY_PATTERN;
function known(text) {
  let rest=text;
  while(rest) { const m=rest.match(word); if(!m)return false; rest=rest.slice(m[0].length); }
  return true;
}

// Discard prose as whole words, rather than extracting e.g. 小 from 小明 or
// 免 from 免费. Keep financial instructions and partially recognized play names
// visible to the parser; they may change the intended wager.
export function cleanBetText(input) {
  const ignored=[];
  const drop=text=>{ignored.push(text);return ' ';};
  const text=canonicalPlayText(input.normalize('NFKC')).replace(/[Oo\d]+/g,s=>/\d/.test(s)?s.replace(/[Oo]/g,'0'):s).replace(courtesy,drop).replace(/[\p{Script=Han}A-Za-z]+/gu,(run,offset,whole)=>{
    // A range word between drag numbers is meaningful, not disposable prose.
    if (/^[至到]$/.test(run)&&/拖/.test(whole)&&/\d\s*$/.test(whole.slice(0,offset))&&/^\s*\d/.test(whole.slice(offset+run.length))) return run;
    if(/^[Tt]$/.test(run)&&/^\s*[:：]/.test(whole.slice(offset+run.length)))return run;
    if(known(run)||/^[Oo]+$/.test(run))return run;
    for(let i=1;i<run.length;i++) {
      const suffix=run.slice(i),prefix=run.slice(0,i);
      if(recoverStart.test(suffix)&&known(suffix)&&!sensitive.test(prefix))return drop(prefix)+suffix;
    }
    if(sensitive.test(run))return run;
    return drop(run);
  }).replace(/[\p{Extended_Pictographic}\uFE0F]+/gu,token=>token==='🟰'?token:drop(token));
  return {text,ignored};
}
