import {ruleForDate, MARKETS} from './rules.js';

const safe=n=>{if(!Number.isSafeInteger(n))throw new Error('转出金额超出精确计算范围');return n;};
const roundRatio=(n,d)=>Number((n+BigInt(d)/2n)/BigInt(d));
export function decimalUnits(value,label='金额') {
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(value)))throw new Error(`${label}须为非负数字，最多两位小数`);
  const [whole,fraction='']=String(value).split('.');
  return safe(Number(whole)*100+Number(fraction.padEnd(2,'0')));
}
export function transferTerms(rate,rebatePercent) {
  const rateUnits=decimalUnits(rate,'含本赔率'),rebateBps=decimalUnits(rebatePercent,'退水率');
  if(rateUnits<=0||rateUnits>100000||rebateBps>10000)throw new Error('赔率须大于0且不超过1000，退水率须在0至100%之间');
  return {rateUnits,rebateBps};
}
export function validateTransferRecord(input) {
  if(!input||!/^[-\w]{8,100}$/.test(input.id||''))throw new Error('转出批次编号无效');
  ruleForDate(input.date);if(!MARKETS.includes(input.market))throw new Error('请选择单个市场');
  const terms=transferTerms(input.rate,input.rebatePercent);
  if(!Array.isArray(input.entries)||!input.entries.length||input.entries.length>49)throw new Error('请选择1至49个已打出的号码');
  const seen=new Set();
  const entries=input.entries.map(e=>{
    if(!Number.isInteger(e.number)||e.number<1||e.number>49||seen.has(e.number))throw new Error('号码须为01至49且不可重复');
    seen.add(e.number);
    if(!Number.isSafeInteger(e.cents)||e.cents<=0||e.cents>1e12)throw new Error('实际金额须大于0且不超过100亿元');
    safe(roundRatio(BigInt(e.cents)*BigInt(terms.rateUnits),100));
    return {number:e.number,cents:e.cents};
  }).sort((a,b)=>a.number-b.number);
  safe(entries.reduce((s,e)=>s+e.cents,0));
  const text=(v,max)=>{if(typeof v!=='string'||v.length>max)throw new Error('转出记录文字格式无效');return v;};
  const period=text(input.period||'',30);if(period&&!/^\d{4}:\d{1,3}$/.test(period))throw new Error('期号格式无效');
  return {id:input.id,date:input.date,market:input.market,period,documentId:text(input.documentId||'',150),ownerName:text(input.ownerName||'集合公共',200),counterparty:text(input.counterparty||'',200),note:text(input.note||'',1000),rate:terms.rateUnits/100,rebatePercent:terms.rebateBps/100,entries};
}
export function transferRecordScope(records,{date,market,documentIds=null,period=''}) {
  const all=records.filter(r=>r.date===date&&r.market===market);
  const active=all.filter(r=>!r.voidedAt);
  if(new Set([period,...active.map(r=>r.period)].filter(Boolean)).size>1)throw new Error('该日期存在不同期号的转出记录，请先核对业务日期与期号');
  const ids=documentIds===null?null:new Set(documentIds);
  return {records:ids?all.filter(r=>ids.has(r.documentId)):all,sharedCount:ids?active.filter(r=>!r.documentId).length:0};
}
export function transferPosition(book,records) {
  const amounts=Array(49).fill(0),payouts=Array(49).fill(0);let total=0,rebate=0;
  for(const record of records.filter(r=>!r.voidedAt)) {
    const r=validateTransferRecord(record),terms=transferTerms(r.rate,r.rebatePercent);
    const subtotal=r.entries.reduce((s,e)=>safe(s+e.cents),0);
    total=safe(total+subtotal);rebate=safe(rebate+roundRatio(BigInt(subtotal)*BigInt(terms.rebateBps),10000));
    for(const e of r.entries){const i=e.number-1;amounts[i]=safe(amounts[i]+e.cents);payouts[i]=safe(payouts[i]+roundRatio(BigInt(e.cents)*BigInt(terms.rateUnits),100));}
  }
  const net=safe(book.stakeCents-book.playerRebateCents-total+rebate);
  const liabilities=book.numbers.map((n,i)=>safe(n.liabilityCents-payouts[i]));
  return {amounts,payouts,totalCents:total,rebateCents:rebate,net,liabilities,...positionStats(liabilities.map(l=>safe(net-l)),book.stakeCents)};
}
function positionStats(profits,stake) {
  const expectedProfitCents=profits.reduce((s,p)=>s+ p/49,0);
  return {profitCents:profits,worstProfitCents:Math.min(...profits),bestProfitCents:Math.max(...profits),expectedProfitCents,expectedMarginPercent:stake?expectedProfitCents/stake*100:null};
}
export function incrementalEvaluation(book,position,amounts,terms) {
  const totalCents=amounts.reduce((s,n)=>safe(s+n),0);
  const rebateCents=roundRatio(BigInt(totalCents)*BigInt(terms.rebateBps),10000);
  const profits=position.liabilities.map((l,i)=>safe(position.net-l-totalCents+rebateCents+roundRatio(BigInt(amounts[i])*BigInt(terms.rateUnits),100)));
  return {feasible:true,transferCents:amounts,totalCents,rebateCents,...positionStats(profits,book.stakeCents),newNumbers:amounts.flatMap((x,i)=>x&&!position.amounts[i]?[i+1]:[]),numberCount:amounts.filter(x=>x>0).length};
}
// Exact integer-yuan floor optimizer. In each payout residue, split at the
// points where another number needs coverage. Profit is monotone inside each
// interval (including cent-rounded rebates), permitting endpoint/binary search.
export function optimizeIncremental(book,position,terms,target,allowed=Array.from({length:49},(_,i)=>i)) {
  safe(target);
  if(terms.rateUnits*100+49*terms.rebateBps>=490000)throw new Error('当前报价不支持限亏优化，请使用平均补打并核对报价');
  const L=position.liabilities,net=position.net,step=terms.rateUnits;
  const set=new Set(allowed),uncovered=L.filter((_,i)=>!set.has(i));
  if(!allowed.length){const p=incrementalEvaluation(book,position,Array(49).fill(0),terms);return {...p,feasible:p.worstProfitCents>=target};}
  const minimum=Math.min(...L),floor=uncovered.length?Math.max(...uncovered):minimum-step;
  const sources=new Map();for(const l of L){const residue=((l%step)+step)%step;sources.set(residue,Math.max(l,sources.get(residue)??-Infinity));}
  let best=null;
  for(const start of sources.values()) {
    const last=Math.floor((start-floor)/step);if(last<0)continue;
    const points=[...new Set([0,last+1,...allowed.map(i=>Math.floor((start-L[i])/step)+1).filter(t=>t>0&&t<=last)])].sort((a,b)=>a-b);
    const cache=new Map();
    const at=t=>{if(!cache.has(t)){const cap=start-step*t;const amounts=L.map((l,i)=>set.has(i)?Math.max(0,Math.ceil((l-cap)/step))*100:0);cache.set(t,incrementalEvaluation(book,position,amounts,terms));}return cache.get(t);};
    for(let j=0;j<points.length-1;j++){
      let lo=points[j],hi=points[j+1]-1;
      if(at(lo).worstProfitCents<target){if(at(hi).worstProfitCents<target)continue;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(at(mid).worstProfitCents>=target)hi=mid;else lo=mid+1;}}
      const p=at(lo);if(p.worstProfitCents>=target&&(!best||p.totalCents<best.totalCents||p.totalCents===best.totalCents&&p.worstProfitCents>best.worstProfitCents))best=p;
    }
  }
  return best||{feasible:false,error:'当前报价和投注无法在所选号码范围内达到亏损上限'};
}
export function incrementalPlan(book,records,{rate=47.3,rebatePercent=3.3,mode='average',maxLossCents=0,maxNewNumbers=8}={}) {
  const terms=transferTerms(rate,rebatePercent),position=transferPosition(book,records);
  if(mode==='average') {
    const average=book.stakeCents/49;
    const amounts=book.numbers.map((n,i)=>Math.max(0,Math.round(Math.max(0,n.cents-average))-position.amounts[i]));
    return {...incrementalEvaluation(book,position,amounts,terms),position};
  }
  if(!Number.isSafeInteger(maxLossCents)||maxLossCents<0||!Number.isInteger(maxNewNumbers)||maxNewNumbers<0||maxNewNumbers>49)throw new Error('请输入有效亏损上限和0至49个新增号码');
  const target=-maxLossCents;
  if(mode==='minimum')return {...optimizeIncremental(book,position,terms,target),position};
  if(mode!=='few')throw new Error('请选择有效补打方式');
  const existing=position.amounts.flatMap((v,i)=>v?[i]:[]);
  const fresh=position.amounts.flatMap((v,i)=>!v?[i]:[]).sort((a,b)=>position.liabilities[b]-position.liabilities[a]||a-b);
  // A forbidden number with larger residual liability can never be replaced
  // by a smaller one to improve the floor: include fresh numbers in this order.
  for(let count=0;count<=Math.min(maxNewNumbers,fresh.length);count++){
    const p=optimizeIncremental(book,position,terms,target,[...existing,...fresh.slice(0,count)]);
    if(p.feasible)return {...p,position};
  }
  return {feasible:false,position,error:`最多新增${maxNewNumbers}个号码无法达到亏损上限；可增加号码上限、调整可承受亏损或核对报价。`};
}
