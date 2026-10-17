import { ANIMALS } from './rules.js';
import { summarize } from './parser.js';

// Repeated selections and each market represent separate paid shares.
export function flatZodiacAmount(bet, { market = '', animal = '' } = {}) {
  const shares = animal ? bet.values.filter(value => value === animal).length : bet.values.length;
  const markets = bet.marketEntries.filter(entry => !market || entry.market === market).length;
  const cents = shares * bet.unitCents * markets;
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('平特肖金额超出精确计算范围');
  return cents;
}

// A live, space-scoped projection of parsed ledgers; no copied betting rows.
export function flatZodiacCollection(documents, { date = '', market = '' } = {}) {
  const scoped = documents.filter(doc => !date || doc.rule?.date === date);
  const flat = scoped.map(doc => ({ ...doc, bets: doc.bets.filter(bet => bet.playType === 'flat-zodiac' && bet.status === 'parsed') }));
  const summary = summarize(flat, { market });
  const bets = flat.flatMap(doc => doc.bets).filter(bet => !market || bet.markets.includes(market));
  const total = BigInt(summary.totalCents);
  const animals = ANIMALS.map(animal => {
    const sources = bets.filter(bet => bet.values.includes(animal));
    const cents = sources.reduce((sum, bet) => sum + flatZodiacAmount(bet, { market, animal }), 0);
    const difference = BigInt(cents) * 12n - total;
    return { animal, cents, betCount: sources.length, documentCount: new Set(sources.map(bet => bet.fileId)).size,
      aboveAverage: difference > 0n, excessCents: difference > 0n ? Number((difference + 6n) / 12n) : 0 };
  });
  return { summary, bets, animals, averageCents: Number((total + 6n) / 12n),
    aboveCount: animals.filter(row => row.aboveAverage).length,
    documentCount: new Set(bets.map(bet => bet.fileId)).size,
    issues: scoped.flatMap(doc => doc.issues).filter(issue => issue.severity !== 'warning') };
}

export function sortFlatZodiacs(animals, order = 'amount-desc') {
  return [...animals].sort((a, b) => (order === 'amount-desc' ? b.cents - a.cents : order === 'amount-asc' ? a.cents - b.cents : 0)
    || ANIMALS.indexOf(a.animal) - ANIMALS.indexOf(b.animal));
}
