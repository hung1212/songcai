import { MARKETS } from './rules.js';
import { DRAW_SOURCES, normalizeSources } from './draws.js';

export function normalizedIssue(issue, date) {
  const text = String(issue).trim();
  const separated = text.match(/^(\d{2}|\d{4})[-/](\d{1,4})$/);
  if (separated) return `${separated[1].length === 2 ? '20' : ''}${separated[1]}-${Number(separated[2])}`;
  if (/^\d{7}$/.test(text)) return `${text.slice(0, 4)}-${Number(text.slice(4))}`;
  return `${date.slice(0, 4)}-${Number(text)}`;
}

// Normal balls may be shown in draw order or ascending order. The special ball
// remains separate; exchanging it with a normal ball is always a conflict.
export function numberSignature(draw) {
  return `${[...draw.numbers.slice(0, 6)].sort((a, b) => a - b).join(',')}+${draw.numbers[6]}`;
}
const isManual = draw => draw.sourceId === 'manual' || draw.sourceId.startsWith('manual-');
function provider(draw) {
  const source = DRAW_SOURCES.find(s => s.id === draw.sourceId);
  if (isManual(draw) || !source || source.retired) return '';
  if (source.provider) return source.provider;
  if (draw.sourceId.startsWith('macaujc-')) return 'macaujc';
  if (draw.sourceId.startsWith('1234-')) return '1234';
  return 'hkjc';
}

export function compareDraws(allRecords, { market, date, selectedId = '', sourceIds = [], reports = [] }) {
  const rank=id=>{const i=sourceIds.indexOf(id);return i<0?sourceIds.length+1:i;};
  const local = allRecords.filter(d => d.market === market).sort((a,b)=>rank(a.sourceId)-rank(b.sourceId)||String(b.observedAt||'').localeCompare(String(a.observedAt||'')));
  const selected = local.find(d => d.id === selectedId && d.date === date);
  const target = selected || local.find(d => d.date === date);
  const issueKey = target ? normalizedIssue(target.issue, target.date) : '';
  const selectedSignature = selected ? numberSignature(selected) : '';
  const records = local.filter(d => d.date === date || normalizedIssue(d.issue, d.date) === issueKey).map(d => ({
    ...d, excluded: DRAW_SOURCES.find(s => s.id === d.sourceId)?.retired === true, manual: isManual(d), provider: provider(d), enabled: sourceIds.includes(d.sourceId),
    sameIssue: normalizedIssue(d.issue, d.date) === issueKey, sameDate: d.date === date,
    signature: numberSignature(d), matchesSelected: !!selected && d.date === date && normalizedIssue(d.issue, d.date) === issueKey && numberSignature(d) === selectedSignature,
  })).sort((a, b) => rank(a.sourceId)-rank(b.sourceId) || String(b.observedAt || '').localeCompare(String(a.observedAt || '')) || a.id.localeCompare(b.id));
  const comparable = records.filter(d => d.sameIssue && !d.excluded);
  const signatures = new Set(comparable.map(d => `${d.date}:${d.signature}`));
  const providers = [...new Set(comparable.filter(d => d.sameDate && d.provider && d.enabled).map(d => d.provider))];
  const status = !comparable.length ? 'missing' : signatures.size > 1 ? 'conflict' : providers.length >= 2 ? 'consistent' : providers.length === 1 ? 'single' : 'manual';
  const sourceStates = sourceIds.map(sourceId => {
    const source = DRAW_SOURCES.find(s => s.id === sourceId);
    const report = reports.find(r => r.market === market && r.sourceId === sourceId);
    const found = comparable.some(d => d.sourceId === sourceId && d.sameDate);
    return { sourceId, sourceName: source.name, note: source.note, found, checkedAt: report?.checkedAt || '',
      state: report?.ok === false ? 'failed' : found ? 'available' : report?.ok ? 'missing' : 'unchecked',
      message: report?.message || '尚未获取', latest: report?.latest || null };
  });
  // New conflicting evidence, a changed chosen result, or a changed source set
  // invalidates the user's decision. Merely fetching identical data does not.
  const reviewKey = JSON.stringify([1, market, date, selectedId, [...sourceIds].sort(),
    comparable.map(d => [d.id, d.sourceId, d.date, normalizedIssue(d.issue, d.date), d.signature]).sort((a, b) => a[0].localeCompare(b[0]))]);
  return { market, date, selectedId, issue: target?.issue || '', issueKey, status, providers, records, sourceStates, reviewKey };
}

export function verifyDraws(allByMarket, settings, date, drawIds, decisions = {}, reports = []) {
  const sources = normalizeSources(settings.sources);
  return Object.fromEntries(MARKETS.map(m => {
    const comparison = compareDraws(allByMarket[m] || [], { market: m, date:typeof date==='string'?date:date[m], selectedId: drawIds[m], sourceIds: sources[m], reports });
    const decision = decisions[m];
    const selectedValid = !!comparison.selectedId && comparison.records.some(d => d.id === comparison.selectedId && d.sameDate && !d.excluded);
    const accepted = selectedValid && decision?.reviewKey === comparison.reviewKey && decision?.drawId === comparison.selectedId;
    return [m, { ...comparison, confirmed: selectedValid && (comparison.status === 'consistent' || accepted),
      method: accepted ? 'user' : comparison.status === 'consistent' && selectedValid ? 'agreement' : 'pending',
      decision: accepted ? { drawId: decision.drawId, reviewKey: decision.reviewKey } : null }];
  }));
}

export function requireVerified(result, verification) {
  for (const market of new Set(result.entries.map(e => e.market))) {
    if (!verification?.[market]?.confirmed) throw new Error(`${market}市场开奖尚未完成多站核对，请核对来源列表并明确采用一个结果`);
  }
}
