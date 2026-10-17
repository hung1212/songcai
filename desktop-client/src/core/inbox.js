import { parseDocument, summarize } from './parser.js';
import { validateAssistance } from './semantic-rules.js';
import { ruleForDate } from './rules.js';

export const INBOX_VERSION = 1;
export const MAX_TEXT = 500_000;
export const REVIEW_DEFAULTS = { source: false, content: false, range: false, duplicates: false, warnings: false };
export { summarize };
export function validateFields(input) {
  const text = String(input.text ?? '');
  if (text.length > MAX_TEXT) throw new Error('一份记录最多50万字，请拆分资料');
  const player = String(input.player ?? '').trim();
  if (player.length > 80) throw new Error('玩家名称最多80字');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate || '')) throw new Error('请选择有效业务日期');
  ruleForDate(input.businessDate);
  return { text, player, businessDate: input.businessDate, name: String(input.name || '微信记录').slice(0, 160),
    source: String(input.source || '').slice(0, 200), multiplePlayers: input.multiplePlayers === true, ...(input.assistance ? {assistance:validateAssistance(input.assistance)} : {}) };
}

export function createBatch(input, id, now = new Date().toISOString()) {
  const fields = validateFields(input);
  return { schemaVersion: INBOX_VERSION, id, revision: 1, ...fields, originalText: fields.text,
    kind: ['text', 'image', 'favorite'].includes(input.kind) ? input.kind : 'text', state: 'draft', busy: false,
    createdAt: now, updatedAt: now, review: { ...REVIEW_DEFAULTS }, assets: [], pages: [],
    capture: null, problems: [], result: null, confirmedAt: null };
}

export function updateBatch(batch, patch) {
  if (batch.state !== 'draft' || batch.busy) throw new Error('已入账或采集中的记录不能修改');
  const fields = validateFields({ ...batch, ...patch });
  const changed = Object.keys(fields).some(key => JSON.stringify(fields[key]) !== JSON.stringify(batch[key]));
  const review = Object.fromEntries(Object.keys(REVIEW_DEFAULTS).map(key => [key, patch.review?.[key] === true]));
  // A text/player/date edit always invalidates previous acknowledgements.
  return { ...batch, ...fields, review: changed ? { ...REVIEW_DEFAULTS } : review,
    revision: batch.revision + 1, updatedAt: new Date().toISOString() };
}

export function inspectBatch(batch, duplicates = []) {
  let result, summary;
  const blockers = [];
  try {
    result = parseDocument(batch.text, { id: batch.id, name: batch.name, businessDate: batch.businessDate, defaultPlayer: batch.player, assistance:batch.assistance });
    summary = summarize([result]);
  } catch (error) { blockers.push(error.message); }
  if (batch.busy) blockers.push('正在采集或识别，请等待完成或停止');
  if (!batch.text.trim() || !result?.bets.length) blockers.push('没有可入账投注，请补充或校正文字');
  if (result?.issues.some(issue => issue.severity !== 'warning') || result?.bets.some(bet => bet.status !== 'parsed')) blockers.push('仍有解析错误或待确认投注');
  if (batch.player && !batch.multiplePlayers && result?.bets.some(bet => bet.player !== batch.player)) blockers.push('原文署名与绑定玩家不同，请修正或启用多玩家署名');
  if (/取消|作废|撤回|改成|改为|不要了/.test(batch.text)) blockers.push('含取消／修改指令，请先人工处理并在识别文本中明确最终投注');
  if (!batch.review.source) blockers.push('请核对玩家、业务日期与市场起点');
  if ((batch.kind !== 'text' || batch.assets.length > 0) && !batch.review.content) blockers.push('请对照原图／原页核对金额、号码、顺序和附件');
  if (batch.kind === 'favorite' && !batch.review.range) blockers.push('请确认这份收藏的读取范围完整；缺页时继续补充');
  if (duplicates.length && !batch.review.duplicates) blockers.push('发现相似来源，请核对是否为另一笔真实记录');
  if ((result?.issues.some(issue => issue.severity === 'warning') || batch.problems.length) && !batch.review.warnings) blockers.push('请核对解析提醒和采集提示');
  return { result, summary: summary || summarize([]), blockers, duplicates, eligible: batch.state === 'draft' && blockers.length === 0 };
}

export function duplicateCandidates(batch, others) {
  const originalHashes = new Set(batch.assets.map(asset => asset.sha256).filter(Boolean));
  return others.filter(other => other.id !== batch.id && other.state !== 'skipped' && other.player === batch.player && other.businessDate === batch.businessDate
    && ((batch.text.trim() && other.text.trim() === batch.text.trim()) || other.assets.some(asset => originalHashes.has(asset.sha256))))
    .map(other => ({ id: other.id, name: other.name, state: other.state, createdAt: other.createdAt }));
}

// This is only a suggested transcript. Original page OCR and screenshots remain
// immutable, and every captured batch requires explicit cross-page review.
export function stitchPages(pages) {
  let lines = [], overlaps = [], problems = [];
  for (let page = 0; page < pages.length; page++) {
    const next = pages[page].text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!next.length) { problems.push(`第${page + 1}页未识别到文字，请查看原图`); continue; }
    let overlap = 0;
    if (lines.length) {
      const candidates = [];
      for (let size = 2; size <= Math.min(lines.length, next.length); size++) {
        const tail = lines.slice(-size).join('\n');
        if (tail.length >= 12 && tail === next.slice(0, size).join('\n')) candidates.push(size);
      }
      if (candidates.length === 1 && candidates[0] < next.length) overlap = candidates[0];
      else problems.push(`第${page + 1}页的跨页衔接不确定，已保留文字，请核对重叠或缺口`);
    }
    if (overlap) overlaps.push({ page: page + 1, lines: overlap });
    lines.push(...next.slice(overlap));
  }
  if (overlaps.length) problems.push('已建议合并跨页重叠文字，请对照逐页原文核对；相同真实投注不能删去');
  return { text: lines.join('\n'), overlaps, problems };
}
