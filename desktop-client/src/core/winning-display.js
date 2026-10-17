import {formatMoney} from './rules.js';

export function wonStake(entry, bet) {
  if(entry.status!=='won')return null;
  if(Number.isSafeInteger(entry.winningStakeCents)&&entry.winningStakeCents>=0)return entry.winningStakeCents;
  // Old saved settlements did not store this amount. Use their own parsed bets,
  // never the newly edited original or the total stake of the whole selection.
  const unit=entry.unitCents??bet?.unitCents;
  if(!Number.isSafeInteger(unit)||unit<0||!Number.isSafeInteger(entry.winCount)||entry.winCount<1)return null;
  const value=BigInt(unit)*BigInt(entry.winCount);
  return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null;
}

export function winningEntryLabel(entry, bet) {
  const cents=wonStake(entry,bet);
  return `${entry.play}${cents===null?'（中奖投注额待核对）':formatMoney(cents)+'元'}`;
}

export function winningLineMarks(parsed, result, {fresh=true,history=false,verification={},odds={}}={}) {
  const marks={};
  if(!fresh||history||!parsed||!result)return marks;
  const bets=new Map(parsed.bets.map(b=>[b.id,b]));
  for(const entry of result.entries||[]){
    if(entry.status!=='won')continue;
    const bet=bets.get(entry.betId);
    if(!bet||bet.status!=='parsed'||!bet.markets.includes(entry.market)||entry.raw!==bet.raw||entry.line!==bet.line)continue;
    const trial=!(verification[entry.market]?.confirmed&&odds[entry.market]?.confirmed);
    const label=`${trial?'试算中奖':'中奖'} · ${entry.market} · ${winningEntryLabel(entry,bet)} · 赔付${formatMoney(entry.payoutCents)}元`;
    for(let line=bet.line;line<=(bet.endLine||bet.line);line++){
      const mark=marks[line]||(marks[line]={entries:[],trial:true,labels:[]});
      mark.entries.push(entry);mark.trial=mark.trial&&trial;mark.labels.push(label);
    }
  }
  for(const mark of Object.values(marks))mark.title=mark.labels.join('\n');
  return marks;
}

export function drawBasisLabel(draws={}) {
  return Object.entries(draws).filter(([,d])=>d).map(([market,d])=>`${market} ${d.date} · ${d.issue}期`).join('；')||'尚无可用开奖';
}
