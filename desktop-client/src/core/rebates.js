import {REBATE_PLAY_IDS,rebatePlayKey,rebatePlayName} from './rebate-plays.js';
// Rates are integer cents returned per 10,000 yuan of effective turnover.
// 100 yuan / 10,000 yuan = 1%. All monetary arithmetic uses integer fractions.
const BASE = 1_000_000n;
const safe = value => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) throw new Error('退水或应付金额超出精确计算范围');
  return Number(value);
};
export function validateRebates(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 10000) throw new Error('玩家退水设置格式无效');
  return Object.fromEntries(Object.entries(input).flatMap(([id, value]) => {
    if (!id || id.length > 1000 || !Number.isSafeInteger(value?.perTenThousandCents) || value.perTenThousandCents < 0 || value.perTenThousandCents > Number(BASE)) throw new Error('每万元退水须为0至10,000元，最多两位小数');
    const overrides=value.playRates??{};
    if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw new Error('玩法退水设置格式无效');
    const playRates=Object.fromEntries(Object.entries(overrides).map(([key,cents])=>{
      if(!REBATE_PLAY_IDS.has(key)||!Number.isSafeInteger(cents)||cents<0||cents>Number(BASE))throw new Error('玩法退水设置无效，须为0至10,000元，最多两位小数');
      return [key,cents];
    }));
    if(value.name!==undefined&&(typeof value.name!=='string'||value.name.length>1000))throw new Error('退水玩家名称无效');
    return value.perTenThousandCents||Object.keys(playRates).length||value.name ? [[id, {perTenThousandCents:value.perTenThousandCents,...(Object.keys(playRates).length?{playRates}:{}),...(value.name?{name:value.name}:{})}]] : [];
  }));
}
export function rebateInput(text) {
  const value=String(text).trim();
  if (!value) return 0;
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value)) throw new Error('每万元退水须为0至10,000元，最多两位小数');
  const [whole, fraction='']=value.split('.'), cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if (cents>Number(BASE)) throw new Error('退水不能超过流水金额');
  return cents;
}
export const rebatePercent = cents => (cents / 10000).toFixed(4).replace(/0+$/,'').replace(/\.$/,'') + '%';
export function settlementPlayers(documents,{includeEmpty=false}={}) {
  const players=new Map();
  for (const doc of documents) for (const bet of (doc.bets?.length?doc.bets:includeEmpty?[{playerId:doc.defaultPlayer?.trim()||`document:${doc.id}:player`,player:doc.defaultPlayer?.trim()||`本单玩家（${doc.name}）`}]:[])) {
    const id=bet.playerId||bet.player;
    if (!players.has(id)) players.set(id,{id,name:bet.player,documents:[]});
    const person=players.get(id);
    if (!person.documents.includes(doc.name)) person.documents.push(doc.name);
  }
  return [...players.values()];
}

export function rebateRateLabel(person) {
  return Object.keys(person.playRates||{}).length?'按玩法设置':rebatePercent(person.perTenThousandCents||0);
}
export function receiptRebateSummary(players) {
  let turnoverCents=0;const rates=new Set();let hasRebate=false;
  for(const p of players) {
    if(p.rebateBreakdown) {
      for(const r of p.rebateBreakdown)if(r.perTenThousandCents){hasRebate=true;turnoverCents=safe(BigInt(turnoverCents)+BigInt(r.turnoverCents));rates.add(r.perTenThousandCents);}
    } else if(p.perTenThousandCents) {hasRebate=true;turnoverCents=safe(BigInt(turnoverCents)+BigInt(p.turnoverCents||0));rates.add(p.perTenThousandCents);}
  }
  return {hasRebate,turnoverCents,rate:rates.size===1?rebatePercent([...rates][0]):'多档退水率'};
}

