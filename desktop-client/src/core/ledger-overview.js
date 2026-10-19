import {summarize} from './parser.js';
import {settleDocuments} from './settlement.js';
import {MARKETS} from './rules.js';

const sum=(values)=>{const n=values.reduce((a,b)=>a+BigInt(b),0n);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('汇总金额超出精确计算范围');return Number(n);};

export function settlementBalance(result,verification={},odds={}) {
  if(!result)return {status:'pending',netCents:null,label:'待结算'};
  if(!result.entries.length&&!result.issues.length)return {status:'empty',netCents:0,label:'空账目'};
  if(!result.complete)return {status:'pending',netCents:null,label:'待结算'};
  const markets=[...new Set(result.entries.map(e=>e.market))];
  const verified=markets.every(m=>verification[m]?.confirmed&&odds[m]?.confirmed);
  const netCents=sum([result.payableCents??result.payoutCents,-result.stakeCents]);
  return {status:verified?'complete':'trial',netCents,label:netCents>0?'赢':netCents<0?'输':'持平'};
}

// Calculate each ledger with its own business date and original zodiac table.
// Only the selected draw date is shared; saved payout snapshots are never added.
export function ledgerOverview(documents,draws,settings,verification,drawDates) {
  const rows=documents.map(doc=>{
    const date=doc.rule?.date;
    if(!date)return {id:doc.id,name:doc.name,status:'pending',label:'待结算',netCents:null,stakeCents:0,payoutCents:0,refundCents:0,winCount:0,wins:[],issues:doc.issues||[],pending:1};
    const result=settleDocuments([doc],draws,settings.odds,date,{drawDates,rebates:settings.rebates,playerOdds:settings.playerOdds});
    const wins=result.entries.filter(e=>e.status==='won').map(e=>({...e,fileId:doc.id}));
    return {id:doc.id,name:doc.name,date,...settlementBalance(result,verification,settings.odds),
      stakeCents:summarize([doc]).totalCents,payoutCents:result.payoutCents,rebateCents:result.rebateCents,payableCents:result.payableCents,refundCents:result.refundCents,
      winCount:sum(wins.map(e=>e.winCount||0)),wins,issues:result.issues,pending:result.pending,result};
  });
  const incomplete=rows.some(r=>r.status==='pending'),trial=rows.some(r=>r.status==='trial');
  const stakeCents=sum(rows.map(r=>r.stakeCents)),payoutCents=sum(rows.map(r=>r.payoutCents)),rebateCents=sum(rows.map(r=>r.rebateCents||0)),payableCents=sum([payoutCents,rebateCents]);
  return {rows,byId:Object.fromEntries(rows.map(r=>[r.id,r])),wins:rows.flatMap(r=>r.wins),
    stakeCents,payoutCents,rebateCents,payableCents,refundCents:sum(rows.map(r=>r.refundCents)),netCents:incomplete?null:sum([payableCents,-stakeCents]),
    status:incomplete?'pending':trial?'trial':'complete',winCount:sum(rows.map(r=>r.winCount)),
    winningLedgers:rows.filter(r=>r.wins.length).length,pendingLedgers:rows.filter(r=>r.status==='pending').length,
    issueCount:rows.reduce((n,r)=>n+r.issues.length,0),markets:MARKETS.map(m=>({market:m,
      stakeCents:sum(documents.map(d=>summarize([d],{market:m}).totalCents)),
      rebateCents:sum(rows.flatMap(r=>r.result?.players||[]).map(p=>p.markets[m]?.rebateCents||0)),
      payableCents:sum(rows.flatMap(r=>r.result?.players||[]).map(p=>p.markets[m]?.payableCents||0)),
      payoutCents:sum(rows.flatMap(r=>r.result?.entries||[]).filter(e=>e.market===m).map(e=>e.payoutCents||0))}))};
}
