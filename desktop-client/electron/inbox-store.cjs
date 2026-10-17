const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

class InboxStore {
  constructor(directory, core) {
    this.directory = directory;
    this.core = core;
    fs.mkdirSync(path.join(directory, 'attachments'), { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'inbox.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, business_date TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS batches_date ON batches(business_date, state, created_at);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, sha256 TEXT NOT NULL, file TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mappings (source TEXT PRIMARY KEY, player TEXT NOT NULL);`);
  }
  save(batch) {
    this.db.prepare('INSERT OR REPLACE INTO batches VALUES (?, ?, ?, ?, ?, ?)').run(batch.id, batch.revision, batch.state, batch.businessDate, batch.createdAt, JSON.stringify(batch));
    return batch;
  }
  get(id) {
    const row = this.db.prepare('SELECT payload FROM batches WHERE id = ?').get(id);
    if (!row) throw new Error('记录不存在');
    return JSON.parse(row.payload);
  }
  all(date = '') {
    const rows = date ? this.db.prepare('SELECT payload FROM batches WHERE business_date = ? ORDER BY created_at DESC, id').all(date)
      : this.db.prepare('SELECT payload FROM batches ORDER BY created_at DESC, id').all();
    return rows.map(row => JSON.parse(row.payload));
  }
  create(fields) { return this.save(this.core.createBatch(fields, randomUUID())); }
  detail(id) {
    const batch = this.get(id);
    return { batch, analysis: batch.state === 'posted' ? { result: batch.result, summary: this.core.summarize([batch.result]), eligible: false, blockers: [], duplicates: [] }
      : this.core.inspectBatch(batch, this.core.duplicateCandidates(batch, this.all(batch.businessDate))) };
  }
  list({ businessDate = '', state = '', page = 1, search = '' } = {}) {
    const all = this.all(businessDate);
    const matched = all.filter(batch => (!state || batch.state === state) && (!search || `${batch.name} ${batch.player} ${batch.source} ${batch.text}`.includes(search)));
    const currentPage = Math.max(1, Math.min(Math.ceil(matched.length / 40) || 1, Number(page) || 1));
    return { total: matched.length, page: currentPage, pages: Math.max(1, Math.ceil(matched.length / 40)),
      items: matched.slice((currentPage - 1) * 40, currentPage * 40).map(batch => ({ id: batch.id, revision: batch.revision, name: batch.name, player: batch.player, businessDate: batch.businessDate,
        source: batch.source, state: batch.state, busy: batch.busy, kind: batch.kind, pages: batch.pages.length, images: batch.assets.length, createdAt: batch.createdAt, preview: batch.text.slice(0, 100), totalCents: batch.result?.bets.reduce((n, bet) => n + bet.totalCents, 0) || 0 })),
      pending: all.filter(batch => batch.state === 'draft').length, posted: all.filter(batch => batch.state === 'posted').length,
      summary: this.core.summarize(all.filter(batch => batch.state === 'posted').map(batch => batch.result)),
      mappings: this.db.prepare('SELECT source, player FROM mappings ORDER BY source').all() };
  }
  update(id, revision, patch) {
    const batch = this.get(id);
    if (batch.revision !== revision) throw new Error('记录已有更新，请重新打开后再修改');
    const next = this.save(this.core.updateBatch(batch, patch));
    if (next.review.source && next.source && next.player && !next.multiplePlayers) this.db.prepare('INSERT OR REPLACE INTO mappings VALUES (?, ?)').run(next.source, next.player);
    return this.detail(id);
  }
  confirm(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 100) throw new Error('每批请选择1～100份记录');
    const outcome = { posted: [], already: [], rejected: [] };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const { id, revision } of entries) {
        const batch = this.get(id);
        if (batch.state === 'posted') { outcome.already.push(id); continue; }
        if (batch.revision !== revision) { outcome.rejected.push({ id, reason: '记录已改变，请重新核对' }); continue; }
        const check = this.core.inspectBatch(batch, this.core.duplicateCandidates(batch, this.all(batch.businessDate)));
        if (!check.eligible) { outcome.rejected.push({ id, reason: check.blockers.join('；') || '记录不可入账' }); continue; }
        this.core.summarize([...this.all().filter(item => item.state === 'posted').map(item => item.result), check.result]);
        batch.state = 'posted'; batch.result = check.result; batch.confirmedAt = new Date().toISOString(); batch.revision++;
        this.save(batch); outcome.posted.push(id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return outcome;
  }
  skip(id, revision) {
    const batch = this.get(id);
    if (batch.busy || batch.state === 'posted' || batch.revision !== revision) throw new Error('记录正在采集、已经入账或已更新，不能跳过');
    batch.state = batch.state === 'skipped' ? 'draft' : 'skipped'; batch.revision++;
    return this.save(batch);
  }
  addAsset(batchId, bytes, name, dimensions) {
    const batch = this.get(batchId);
    if (batch.state !== 'draft') throw new Error('已入账记录不能添加图片');
    if (batch.assets.length >= 100 || bytes.length > 25_000_000) throw new Error('单份最多100张图片，每张最多25MB');
    const id = randomUUID(), file = id + '.png', sha256 = createHash('sha256').update(bytes).digest('hex');
    const temporary = path.join(this.directory, 'attachments', file + '.tmp');
    fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, path.join(this.directory, 'attachments', file));
    this.db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(id, batchId, sha256, file);
    const asset = { id, sha256, name: name.slice(0, 160), ...dimensions };
    batch.assets.push(asset); batch.review = { ...this.core.REVIEW_DEFAULTS }; batch.revision++;
    this.save(batch);
    return asset;
  }
  assetPath(id) {
    const row = this.db.prepare('SELECT file FROM assets WHERE id = ?').get(id);
    if (!row || !/^[a-f0-9-]+\.png$/.test(row.file)) throw new Error('附件不存在');
    return path.join(this.directory, 'attachments', row.file);
  }
  recover() {
    for (const batch of this.all()) if (batch.busy) {
      batch.busy = false; batch.revision++; batch.problems.push('上次采集被中断；已保存原页，请核对完整性');
      if (batch.capture) batch.capture.status = 'interrupted';
      this.save(batch);
    }
  }
  backup(date = '') {
    const batches = this.all(date);
    return { format: 'songcai-inbox-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), batches,
      assets: batches.flatMap(batch => batch.assets.map(asset => ({ id: asset.id, data: fs.readFileSync(this.assetPath(asset.id)).toString('base64') }))) };
  }
  restore(value) {
    if (value?.format !== 'songcai-inbox-backup' || value.schemaVersion !== 1 || !Array.isArray(value.batches) || !Array.isArray(value.assets) || value.batches.length > 10_000) throw new Error('不是有效的收件箱备份（每次最多一万份）');
    const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
    const encoded = new Map();
    for (const asset of value.assets) {
      if (!uuid.test(asset.id) || encoded.has(asset.id) || typeof asset.data !== 'string' || asset.data.length > 34_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) throw new Error('备份附件无效或重复');
      encoded.set(asset.id, asset.data);
    }
    const ids = new Set(), existing = new Map(this.all().map(batch => [batch.id, batch]));
    const staged = [], skipped = [], conflicts = [];
    for (const input of value.batches) {
      if (!uuid.test(input.id) || ids.has(input.id) || input.schemaVersion !== 1 || !Array.isArray(input.assets) || input.assets.length > 100 || !Array.isArray(input.pages) || input.pages.length > 100) throw new Error('备份记录结构无效');
      ids.add(input.id);
      if (existing.has(input.id)) {
        const old = existing.get(input.id);
        (old.text !== input.text || old.player !== input.player || old.businessDate !== input.businessDate || old.state !== input.state ? conflicts : skipped).push(input.id);
        continue;
      }
      const batch = this.core.createBatch(input, input.id, typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString());
      batch.originalText = typeof input.originalText === 'string' ? input.originalText.slice(0, this.core.MAX_TEXT) : '';
      batch.problems = Array.isArray(input.problems) ? input.problems.slice(0, 300).map(text => String(text).slice(0, 2000)) : [];
      batch.capture = input.capture || null;
      batch.review = Object.fromEntries(Object.keys(this.core.REVIEW_DEFAULTS).map(key => [key, input.review?.[key] === true]));
      const assets = [], seenAssets = new Set();
      for (const item of input.assets) {
        if (!uuid.test(item.id) || seenAssets.has(item.id) || !encoded.has(item.id)) throw new Error('备份缺少原图，未恢复任何新记录');
        seenAssets.add(item.id);
        const bytes = Buffer.from(encoded.get(item.id), 'base64');
        if (bytes.length > 25_000_000 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('备份原图不是有效 PNG 或过大');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (item.sha256 && item.sha256 !== sha256) throw new Error('备份图片校验不一致，未恢复任何新记录');
        if (this.db.prepare('SELECT id FROM assets WHERE id = ?').get(item.id)) throw new Error('备份附件 ID 与已有数据冲突');
        const metadata = { id: item.id, name: String(item.name || '原图').slice(0, 160), sha256 };
        assets.push({ ...metadata, bytes }); batch.assets.push(metadata);
      }
      batch.pages = input.pages.map(page => {
        if (!seenAssets.has(page.assetId) || typeof page.text !== 'string' || page.text.length > this.core.MAX_TEXT) throw new Error('备份页面引用无效');
        if (page.rawText !== undefined && (typeof page.rawText !== 'string' || page.rawText.length > this.core.MAX_TEXT)) throw new Error('备份原始 OCR 无效');
        const spacingChanges = (Array.isArray(page.spacingChanges) ? page.spacingChanges : []).slice(0, 10000).map(change => {
          if (!Number.isInteger(change.line) || change.line < 1 || typeof change.original !== 'string' || typeof change.restored !== 'string'
              || !/^\d+$/.test(change.original) || !/^[\d ]+$/.test(change.restored) || change.restored.replace(/ /g, '') !== change.original || change.restored.length > this.core.MAX_TEXT) throw new Error('备份空格恢复记录无效');
          return { line: change.line, original: change.original, restored: change.restored };
        });
        return { assetId: page.assetId, text: page.text, rawText: page.rawText ?? page.text, spacingChanges,
          lowConfidenceLines: (Array.isArray(page.lowConfidenceLines) ? page.lowConfidenceLines : []).filter(n => Number.isInteger(n) && n > 0).slice(0, 10000),
          engine: String(page.engine || ''), capturedAt: String(page.capturedAt || ''), lines: [] };
      });
      const check = this.core.inspectBatch(batch);
      if (input.state === 'posted' && check.eligible && JSON.stringify(input.result?.bets) === JSON.stringify(check.result.bets)) {
        batch.state = 'posted'; batch.result = check.result; batch.confirmedAt = String(input.confirmedAt || '从备份恢复');
      } else if (input.state === 'posted') { batch.problems.push('备份原入账结果与当前规则或核对状态不同，已恢复为待核对，不自动计入账目'); batch.review = { ...this.core.REVIEW_DEFAULTS }; }
      else if (input.state === 'skipped') batch.state = 'skipped';
      if (input.busy) { batch.problems.push('备份中的采集尚未结束，请核对完整性'); batch.review = { ...this.core.REVIEW_DEFAULTS }; }
      staged.push({ batch, assets });
    }
    this.core.summarize([...existing.values(), ...staged.map(item => item.batch)].filter(batch => batch.state === 'posted').map(batch => batch.result));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const { batch, assets } of staged) {
        for (const asset of assets) {
          const file = asset.id + '.png'; fs.writeFileSync(path.join(this.directory, 'attachments', file), asset.bytes);
          this.db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?)').run(asset.id, batch.id, asset.sha256, file);
        }
        this.save(batch);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { restored: staged.length, skipped: skipped.length, conflicts: conflicts.length };
  }
  close() { this.db.close(); }
}
module.exports = { InboxStore };
