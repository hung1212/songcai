const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

class LedgerStore {
  constructor(directory, core) {
    fs.mkdirSync(directory, { recursive: true });
    this.directory = directory; this.core = core;
    this.db = new DatabaseSync(path.join(directory, 'ledger.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS ledger_documents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, original_text TEXT NOT NULL,
        business_date TEXT NOT NULL, default_player TEXT NOT NULL, auto_title INTEGER NOT NULL,
        position INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    if(!this.db.prepare('PRAGMA table_info(ledger_documents)').all().some(c=>c.name==='assistance'))this.db.exec("ALTER TABLE ledger_documents ADD COLUMN assistance TEXT NOT NULL DEFAULT 'null'");
    for(const [name,definition] of [['parser_version',"TEXT NOT NULL DEFAULT ''"],['parser_review',"TEXT NOT NULL DEFAULT 'null'"]])if(!this.db.prepare('PRAGMA table_info(ledger_documents)').all().some(c=>c.name===name))this.db.exec(`ALTER TABLE ledger_documents ADD COLUMN ${name} ${definition}`);
  }
  meta(key) { return this.db.prepare('SELECT value FROM ledger_meta WHERE key = ?').get(key)?.value; }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO ledger_meta VALUES (?, ?)').run(key, String(value)); }
  migrate() {
    if (this.meta('legacy-migrated')) return;
    const filename = path.join(this.directory, 'draft.json');
    if (fs.existsSync(filename)) {
      let project;
      try { project = this.core.upgradeProject(this.core.validateProject(JSON.parse(fs.readFileSync(filename, 'utf8')))); }
      catch { throw new Error('旧版草稿无法迁移，原文件已保留。请先通过导入账单恢复有效备份。'); }
      // Old versions allowed duplicate filenames. Preserve all of that history
      // during the one-time migration; future same-title saves do overwrite.
      const titles = new Set();
      for (const doc of project.documents) {
        const base = this.core.ledgerTitle(doc); let title = base, suffix = 2;
        while (titles.has(title)) title = `${base.slice(0, 180)}（迁移${suffix++}）`;
        if (title !== base) doc.autoTitle = false;
        doc.name = title; titles.add(title);
      }
      this.write({ ...this.core.upgradeProject(project), storageRevision: 0 }, true);
    } else this.setMeta('legacy-migrated', '1');
  }
  read() {
    this.migrate();
    const documents = this.db.prepare('SELECT * FROM ledger_documents ORDER BY position').all().map(row => ({
      id: row.id, name: row.title, text: row.original_text, businessDate: row.business_date,
      defaultPlayer: row.default_player, autoTitle: !!row.auto_title, parserVersion:row.parser_version, ...(JSON.parse(row.parser_review||'null')?{parserReview:JSON.parse(row.parser_review)}:{}), ...(JSON.parse(row.assistance||'null')?{assistance:JSON.parse(row.assistance)}:{}),
    }));
    if(!documents.length)return null;
    const saved={schemaVersion:1,activeId:this.meta('active-id'),documents,storageRevision:Number(this.meta('revision')||0)};
    const upgraded=this.core.upgradeProject(saved);
    return upgraded===saved?saved:this.write(upgraded);
  }
  write(input, migration = false, clearBackup) {
    if (!migration) this.migrate();
    if (JSON.stringify(input).length > 20_000_000) throw new Error('账目过大，暂不能保存');
    const project = this.core.canonicalLedger(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = Number(this.meta('revision') || 0);
      if (input.storageRevision !== current) throw new Error('账目已在其他窗口更新，已阻止覆盖；请保留当前原文副本');
      this.db.exec('DELETE FROM ledger_documents');
      const insert = this.db.prepare('INSERT INTO ledger_documents (id,title,original_text,business_date,default_player,auto_title,position,updated_at,assistance,parser_version,parser_review) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const now = new Date().toISOString();
      project.documents.forEach((doc, i) => insert.run(doc.id, doc.name, doc.text, doc.businessDate, doc.defaultPlayer, doc.autoTitle ? 1 : 0, i, now, JSON.stringify(doc.assistance||null),doc.parserVersion,JSON.stringify(doc.parserReview||null)));
      this.setMeta('active-id', project.activeId); this.setMeta('revision', current + 1);
      this.setMeta('legacy-migrated', '1');
      if(clearBackup!==undefined){
        if(clearBackup===null)this.db.prepare('DELETE FROM ledger_meta WHERE key=?').run('clear-backup');
        else this.setMeta('clear-backup',JSON.stringify(clearBackup));
      }
      this.db.exec('COMMIT');
      return { ...project, storageRevision: current + 1 };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  clearState() {
    const backup=JSON.parse(this.meta('clear-backup')||'null');
    return backup?{createdAt:backup.createdAt,count:backup.project.documents.length,clearedKey:backup.clearedKey}:null;
  }
  clearContents({storageRevision}) {
    const project=this.read();
    if(!project)throw new Error('没有可清空的账目');
    if(project.storageRevision!==storageRevision)throw new Error('账目已发生变化，请刷新后再清空');
    if(!project.documents.some(d=>d.text||d.assistance||d.parserReview))throw new Error('所有账目已经为空');
    const cleared=this.core.clearLedgerContents(project);
    const backup={createdAt:new Date().toISOString(),project,clearedKey:this.core.ledgerParseKey(cleared.documents)};
    const saved=this.write({...cleared,storageRevision},false,backup);
    return {project:saved,backup:this.clearState()};
  }
  restoreContents({storageRevision}) {
    const backup=JSON.parse(this.meta('clear-backup')||'null'),current=this.read();
    if(!backup)throw new Error('没有可撤销的清空记录');
    if(current?.storageRevision!==storageRevision||this.core.ledgerParseKey(current.documents)!==backup.clearedKey)throw new Error('清空后已有新内容或账目变动，为避免覆盖，请先导出当前账目');
    const saved=this.write({...backup.project,activeId:current.activeId,storageRevision},false,null);
    return {project:saved,backup:null};
  }
  close() { this.db.close(); }
}
module.exports = async directory => new LedgerStore(directory, await import('../src/core/ledger.js'));
module.exports.LedgerStore = LedgerStore;
