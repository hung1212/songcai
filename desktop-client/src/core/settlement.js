import { MARKETS, WAVES, ruleForDate } from './rules.js';
import { validateDraw } from './draws.js';
import { withRebates } from './rebates.js';
import {rebatePlayKey} from './rebate-plays.js';
import {ledgerOwnedDocument,ledgerOwnerSettings} from './ledger-owner.js';
export { validateRebates } from './rebates.js';

export const SETTLEMENT_VERSION = 'songcai-settlement-4';
import {validateOdds,TWO_NUMBER_SPECIAL_RATE,TWO_NUMBER_SPECIAL_TOGGLE} from './odds.js';
import {effectivePlayerOdds,validatePlayerOdds} from './player-odds.js';
export {RATE_ROWS,defaultOdds,validateOdds,withOptionalOdds} from './odds.js';
export {validatePlayerOdds,validatePlayerOddsSettings} from './player-odds.js';
function choose(n,k) { if (k<0||n<k) return 0n; let result=1n; for(let i=1;i<=k;i++) result=result*BigInt(n-i+1)/BigInt(i); return result; }
function asSafe(value) { if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(-Number.MAX_SAFE_INTEGER)) throw new Error('赔付金额超出精确计算范围'); return Number(value); }
export function payoutForStake(cents, rate, includePrincipal) {
  if(!rate) throw new Error('中奖档位未配置赔率');
  const [whole,fraction='']=rate.split('.'); const scale=10n**BigInt(fraction.length); let numerator=BigInt(whole)*scale+BigInt(fraction||'0');
  if(!includePrincipal) numerator+=scale;
  return (BigInt(cents)*numerator+scale/2n)/scale;
}
function attributeMatches(value,n) { return value==='大'?n>=25:value==='小'?n<=24:value==='单'?n%2===1:value==='双'?n%2===0:value==='合单'?(Math.floor(n/10)+n%10)%2===1:(Math.floor(n/10)+n%10)%2===0; }
function waveMatches(value,n) { return WAVES[value[0]]?.includes(n) && (value[1]==='波'||attributeMatches(value[1],n)); }
export function settleBet(bet, drawInput, rawOdds, now = Date.now(), options = {}) {
  try {
    if(bet.status!=='parsed'||!bet.assigned) throw new Error('投注未解析或未归属玩家');
    const draw=validateDraw(drawInput, now), odds=validateOdds(rawOdds);
    if(draw.date!==(options.drawDate||bet.businessDate)) throw new Error('开奖日期与投注业务日期不符');
    if(!bet.markets.includes(draw.market)) throw new Error('开奖市场与投注市场不符');
    const all=draw.numbers, normal=all.slice(0,6), special=all[6], rule=ruleForDate(draw.date);
    const animal=n=>Object.keys(rule.zodiac).find(a=>rule.zodiac[a].includes(n));
    const yearAnimal=odds.specialAnimal==='lunar'?rule.animal:odds.specialAnimal;
    // 任中 always includes the special number, even with an old six-only setting.
    const scope=type=>type==='flat-any'?all:odds.scopes[type]==='six'?normal:all;
    const t=bet.playType, tiers=new Map();
    const add=(key,count=1n,specialRate=false)=>{ if(count<=0n)return; const id=key+(specialRate?':special':''); const previous=tiers.get(id); tiers.set(id,{key,count:(previous?.count||0n)+count,specialRate}); };
    let refund=false;
    if(special===49) {
      const key=t==='attribute'?'attribute':t==='special-zodiac-any'&&bet.size===6?'sixZodiac':t==='half-wave'?'halfWave':null;
      if(key) { if(odds.refund49[key]===null) throw new Error('开49和局规则尚未配置'); refund=odds.refund49[key]; }
    }
    if(refund) return {status:'refund',payoutCents:bet.perMarketCents,refundCents:bet.perMarketCents,winCount:0,tiers:[],note:'开49和局，退回本金'};
    const required=t==='linked-zodiac'?`zodiac-${bet.size}`:t==='linked-tail'?`tail-${bet.size}`:t==='not-hit'?`not-hit-${bet.size}`:t==='flat-any'?`flat-any-${bet.size}`:t==='special-zodiac-any'?(bet.size===1?'special-zodiac':`any-${bet.size}`):t;
    if(!odds.rates[required]&&!['wave','half-wave','attribute','linked-number-3-2','linked-number-2-special'].includes(t)) throw new Error('此玩法暂无可执行赔率');
    if(t==='special-number') bet.values.forEach(v=>{if(v===special)add(t);});
    else if(t==='special-zodiac') bet.values.forEach(v=>{if(v===animal(special))add(t,1n,v===yearAnimal);});
    else if(t==='special-zodiac-any') {if(bet.values.includes(animal(special)))add(required,1n,bet.values.includes(yearAnimal));}
    else if(t==='wave'||t==='half-wave') {if(waveMatches(bet.values[0],special))add(`${t==='wave'?'wave':'half'}-${bet.values[0]}`);}
    else if(t==='attribute') {if(attributeMatches(bet.values[0],special))add(t);}
    else if(t==='flat-number') { const drawn=bet.play==='平特号码'?all:scope(t); bet.values.forEach(v=>{if(drawn.includes(v))add(t);}); }
    else if(t==='flat-zodiac') bet.values.forEach(v=>{if(scope(t).some(n=>animal(n)===v))add(t,1n,v===yearAnimal);});
    else if(t==='flat-tail') bet.values.forEach(v=>{if(scope(t).some(n=>n%10===v))add(v===0?'zero-tail':t);});
    else {
      const pools=bet.groups||[bet.values];
      for(const pool of pools) {
        const values=[...new Set(pool)], size=bet.size, n=values.length;
        const present=t==='linked-zodiac'?new Set(scope(t).map(animal)):t==='linked-tail'?new Set(scope(t).map(v=>v%10)):new Set(t.startsWith('linked-number')||t==='special-pair'?normal:scope(t));
        const h=values.filter(v=>present.has(v)).length;
        if(t==='linked-zodiac') {
          const winners=choose(h,size), has=values.includes(yearAnimal)&&present.has(yearAnimal); const specialWinners=has?choose(h-1,size-1):0n;
          add(required,winners-specialWinners); add(required,specialWinners,true);
        } else if(t==='linked-number-2-2') {
          add(required,choose(h,2));
          if(odds[TWO_NUMBER_SPECIAL_TOGGLE]&&values.includes(special))add(TWO_NUMBER_SPECIAL_RATE,BigInt(h));
        } else if(t==='linked-tail'||t==='linked-number-3-3') add(required,choose(h,size));
        else if(t==='not-hit') add(required,choose(n-h,size));
        else if(t==='flat-any') add(required,choose(n,size)-choose(n-h,size));
        else if(t==='linked-number-3-2') {add('three-two',choose(h,2)*choose(n-h,1));add('three-three',choose(h,3));}
        else if(t==='linked-number-2-special') {add('two-normal',choose(h,2));if(values.includes(special))add('two-special',BigInt(h));}
        else if(t==='special-pair') {if(values.includes(special))add(t,BigInt(h));}
        else throw new Error('此玩法尚未实现中奖判断');
      }
    }
    let total=0n,wins=0n; const breakdown=[];
    for(const tier of tiers.values()) {const rate=odds.rates[tier.key]?.[tier.specialRate?'specialRate':'rate']; const unit=payoutForStake(bet.unitCents,rate,odds.includePrincipal), payout=unit*tier.count; total+=payout;wins+=tier.count;
      breakdown.push({key:tier.key,rate,yearAnimal:tier.specialRate?yearAnimal:'',count:asSafe(tier.count),unitPayoutCents:asSafe(unit),payoutCents:asSafe(payout)});}
    return {status:wins?'won':'lost',payoutCents:asSafe(total),refundCents:0,winCount:asSafe(wins),winningStakeCents:asSafe(wins*BigInt(bet.unitCents)),tiers:breakdown,note:wins?'逐份按赔率计算，金额四舍五入到分':'未中奖'};
  } catch(error) {return {status:'pending',payoutCents:null,refundCents:0,winCount:null,tiers:[],note:error.message};}
}
export function settleDocuments(documents, draws, settings, date, options = {}) {
  options=ledgerOwnerSettings(documents,options);
  ruleForDate(date); const playerOdds=validatePlayerOdds(options.playerOdds||{}); const entries=[],issues=[],players=new Map(); let stake=0n,payout=0n,refund=0n,pending=0;
  for(const source of documents) {
    const doc=ledgerOwnedDocument(source);
    if(doc.rule?.date!==date)continue;
    for(const issue of doc.issues||[]) if(issue.severity!=='warning') issues.push({...issue,document:doc.name});
    const periodDeclarations=(doc.metadata||[]).filter(m=>m.kind==='期号');
    for(const bet of doc.bets||[]) for(const market of bet.markets) {
      const scoped=periodDeclarations.filter(m=>m.markets?.includes(market)&&m.playerId===bet.sourcePlayerId&&m.messageIndex===bet.messageIndex&&m.line<=bet.line).at(-1);
      const periodHints=periodDeclarations.filter(m=>!m.markets).concat(scoped?[scoped]:[]).map(m=>m.text.replace(/\D/g,''));
      let result; const draw=draws[market];
      if(!draw)result={status:'pending',payoutCents:null,note:'未选择该市场、该日期的开奖'};
      else if(periodHints.length && periodHints.some(h=>h.length<=3?Number(h)!==Number(draw.issue.slice(-3)):h!==draw.issue.replace(/\D/g,''))) result={status:'pending',payoutCents:null,note:'原文期号与所选开奖不一致，请拆分或核对该账目'};
      else result=settleBet(bet,draw,effectivePlayerOdds(settings[market],playerOdds,bet.playerId||bet.player,market),Date.now(),{drawDate:options.drawDates?.[market]});
      const playerId=bet.playerId||bet.player;
      const entry={...result,id:`${bet.id}:${market}`,betId:bet.id,player:bet.player,playerId,market,play:bet.play,playType:bet.playType,rebatePlayKey:rebatePlayKey(bet),raw:bet.raw,fileId:doc.id,fileName:bet.fileName,line:bet.line,endLine:bet.endLine,unitCents:bet.unitCents,stakeCents:bet.perMarketCents,issue:draw?.issue||'',drawId:draw?.id||'',drawDate:draw?.date||'',businessDate:bet.businessDate};
      if(bet.playType==='flat-zodiac'&&['won','lost'].includes(result.status)) {
        const animal=ruleForDate(draw?.date||bet.businessDate).animal;
        const specialStake=bet.values.filter(value=>value===animal).length*bet.unitCents;
        entry.rebateLots=[{playKey:'flat-zodiac',stakeCents:bet.perMarketCents-specialStake},{playKey:'flat-zodiac-year',stakeCents:specialStake}].filter(lot=>lot.stakeCents>0);
      }
      entries.push(entry);stake+=BigInt(entry.stakeCents);
      if(!players.has(playerId))players.set(playerId,{id:playerId,name:bet.player,stakeCents:0,payoutCents:0,pending:0,markets:Object.fromEntries(MARKETS.map(m=>[m,{stakeCents:0,payoutCents:0,pending:0}]))});
      const person=players.get(playerId), group=person.markets[market];person.stakeCents=asSafe(BigInt(person.stakeCents)+BigInt(entry.stakeCents));group.stakeCents=asSafe(BigInt(group.stakeCents)+BigInt(entry.stakeCents));
      if(entry.payoutCents===null) {pending++;person.pending++;group.pending++;} else {payout+=BigInt(entry.payoutCents);refund+=BigInt(entry.refundCents||0);person.payoutCents=asSafe(BigInt(person.payoutCents)+BigInt(entry.payoutCents));group.payoutCents=asSafe(BigInt(group.payoutCents)+BigInt(entry.payoutCents));}
    }
  }
  return withRebates({version:SETTLEMENT_VERSION,date,entries,players:[...players.values()],issues,stakeCents:asSafe(stake),payoutCents:asSafe(payout),refundCents:asSafe(refund),pending,complete:!!entries.length&&!pending&&!issues.length}, options.rebates);
}
