import {ledgerReceipt,receiptMoney,receiptFormula,receiptMarketName,receiptSegmentRows} from './ledger-receipt.js';
import {combinationPreview,pad,MARKETS} from './rules.js';
import {settleBet} from './settlement.js';
import {effectivePlayerOdds} from './player-odds.js';
import {ledgerOwner,ledgerOwnerSettings} from './ledger-owner.js';
import {payoutTierLabel,wonStake} from './winning-display.js';

const money=cents=>receiptMoney(cents).replace(/,/g,'');
const sum=values=>{const value=values.reduce((n,v)=>n+BigInt(v),0n);if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('文字结算金额超出精确范围');return Number(value);};
const tierKey=tier=>JSON.stringify([tier.key,tier.yearAnimal||'',String(tier.rate||'')]);
const singleton=new Set(['special-number','special-zodiac','flat-number','flat-zodiac','flat-tail']);
const whole=new Set(['special-zodiac-any','wave','half-wave','attribute']);
const order=['special-number','special-zodiac','special-zodiac-any','linked-number-2-2','linked-number-3-2','linked-number-3-3','linked-number-2-special','special-pair','linked-zodiac','linked-tail','flat-zodiac','flat-number','flat-tail','flat-any','wave','half-wave','attribute','not-hit'];

// Reconstruct selection labels from the SAME saved bets/draw/settings. We only
// expose them if the full tier counts and payouts match the recorded result.
// The recorded payout remains authoritative, including per-unit rounding.
function detailedWinners(entry,bet,draw,odds,budget){
  if(!bet||!draw||!odds||!entry.tiers?.length)return null;
  const limit=Math.min(500,budget.remaining);if(limit<=0)return null;
  let choices;
  if(singleton.has(bet.playType))choices=bet.values.map(value=>[value]);
  else if(whole.has(bet.playType))choices=[bet.values];
  else{
    choices=[];
    for(const pool of bet.groups||[bet.values]){
      choices.push(...combinationPreview([...new Set(pool)],bet.size,limit+1-choices.length));
      if(choices.length>limit)return null;
    }
  }
  if(choices.length>limit)return null;
  budget.remaining-=choices.length;
  const unit=entry.unitCents??bet.unitCents,rows=[],totals=new Map();
  for(const values of choices){
    const trial=settleBet({...bet,values,groups:singleton.has(bet.playType)||whole.has(bet.playType)?undefined:[values],unitCents:unit,markets:[entry.market]},draw,odds,Date.now(),{drawDate:draw.date});
    if(trial.status==='pending')return null;
    for(const tier of trial.tiers||[]){
      const key=tierKey(tier),total=totals.get(key)||{count:0,payout:0};
      total.count+=tier.count;total.payout=sum([total.payout,tier.payoutCents]);totals.set(key,total);
      rows.push({values,unitCents:unit,tier});
    }
  }
  if(totals.size!==entry.tiers.length||!entry.tiers.every(t=>{const total=totals.get(tierKey(t));return total?.count===t.count&&total.payout===t.payoutCents;}))return null;
  return rows;
}
const selectionLabel=(values,type)=>values.map(v=>typeof v==='number'?type.includes('tail')?`${v}尾`:pad(v):v).join(values.every(v=>typeof v==='string')?'':'、');

