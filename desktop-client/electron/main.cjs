const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const startupCheck = process.argv.includes('--startup-check');
if (startupCheck) require('./startup-check.cjs')({ app, ipcMain });

let win;
let draftWrites = Promise.resolve();
let inbox;
let ledger;
let settlement;
let ai;
let spaces;
let recovery;
// All shipped copies use the same userData lock. A second launch focuses the
// existing window before opening any database or running a parser migration.
const primary=app.requestSingleInstanceLock();
if(!primary)app.quit();
else {
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async () => {
  require('./receipt-image.cjs')({electron:require('electron'),window:()=>win,startupCheck});
  spaces = await require('./space-store.cjs').openSpaces(app.getPath('userData'));
  recovery = new (require('./draft-recovery.cjs').DraftRecovery)(app.getPath('userData'),spaces.core);
  const closeDraft=require('./close-draft.cjs')({app,dialog,window:()=>win,recovery,stop:async()=>{await draftWrites.catch(()=>{});await inbox.stop();}});
  ledger = spaces.ledger('default');
  ai = await require('./ai-review-service.cjs')({electron:require('electron'),window:()=>win,startupCheck,spaces});
  inbox = await require('./inbox-service.cjs')({ electron: require('electron'), window: () => win,spaces });
  settlement = await require('./settlement-service.cjs')({ electron: require('electron'), window: () => win, ledger, inbox,spaces });
  const projectInput=input=>input&&Object.hasOwn(input,'spaceId')&&Object.hasOwn(input,'payload')?input:{spaceId:'default',payload:input};
  const owned=(event,input,write=false)=>{if(event.sender!==win?.webContents)throw new Error('未知窗口');const request=projectInput(input);spaces.get(request.spaceId,{write});return request;};
  ipcMain.handle('spaces:list',event=>{owned(event);return spaces.list();});
  for(const method of ['activate','rename','archive','create'])ipcMain.handle(`spaces:${method}`,async(event,input)=>{
    owned(event);await draftWrites.catch(()=>{});
    if(method==='create'){
      const from=input.copyFrom||'default',sourceStore=(await settlement.ensure(from)).store,source=sourceStore.settings();
      const space=spaces.create({...input,copyFrom:from},directory=>{
        const target=new (require('./settlement-store.cjs').SettlementStore)(directory,sourceStore.core,sourceStore.draws,sourceStore.reviewSnapshot);
        try{target.saveSettings({...source,revision:target.settings().revision});}finally{target.close();}
      });
      spaces.activate(space.id);return spaces.list();
    }
    if(method==='archive'&&input.archived&&(inbox.busy(input.id)||ai.busy(input.id)))throw new Error('此空间还有采集或AI核验任务，请完成或停止后归档');
    return spaces[method](method==='activate'?input.id:input);
  });
  ipcMain.handle('project:read-draft', async (event,input) => {
    try { return spaces.project(owned(event,input).spaceId); }
    catch (error) { return { loadError: error.message }; }
  });
  ipcMain.handle('project:write-draft', async (event, project) => {
    if (event.sender !== win?.webContents) throw new Error('未知窗口');
    const {spaceId,payload}=owned(event,project,true);
    const write = draftWrites.catch(() => {}).then(async() => {
      try{
        const runtime=await ai.ensure(spaceId);spaces.get(spaceId,{write:true});
        const saved=await require('./ledger-ai-lifecycle.cjs').writeLedger(spaces.ledger(spaceId),runtime,payload);
        // Cleanup failure must not turn a committed ledger write into a failed
        // response: that would leave the renderer holding a stale revision.
        try{recovery.saved(spaceId);}catch{}
        return saved;
      }catch(error){
        try{recovery.save(spaces.get(spaceId),payload);}
        catch(backupError){throw new Error(error.message+'；原文副本保存失败：'+backupError.message);}
        throw new Error(error.message+'。当前原文已保留恢复副本，可关闭后在恢复空间中继续。');
      }
    });
    draftWrites = write;
    return write;
  });
  ipcMain.handle('project:backup-draft',(event,input)=>{
    const {spaceId,payload}=owned(event,input);
    return recovery.save(spaces.get(spaceId),payload);
  });
  ipcMain.handle('recovery:list',event=>{owned(event);return recovery.list();});
  ipcMain.handle('recovery:restore',async(event,id)=>{owned(event);await draftWrites.catch(()=>{});return recovery.restore(id,spaces);});
  ipcMain.handle('project:clear-state',(event,input)=>{
    if(event.sender!==win?.webContents)throw new Error('未知窗口');
    return spaces.ledger(owned(event,input).spaceId).clearState();
  });
  for(const [channel,method] of [['clear-contents','clearContents'],['restore-contents','restoreContents']])ipcMain.handle(`project:${channel}`,(event,input)=>{
    if(event.sender!==win?.webContents)throw new Error('未知窗口');
    const {spaceId,payload}=owned(event,input,true);
    const write=draftWrites.catch(()=>{}).then(async()=>{const runtime=await ai.ensure(spaceId);spaces.get(spaceId,{write:true});return method==='clearContents'?require('./ledger-ai-lifecycle.cjs').clearLedger(spaces.ledger(spaceId),runtime,payload):spaces.ledger(spaceId)[method](payload);});draftWrites=write;return write;
  });
  ipcMain.on('project:flush-ready', event => {
    if (event.sender === win?.webContents) win.canFlushDraft = true;
  });
  ipcMain.handle('project:flushed', async event => {
    if (event.sender !== win?.webContents) return;
    await draftWrites.catch(()=>{});
    await closeDraft.flushed();
  });
  ipcMain.handle('project:flush-failed', async (event,input) => {
    if (event.sender === win?.webContents) await closeDraft.failed(input);
  });
  ipcMain.handle('files:open', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: '文本与松财账单', extensions: ['og', 'txt', 'json'] }] });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async filename => {
      const stat = await fs.stat(filename);
      const maxBytes = path.extname(filename).toLowerCase() === '.json' ? 20_000_000 : 5_000_000;
      if (stat.size > maxBytes) throw new Error(`单个文件不能超过${maxBytes / 1_000_000}MB`);
      const bytes = await fs.readFile(filename);
      return { name: path.basename(filename), text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    }));
  });
  ipcMain.handle('files:save', async (_event, { name, text }) => {
    if (typeof text !== 'string' || text.length > 20_000_000) throw new Error('保存内容无效或过大');
    const result = await dialog.showSaveDialog(win, { defaultPath: path.basename(name || '松财账单.json') });
    if (result.canceled) return false;
    await fs.writeFile(result.filePath, text, 'utf8');
    return true;
  });
  const createWindow = () => {
    win = new BrowserWindow({ show: !startupCheck, width: 1480, height: 960, minWidth: 1060, minHeight: 700, title: '松财 · 玩家算账', backgroundColor: '#f6f7f8',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
        additionalArguments: startupCheck ? ['--songcai-startup-check', ...(process.argv.includes('--draw-network-check') ? ['--songcai-draw-network-check'] : [])] : [] } });
    win.setMenuBarVisibility(false);
    closeDraft.attach(win);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  };
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// This is a single-window ledger with no background work. After the normal
// close/save handshake, quit on macOS too, so a closed app cannot retain stale
// archive offsets while its on-disk preview is updated.
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { ai?.close(); settlement?.close(); inbox?.close(); spaces?.close(); recovery?.close(); });
}
