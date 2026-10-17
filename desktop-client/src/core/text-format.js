import {ANIMALS,CN} from './rules.js';

const amount=`(?:[0-9０-９]+(?:[.．][0-9０-９]{1,2})?|[${CN}壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬]+)`;
const marker='(?:各(?:个?(?:号码?|数字|数)|肖|尾|组|注|连|买|写)?|每(?:个?(?:号码?|数字|数)|肖|尾|组|注|个)|总合计|合计|总共|共计|一共|共)';
const currency='[元米块斤钱圆圓]';
// Explicit 特包 plus a per-zodiac total is distinct from the ordinary
// post-price 一肖 abbreviation for special-zodiac bets.
export function perZodiacPackages(text){
  const pattern=new RegExp(`(?:特码|特马|特)[ \\t]*包[ \\t]*([${ANIMALS.join('')}](?:[ \\t、,，]*[${ANIMALS.join('')}])*)[ \\t]*各[ \\t]*(${amount})[ \\t]*(?:${currency})?[ \\t]*((?:一|1|１)[ \\t]*肖)(?=[\\s,，;；。]|$)`,'g');
  return [...text.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length,text:m[0],animals:[...m[1]].filter(c=>ANIMALS.includes(c)),amount:m[2],
    amountStart:m.index+m[0].indexOf(m[2],m[0].indexOf('各')+1),suffixStart:m.index+m[0].lastIndexOf(m[3])}));
}
// A zodiac followed by 数/号码/数字 and a price is a per-number amount,
// even without 各. Share its exact source spans across parsing and decoration.
export function zodiacNumberAmounts(text){
  const pattern=new RegExp(`([${ANIMALS.join('')}][ \\t]*)(?:号码|数字|数)[ \\t]*[:：]?[ \\t]*(${amount})[ \\t]*(?:${currency})?`,'g');
  return [...text.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length,text:m[0],amount:m[2],amountStart:m.index+m[0].indexOf(m[2],m[1].length)}));
}
// Match forward packages first, so 包蛇60元包羊40元 keeps both totals
// with their own zodiac. Reverse packages are a complete amount + play atom.
export function packageAmounts(text){
  const zodiac=`(?:单数|双数|[${ANIMALS.join('')}])`, gap='[ \\t]*',frontAmount=amount.replace('{1,2}','+');
  const pattern=new RegExp(`包${gap}(${zodiac})${gap}[:：]?${gap}(${amount})${gap}(?:${currency})?|(?<![-0-9０-９.．${CN}壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬－])(-?${frontAmount})${gap}(?:${currency})?${gap}[:：]?${gap}包${gap}(${zodiac})`,'g');
  return [...text.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length,text:m[0],amount:m[2]||m[3],amountStart:m.index+(m[2]?m[0].indexOf(m[2],m[0].indexOf(m[1])+m[1].length):0),reversed:!!m[3]}));
}
export function dottedAmounts(text){
  const pattern=new RegExp(`(${marker})[ \\t]*[.．·][ \\t]*(${amount})[ \\t]*[.．·][ \\t]*(${currency})`,'g');
  return [...text.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length,marker:m[1],amount:m[2],unit:m[3],amountStart:m.index+m[0].indexOf(m[2],m[1].length)}));
}
export function normalizeDottedAmounts(text){
  let result=text;
  for(const m of dottedAmounts(text).reverse())result=result.slice(0,m.start)+m.marker+m.amount+m.unit+result.slice(m.end);
  return result;
}
const endings=()=>new RegExp(`(?:${marker}[ \\t]*[.．·]?[ \\t]*${amount}[ \\t]*[.．·]?[ \\t]*(?:${currency})?|${amount}[ \\t]*[.．·]?[ \\t]*${currency})`,'g');
const amountEndings=text=>{const packages=packageAmounts(text),perZodiac=perZodiacPackages(text);return [
  ...[...text.matchAll(endings())].map(m=>({end:m.index+m[0].length,text:m[0]})),
  ...zodiacNumberAmounts(text),...packages,...perZodiac,
].filter(m=>!packages.some(p=>p.reversed&&m.end>p.start&&m.end<p.end)&&!perZodiac.some(p=>m.end>p.start&&m.end<p.end));};
const startsBet=new RegExp(`^(?:[0-9０-９${ANIMALS.join('')}]|新|旧|老|港|香港|澳|奥|特|平|包|独肖|[二三四五六七八九十两俩一]|红|蓝|绿|合|总|共|每|各|金|木|水|火|土|天肖|地肖|男肖|女肖|阴肖|阳肖|吉肖|凶肖)`);

// Add only line breaks. Never rewrite punctuation, numbers, names or declarations.
export function formatBetLines(input){
  return String(input).replace(/\r\n|\r/g,'\n').split('\n').map(line=>{
    const points=[];
    for(const m of amountEndings(line)){
      const end=m.end,tail=line.slice(end);
      // Only commas/semicolons after a complete price, never between selections.
      const separator=tail.match(/^[ \t]*[,，;；][ \t]*/);
      if(!separator)continue;
      const next=tail.slice(separator[0].length);
      if(!startsBet.test(next)||!amountEndings(next).length)continue;
      // A subtotal and its trailing market are kept together.
      if(/^(?:总合计|合计|总共|共计|一共|共)/.test(m.text))continue;
      points.push(end+separator[0].length);
    }
    let result=line;
    for(const pos of [...new Set(points)].reverse())result=result.slice(0,pos)+'\n'+result.slice(pos);
    return result;
  }).join('\n');
}
export function prepareBetPaste(value,start,end,clipboard){
  const text=formatBetLines(clipboard),atEnd=end===value.length;
  // Replacing a selected amount/number is an ordinary edit; it must not split a bet.
  const whole=text.includes('\n')||amountEndings(text).length>0;
  const boundary=start===0||value[start-1]==='\n'||start===end&&atEnd;
  const append=whole&&atEnd&&boundary;
  // Separate pasted messages so a closing market cannot reach an earlier paste.
  const prefix=append&&start===end&&start>0&&!value.endsWith('\n\n')?(value.endsWith('\n')?'\n':'\n\n'):'';
  const suffix=append&&!text.endsWith('\n')?'\n':'';
  return prefix+text+suffix;
}
