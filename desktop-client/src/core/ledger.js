import { validateAssistance } from './semantic-rules.js';
import { senderHeader, PARSER_VERSION } from './business-syntax.js';
import { validateParserReview } from './parser-upgrade.js';
export { upgradeProject } from './parser-upgrade.js';

export function reorderDocuments(documents, sourceId, targetId, after = false) {
  if(sourceId===targetId || !documents.some(d=>d.id===sourceId) || !documents.some(d=>d.id===targetId)) return documents;
  const result=documents.filter(d=>d.id!==sourceId);
  result.splice(result.findIndex(d=>d.id===targetId)+(after?1:0),0,documents.find(d=>d.id===sourceId));
  return result;
}

export function clearLedgerContents(value) {
  const project=canonicalLedger(value);
  return {...project,documents:project.documents.map(doc=>({
    id:doc.id,name:doc.name,text:'',businessDate:doc.businessDate,defaultPlayer:doc.defaultPlayer,
    autoTitle:false,parserVersion:doc.parserVersion||PARSER_VERSION,
  }))};
}

// Compare persisted values, not object identity or JSON property insertion order.
// A database echo adds default fields and may reorder keys without being an edit.
export function ledgerSnapshotKey(project) {
  return JSON.stringify([project.activeId, project.documents.map(doc => [doc.id, doc.name, doc.text,
    doc.businessDate, doc.defaultPlayer || '', doc.autoTitle === true || !doc.name.trim(), doc.assistance || null,doc.parserReview||null])]);
}
export function ledgerParseKey(documents) {
  return JSON.stringify(documents.map(doc => [doc.id, doc.name, doc.text, doc.businessDate, doc.defaultPlayer || '',doc.assistance||null,doc.parserReview||null]));
}

export function validateProject(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.documents) || value.documents.length > 200) throw new Error('不是有效的松财账单（每空间最多200份原文）');
  const ids = new Set();
  const documents = value.documents.map(doc => {
    if (typeof doc.id !== 'string' || !doc.id || ids.has(doc.id) || typeof doc.name !== 'string' || typeof doc.text !== 'string' || doc.text.length > 5_000_000 || !/^\d{4}-\d{2}-\d{2}$/.test(doc.businessDate)) throw new Error('账单结构或日期无效');
    ids.add(doc.id);
    return { id: doc.id, name: doc.name.slice(0, 200), text: doc.text, businessDate: doc.businessDate,
      defaultPlayer: typeof doc.defaultPlayer === 'string' ? doc.defaultPlayer : '', autoTitle: doc.autoTitle === true || !doc.name.trim(), ...(doc.assistance ? {assistance:validateAssistance(doc.assistance)} : {}), ...(doc.parserVersion?{parserVersion:String(doc.parserVersion)}:{}), ...(doc.parserReview?{parserReview:validateParserReview(doc.parserReview)}:{}) };
  });
  return { schemaVersion: 1, documents, activeId: ids.has(value.activeId) ? value.activeId : documents[0]?.id||'' };
}

export function ledgerTitle(doc) {
  if (!doc.autoTitle && doc.name.trim()) return doc.name.trim();
  for (const line of doc.text.split(/\r\n|\n|\r/)) {
    const header = senderHeader(line,doc.defaultPlayer);
    if (header) return header.name;
    if (line.trim() && doc.defaultPlayer?.trim()) return doc.defaultPlayer.trim().slice(0, 200);
  }
  return doc.defaultPlayer?.trim().slice(0, 200) || '未命名账目';
}

// Active input wins a title collision. Other collisions use the last incoming
// document, so importing or saving the same title updates one ledger row.
export function canonicalLedger(value) {
  const project = validateProject(value), byTitle = new Map();
  for (const doc of project.documents) {
    const name = ledgerTitle(doc), existing = byTitle.get(name);
    if (!existing || existing.id !== project.activeId) byTitle.set(name, { ...doc, name, parserVersion:doc.parserVersion||PARSER_VERSION });
  }
  const documents = [...byTitle.values()];
  return { schemaVersion: 1, documents, activeId: documents.some(d => d.id === project.activeId) ? project.activeId : documents[0]?.id||'' };
}
