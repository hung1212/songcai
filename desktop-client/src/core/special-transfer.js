import { specialCollection } from './special-collection.js';
import { MARKETS } from './rules.js';
import { validateOdds } from './odds.js';
import { effectivePlayerOdds, validatePlayerOdds } from './player-odds.js';
import { payoutForStake } from './settlement.js';
import { withRebates } from './rebates.js';
import { ledgerOwnerSettings } from './ledger-owner.js';
import { numberDistribution } from './number-distribution.js';

export const SPECIAL_TRANSFER_TERMS = Object.freeze({ rate: 47.3, rebatePercent: 3.3, unitYuan: 1 });
const PAYOUT = 4730n; // Cents returned for one yuan on the winning number.
const sum = values => values.reduce((total, value) => total + value, 0n);
function safe(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('转出金额超出精确计算范围，请缩小统计范围');
  return Number(value);
}
function cents(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('投注或赔付金额无效');
  return BigInt(value);
}

// Exact maximin for these fixed terms and integer-yuan stakes. For each
// residual-liability cap, ceil((liability-cap)/4730) is the least stake needed.
// A cap > min+4730 can move down one payout step: at most 48 extra yuan cost
// <= 46.42, less than the 47.30 reduction in liability. A cap < min-4730 can
// move up one step: saving 49 yuan costs only 47.30 of coverage, gaining >=.08.
// Thus only two breakpoints per number around the minimum can be optimal.
// BigInt includes the counterparty's aggregate rebate rounding to cents.
export function optimizeSpecialTransfer(liabilityCents, netReceivedCents) {
  if (liabilityCents.length !== 49) throw new Error('转出方案需要完整的49个号码');
  const liabilities = liabilityCents.map(cents);
  if (!Number.isSafeInteger(netReceivedCents)) throw new Error('实收金额无效');
  const net = BigInt(netReceivedCents), minimum = liabilities.reduce((a,b)=>a<b?a:b);
  const caps = new Set();
  for (const liability of liabilities) {
    const cap = minimum + (liability - minimum) % PAYOUT;
    caps.add(cap); caps.add(cap - PAYOUT);
  }
  let best;
  for (const cap of caps) {
    const yuan = liabilities.map(l => l > cap ? (l-cap+PAYOUT-1n)/PAYOUT : 0n);
    const totalYuan = sum(yuan), rebate = (totalYuan*33n+5n)/10n;
    const profits = liabilities.map((l,i)=>net-l-totalYuan*100n+rebate+PAYOUT*yuan[i]);
    const worst = profits.reduce((a,b)=>a<b?a:b);
    if (!best || worst > best.worst || worst === best.worst && totalYuan < best.totalYuan) best = {yuan,totalYuan,rebate,profits,worst};
  }
  return {
    transferCents: best.yuan.map(n=>safe(n*100n)), totalCents: safe(best.totalYuan*100n),
    rebateCents: safe(best.rebate), profitCents: best.profits.map(safe),
    worstProfitCents: safe(best.worst), bestProfitCents: safe(best.profits.reduce((a,b)=>a>b?a:b)),
  };
}

function transferResult(liabilities, net, yuan) {
  return transferCentResult(liabilities,net,yuan.map(n=>n*100n));
}

// Average excess uses the same cent-rounded amount shown on the number card.
// Counterparty payout rounds once for the winning number; its rebate rounds
// once on the entire outgoing stake, just like the integer-yuan scenarios.
function transferCentResult(liabilities, net, transfers) {
  const total=sum(transfers),rebate=(total*33n+500n)/1000n;
  const payouts=transfers.map(n=>(PAYOUT*n+50n)/100n);
  const profits=liabilities.map((l,i)=>net-l-total+rebate+payouts[i]);
  return {
    transferCents: transfers.map(safe), totalCents: safe(total),
    rebateCents: safe(rebate), profitCents: profits.map(safe),
    worstProfitCents: safe(profits.reduce((a,b)=>a<b?a:b)),
    bestProfitCents: safe(profits.reduce((a,b)=>a>b?a:b)),
  };
}

export function averageExcessSpecialTransfer(numberStakeCents, liabilityCents, netReceivedCents) {
  if(numberStakeCents.length!==49||liabilityCents.length!==49)throw new Error('转出方案需要完整的49个号码');
  const liabilities=liabilityCents.map(cents);
  if(!Number.isSafeInteger(netReceivedCents))throw new Error('实收金额无效');
  const distribution=numberDistribution(numberStakeCents.map((value,i)=>({number:i+1,cents:value})));
  const transfers=distribution.numbers.map(n=>BigInt(n.excessCents));
  return {...transferCentResult(liabilities,BigInt(netReceivedCents),transfers),
    averageCents:distribution.averageCents,transferNumberCount:transfers.filter(n=>n>0n).length,unitYuan:0.01};
}

