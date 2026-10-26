import { senderHeader, playTokens, leadingIssuePrefix, explicitIssueTokens } from './business-syntax.js';
import {dottedAmounts,zodiacNumberAmounts,packageAmounts,perZodiacPackages} from './text-format.js';
import { CATEGORY_ALIASES } from './classifications.js';

const count = '(?:[一二三四五六七八九十两俩]+|[0-9０-９]+)';
const number = '(?:[0-9０-９]+(?:[.．][0-9０-９]{1,2})?[十百千万拾佰仟萬]?|[零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+)';
const plays = new RegExp(`${count}肖中特|${count}\\s*中[二三234２３４]|${count}\\s*连[肖码尾]|${count}不中|${count}\\s*粒(?:任中)?|平特(?:一肖|肖|尾|码|号码|任中)?|特码|特马|特肖|独肖|一肖|平码|平肖|平尾|连肖|连码|连尾|二中特|两中特|2中特|复式|复试|复实|任中|特串|拖|对打|对(?=\\s*[0-9鼠牛虎兔龙蛇马羊猴鸡狗猪（(])|串`, 'g');
const selections = new RegExp([...new Set(CATEGORY_ALIASES.map(item => item.alias))].sort((a, b) => b.length - a.length).join('|') + '|[红蓝绿兰](?:波)?[单双大小]?(?:波)?|合[单双]|[金木水火土](?:行)?|[鼠牛虎兔龙蛇马羊猴鸡狗猪]|[0-9０-９]+(?:[头尾])?|[大小单双]', 'g');
const explicitAmount = new RegExp(`(?:各(?:个?(?:号码?|数字|数)|肖|尾|组|注|连|买|写)?|每(?:个?(?:号码?|数字|数)|肖|尾|组|注|个)|个(?:号码?|数字|数)|组|买|下|落|加|[=＝])\\s*[（(]?\\s*(${number})`, 'g');
const unitAmount = new RegExp(`(${number})\\s*[元米块斤钱]`, 'g');
const trailingAmount = new RegExp(`(${number})\\s*[元米块斤钱）)]*\\s*[。.,，#＃;；]*\\s*$`);

// Decoration only: return exact source slices, never HTML or normalized input.
export function highlightText(text, defaultPlayer='', selectionLines=[]) {
  const numberOnly=new Set(selectionLines);let line=1;
  const output = [];
  for (const part of text.split(/(\r\n|\n|\r)/)) {
    if (/^[\r\n]+$/.test(part)) { output.push({ text: part, kind: '' }); line++;continue; }
    const styles = new Array(part.length).fill('');
    const header = senderHeader(part,defaultPlayer), start = header ? part.search(/[:：]/) + 1 : 0;
    const body = part.slice(start);
    selections.lastIndex = 0;
    const mark = (from, length, kind, overwrite = false) => { for (let i = from; i < from + length; i++) if (overwrite || !styles[i]) styles[i] = kind; };
    for (const token of playTokens(body)) mark(start + token.start, token.end-token.start, 'play');
    for (const m of body.matchAll(plays)) mark(start + m.index, m[0].length, 'play');
    for (const m of body.matchAll(selections)) mark(start + m.index, m[0].length, 'selection');
    for (const regex of [explicitAmount, unitAmount]) for (const m of body.matchAll(regex)) mark(start + m.index + m[0].lastIndexOf(m[1]), m[1].length, 'amount', true);
    for(const m of [...dottedAmounts(body),...zodiacNumberAmounts(body),...packageAmounts(body).filter(m=>m.reversed)])mark(start+m.amountStart,m.amount.length,'amount',true);
    for(const m of perZodiacPackages(body)){
      mark(start+m.amountStart,m.amount.length,'amount',true);
      mark(start+m.suffixStart,m.end-m.suffixStart,'play',true);
    }
    const last = body.match(trailingAmount);
    if (last&&!numberOnly.has(line)) {
      const prefix = body.slice(0, last.index);
      // A bare number or unfinished play count is not an amount. The trailing
      // shorthand requires earlier selections, as in 牛100 or 01 02 100.
      selections.lastIndex = 0;
      if (selections.test(prefix) && !styles.slice(start + last.index, start + last.index + last[1].length).includes('play')) mark(start + last.index, last[1].length, 'amount', true);
    }
    // A trailing 一肖 can touch a Chinese price (三千一肖). Its 一 belongs
    // to the play, even when the decoration's broad amount regex consumes it.
    for(const token of playTokens(body))if(['一肖','1肖','独肖'].includes(token.phrase))mark(start+token.start,token.end-token.start,'play',true);
    const issue=leadingIssuePrefix(body);
    if(issue)mark(start+issue.start,issue.end-issue.start,'',true);
    for(const token of explicitIssueTokens(body))mark(start+token.start,token.end-token.start,'',true);
    let from = 0;
    for (let i = 1; i <= part.length; i++) if (i === part.length || styles[i] !== styles[from]) {
      output.push({ text: part.slice(from, i), kind: styles[from] }); from = i;
    }
  }
  return output;
}
