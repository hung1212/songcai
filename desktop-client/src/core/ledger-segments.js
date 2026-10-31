import {MARKETS,pad} from './rules.js';
import {settleBet} from './settlement.js';
import {effectivePlayerOdds} from './player-odds.js';
import {ledgerOwner,ledgerOwnerSettings} from './ledger-owner.js';
import {wonStake} from './winning-display.js';

const sum=values=>{const n=values.reduce((s,v)=>s+BigInt(v||0),0n);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('分段金额超出精确范围');return Number(n);};
// A newline ends a line; a whitespace-only line separates paragraphs. Preserve
// source line numbers, including leading/trailing blanks and Windows newlines.
export function sourceSegments(text='') {
 const lines=String(text).split(/\r\n|\n|\r/),rows=[];let start=null;
 const flush=end=>{if(start===null)return;rows.push({index:rows.length+1,line:start+1,endLine:end,raw:lines.slice(start,end).join('\n')});start=null;};
 lines.forEach((line,i)=>{if(/^[\s\u200b\ufeff]*$/u.test(line))flush(i);else if(start===null)start=i;});flush(lines.length);
 return rows;
}
// Assign whole parsed bets once, by their original starting line. Never parse
// paragraphs independently: that could change market/price inheritance or AI
// decisions, and would produce a different ledger rather than a reconciliation.
export function ledgerSegments(document,parsed,result,{fresh=true,history=false}={}) {
 const rows=sourceSegments(document.text).map(r=>({...r,fileId:document.id,bets:[],entries:[],issues:[],crossBoundary:[]}));
 const output={rows,count:rows.length,ready:false,settlementReady:false,stakeCents:null,payoutCents:null,error:''};
 if(!fresh||!parsed||parsed.id!==document.id)return {...output,error:'原文正在更新解析，金额暂不显示'};
 const byLine=new Map();for(const row of rows)for(let i=row.line;i<=row.endLine;i++)byLine.set(i,row);
 for(const bet of parsed.bets||[]) {
  const row=byLine.get(bet.line);if(!row)return {...output,error:'投注行号与原文不一致，请等待重新解析'};
  row.bets.push(bet);if((bet.endLine||bet.line)>row.endLine)row.crossBoundary.push(bet);
 }
 for(const issue of parsed.issues||[]) {const row=byLine.get(issue.line)||rows.find(r=>r.line>issue.line)||rows.at(-1);row?.issues.push(issue);}
 const bets=new Map((parsed.bets||[]).map(b=>[b.id,b]));
 let settlementReady=!!result&&!history;
 if(settlementReady){
  const expected=new Set((parsed.bets||[]).flatMap(b=>b.markets.map(m=>`${b.id}:${m}`))),seen=new Set();
  for(const e of result.entries||[]){const b=bets.get(e.betId),key=`${e.betId}:${e.market}`;if(!b||e.fileId!==document.id||e.line!==b.line||e.raw!==b.raw||e.stakeCents!==b.perMarketCents||!expected.has(key)||seen.has(key)){settlementReady=false;break;}seen.add(key);}
  if(seen.size!==expected.size)settlementReady=false;
 }
 if(settlementReady)for(const e of result.entries)byLine.get(bets.get(e.betId).line).entries.push(e);
 for(const row of rows){
  row.stakeCents=sum(row.bets.filter(b=>b.status==='parsed').map(b=>b.totalCents));row.markets=MARKETS.filter(m=>row.bets.some(b=>b.markets.includes(m)));
  row.marketAmounts=Object.fromEntries(MARKETS.map(m=>[m,sum(row.bets.filter(b=>b.status==='parsed'&&b.markets.includes(m)).map(b=>b.perMarketCents))]));
  row.wins=row.entries.filter(e=>e.status==='won');row.winCount=sum(row.wins.map(e=>e.winCount));
  row.winningStakeCents=settlementReady?sum(row.wins.map(e=>wonStake(e,bets.get(e.betId)))):null;
  row.payoutCents=settlementReady?sum(row.entries.map(e=>e.payoutCents)):null;
  row.refundCents=settlementReady?sum(row.entries.map(e=>e.refundCents)):null;
  row.pending=settlementReady?row.entries.filter(e=>e.status==='pending').length:sum(row.bets.map(b=>b.markets.length));
  row.issueCount=row.issues.filter(i=>i.severity!=='warning').length;
  row.complete=settlementReady&&!row.pending&&!row.issueCount;
 }
 const stakeCents=sum(rows.map(r=>r.stakeCents)),payoutCents=settlementReady?sum(rows.map(r=>r.payoutCents)):null;
 if(settlementReady&&(sum((parsed.bets||[]).map(b=>b.totalCents))!==result.stakeCents||payoutCents!==result.payoutCents))return {...output,error:'分段合计与本单数据不一致，请刷新中奖数据'};
 return {...output,ready:true,settlementReady,stakeCents,payoutCents,rows};
}
function* combinations(values,size,start=0,prefix=[]) {
 if(prefix.length===size){yield prefix;return;}
 for(let i=start;i<=values.length-(size-prefix.length);i++)yield* combinations(values,size,i+1,[...prefix,values[i]]);
}
// Reuse settlement rules to identify the winning selections, including player
// overrides and optional normal+special pairs. Totals remain the full ledger's
// recorded values; bounded detail enumeration never changes financial totals.
export function segmentWinningDetail(entry,bet,document,basis={},limit=60) {
 const draw=basis.draws?.[entry.market];
 if(!bet||!draw||entry.status!=='won')return {text:'中奖选号待核对',partial:true};
 const settings=ledgerOwnerSettings([document],{rebates:basis.rebates,playerOdds:basis.playerOdds}),owner=ledgerOwner(document);
 const odds=effectivePlayerOdds(basis.odds?.[entry.market],settings.playerOdds,owner.id,entry.market);
 const t=bet.playType,individual=['special-number','special-zodiac','flat-number','flat-zodiac','flat-tail'].includes(t);
 function* units(){
  if(individual){for(const v of bet.values)yield [v];}
  else if(['special-zodiac-any','wave','half-wave','attribute'].includes(t))yield bet.values;
  else for(const group of bet.groups||[bet.values])yield* combinations([...new Set(group)],bet.size);
 }
 const labels=[],valueLabel=v=>typeof v==='number'?/tail/.test(t)?`${v}尾`:pad(v):v;
 let scanned=0,found=0,partial=false;
 for(const values of units()){
  if(++scanned>3000||labels.length>=limit){partial=true;break;}
  const unit={...bet,assigned:true,values,groups:individual?undefined:[values],count:1,perMarketCents:bet.unitCents,totalCents:bet.unitCents*bet.markets.length};
  const settled=settleBet(unit,draw,odds,Date.now(),{drawDate:basis.drawDates?.[entry.market]});
  if(settled.status==='pending'){partial=true;continue;}
  if(settled.status==='won'){found+=settled.winCount;labels.push(values.map(valueLabel).join('·'));}
 }
 if(found!==entry.winCount)partial=true;
 return {text:labels.join('、')||'详见原文投注',partial};
}
export function segmentCopyText(row) {
 if(!Number.isSafeInteger(row.index)||row.index<1||!Number.isSafeInteger(row.stakeCents)||row.stakeCents<0)throw new Error('分段金额尚未就绪，请等待重新解析');
 const cents=BigInt(row.stakeCents),fraction=String(cents%100n).padStart(2,'0').replace(/0+$/,'');
 return `${row.index}:${cents/100n}${fraction?'.'+fraction:''}`;
}
