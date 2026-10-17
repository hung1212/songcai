const {DatabaseSync} = require('node:sqlite');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Separate from ledger.sqlite: failed writes never replace the live accounts.
// One snapshot per session/space keeps the latest unsaved input without creating
// a new recovery entry for every keystroke. Previous sessions remain untouched.
class DraftRecovery {
  constructor(directory, core, session = randomUUID()) {
    fs.mkdirSync(directory,{recursive:true});
    this.core=core;this.session=session;
    this.db=new DatabaseSync(path.join(directory,'draft-recovery.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,session TEXT NOT NULL,space_id TEXT NOT NULL,
        space_name TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(session,space_id));`);
  }
  save(space, input) {
    const serialized=JSON.stringify(input);
    if(serialized.length>20_000_000)throw new Error('原文副本超过20MB，请先导出备份');
    // Validate without canonicalizing: even same-title documents must survive.
    const project={...this.core.validateProject(input),storageRevision:input.storageRevision||0};
    const id=this.db.prepare('SELECT id FROM drafts WHERE session=? AND space_id=?').get(this.session,space.id)?.id||randomUUID();
    this.db.prepare('INSERT OR REPLACE INTO drafts VALUES(?,?,?,?,?,?)').run(id,this.session,space.id,space.name,JSON.stringify(project),new Date().toISOString());
    return {id,spaceName:space.name,count:project.documents.length};
  }
  list() {
    return this.db.prepare('SELECT id,space_name AS spaceName,updated_at AS updatedAt,payload FROM drafts ORDER BY updated_at DESC').all()
      .map(({payload,...row})=>({...row,count:JSON.parse(payload).documents.length}));
  }
  hasCurrent(id) {return !!this.db.prepare('SELECT id FROM drafts WHERE id=? AND session=?').get(id,this.session);}
  saved(spaceId) {this.db.prepare('DELETE FROM drafts WHERE session=? AND space_id=?').run(this.session,spaceId);}
  restore(id,spaces) {
    const row=this.db.prepare('SELECT * FROM drafts WHERE id=?').get(id);
    if(!row)throw new Error('原文副本不存在或已经恢复');
    const input=this.core.validateProject(JSON.parse(row.payload));
    // Match the existing migration policy; preserve all originals on collision.
    const titles=new Set();
    for(const doc of input.documents){
      const base=this.core.ledgerTitle(doc);let title=base,index=2;
      while(titles.has(title))title=`${base.slice(0,175)}（恢复${index++}）`;
      doc.name=title;doc.autoTitle=false;titles.add(title);
    }
    const names=new Set(spaces.list().spaces.map(s=>s.name));
    const base=`恢复 · ${row.space_name}`.slice(0,50);let name=base,index=2;
    while(names.has(name))name=`${base}（${index++}）`;
    const target=spaces.create({name});
    const ledger=spaces.ledger(target.id);
    ledger.write({...this.core.upgradeProject(input),storageRevision:Number(ledger.meta('revision')||0)});
    spaces.activate(target.id);
    this.db.prepare('DELETE FROM drafts WHERE id=?').run(id);
    return spaces.list();
  }
  close(){this.db.close();}
}
module.exports={DraftRecovery};
