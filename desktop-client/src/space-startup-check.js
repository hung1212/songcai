// Runs only in --startup-check's temporary profile. No real user data is used.
export async function checkSpaces({service,workspace,switchSpace,ready,refreshRegistry}){
  const assert=(value,message)=>{if(!value)throw new Error('空间检查：'+message);};
  let phase='启动';
  const wait=async predicate=>{const end=Date.now()+4500;while(!predicate()){if(Date.now()>end)throw new Error('空间界面等待超时：'+phase+'；'+(document.querySelector('.space-error,.space-dialog-error')?.textContent||document.querySelector('h1')?.textContent)+'；页面='+workspace()?.currentView()+'；当前='+document.querySelector('.space-current')?.textContent+'；焦点='+document.activeElement?.getAttribute('aria-label'));await new Promise(r=>setTimeout(r,25));}};
  const button=label=>document.querySelector(`[aria-label="${label}"]`);
  const clickText=(scope,text)=>{const element=[...document.querySelectorAll(scope)].find(e=>e.textContent.trim()===text);assert(element,'未找到 '+text);element.click();};
  const input=(element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));};
  const create=async(name,copy=false)=>{
    phase='创建'+name;button('切换空间').click();clickText('.space-popover button','＋ 新建空间');
    await wait(()=>document.querySelector('.space-dialog[open] input[name="space-name"]'));
    input(document.querySelector('[name="space-name"]'),name);
    if(copy)document.querySelector('.space-copy input').click();
    await new Promise(r=>setTimeout(r,0));
    document.querySelector('.space-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await wait(()=>!document.querySelector('.space-dialog[open]')&&document.querySelector('.space-current')?.textContent===name&&ready());
    return (await service.list()).activeId;
  };
  const original=await window.songcai.forSpace('default').readDraft();
  const b=await create('验收二组');
  assert((await window.songcai.forSpace(b).readDraft()).documents.length===0,'空空间');
  assert(document.querySelector('.space-empty')&&document.querySelectorAll('.file-item').length===0,'空空间界面');
  phase='打开集合';button('特码集合').click();await wait(()=>document.querySelector('.collection-page'));
  assert(document.querySelector('.collection-page .total-card .metric-value')?.textContent.includes('0.00'),'空集合');
  clickText('.app-navigation nav>button','投注账目');
  for(const text of ['明：11各80\n平特肖鼠各20','长标题玩家：11各80\n平特肖鼠各20']){
    phase='新增'+text;const count=document.querySelectorAll('.file-item').length;button('新建账目').click();await wait(()=>document.querySelectorAll('.file-item').length===count+1);
    input(button('投注原文'),text);await wait(()=>document.querySelector('.entry-total')?.textContent==='¥100.00');await workspace().flush();
  }
  await wait(()=>document.querySelectorAll('.file-item').length===2);
  const names=[...document.querySelectorAll('.file-item .file-name')].map(e=>e.textContent);
  assert(names.join('|')==='长标题玩家|明','同额标题长度排序');
  const editor=button('投注原文');editor.focus();editor.setSelectionRange(2,5);
  input(button('搜索账目名称'),'长标题');button('搜索账目名称').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  phase='切回默认';await switchSpace('default');await wait(()=>ready()&&document.querySelector('.space-current')?.textContent==='默认空间');
  assert(button('投注原文').value===original.documents[0].text,'默认原文隔离');
  assert(!document.querySelector('.ledger-search-history')?.textContent.includes('长标题'),'搜索隔离');
  phase='切回二组';await switchSpace(b);await wait(()=>ready()&&document.querySelector('.space-current')?.textContent==='验收二组');
  assert(button('投注原文').selectionStart===2&&button('投注原文').selectionEnd===5,'光标恢复');
  phase='打开搜索历史';button('搜索账目名称').focus();button('搜索账目名称').dispatchEvent(new FocusEvent('focus'));await wait(()=>document.querySelector('.ledger-search-history'));
  assert(document.querySelector('.ledger-search-history').textContent.includes('长标题'),'搜索恢复');
  phase='打开集合';button('特码集合').click();await wait(()=>document.querySelector('.collection-page'));
  assert(document.querySelector('.collection-page .total-card .metric-value').textContent.includes('160.00'),'二组特码合计');
  phase='切回默认';await switchSpace('default');await wait(()=>ready()&&document.querySelector('.collection-page .total-card .metric-value')?.textContent.includes('300.00'));
  phase='二组集合恢复';await switchSpace(b);await wait(()=>ready()&&document.querySelector('.collection-page .total-card .metric-value')?.textContent.includes('160.00'));
  phase='平特肖集合';button('平特肖集合').click();await wait(()=>document.querySelector('.flat-zodiac-page .total-card .metric-value')?.textContent.includes('40.00'));
  assert(document.querySelectorAll('.flat-zodiac-card').length===12,'十二生肖展示');
  phase='默认平特肖集合';await switchSpace('default');await wait(()=>ready()&&document.querySelector('.flat-zodiac-page .total-card .metric-value')?.textContent.includes('0.00'));
  phase='二组平特肖集合恢复';await switchSpace(b);await wait(()=>ready()&&document.querySelector('.flat-zodiac-page .total-card .metric-value')?.textContent.includes('40.00'));
  phase='统计页';button('全部账目统计').click();await wait(()=>document.querySelector('.ledger-overview'));
  const copied=await create('验收名单复制',true);
  const p=await window.songcai.forSpace(copied).readDraft();assert(p.documents.length===2&&p.documents.every(d=>!d.text&&!d.assistance),'复制名单无投注');
  assert(document.querySelector('.ledger-overview'),'切空间保留统计页');
  await service.rename({id:copied,name:'验收改名'});await refreshRegistry();assert(document.querySelector('.space-current').textContent==='验收改名','改名显示');
  await workspace().flush();await service.archive({id:copied,archived:true});await refreshRegistry();await wait(ready);
  assert((await service.list()).spaces.find(s=>s.id===copied).archived,'归档保留');
  await service.archive({id:copied,archived:false});await switchSpace(copied);await wait(ready);assert((await window.songcai.forSpace(copied).readDraft()).documents.length===2,'恢复名单');
  phase='切回默认';await switchSpace('default');await wait(ready);clickText('.app-navigation nav>button','投注账目');await workspace().flush();
  assert((await window.songcai.forSpace('default').readDraft()).documents[0].text===original.documents[0].text,'检查后默认原文保持');
  return true;
}
