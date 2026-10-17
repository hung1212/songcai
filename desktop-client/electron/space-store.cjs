const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {LedgerStore} = require('./ledger-store.cjs');

const DEFAULT_SPACE = 'default';
const emptyProject = () => ({schemaVersion:1,activeId:'',documents:[],storageRevision:0});

// Keep the legacy space at its original path. New spaces get their own existing
// store implementations, so a whole-ledger save cannot erase another space.
class SpaceStore {
  constructor(directory,core) {
    this.directory=directory;this.core=core;this.ledgers=new Map();
    fs.mkdirSync(directory,{recursive:true});
    const registry=path.join(directory,'spaces.sqlite');
    if(!fs.existsSync(registry))this.backupLegacy();
    this.db=new DatabaseSync(registry);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO spaces VALUES(?,?,0,?)').run(DEFAULT_SPACE,'默认空间',new Date().toISOString());
    this.db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run('active',DEFAULT_SPACE);
  }
  backupLegacy() {
    const files=['ledger.sqlite','settlement.sqlite','ai-review.sqlite','wechat-inbox/inbox.sqlite'];
    const existing=files.filter(file=>fs.existsSync(path.join(this.directory,file)));
    if(!existing.length)return;
    const target=path.join(this.directory,'space-upgrade-backup');fs.mkdirSync(target,{recursive:true});
    for(const file of existing){
      const output=path.join(target,file.replaceAll('/','-'));
      if(fs.existsSync(output))continue;
      const source=new DatabaseSync(path.join(this.directory,file),{readOnly:true});
      const temp=output+'.tmp';
      try {fs.rmSync(temp,{force:true});source.exec(`VACUUM INTO '${temp.replaceAll("'","''")}'`);fs.renameSync(temp,output);}
      finally {source.close();}
    }
  }
  get(id=DEFAULT_SPACE,{write=false}={}) {
    if(typeof id!=='string')throw new Error('空间标识无效');
    const row=this.db.prepare('SELECT * FROM spaces WHERE id=?').get(id);
    if(!row)throw new Error('空间不存在');
    if(write&&row.archived)throw new Error('空间已归档，请先恢复后再操作');
    return {id:row.id,name:row.name,archived:!!row.archived,createdAt:row.created_at};
  }
  dataDirectory(id=DEFAULT_SPACE){this.get(id);return id===DEFAULT_SPACE?this.directory:path.join(this.directory,'spaces',id);}
  ledger(id=DEFAULT_SPACE){
    const directory=this.dataDirectory(id);
    if(!this.ledgers.has(id))this.ledgers.set(id,new LedgerStore(directory,this.core));
    return this.ledgers.get(id);
  }
  project(id=DEFAULT_SPACE){const store=this.ledger(id);return store.read()||{...emptyProject(),storageRevision:Number(store.meta('revision')||0)};}
  list(){
    const activeId=this.db.prepare('SELECT value FROM meta WHERE key=?').get('active')?.value||DEFAULT_SPACE;
    return {activeId,spaces:this.db.prepare('SELECT id FROM spaces ORDER BY created_at,id').all().map(({id})=>{
      const space=this.get(id),store=this.ledger(id);store.migrate();
      return {...space,count:store.db.prepare('SELECT COUNT(*) AS n FROM ledger_documents').get().n};
    })};
  }
  name(value){const name=typeof value==='string'?value.trim():'';if(!name||name.length>60)throw new Error('空间名称请输入1至60个字');return name;}
  uniqueName(name,id=''){if(this.db.prepare('SELECT id FROM spaces WHERE name=? AND id<>?').get(name,id))throw new Error('空间名称已存在，请换一个名称或打开已有空间');}
  create({name,copyFrom,copyNames=false,businessDate}={},initialize=()=>{}){
    name=this.name(name);this.uniqueName(name);
    if(this.db.prepare('SELECT COUNT(*) AS n FROM spaces').get().n>=100)throw new Error('最多创建100个空间');
    const source=copyFrom?this.project(copyFrom):null;
    if(copyNames&&!source)throw new Error('请选择要复制名单的空间');
    if(copyNames&&!/^\d{4}-\d{2}-\d{2}$/.test(businessDate||''))throw new Error('请选择新账目的业务日期');
    const id=randomUUID(),documents=copyNames?source.documents.map(d=>({id:randomUUID(),name:d.name,text:'',businessDate,defaultPlayer:d.defaultPlayer,autoTitle:false,parserVersion:d.parserVersion})):[];
    this.db.prepare('INSERT INTO spaces VALUES(?,?,0,?)').run(id,name,new Date().toISOString());
    try {this.ledger(id).write({...emptyProject(),documents,activeId:documents[0]?.id||''});initialize(this.dataDirectory(id));}
    catch(error){this.db.prepare('DELETE FROM spaces WHERE id=?').run(id);this.ledgers.get(id)?.close();this.ledgers.delete(id);fs.rmSync(path.join(this.directory,'spaces',id),{recursive:true,force:true});throw error;}
    return this.get(id);
  }
  activate(id){this.get(id,{write:true});this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('active',id);return this.list();}
  rename({id,name}){this.get(id);name=this.name(name);this.uniqueName(name,id);this.db.prepare('UPDATE spaces SET name=? WHERE id=?').run(name,id);return this.list();}
  archive({id,archived}){
    this.get(id);if(typeof archived!=='boolean')throw new Error('归档状态无效');
    if(archived&&this.db.prepare('SELECT COUNT(*) AS n FROM spaces WHERE archived=0 AND id<>?').get(id).n===0)throw new Error('至少保留一个使用中的空间');
    this.db.prepare('UPDATE spaces SET archived=? WHERE id=?').run(archived?1:0,id);
    if(archived&&this.list().activeId===id){const next=this.db.prepare('SELECT id FROM spaces WHERE archived=0 ORDER BY created_at LIMIT 1').get();this.activate(next.id);}
    return this.list();
  }
  close(){for(const store of this.ledgers.values())store.close();this.db.close();}
}
module.exports={SpaceStore,DEFAULT_SPACE,emptyProject,openSpaces:async directory=>new SpaceStore(directory,await import('../src/core/ledger.js'))};
