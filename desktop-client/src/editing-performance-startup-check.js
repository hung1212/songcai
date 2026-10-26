import {createApp,h,nextTick} from 'vue';
import LedgerWorkspace from './LedgerWorkspace.vue';
import {createParseWorker} from './parse-worker-client.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message){
  for(let i=0;i<240;i++){if(predicate())return;await delay(25);}
  throw new Error(message);
}

// Runs only inside --startup-check's isolated profile. No live ledgers or AI.
export async function checkEditingPerformanceUI(){
  const id='editing-performance',text=Array.from({length:3000},(_,i)=>`特肖三中三1 2 ${100+i}`).join('\n');
  let saved={schemaVersion:1,activeId:'large',documents:[
    {id:'large',name:'大量待处理',autoTitle:false,text,businessDate:'2026-10-21',defaultPlayer:''},
    {id:'other',name:'其他账目',autoTitle:false,text:'02各30',businessDate:'2026-10-21',defaultPlayer:''},
  ]};
  let cacheCalls=0,historyCalls=0;
  const api={onInboxChanged:()=>()=>{},readDraft:async()=>structuredClone(saved),writeDraft:async project=>{saved=structuredClone(project);return saved;},
    clearLedgerState:async()=>null,ai:{
      load:async()=>({settings:{enabled:true,mode:'doubt'},usage:{},aliases:[]}),
      history:async()=>{historyCalls++;return [];},
      cached:async()=>{cacheCalls++;return {total:0,missing:0,items:[]};},
    }};
  const host=document.createElement('div');document.body.append(host);
  const app=createApp({render:()=>h(LedgerWorkspace,{space:{id,name:'性能检查'},api})});
  app.mount(host);
  try{
    const input=()=>host.querySelector('[aria-label="投注原文"]');
    await until(()=>host.querySelector('.entry-pending')?.textContent.includes('3000'),'大账目后台解析失败');
    host.querySelector('.entry-pending').click();await nextTick();
    if(host.querySelectorAll('.issue-card').length!==30)throw new Error('待处理未限制为每页30项');
    if(host.querySelector('.ai-page'))throw new Error('隐藏AI页面仍在生成列表');
    // Navigate directly to a far-away issue without rendering preceding cards.
    host.querySelectorAll('.line-numbers button')[2500].click();await nextTick();await nextTick();
    if(host.querySelectorAll('.issue-card').length!==30||!host.querySelector('.located-result'))throw new Error('跨页定位失败');
    const timings=[],callsBefore=cacheCalls,historiesBefore=historyCalls;
    for(let i=0;i<8;i++){
      const field=input(),start=performance.now();field.value=text+`\n01各${10+i}`;
      field.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
      field.getBoundingClientRect();timings.push(performance.now()-start);await delay(20);
    }
    const typingCacheReads=cacheCalls-callsBefore;
    if(typingCacheReads!==0||historyCalls!==historiesBefore)throw new Error('连续输入仍在逐字读取AI缓存或历史');
    // Start a long parse, then replace it while the worker is still running.
    await delay(340);
    input().value='香港01各20';input().dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
    await until(()=>host.querySelector('.entry-total')?.textContent==='¥20.00'&&!host.querySelector('.entry-pending')?.textContent.includes('3000'),'迟到解析覆盖了最新输入（文字：'+input().value+'，金额：'+host.querySelector('.entry-total')?.textContent+'）');
    await delay(400);
    if(input().value!=='香港01各20'||host.querySelector('.entry-total')?.textContent!=='¥20.00')throw new Error('编辑后最新原文或金额丢失');
    host.querySelector('[data-document-id="other"] .file-select').click();
    await until(()=>input()?.value==='02各30','切换账目失败');
    host.querySelector('[data-document-id="large"] .file-select').click();
    await until(()=>input()?.value==='香港01各20','切换后原文未保存');
    const reviewWorker=createParseWorker();let reviewTicks=0;
    const heartbeat=setInterval(()=>{reviewTicks++;},20);
    try{
      const prepared=await reviewWorker.review({id:'review-large',name:'核验测试',text,businessDate:'2026-10-21'},'doubt');
      if(prepared.items.length!==3000||reviewTicks<3)throw new Error('AI核验准备未在后台完成');
    }finally{clearInterval(heartbeat);reviewWorker.dispose();}
    const sorted=[...timings].sort((a,b)=>a-b);
    console.log('SONGCAI_EDITING_PERFORMANCE '+JSON.stringify({lines:3000,pendingCards:30,inputMs:timings,medianMs:sorted[4],maxMs:sorted.at(-1),cacheReadsDuringTyping:typingCacheReads,latestTextPreserved:true,reviewBackgroundTicks:reviewTicks}));
    // Generous ceiling catches accidental multi-second synchronous parsing,
    // without making the test depend on fine differences between Mac hardware.
    if(sorted[4]>500)throw new Error('长文本输入仍有明显同步阻塞：'+sorted[4].toFixed(0)+'ms');
    return true;
  }finally{app.unmount();host.remove();}
}