// Every minimal allocation has a residual cap L[i] - 4730*x[i]. Group these
// breakpoints by residue modulo 4730. In one group, lowering the cap by 4730
// while it remains >= min(L) costs at most 48 yuan, so worst profit strictly
// increases (including rebate rounding). Binary search WITHIN each group is
// therefore exact; binary search over total stakes would not be monotonic.
// Caps below min(L) are dominated: raising them by 4730 saves 49 yuan and
// improves worst profit. This avoids loops proportional to the stake amount.
function createFloorOptimizer(liabilityCents, netReceivedCents) {
  if (liabilityCents.length !== 49) throw new Error('转出方案需要完整的49个号码');
  const liabilities = liabilityCents.map(cents);
  if (!Number.isSafeInteger(netReceivedCents)) throw new Error('实收金额无效');
  const net = BigInt(netReceivedCents), minimum = liabilities.reduce((a,b)=>a<b?a:b);
  const sources = new Map();
  for (const l of liabilities) {
    const residue = (l-minimum)%PAYOUT;
    if (!sources.has(residue) || l > sources.get(residue)) sources.set(residue,l);
  }
  const groups = [...sources.values()].map(start=>{
    const last = (start-minimum)/PAYOUT, cache = new Map();
    const at = step=>{
      if (!cache.has(step)) {
        const cap = start-PAYOUT*step;
        const yuan = liabilities.map(l=>l>cap?(l-cap+PAYOUT-1n)/PAYOUT:0n), total = sum(yuan);
        cache.set(step,{yuan,total,worst:net-cap-total*100n+(total*33n+5n)/10n});
      }
      return cache.get(step);
    };
    return {last,at,peak:at(last).worst};
  });
  const maximumWorstProfitCents = safe(groups.reduce((v,g)=>g.peak>v?g.peak:v,groups[0].peak));
  return targetProfitCents=>{
    if (!Number.isSafeInteger(targetProfitCents)) throw new Error('最低利润金额无效');
    if (targetProfitCents > maximumWorstProfitCents) return {feasible:false,targetProfitCents,maximumWorstProfitCents};
    const target = BigInt(targetProfitCents);
    let best;
    for (const g of groups) {
      if (g.peak < target) continue;
      let low=0n,high=g.last;
      while (low < high) {
        const mid=(low+high)/2n;
        if (g.at(mid).worst >= target) high=mid;
        else low=mid+1n;
      }
      const candidate=g.at(low);
      if (!best || candidate.total<best.total || candidate.total===best.total && candidate.worst>best.worst) best=candidate;
    }
    return {...transferResult(liabilities,net,best.yuan),feasible:true,targetProfitCents,maximumWorstProfitCents};
  };
}

export function minimizeSpecialTransfer(liabilityCents, netReceivedCents, targetProfitCents) {
  return createFloorOptimizer(liabilityCents,netReceivedCents)(targetProfitCents);
}

export function specialTransferTarget(stakeCents, mode, percent) {
  const stake=cents(stakeCents), value=String(percent??'').trim();
  if (!['loss','profit'].includes(mode)) throw new Error('请选择最大亏损或最低盈利');
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) throw new Error('请输入0至100的百分比，最多两位小数');
  const [whole,fraction='']=value.split('.'), basisPoints=BigInt(whole||'0')*100n+BigInt(fraction.padEnd(2,'0'));
  if (basisPoints>10000n) throw new Error('百分比须在0至100之间');
  // Round the profit floor upward to cents, so fractional-cent percentages
  // never allow a larger loss or a smaller gain than requested.
  const product=stake*basisPoints;
  return safe(mode==='loss'?-(product/10000n):(product+9999n)/10000n);
}

function transferStatistics(plan, stakeCents) {
  const profitSum=sum(plan.profitCents.map(BigInt));
  const expectedProfitCents=safe(profitSum/49n)+Number(profitSum%49n)/49;
  const nonLossCount=plan.profitCents.filter(p=>p>=0).length;
  return {...plan,expectedProfitCents,expectedMarginPercent:stakeCents?expectedProfitCents/stakeCents*100:0,
    transferPercent:stakeCents?plan.totalCents/stakeCents*100:0,nonLossCount,nonLossPercent:nonLossCount/49*100};
}

// Reuse the scoped book's validated player odds, rebates and liabilities for
// every scenario. Changing a target never changes which bets are included.
export function specialTransferScenarios(book, custom={mode:'loss',percent:'5'}) {
  const liabilities=book.numbers.map(n=>n.liabilityCents), net=book.stakeCents-book.playerRebateCents;
  const optimize=createFloorOptimizer(liabilities,net), stats=p=>transferStatistics(p,book.stakeCents);
  const targetPlan=(id,mode,percent)=>{
    const targetProfitCents=specialTransferTarget(book.stakeCents,mode,percent);
    const label=Number(percent)===0?'不亏损':`${mode==='loss'?'最多亏':'至少赚'}${Number(percent)}%`;
    const plan=optimize(targetProfitCents);
    return {...(plan.feasible?stats(plan):plan),id,label,targetProfitCents};
  };
  const plans=[
    {...stats(transferResult(liabilities.map(BigInt),BigInt(net),Array(49).fill(0n))),id:'none',label:'不转出',feasible:true},
    {...stats(averageExcessSpecialTransfer(book.numbers.map(n=>n.cents),liabilities,net)),id:'average-excess',label:'超出平均转出',feasible:true},
    targetPlan('loss-5','loss','5'),targetPlan('loss-2','loss','2'),targetPlan('break-even','profit','0'),
    targetPlan('profit-0.5','profit','0.5'),targetPlan('profit-1','profit','1'),
    {...stats(book),id:'maximin',label:'原稳定方案',feasible:true},
  ];
  try { plans.push({...targetPlan('custom',custom.mode,custom.percent),custom:true}); }
  catch (error) { plans.push({id:'custom',label:'自定义方案',custom:true,feasible:false,error:error.message}); }
  return plans;
}

