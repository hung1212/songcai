import {MARKETS,formatMoney,pad} from './rules.js';

export const MARKET_NAMES={新:'新澳',旧:'旧澳',港:'香港'};

// Compare the visible stakes with each market's latest draw. This is a derived
// marker, not a settlement: leave amounts, sorting and saved snapshots alone.
export function specialNumberHighlights(bets,{draws={},verification={}}={},market='') {
  const marks={};
  for(const m of MARKETS.filter(m=>!market||market===m)) {
    const draw=draws[m],check=verification[m];
    if(!draw||draw.market!==m||draw.numbers?.length!==7||check?.status==='conflict'&&!check.confirmed)continue;
    const number=draw.numbers[6];
    if(!Number.isInteger(number)||number<1||number>49)continue;
    let cents=0n;
    for(const bet of bets) {
      if(bet.playType!=='special-number'||bet.status!=='parsed'||!bet.markets.includes(m))continue;
      cents+=BigInt(bet.values.filter(n=>n===number).length)*BigInt(bet.unitCents);
    }
    if(!cents)continue;
    if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('中奖号码投注金额超出精确计算范围');
    const trial=!check?.confirmed,name=MARKET_NAMES[m],stakeCents=Number(cents);
    const hit={market:m,name,number,stakeCents,trial,date:draw.date,issue:draw.issue,
      title:`${name} · ${draw.date} · ${draw.issue}期 · 特码${pad(number)} · 命中投注${formatMoney(stakeCents)}元${trial?' · 开奖待核对':''}`};
    (marks[number]||=[]).push(hit);
  }
  return marks;
}
