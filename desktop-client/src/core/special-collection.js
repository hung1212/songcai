import { summarize } from './parser.js';
import { numberDistribution } from './number-distribution.js';

// A derived view of existing bets: no copied ledger and no extra betting rows.
export function specialCollection(documents, { date = '', market = '' } = {}) {
  const scoped = documents.filter(d => !date || d.rule?.date === date);
  const special = scoped.map(d => ({...d,bets:d.bets.filter(b => b.playType === 'special-number' && b.status === 'parsed')}));
  const summary = summarize(special, {market});
  const bets = special.flatMap(d => d.bets).filter(b => !market || b.markets.includes(market));
  return {summary,bets,distribution:numberDistribution(summary.numbers),
    documentCount:new Set(bets.map(b => b.fileId)).size,
    dates:[...new Set(bets.map(b => b.businessDate))].sort(),
    issues:scoped.flatMap(d => d.issues).filter(i => i.severity !== 'warning')};
}
