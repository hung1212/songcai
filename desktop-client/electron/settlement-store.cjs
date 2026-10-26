const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
class SettlementStore {
  constructor(directory, core, draws, reviewSnapshot = null) {
    fs.mkdirSync(directory,{recursive:true}); this.core=core;this.draws=draws;this.reviewSnapshot=reviewSnapshot;
    this.db=new DatabaseSync(path.join(directory,'settlement.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS draws (id TEXT PRIMARY KEY,market TEXT NOT NULL,source_id TEXT NOT NULL,issue TEXT NOT NULL,date TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,observed_at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS draws_date ON draws(market,date);
      CREATE TABLE IF NOT EXISTS draw_fetches (market TEXT NOT NULL,source_id TEXT NOT NULL,year INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(market,source_id,year));
      CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY,date TEXT NOT NULL,input_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,payload TEXT NOT NULL);`);
    if(!this.db.prepare('SELECT id FROM settings').get()) this.db.prepare('INSERT INTO settings VALUES(1,0,?)').run(JSON.stringify({sources:draws.DEFAULT_DRAW_SOURCES,odds:Object.fromEntries(['新','旧','港'].map(m=>[m,core.defaultOdds()]))}));
    const previous=this.settings();
    if(['新','旧','港'].some(m=>!Array.isArray(previous.sources[m]))) {
      previous.sources=draws.normalizeSources(previous.sources,true);
      this.db.prepare('UPDATE settings SET revision=?,payload=? WHERE id=1').run(previous.revision+1,JSON.stringify({sources:previous.sources,odds:previous.odds,rebates:previous.rebates||{},playerOdds:previous.playerOdds||{}}));
    }
  }
  settings() {const row=this.db.prepare('SELECT * FROM settings WHERE id=1').get(),settings={rebates:{},playerOdds:{},...JSON.parse(row.payload),revision:row.revision};settings.odds=Object.fromEntries(Object.entries(settings.odds).map(([m,odds])=>[m,this.core.withOptionalOdds(odds)]));return settings;}
  saveSettings(input) {
    const current=this.settings();if(input.revision!==current.revision)throw new Error('赔率设置已更新，请重新加载再保存');
    const settings={sources:this.draws.normalizeSources(input.sources),odds:{},rebates:this.core.validateRebates(input.rebates??current.rebates),playerOdds:this.core.validatePlayerOdds(input.playerOdds??current.playerOdds)};
    for(const m of ['新','旧','港']) settings.odds[m]=this.core.validateOdds(input.odds?.[m]);
    this.core.validatePlayerOddsSettings(settings.odds,settings.playerOdds);
    this.db.prepare('UPDATE settings SET revision=?,payload=? WHERE id=1').run(current.revision+1,JSON.stringify(settings));return this.settings();
  }
  addDraws(input,now=Date.now()) {
    const records=input.map(item=>this.draws.validateDraw(item,now)); const observedAt=new Date(now).toISOString();
    this.db.exec('BEGIN IMMEDIATE');let added=0;
    try {for(const value of records) {
      const digest=hash(value); if(this.db.prepare('SELECT id FROM draws WHERE hash=?').get(digest))continue;
      const id=randomUUID();this.db.prepare('INSERT INTO draws VALUES(?,?,?,?,?,?,?,?)').run(id,value.market,value.sourceId,value.issue,value.date,digest,observedAt,JSON.stringify(value));added++;
    }this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return {added};
  }
  listDraws(market,year) {
    return this.db.prepare('SELECT * FROM draws WHERE market=? AND date LIKE ? ORDER BY date DESC,observed_at DESC,issue DESC').all(market,year?`${year}-%`:'%').map(row=>({...JSON.parse(row.payload),id:row.id,observedAt:row.observed_at}));
  }
  draw(id) {const row=this.db.prepare('SELECT * FROM draws WHERE id=?').get(id);if(!row)throw new Error('开奖记录不存在');return {...JSON.parse(row.payload),id:row.id,observedAt:row.observed_at};}
  fetchReports(year) {return this.db.prepare('SELECT payload FROM draw_fetches WHERE year=? ORDER BY market,source_id').all(year).map(r=>JSON.parse(r.payload));}
  saveFetchReport(report,year) {
    const value={...report,checkedAt:new Date().toISOString()};
    this.db.prepare('INSERT INTO draw_fetches VALUES(?,?,?,?) ON CONFLICT(market,source_id,year) DO UPDATE SET payload=excluded.payload').run(report.market,report.sourceId,year,JSON.stringify(value));
    return value;
  }
  saveSettlement({documents,draws,settings,date,kind,selection,verification,drawDates,spaceId},expectedHash) {
    const input={...(spaceId?{spaceId}:{}),documents,draws,settings,date,kind,selection,verification,...(drawDates?{drawDates}:{})};const digest=hash(input);
    if(expectedHash!==digest)throw new Error('账目、开奖或赔率已经变化，请重新试算后再保存');
    const result=this.core.settleDocuments(documents,draws,settings.odds,date,{drawDates,rebates:settings.rebates,playerOdds:settings.playerOdds});
    if(!result.complete)throw new Error('仍有未结算或未处理原文，不能保存为完成的赔付记录');
    for(const market of new Set(result.entries.map(e=>e.market)))if(!settings.odds[market].confirmed)throw new Error(`${market}市场赔率与中奖范围尚未确认`);
    for(const market of new Set(result.entries.map(e=>e.market)))if(!verification?.[market]?.confirmed)throw new Error(`${market}市场开奖尚未完成多站核对，请明确采用一个结果`);
    const existing=this.db.prepare('SELECT id FROM settlements WHERE input_hash=?').get(digest);if(existing)return {...this.getSettlement(existing.id),reused:true};
    const snapshot={id:randomUUID(),createdAt:new Date().toISOString(),inputHash:digest,inputs:input,result,paid:false};
    this.db.prepare('INSERT INTO settlements VALUES(?,?,?,?,?)').run(snapshot.id,date,digest,snapshot.createdAt,JSON.stringify(snapshot));return snapshot;
  }
  history(date) {return this.db.prepare('SELECT * FROM settlements WHERE date=? ORDER BY created_at DESC').all(date).map(row=>{const v=JSON.parse(row.payload);return {id:v.id,date,createdAt:v.createdAt,stakeCents:v.result.stakeCents,payoutCents:v.result.payoutCents,rebateCents:v.result.rebateCents||0,payableCents:v.result.payableCents??v.result.payoutCents,kind:v.inputs.kind,selection:v.inputs.selection,entries:v.result.entries.length,...(this.reviewSnapshot?.(v)?.required?{parserReviewRequired:true}:{})};});}
  getSettlement(id) {const row=this.db.prepare('SELECT payload FROM settlements WHERE id=?').get(id);if(!row)throw new Error('赔付记录不存在');const record=JSON.parse(row.payload),parserReview=this.reviewSnapshot?.(record);return parserReview?{...record,parserReview}:record;}
  close(){this.db.close();}
}
module.exports={SettlementStore,hash};
