import {MARKETS,formatMoney,pad,ruleForDate} from './rules.js';
import {MARKET_NAMES} from './special-number-highlights.js';

// One winning stake per purchased zodiac, even if several drawn numbers share
// that zodiac. Use the draw's lunar year and the market's settlement scope.
export function flatZodiacHighlights(bets,{draws={},verification={},odds={}}={},market='') {
  const marks={};
  for(const m of MARKETS.filter(m=>!market||market===m)) {
    const draw=draws[m],check=verification[m];
    if(!draw||draw.market!==m||draw.numbers?.length!==7||check?.status==='conflict'&&!check.confirmed)continue;
    let rule;
    try {rule=ruleForDate(draw.date);} catch {continue;}
    const scope=odds[m]?.scopes?.['flat-zodiac']==='six'?'six':'seven';
    const drawn=draw.numbers.slice(0,scope==='six'?6:7);
    for(const [animal,pool] of Object.entries(rule.zodiac)) {
      const numbers=drawn.filter(n=>pool.includes(n));
      if(!numbers.length)continue;
      let cents=0n;
      for(const bet of bets) {
        if(bet.playType!=='flat-zodiac'||bet.status!=='parsed'||!bet.markets.includes(m))continue;
        cents+=BigInt(bet.values.filter(v=>v===animal).length)*BigInt(bet.unitCents);
      }
      if(!cents)continue;
      if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('中奖生肖投注金额超出精确计算范围');
      const trial=!check?.confirmed,name=MARKET_NAMES[m],stakeCents=Number(cents);
      const hit={market:m,name,animal,numbers,scope,stakeCents,trial,date:draw.date,issue:draw.issue,
        title:`${name} · ${draw.date} · ${draw.issue}期 · ${animal}肖开出${numbers.map(pad).join('、')} · ${scope==='six'?'仅正码':'正码＋特码'} · 命中投注${formatMoney(stakeCents)}元${trial?' · 开奖待核对':''}`};
      (marks[animal]||=[]).push(hit);
    }
  }
  return marks;
}