export function withRebates(result, rawRates) {
  const rates=validateRebates(rawRates), lots=new Map();
  // Round once per ledger/player, so the daily total equals the sum of the
  // individual receipts. Allocate those cents to markets by largest remainder.
  for (const entry of result.entries) {
    if (!['won','lost'].includes(entry.status)) continue;
    const key=JSON.stringify([entry.fileId,entry.playerId]);
    if (!lots.has(key)) lots.set(key,{playerId:entry.playerId,groups:new Map()});
    const groups=lots.get(key).groups;
    const config=Object.hasOwn(rates,entry.playerId)?rates[entry.playerId]:{};
    for(const lot of entry.rebateLots||[{playKey:rebatePlayKey(entry),stakeCents:entry.stakeCents}]) {
      const hasYearRate=Object.hasOwn(config.playRates||{},'flat-zodiac-year');
      const playKey=lot.playKey==='flat-zodiac-year'&&!hasYearRate?'flat-zodiac':lot.playKey;
      const groupKey=JSON.stringify([entry.market,playKey]);
      const rate=config.playRates&&Object.hasOwn(config.playRates,playKey)?config.playRates[playKey]:config.perTenThousandCents||0;
      if(!groups.has(groupKey))groups.set(groupKey,{market:entry.market,playKey,rate,turnover:0n});
      groups.get(groupKey).turnover+=BigInt(lot.stakeCents);
    }
  }
  const players=result.players.map(person=>({...person,turnoverCents:0,rebateCents:0,
    perTenThousandCents:Object.hasOwn(rates,person.id)?rates[person.id].perTenThousandCents:0,
    playRates:Object.hasOwn(rates,person.id)?{...rates[person.id].playRates}:{},rebateBreakdown:[],
    markets:Object.fromEntries(Object.entries(person.markets).map(([m,g])=>[m,{...g,turnoverCents:0,rebateCents:0}]))}));
  const byId=new Map(players.map(p=>[p.id,p]));
  for (const lot of lots.values()) {
    const person=byId.get(lot.playerId);
    const rows=[...lot.groups.values()].map(r=>({...r,cents:r.turnover*BigInt(r.rate)/BASE,remainder:r.turnover*BigInt(r.rate)%BASE}));
    const turnover=rows.reduce((n,r)=>n+r.turnover,0n), rebate=(rows.reduce((n,r)=>n+r.turnover*BigInt(r.rate),0n)+BASE/2n)/BASE;
    let remaining=rebate-rows.reduce((n,r)=>n+r.cents,0n);
    rows.sort((a,b)=>a.remainder>b.remainder?-1:a.remainder<b.remainder?1:a.market.localeCompare(b.market)||String(a.playKey).localeCompare(String(b.playKey)));
    for (const row of rows) {
      if (remaining>0n) {row.cents++;remaining--;}
      const group=person.markets[row.market];
      group.turnoverCents=safe(BigInt(group.turnoverCents)+row.turnover);
      group.rebateCents=safe(BigInt(group.rebateCents)+row.cents);
      let detail=person.rebateBreakdown.find(r=>r.playKey===row.playKey);
      if(!detail){detail={playKey:row.playKey,name:rebatePlayName(row.playKey),perTenThousandCents:row.rate,turnoverCents:0,rebateCents:0};person.rebateBreakdown.push(detail);}
      detail.turnoverCents=safe(BigInt(detail.turnoverCents)+row.turnover);detail.rebateCents=safe(BigInt(detail.rebateCents)+row.cents);
    }
    person.turnoverCents=safe(BigInt(person.turnoverCents)+turnover);
    person.rebateCents=safe(BigInt(person.rebateCents)+rebate);
  }
  for (const person of players) {
    person.payableCents=safe(BigInt(person.payoutCents)+BigInt(person.rebateCents));
    person.netCents=person.pending||result.issues.some(i=>i.playerId===person.id)?null:person.payableCents-person.stakeCents;
    for (const group of Object.values(person.markets)) group.payableCents=safe(BigInt(group.payoutCents)+BigInt(group.rebateCents));
  }
  const rebateCents=safe(players.reduce((n,p)=>n+BigInt(p.rebateCents),0n));
  return {...result,players,rebateCents,turnoverCents:safe(players.reduce((n,p)=>n+BigInt(p.turnoverCents),0n)),payableCents:safe(BigInt(result.payoutCents)+BigInt(rebateCents))};
}
