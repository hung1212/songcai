import {nextTick} from 'vue';
export async function checkContentSearchUI({documents,activeId,view,workspace,parseAll,saveDraft,closeContentSearch}){
 const original={documents:documents.value,activeId:activeId.value,view:view.value,wrap:workspace.value.wrap};
 const prefix=Array.from({length:70},()=> '01各1').join('\n');
 const text=prefix+'\n预备号：\n01各10\n\n预备号：\n02各20';
 const a={...documents.value[0],id:'find-check-a',name:'副号搜索检查',autoTitle:false,text,defaultPlayer:''},b={...a,id:'find-check-b',name:'另一个搜索检查',text:'预备号：\n03各30'};
 const require=(ok,message)=>{if(!ok)throw new Error('原文搜索：'+message);};
 const wait=async check=>{for(let i=0;i<140;i++){await new Promise(r=>setTimeout(r,25));await nextTick();if(check())return;}throw new Error('原文搜索检查等待超时');};
 const key=(key,extra={})=>window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,...extra}));
 const field=()=>document.querySelector('[aria-label="投注原文"]');
 const search=()=>document.querySelector('[aria-label="搜索投注原文"]');
 const count=()=>document.querySelector('[data-find-count]')?.textContent||'';
 const query=async value=>{const el=search();el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();};
 try{
  documents.value=[a,b];activeId.value=a.id;view.value='ledger';parseAll();await nextTick();field().setSelectionRange(0,0);
  key('f',{metaKey:true});await wait(()=>search()===document.activeElement);await query('预备号');await wait(()=>count().includes('2 处匹配'));
  require(document.querySelectorAll('[data-find-index]').length===2,'当前账目次数错误');
  document.querySelector('[data-find-index="1"]').click();await wait(()=>field().selectionEnd-field().selectionStart===3);
  require(field().value.slice(field().selectionStart,field().selectionEnd)==='预备号'&&field().scrollTop>0,'没有精确定位并滚动');
  key('F3');await wait(()=>count().includes('2 / 2'));require(field().selectionStart===text.lastIndexOf('预备号'),'下一处定位错误');
  key('f',{ctrlKey:true,shiftKey:true});await wait(()=>search()===document.activeElement);await wait(()=>count().includes('3 处匹配'));
  document.querySelector('[data-find-index="3"]').click();await wait(()=>activeId.value===b.id&&field().selectionEnd===3);
  require(field().value===b.text&&field().selectionStart===0,'跨账目定位失败或修改了原文');
  const scope=document.querySelector('[aria-label="原文搜索范围"]');scope.value='current';scope.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>count().includes('1 处匹配'));
  field().value+='\n预备号：\n04各40';field().dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>count().includes('2 处匹配'));
  require(documents.value.find(d=>d.id===a.id).text===text,'搜索改变了其他账目原文');
  await query('不存在');await wait(()=>count().includes('没有匹配'));require(document.querySelector('[aria-label="下一处匹配"]').disabled,'零结果仍可定位');
  await query('预备号');await wait(()=>count().includes('2 处匹配'));key('Escape');await nextTick();require(!search(),'Esc未关闭搜索');
  // A long wrapped line uses character geometry, not a source-line estimate.
  activeId.value=a.id;workspace.value.wrap=true;documents.value.find(d=>d.id===a.id).text='01各1 '.repeat(300)+'预备号';parseAll();await nextTick();
  field().setSelectionRange(0,0);key('f',{ctrlKey:true});await wait(()=>search()===document.activeElement);await query('预备号');await wait(()=>count().includes('1 处匹配'));
  document.querySelector('[data-find-index="1"]').click();await wait(()=>field().value.slice(field().selectionStart,field().selectionEnd)==='预备号');require(field().scrollTop>0,'长行折行定位没有滚动');
  return true;
 }finally{
  closeContentSearch();documents.value=original.documents;activeId.value=original.activeId;view.value=original.view;workspace.value.wrap=original.wrap;parseAll();await nextTick();await saveDraft(true);
 }
}
