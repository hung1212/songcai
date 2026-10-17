import {spaceKey} from './space-context.js';
import {STORAGE_KEY} from './project.js';
import {canonicalLedger,clearLedgerContents,ledgerParseKey} from './core/ledger.js';
const KEY='songcai.ledger.clear-backup.v1';
export function clearPreviewState(spaceId='default'){const b=JSON.parse(localStorage.getItem(spaceKey(KEY,spaceId))||'null');return b?{createdAt:b.createdAt,count:b.project.documents.length,clearedKey:b.clearedKey}:null;}
export function clearPreviewContents(project,spaceId='default'){
  const saved=canonicalLedger(project),cleared=clearLedgerContents(saved);
  if(!saved.documents.some(d=>d.text||d.assistance||d.parserReview))throw new Error('所有账目已经为空');
  const backup={project:saved,createdAt:new Date().toISOString(),clearedKey:ledgerParseKey(cleared.documents)};
  // Write the recovery copy first: quota errors cannot erase the originals.
  localStorage.setItem(spaceKey(KEY,spaceId),JSON.stringify(backup));localStorage.setItem(spaceKey(STORAGE_KEY,spaceId),JSON.stringify(cleared));
  return {project:cleared,backup:clearPreviewState(spaceId)};
}
export function restorePreviewContents(project,spaceId='default'){
  const backup=JSON.parse(localStorage.getItem(spaceKey(KEY,spaceId))||'null');
  if(!backup||ledgerParseKey(project.documents)!==backup.clearedKey)throw new Error('清空后已有新内容或账目变动，不能覆盖恢复');
  const restored={...backup.project,activeId:project.activeId};localStorage.setItem(spaceKey(STORAGE_KEY,spaceId),JSON.stringify(restored));localStorage.removeItem(spaceKey(KEY,spaceId));
  return {project:restored,backup:null};
}