function periodForBet(doc, bet, market) {
  const declarations = (doc.metadata || []).filter(m=>m.kind==='期号');
  const scoped = declarations.filter(m=>m.markets?.includes(market)&&m.playerId===(bet.sourcePlayerId??bet.playerId)&&m.messageIndex===bet.messageIndex&&m.line<=bet.line).at(-1);
  return declarations.filter(m=>!m.markets).concat(scoped?[scoped]:[]).map(m=>{
    const digits = m.text.replace(/\D/g,'');
    // 2026278 / 26/278 / 278 share the same issue in this business year.
    const year = digits.length===7?digits.slice(0,4):digits.length===5?'20'+digits.slice(0,2):bet.businessDate.slice(0,4);
    return year+':'+Number(digits.slice(-3));
  });
}

export function specialTransferPlan(documents, settings, { date, market, allowEmpty=false } = {}) {
  if (!date || !MARKETS.includes(market)) throw new Error('请选择单个业务日期和市场，再查看转出方案');
  if (!settings?.odds?.[market]) throw new Error('正在加载玩家赔率与退水设置');
  settings = ledgerOwnerSettings(documents,settings);
  const collection = specialCollection(documents, {date,market});
  if (!collection.bets.length&&!allowEmpty) throw new Error('当前日期和市场没有已解析的特码投注');
  const playerOdds = validatePlayerOdds(settings.playerOdds || {});
  const defaultOdds = validateOdds(settings.odds[market]);
  const docs = new Map(documents.map(d=>[d.id,d])), periods = new Set(), players = new Map(), entries = [];
  const liabilities = Array(49).fill(0n), zeroRebateStakes = [], oddsByPlayer = new Map();
  let unknownPeriod = false;
  for (const bet of collection.bets) {
    if (!bet.assigned) throw new Error('请先确认特码投注所属玩家');
    const hints = periodForBet(docs.get(bet.fileId),bet,market);
    if (!hints.length) unknownPeriod = true;
    for (const hint of hints) periods.add(hint);
    if (periods.size > 1) throw new Error('当前范围包含不同期号，请先拆分账目或调整业务日期');
    if (!oddsByPlayer.has(bet.playerId)) oddsByPlayer.set(bet.playerId,validateOdds(effectivePlayerOdds(defaultOdds,playerOdds,bet.playerId,market)));
    const odds = oddsByPlayer.get(bet.playerId), unit = payoutForStake(cents(bet.unitCents),odds.rates['special-number'].rate,odds.includePrincipal);
    for (const number of bet.values) liabilities[number-1] += unit;
    if (!players.has(bet.playerId)) players.set(bet.playerId,{id:bet.playerId,stakeCents:0,payoutCents:0,pending:0,markets:{[market]:{stakeCents:0,payoutCents:0,pending:0}}});
    const person = players.get(bet.playerId);
    person.stakeCents = safe(BigInt(person.stakeCents)+cents(bet.perMarketCents));
    person.markets[market].stakeCents = person.stakeCents;
    entries.push({fileId:bet.fileId,playerId:bet.playerId,market,playType:'special-number',stakeCents:bet.perMarketCents,status:'lost'});
    const config = Object.hasOwn(settings.rebates||{},bet.playerId)?settings.rebates[bet.playerId]:{};
    if (!(config.playRates?.['special-number']??config.perTenThousandCents??0)) zeroRebateStakes.push(cents(bet.perMarketCents));
  }
  const rebate = withRebates({entries,players:[...players.values()],issues:[],payoutCents:0},settings.rebates||{}).rebateCents;
  const plan = optimizeSpecialTransfer(liabilities.map(safe),collection.summary.totalCents-rebate);
  const numbers = collection.summary.numbers.map((n,i)=>({...n,liabilityCents:safe(liabilities[i]),transferCents:plan.transferCents[i],profitCents:plan.profitCents[i]}));
  return {...plan,date,market,period:[...periods][0]||'',numbers,stakeCents:collection.summary.totalCents,playerRebateCents:rebate,
    zeroRebateStakeCents:safe(sum(zeroRebateStakes)),unknownPeriod,confirmedOdds:defaultOdds.confirmed,
    issueCount:collection.issues.length,exceedsStake:numbers.some(n=>n.transferCents>n.cents)};
}
