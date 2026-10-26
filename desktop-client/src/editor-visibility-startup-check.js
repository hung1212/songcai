import {createApp,h,nextTick} from 'vue';
import LedgerWorkspace from './LedgerWorkspace.vue';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message){for(let i=0;i<100;i++){if(predicate())return;await pause(20);}throw new Error(message);}
// Isolated UI fixture; covers indented lines, account switching and scroll ends.
export async function checkEditorVisibilityUI(){
  const text=Array.from({length:49},(_,i)=>i%3===0?'01各10':'').join('\n')+'\n新澳门\n  特：狗龙鸡各个数1500斤\n          猴牛鼠各个数750斤\n            \n\n02各20';
  let saved={schemaVersion:1,activeId:'visibility-a',documents:[{id:'visibility-a',name:'显示甲',text,businessDate:'2026-10-05',defaultPlayer:''},{id:'visibility-b',name:'显示乙',text:text.replace('狗龙鸡','狗龙猪'),businessDate:'2026-10-05',defaultPlayer:''}]};
  const api={onInboxChanged:()=>()=>{},readDraft:async()=>structuredClone(saved),writeDraft:async p=>(saved=structuredClone(p)),clearLedgerState:async()=>null,ai:{load:async()=>({settings:{enabled:false},usage:{},aliases:[]}),history:async()=>[],cached:async()=>({total:0,missing:0,items:[]})}};
  const host=document.createElement('div');document.body.append(host);
  const app=createApp({render:()=>h(LedgerWorkspace,{space:{id:'editor-visibility',name:'显示检查'},api})});app.mount(host);
  const input=()=>host.querySelector('[aria-label="投注原文"]');
  const layer=()=>host.querySelector('.highlight-viewport pre');
  const native=()=>!host.querySelector('.source-editor').classList.contains('highlight-active')&&getComputedStyle(input()).webkitTextFillColor!=='rgba(0, 0, 0, 0)';
  try{
    await until(()=>input()?.value===text&&layer()?.children.length===text.split('\n').length,'原文显示初始化失败');
    for(const id of ['visibility-b','visibility-a']){
      host.querySelector(`[data-document-id="${id}"] .file-select`).click();
      await until(()=>host.querySelector('.file-item.active')?.dataset.documentId===id,'账目切换失败');await nextTick();await pause(30);
      if(layer().children[51].textContent!==text.split('\n')[51])throw new Error('切换账目后缩进投注文字丢失');
    }
    // Editing a newline moves all cached rows below it. Their DOM must follow
    // the current source rather than leaving a previously blank row in place.
    for(const changed of [text.replace('新澳门','\n新澳门'),text,text.replace('          猴','\n          猴'),text]){
      input().value=changed;input().dispatchEvent(new Event('input',{bubbles:true}));await nextTick();await nextTick();
      const lines=changed.split('\n');
      if(layer().children.length!==lines.length||lines.some((line,i)=>layer().children[i].textContent!==(line||' ')))throw new Error('插入或删除换行后高亮文字未与原文逐行同步');
    }
    const row=layer().children[51];row.classList.add('winning-line','located-line');
    for(const wrap of [false,true]){
      const checkbox=host.querySelector('.editor-wrap-control input');checkbox.checked=wrap;checkbox.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();await pause(30);
      for(const top of [0,49*28,100000]){
        input().scrollTop=top;input().dispatchEvent(new Event('scroll'));await nextTick();
        if(Math.abs(layer().parentElement.scrollTop-input().scrollTop)>1||Math.abs(host.querySelector('.line-numbers').scrollTop-input().scrollTop)>1)throw new Error('滚动到底部时原文与高亮/行号不同步');
      }
      if(getComputedStyle(layer()).transform!=='none')throw new Error('高亮仍使用整层平移');
      if(row.querySelector('.token-selection')?.textContent!=='猴牛鼠'||row.querySelector('.token-amount')?.textContent!=='750')throw new Error('中奖行缺少生肖或金额文字');
    }
    const mode=host.querySelector('.editor-display-mode');mode.click();await nextTick();await nextTick();
    if(!native()||input().value!==text)throw new Error('原文模式未显示真实文字');
    mode.click();await nextTick();await nextTick();
    if(!host.querySelector('.source-editor.highlight-active'))throw new Error('彩色模式未恢复');
    // Deliberately damage decoration only: the real input must become visible.
    layer().children[51].textContent='';
    const font=host.querySelector('.editor-font-control select');font.value='18';font.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();await nextTick();await pause(30);
    if(!native()||input().value!==text||!host.querySelector('.highlight-legend').textContent.includes('已显示原文'))throw new Error('高亮缺文字时没有回退到真实原文');
    return true;
  }finally{app.unmount();host.remove();}
}
