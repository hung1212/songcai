const {SettlementStore,hash}=require('./settlement-store.cjs');
async function fetchJson(request,fetcher) {
  const response=await fetcher(request.url,{method:request.method,body:request.body,headers:request.body?{'Content-Type':request.contentType||'application/json'}:{Accept:request.responseType==='text'?'text/html':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`开奖来源暂不可用（HTTP ${response.status}）`);
  if(Number(response.headers.get('content-length'))>5_000_000)throw new Error('开奖响应过大');
  const reader=response.body.getReader();let length=0;const chunks=[];
  try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>5_000_000)throw new Error('开奖响应过大');chunks.push(Buffer.from(value));}}
  finally {await reader.cancel().catch(()=>{});}
  const text=Buffer.concat(chunks).toString('utf8');
  if(request.responseType==='text')return text;
  try{return JSON.parse(text);}catch{throw new Error('开奖来源没有返回JSON数据');}
}
module.exports=async function installSettlement({electron,window:getWindow,ledger,inbox,fetcher,spaces,directory,spaceId,sharedDrawStore,register=true}) {
  if(spaces){
    let publicDrawStore;
    return require('./scoped-service.cjs').scopedService({name:'settlement',electron,getWindow,spaces,
      methods:['players','load','settings','openSource','sync','manual','preview','save','get'],readOnly:['players','load','openSource','preview','get'],
      create:async id=>{
        const service=await installSettlement({electron,window:getWindow,ledger:{read:()=>spaces.project(id)},inbox:await inbox.ensure(id),fetcher,directory:spaces.dataDirectory(id),spaceId:id,sharedDrawStore:publicDrawStore,register:false});
        if(id==='default')publicDrawStore=service.store;return service;
      }});
  }
  const core=await import('../src/core/settlement.js'),drawCore=await import('../src/core/draws.js'),parser=await import('../src/core/parser.js'),rules=await import('../src/core/rules.js'),verificationCore=await import('../src/core/draw-verification.js'),selectionCore=await import('../src/core/draw-selection.js');
  const {reviewSettlement}=await import('../src/core/parser-upgrade.js');
  const {settlementPlayers}=await import('../src/core/rebates.js');
  const store=new SettlementStore(directory||electron.app.getPath('userData'),core,drawCore,reviewSettlement);
  if(sharedDrawStore)for(const method of ['addDraws','listDraws','draw','fetchReports','saveFetchReport'])store[method]=sharedDrawStore[method].bind(sharedDrawStore);
  const network=fetcher||((url,options)=>electron.net.fetch(url,options));let syncing=false;let lastAutoSync=0;let syncPromise=null;let lastAutoYear=0;let closing=false;
  const validDate=date=>{rules.ruleForDate(date);return date;};
  function inputs(input) {
    if(syncing)throw new Error('正在同步开奖记录，请稍候再计算或保存');
    const date=validDate(input.date),settings=store.settings();let documents;
    if(input.kind==='inbox')documents=inbox.settlementDocuments(date);
    else {
      if(!['current','ledger'].includes(input.kind))throw new Error('请选择账目来源');
      const saved=ledger.read(); const docs=(saved?.documents||[]).filter(d=>d.businessDate===date&&(input.kind!=='current'||d.id===input.activeId));
      if(spaceId&&input.kind==='current'&&!docs.length)throw new Error('当前空间没有该账目或业务日期不符');
      documents=docs.map(doc=>({...parser.parseDocument(doc.text,doc),originalText:doc.text}));
    }
    if(input.drawMode&&(!['latest','date'].includes(input.drawMode)||input.kind!=='current'))throw new Error('仅当前账目支持独立选择开奖日期');
    if(input.drawMode==='date')validDate(input.drawDate);
    const drawDates=input.drawMode?{}:null;
    const draws={};for(const market of rules.MARKETS)if(input.drawIds?.[market]) {const draw=store.draw(input.drawIds[market]);if(draw.market!==market||(!input.drawMode&&draw.date!==date)||(input.drawMode==='date'&&draw.date!==input.drawDate))throw new Error('所选开奖的市场或日期不匹配');draws[market]=draw;if(drawDates)drawDates[market]=draw.date;}
    const all=Object.fromEntries(rules.MARKETS.map(m=>[m,store.listDraws(m,input.drawMode?undefined:Number(date.slice(0,4)))]));
    if(drawDates){const selected=selectionCore.ledgerDrawSelection(all,settings,{mode:input.drawMode,date:input.drawDate||date,preserve:false});for(const m of rules.MARKETS)drawDates[m] ||= selected.drawDates[m];}
    const verification=verificationCore.verifyDraws(all,settings,drawDates?Object.fromEntries(rules.MARKETS.map(m=>[m,drawDates[m]||input.drawDate||date])):date,input.drawIds||{},input.decisions,store.fetchReports(Number(date.slice(0,4))));
    return {...(spaceId?{spaceId}:{}),documents,draws,settings,date,kind:input.kind,selection:input.kind==='current'?String(input.activeId):'all',verification,...(drawDates?{drawDates}:{})};
  }
  const handlers={
    players:()=>settlementPlayers(inbox.settlementDocuments?.('')||[]),
    load:input=>{const date=validDate(input.date);return {settings:store.settings(),draws:Object.fromEntries(rules.MARKETS.map(m=>[m,store.listDraws(m,input.allDates?undefined:Number(date.slice(0,4)))])),reports:store.fetchReports(Number(date.slice(0,4))),history:store.history(date)};},
    settings:input=>store.saveSettings(input),
    openSource:input=>{const source=[...drawCore.DRAW_SOURCES,...drawCore.DRAW_REFERENCES].find(s=>s.id===input.id);if(!source)throw new Error('未知开奖来源');return electron.shell.openExternal(source.page);},
    sync:async input=>{
      const date=validDate(input.date),settings=store.settings();
      if(syncPromise)return syncPromise;
      if(input.auto&&lastAutoYear===Number(date.slice(0,4))&&Date.now()-lastAutoSync<120000)return [];
      lastAutoSync=Date.now();lastAutoYear=Number(date.slice(0,4));syncing=true;
      syncPromise=(async()=>{try {
        const year=Number(date.slice(0,4)),jobs=rules.MARKETS.flatMap(market=>settings.sources[market].map(sourceId=>({market,sourceId}))),cache=new Map(),reports=new Array(jobs.length);let next=0;
        await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
          while(next<jobs.length){const index=next++,job=jobs[index],source=drawCore.drawSource(job.sourceId,job.market);let report;
            try {
              let decoded,lastError;
              const years=(input.auto||input.latest)&&date.slice(5,7)==='01'?[year,year-1]:[year];
              for(const queryYear of years){try{const request=drawCore.drawRequest(source,queryYear),key=JSON.stringify(request);if(!cache.has(key))cache.set(key,fetchJson(request,network));const payload=await cache.get(key);if(closing)throw new Error('应用正在关闭');decoded=drawCore.decodeDraws(payload,source,job.market,queryYear);break;}catch(e){lastError=e;}}
              if(!decoded)throw lastError;
              const {added}=store.addDraws(decoded.records);
              report={...job,sourceName:source.name,ok:true,added,rejected:decoded.rejected.length,latest:decoded.records[0],message:`读取${decoded.records.length}期，新增${added}期${decoded.rejected.length?'；忽略'+decoded.rejected.length+'条异常记录':''}`};
            }catch(error){report={...job,sourceName:source.name,ok:false,message:`读取失败，已有记录保留：${error.message}`};}
            if(closing)return;reports[index]=store.saveFetchReport(report,year);
          }
        }));
        return reports;
      }finally{syncing=false;syncPromise=null;}})();
      return syncPromise;
    },
    manual:input=>store.addDraws([drawCore.manualDraw(input)]),
    preview:input=>{const data=inputs(input);return {inputHash:hash(data),result:core.settleDocuments(data.documents,data.draws,data.settings.odds,data.date,{drawDates:data.drawDates,rebates:data.settings.rebates}),draws:data.draws,settings:data.settings,inputs:data};},
    save:input=>{if(input.reviewed!==true)throw new Error('请先核对开奖来源、期号、号码与账目范围');return store.saveSettlement(inputs(input),input.inputHash);},
    get:input=>store.getSettlement(input.id),
  };
  if(register)for(const [name,handler] of Object.entries(handlers))electron.ipcMain.handle(`settlement:${name}`,(event,input)=>{if(event.sender!==getWindow()?.webContents)throw new Error('未知窗口');return handler(input);});
  return {handlers,store,close:()=>{if(!closing){closing=true;store.close();}}};
};
module.exports.fetchJson=fetchJson;
