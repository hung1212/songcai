// Real IPC + recovery banner, exercised only in the isolated startup profile.
export async function checkRecovery({service,workspace,switchSpace,refreshRegistry}){
  const assert=(value,message)=>{if(!value)throw new Error('恢复检查：'+message);};
  const wait=async predicate=>{const end=Date.now()+4000;while(!predicate()){if(Date.now()>end)throw new Error('恢复界面等待超时');await new Promise(r=>setTimeout(r,20));}};
  await workspace().flush();
  const registry=await service.create({name:'冲突验收'}),id=registry.activeId,api=window.songcai.forSpace(id);
  const initial=await api.readDraft();
  const doc={id:'conflict-fixture',name:'恢复验收',text:'01各10',businessDate:'2026-10-14',defaultPlayer:'恢复验收'};
  const first=await api.writeDraft({...initial,activeId:doc.id,documents:[doc]});
  const latest=await api.writeDraft({...first,documents:[{...doc,text:'02各20'}]});
  let rejected=false;
  try{await api.writeDraft({...first,documents:[{...doc,text:'03各30\n04各40'}]});}catch(e){rejected=e.message.includes('恢复副本');}
  assert(rejected,'冲突写入必须保留副本并拒绝覆盖');
  assert((await api.readDraft()).documents[0].text===latest.documents[0].text,'数据库原文被覆盖');
  await refreshRegistry();await wait(()=>workspace()?.ready()&&document.querySelector('.draft-recovery-banner button'));
  document.querySelector('.draft-recovery-banner button').click();
  await wait(()=>workspace()?.ready()&&document.querySelector('.space-current')?.textContent==='恢复 · 冲突验收');
  await wait(()=>document.querySelector('[aria-label="投注原文"]')?.value==='03各30\n04各40');
  assert((await api.readDraft()).documents[0].text==='02各20','恢复不应修改来源空间');
  assert((await window.songcai.recovery.list()).length===0,'恢复完成后应移除待恢复提示');
  const current=window.songcai.forSpace((await service.list()).activeId),before=await current.readDraft();
  await workspace().flush();await workspace().flush();
  assert((await current.readDraft()).storageRevision===before.storageRevision,'无修改关闭不应重复写库');
  await switchSpace('default');await wait(()=>workspace()?.ready()&&document.querySelector('.space-current')?.textContent==='默认空间');
  return true;
}
