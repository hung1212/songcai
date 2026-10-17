// Keep failed-save handling testable without starting Electron. Never permit a
// close until a current renderer snapshot has been durably stored by the main
// process, or the regular flush has succeeded.
module.exports=function createCloseDraft({app,dialog,window,recovery,stop}) {
  let quitting=false,prompting=false;
  app.on('before-quit',()=>{quitting=true;});
  const finish=async()=>{
    await stop();
    const win=window();
    win.allowClose=true;
    if(quitting)app.quit();else win.close();
  };
  return {
    attach(win){
      win.on('close',event=>{
        if(win.canFlushDraft&&!win.allowClose&&!win.webContents.isDestroyed()){
          event.preventDefault();
          if(!win.flushingDraft){win.flushingDraft=true;win.webContents.send('project:flush');}
        }
      });
    },
    flushed:finish,
    async failed({message,backupId,backupError}={}){
      if(prompting)return;
      prompting=true;
      const win=window();
      try{
        const safe=!!backupId&&recovery.hasCurrent(backupId);
        const result=await dialog.showMessageBox(win,{
          type:'warning',title:'松财 · 保存未完成',
          message:safe?'当前原文已另存恢复副本，可以安全退出':'当前原文尚未备份，请先保留原文',
          detail:safe?'数据库里的账目保持原样。再次打开软件后，可点击“打开恢复副本”，在独立空间找回全部投注原文。赔率、退水或收件箱中尚未保存的设置不包含在原文副本中。\n\n'+(message||'保存失败')
            :(message||'保存失败')+'\n\n副本保存失败：'+(backupError||'没有收到当前原文')+'\n请返回编辑，使用“导出备份”或复制原文后再退出。',
          buttons:safe?['返回编辑','保留原文副本并退出']:['返回编辑'],defaultId:0,cancelId:0,noLink:true,
        });
        if(safe&&result.response===1){
          try{await finish();return;}
          catch(error){await dialog.showMessageBox(win,{type:'error',message:'停止后台任务失败，请重试退出',detail:error.message,buttons:['返回编辑']});}
        }
      } finally {prompting=false;win.flushingDraft=false;quitting=false;}
    },
  };
};
