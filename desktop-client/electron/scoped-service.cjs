// Capture the caller's space once, including for asynchronous completion.
async function scopedService({name,electron,getWindow,spaces,methods,readOnly=[],create,exclusive=[],idleOnly=[]}) {
  const runtimes=new Map(),pending=new Map();let closing=false,starting=false;
  async function ensure(id='default'){
    spaces.get(id);if(closing)throw new Error('应用正在关闭');
    if(runtimes.has(id))return runtimes.get(id);
    if(!pending.has(id))pending.set(id,Promise.resolve().then(()=>create(id)).then(runtime=>{if(closing){runtime.close();throw new Error('应用正在关闭');}runtimes.set(id,runtime);return runtime;}).finally(()=>pending.delete(id)));
    return pending.get(id);
  }
  await ensure('default');
  for(const method of methods)electron.ipcMain.handle(`${name}:${method}`,async(event,input)=>{
    if(event.sender!==getWindow()?.webContents)throw new Error('未知窗口');
    const envelope=input&&typeof input==='object'&&Object.hasOwn(input,'spaceId')&&Object.hasOwn(input,'payload');
    const id=envelope?input.spaceId:'default',payload=envelope?input.payload:input;
    spaces.get(id,{write:!readOnly.includes(method)});
    if(idleOnly.includes(method)&&[...runtimes.values()].some(r=>r.busy?.()))throw new Error('请先停止各空间的任务再修改设置');
    const guarded=exclusive.includes(method);
    if(guarded&&(starting||[...runtimes.values()].some(r=>r.busy?.())))throw new Error('其他空间有采集或识别任务，请等待完成后重试');
    if(guarded)starting=true;
    try{const runtime=await ensure(id);spaces.get(id,{write:!readOnly.includes(method)});return await runtime.handlers[method](payload);}
    finally{if(guarded)starting=false;}
  });
  return {ensure,busy:id=>runtimes.get(id)?.busy?.()||false,
    async stop(){await Promise.all([...runtimes.values()].map(r=>r.stop?.()));},
    close(){closing=true;for(const runtime of [...runtimes.values()].reverse())runtime.close();}};
}
module.exports={scopedService};
