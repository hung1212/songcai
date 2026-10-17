const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('songcai', {
  spaces: Object.fromEntries(['list','create','activate','rename','archive'].map(name=>[name,input=>ipcRenderer.invoke(`spaces:${name}`,input)])),
  recovery:{list:()=>ipcRenderer.invoke('recovery:list'),restore:id=>ipcRenderer.invoke('recovery:restore',id)},
  forSpace: spaceId => {
    const invoke=(channel,payload)=>ipcRenderer.invoke(channel,{spaceId,payload});
    return {
      ai:Object.fromEntries(['load','configure','test','cached','review','cancel','history','remember','removeAlias'].map(name=>[name,input=>invoke(`ai:${name}`,input)])),
      settlement:Object.fromEntries(['players','load','settings','sync','manual','preview','save','get','openSource'].map(name=>[name,input=>invoke(`settlement:${name}`,input)])),
      inbox:Object.fromEntries(['list','get','create','update','confirm','skip','asset','clipboard','images','reocr','status','permission','windows','preview','capture','stop','export','restore'].map(name=>[name,input=>invoke(`inbox:${name}`,input)])),
      readDraft:()=>invoke('project:read-draft'),writeDraft:input=>invoke('project:write-draft',input),
      backupDraft:input=>invoke('project:backup-draft',input),
      clearLedgerState:()=>invoke('project:clear-state'),clearLedgerContents:input=>invoke('project:clear-contents',input),restoreLedgerContents:input=>invoke('project:restore-contents',input),
      onInboxChanged:callback=>{const listener=(_event,value)=>{if((value.spaceId||'default')===spaceId)callback(value);};ipcRenderer.on('inbox:changed',listener);return()=>ipcRenderer.removeListener('inbox:changed',listener);},
    };
  },
  receiptImage: input => ipcRenderer.invoke('receipt:image',input),
  ai: Object.fromEntries(['load','configure','test','cached','review','cancel','history','remember','removeAlias'].map(name=>[name,input=>ipcRenderer.invoke(`ai:${name}`,input)])),
  settlement: Object.fromEntries(['players','load','settings','sync','manual','preview','save','get','openSource'].map(name => [name, input => ipcRenderer.invoke(`settlement:${name}`, input)])),
  inbox: Object.fromEntries(['list', 'get', 'create', 'update', 'confirm', 'skip', 'asset', 'clipboard', 'images', 'reocr', 'status', 'permission', 'windows', 'preview', 'capture', 'stop', 'export', 'restore'].map(name => [name, input => ipcRenderer.invoke(`inbox:${name}`, input)])),
  onInboxChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('inbox:changed', listener);
    return () => ipcRenderer.removeListener('inbox:changed', listener);
  },
  ...(process.argv.includes('--songcai-startup-check') ? {
    reportStartup: report => ipcRenderer.send('startup:interface-ready', report),
    checkDrawNetwork: process.argv.includes('--songcai-draw-network-check'),
  } : {}),
  readDraft: () => ipcRenderer.invoke('project:read-draft'),
  writeDraft: project => ipcRenderer.invoke('project:write-draft', project),
  clearLedgerState: () => ipcRenderer.invoke('project:clear-state'),
  clearLedgerContents: input => ipcRenderer.invoke('project:clear-contents',input),
  restoreLedgerContents: input => ipcRenderer.invoke('project:restore-contents',input),
  onBeforeClose: (save,recover,finished) => {
    let running=false;
    ipcRenderer.removeAllListeners('project:flush');
    ipcRenderer.on('project:flush', async () => {
      if(running)return;running=true;
      try { await save(); await ipcRenderer.invoke('project:flushed'); }
      catch(error) {
        let backup,backupError;
        try{backup=await recover?.();}catch(e){backupError=e.message;}
        await ipcRenderer.invoke('project:flush-failed',{message:error.message,backupId:backup?.id,backupError});
      }finally{running=false;finished?.();}
    });
    ipcRenderer.send('project:flush-ready');
  },
  openFiles: () => ipcRenderer.invoke('files:open'),
  saveFile: (name, text) => ipcRenderer.invoke('files:save', { name, text }),
});
