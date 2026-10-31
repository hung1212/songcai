const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
class TransferStore {
  constructor(directory,validate){this.validate=validate;fs.mkdirSync(directory,{recursive:true});this.db=new DatabaseSync(path.join(directory,'transfers.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,date TEXT NOT NULL,market TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS batch_scope ON batches(date,market);`);}
  list({date,market}){return this.db.prepare('SELECT payload FROM batches WHERE date=? AND market=? ORDER BY created_at DESC,id DESC').all(date,market).map(r=>JSON.parse(r.payload));}
  add(input){const value=this.validate(input),old=this.db.prepare('SELECT payload FROM batches WHERE id=?').get(value.id);
    if(old){const record=JSON.parse(old.payload);if(JSON.stringify(this.validate(record))!==JSON.stringify(value))throw new Error('批次编号已存在，内容不同，请重新加载');return record;}
    const record={...value,createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO batches VALUES(?,?,?,?,?)').run(record.id,record.date,record.market,record.createdAt,JSON.stringify(record));return record;}
  void({id,reason}){if(typeof reason!=='string'||!reason.trim()||reason.length>500)throw new Error('请填写作废原因（仅更正记录，不撤回实际转出）');const row=this.db.prepare('SELECT payload FROM batches WHERE id=?').get(id);if(!row)throw new Error('转出记录不存在');const r=JSON.parse(row.payload);if(r.voidedAt)return r;r.voidedAt=new Date().toISOString();r.voidReason=reason.trim();this.db.prepare('UPDATE batches SET payload=? WHERE id=?').run(JSON.stringify(r),id);return r;}
  delete({id,date,market}){
    if(typeof id!=='string'||!id||typeof date!=='string'||!['新','旧','港'].includes(market))throw new Error('请选择要删除的转出记录');
    const row=this.db.prepare('SELECT date,market FROM batches WHERE id=?').get(id);
    if(row&&(row.date!==date||row.market!==market))throw new Error('记录日期或市场不匹配，请重新加载');
    const result=this.db.prepare('DELETE FROM batches WHERE id=? AND date=? AND market=?').run(id,date,market);
    return {deleted:result.changes>0};
  }
  close(){this.db.close();}
}
module.exports={TransferStore};
