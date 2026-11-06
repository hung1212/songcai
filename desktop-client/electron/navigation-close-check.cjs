// Isolated startup fixture: closing the unopened navigation page must never
// invoke a draft flush, show recovery prompts, or modify the migrated ledger.
module.exports=function({app,ipcMain,directory,draftPath}){
  const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
  const {dialog}=require('electron');
  let ready=false,finished=false,before;
  const fail=error=>{if(finished)return;finished=true;console.error('SONGCAI_NAVIGATION_CLOSE_FAILED',String(error));app.exit(1);};
  const timer=setTimeout(()=>fail('导航关闭检查超时'),15000);
  dialog.showMessageBox=async()=>{throw new Error('导航页关闭不应显示保存提示');};
  ipcMain.on('project:flush-ready',()=>fail('导航页不应启动原文保存'));
  function snapshot(){
    const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(directory,'ledger.sqlite'),{readOnly:true});
    try{return JSON.stringify({documents:db.prepare('SELECT * FROM ledger_documents ORDER BY id').all(),meta:db.prepare('SELECT * FROM ledger_meta ORDER BY key').all(),legacy:fs.readFileSync(draftPath,'utf8')});}finally{db.close();}
  }
  app.on('web-contents-created',(_event,contents)=>{
    contents.once('did-finish-load',async()=>{
      try{before=snapshot();await require('./navigation-startup-check.cjs')(contents,{unlock:false,capture:process.argv.includes('--navigation-screenshots')});ready=true;app.quit();}catch(error){fail(error.stack||error);}
    });
    contents.on('render-process-gone',()=>fail('导航页面异常退出'));
  });
  app.once('will-quit',()=>{
    try{assert(ready);assert.equal(snapshot(),before,'关闭导航页不应改写账目');finished=true;clearTimeout(timer);console.log('SONGCAI_NAVIGATION_CLOSE_OK');}catch(error){fail(error.stack||error);}
  });
};
