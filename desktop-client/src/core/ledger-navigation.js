export const NAVIGATION_KEY='songcai-ledger-navigation-v1';
const normalized=value=>value.normalize('NFKC').toLocaleLowerCase();
function uniqueStrings(value,limit,normalize=x=>x){
  const seen=new Set();
  return (Array.isArray(value)?value:[]).filter(v=>{
    if(typeof v!=='string'||!v.trim()||v.length>200)return false;
    const key=normalize(v.trim());if(seen.has(key))return false;seen.add(key);return true;
  }).map(v=>v.trim()).slice(0,limit);
}
export function navigationHistory(value){return {recent:uniqueStrings(value?.recent,5),searches:uniqueStrings(value?.searches,10,normalized)};}
export function visitLedger(history,id,documents){
  const valid=new Set(documents.map(d=>d.id));
  return navigationHistory({...history,recent:[id,...history.recent].filter(id=>valid.has(id))});
}
export function rememberSearch(history,term){return navigationHistory({...history,searches:[term,...history.searches]});}
// Selection end is exclusive: selecting through the next line's first character
// must not accidentally include that line. Visual wrapping does not add lines.
export function sourceSelection(text,start=0,end=start){
  start=Math.min(text.length,Math.max(0,start));end=Math.min(text.length,Math.max(start,end));
  return {line:text.slice(0,start).split('\n').length,endLine:text.slice(0,end>start?end-1:end).split('\n').length};
}
export function sourceOffsets(text,line,endLine=line){
  const lines=text.split('\n');
  line=Math.min(lines.length,Math.max(1,line));endLine=Math.min(lines.length,Math.max(line,endLine||line));
  const start=lines.slice(0,line-1).reduce((n,l)=>n+l.length+1,0);
  return {line,endLine,start,end:start+lines.slice(line-1,endLine).join('\n').length};
}
export function sourceResults(parsed,line,endLine=line){
  const intersects=row=>row.line<=endLine&&(row.endLine||row.line)>=line;
  return {bets:(parsed?.bets||[]).filter(b=>b.status==='parsed'&&intersects(b)),issues:(parsed?.issues||[]).filter(intersects)};
}
