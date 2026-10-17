import {ledgerTitle} from './ledger.js';
export const WORKSPACE_KEY = 'songcai-workspace-v1';
const titleSegments = new Intl.Segmenter('zh-CN',{granularity:'grapheme'});

export function workspacePreferences(value = {}) {
  const bounded = (v, fallback, min, max) => Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  return { sidebarWidth: bounded(value?.sidebarWidth, 260, 220, 360), fontSize: bounded(value?.fontSize, 15, 14, 18),
    wrap: value?.wrap !== false, focused: value?.focused !== false,
    ledgerSort: ['manual','profit-desc'].includes(value?.ledgerSort) ? value.ledgerSort : 'stake-desc' };
}

// Sorting is a display preference; keep the saved drag order intact.
export function sortLedgers(documents, amounts, mode = 'stake-desc', balances = {}) {
  if (mode === 'manual') return documents;
  const amount = doc => mode === 'profit-desc'
    ? balances[doc.id]?.status !== 'empty' && Number.isSafeInteger(balances[doc.id]?.netCents) ? balances[doc.id].netCents : null
    : Number.isSafeInteger(amounts[doc.id]) ? amounts[doc.id] : null;
  const lengths=new Map(documents.map(doc=>[doc.id,[...titleSegments.segment(ledgerTitle({...doc,name:doc.name||'',text:doc.text||''}))].length]));
  return [...documents].sort((a, b) => {
    const left = amount(a), right = amount(b);
    return (left === null && right !== null ? 1 : right === null && left !== null ? -1 : left === null ? 0 : right - left)
      || lengths.get(b.id) - lengths.get(a.id);
  });
}

// Preserve source lines even when a highlighted token spans several lines.
export function highlightRows(tokens) {
  const rows = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((text, i) => {
      if (i) rows.push([]);
      if (text) rows.at(-1).push({ ...token, text });
    });
  }
  return rows;
}

export function editorPosition(saved, text) {
  if (!saved || saved.text !== text) return { start: 0, end: 0, direction: 'none', top: 0, left: 0 };
  const start = Math.min(text.length, Math.max(0, saved.start || 0));
  return { start, end: Math.min(text.length, Math.max(start, saved.end || 0)),
    direction: ['forward', 'backward', 'none'].includes(saved.direction) ? saved.direction : 'none',
    top: Math.max(0, saved.top || 0), left: Math.max(0, saved.left || 0) };
}