export function receiptText(data,{showName=false,showSegments=false}={}){
  const card=ledgerReceipt(data);if(!card)throw new Error('尚无结算数据');
  const {inputs,result}=data,snapshot=inputs.documents[0],bets=new Map((snapshot.bets||[]).map(b=>[b.id,b]));
  const settings=ledgerOwnerSettings([snapshot],inputs.settings||{}),owner=ledgerOwner(snapshot),groups=new Map(),budget={remaining:5000};
  let summarized=false;
  function add(entry,bet,tier,unit,values,principal){
    const known=Number.isSafeInteger(unit)&&Number.isSafeInteger(tier.count);
    const stake=known?sum([BigInt(unit)*BigInt(tier.count)]):entry.tiers?.length>1?null:wonStake(entry,bet);
    const selection=values?selectionLabel(values,entry.playType):'';
    const selectionKey=values?[...values].sort((a,b)=>String(a).localeCompare(String(b))).join('|'):null;
    const key=JSON.stringify([entry.market,entry.playType,entry.play,tierKey(tier),principal,selectionKey]);
    const row=groups.get(key)||{market:entry.market,play:entry.play,type:entry.playType,size:bet?.size||1,selection,detail:tier.yearAnimal?`${tier.yearAnimal}年生肖档`:payoutTierLabel(tier),rate:tier.rate||'',includePrincipal:principal,complete:known&&!!tier.rate&&typeof principal==='boolean',stakeCents:0,payoutCents:0,count:0};
    row.stakeCents=stake===null||row.stakeCents===null?null:sum([row.stakeCents,stake]);
    row.payoutCents=sum([row.payoutCents,tier.payoutCents]);row.count+=tier.count||0;groups.set(key,row);
  }
  for(const entry of result.entries.filter(e=>e.status==='won')){
    const bet=bets.get(entry.betId),odds=effectivePlayerOdds(settings.odds?.[entry.market],settings.playerOdds,owner.id,entry.market);
    const details=detailedWinners(entry,bet,inputs.draws?.[entry.market],odds,budget);
    if(details)for(const detail of details)add(entry,bet,detail.tier,detail.unitCents,detail.values,odds.includePrincipal);
    else{
      summarized=true;
      for(const tier of entry.tiers?.length?entry.tiers:[{key:'unknown',count:entry.winCount,rate:'',payoutCents:entry.payoutCents}])add(entry,bet,tier,entry.unitCents??bet?.unitCents,null,odds?.includePrincipal);
    }
  }
  const rows=[...groups.values()].sort((a,b)=>MARKETS.indexOf(a.market)-MARKETS.indexOf(b.market)||order.indexOf(a.type)-order.indexOf(b.type)||a.size-b.size);
  if(sum(rows.map(r=>r.payoutCents))!==card.winningPayoutCents)throw new Error('文字中奖明细与结算合计不一致');
  const lines=[];
  if(showName)lines.push(card.name);
  for(const market of card.markets)lines.push(`${receiptMarketName(market.market)}${market.date?' · '+market.date:''}${market.issue?' · '+market.issue+'期':''}${market.drawState!=='available'?' · 开奖待补齐':''}`);
  lines.push(`总投注：${money(card.stakeCents)}元`,'','中奖明细（投注 × 赔率 = 赔付）');
  if(!rows.length)lines.push(card.status==='pending'?'暂无已确认中奖明细':'无中奖');
  for(const row of rows){
    const market=card.markets.length>1?`【${receiptMarketName(row.market)}】`:'';
    const selection=row.selection&&!row.play.includes(row.selection)?row.selection:'';
    const detail=row.detail?`（${row.detail}）`:'';
    const formula=receiptFormula(row).replace(/,/g,'');
    lines.push(`${market}${row.play}${selection}${detail}：${formula} = ${money(row.payoutCents)}元${!row.selection&&row.count>1?'（中奖'+row.count+'组/份）':''}`);
  }
  if(summarized)lines.push('注：部分组合明细未展开，按已保存的中奖合计列示。');
  const pending=card.status==='pending',prefix=pending?'已算':'';
  lines.push('',`${prefix}中奖合计：${money(card.winningPayoutCents)}元`);
  if(card.refundCents)lines.push(`和局退回本金：${money(card.refundCents)}元`);
  lines.push(`${prefix}退水：${money(card.rebateCents)}元`,`${prefix}合计返还：${money(card.payableCents)}元`,'');
  lines.push(card.netCents===null?`本单待结算：${result.pending}笔未结算，${result.issues.length}项待处理，暂不能确定应收／应付。`:card.netCents<0?`本单应收：${money(-card.netCents)}元`:card.netCents>0?`本单应付：${money(card.netCents)}元`:'本单持平：0元');
  if(showSegments){lines.push('','分段投注：');for(const row of receiptSegmentRows(inputs,result))lines.push(`${row.index}：${money(row.stakeCents)}`);}
  return lines.join('\n');
}
