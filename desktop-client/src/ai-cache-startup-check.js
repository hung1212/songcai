import {createApp,h,reactive,nextTick} from 'vue';
import AiReview from './components/AiReview.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {reviewInput,relocateReview,documentReviewKey} from './core/ai-review.js';

// A synthetic, isolated API exercises the real component's edit/watch/timer
// flow without making a Codex request or touching the user's ledgers.
export async function checkIncrementalReviewUI(){
  const doc=reactive({id:'ai-ui',name:'核验测试',text:'新01各10',businessDate:'2026-10-10',defaultPlayer:''});
  const cache=new Map(),requests=[];let generation=0,cancelled=0;
  const settings={enabled:true,transport:'codex',mode:'all'};
  const api={
    load:async()=>({settings,aliases:[],usage:{},codex:{available:true}}),history:async()=>[],
    cancel:()=>{cancelled++;},
    cached:async({document,mode})=>{
      const items=reviewInput(document,mode).items,known=items.filter(i=>cache.has(i.fragmentKey));
      return {items:known.map(i=>relocateReview(cache.get(i.fragmentKey),i)),missing:items.length-known.length,total:items.length,generation,profile:'ui-fixture',running:requests.some(r=>!r.done)};
    },
    review:async({document,mode})=>{
      const items=reviewInput(document,mode).items.filter(i=>!cache.has(i.fragmentKey));
      let release;const gate=new Promise(r=>release=r),request={items,release,done:false};requests.push(request);
      for(const i of items)cache.set(i.fragmentKey,{status:'pending',replacement:'',candidates:[],reason:'测试等待'});
      await gate;
      for(const i of items)cache.set(i.fragmentKey,{status:'agree',replacement:'',candidates:[],reason:'测试已完成'});
      request.done=true;return {status:'completed',items:[],id:'ui-fixture'};
    },
  };
  const host=document.createElement('div');host.hidden=true;document.body.append(host);
  const app=createApp({render:()=>h(AiReview,{document:doc,prepare:async()=>{},apply:async(id,key,value)=>{
    if(id!==doc.id||key!==documentReviewKey(doc))return false;doc.assistance=value;return true;
  }})});
  app.provide(SPACE_CONTEXT,{id:'ai-ui',api:{ai:api}});app.mount(host);
  const wait=async(predicate)=>{const until=Date.now()+6000;while(!predicate()){if(Date.now()>until)throw new Error('增量核验界面检查超时');await new Promise(r=>setTimeout(r,25));}await nextTick();};
  try{
    await wait(()=>requests.length===1);
    doc.text+='\n新02各20';await nextTick();
    if(cancelled)throw new Error('追加内容取消了第一笔核验');
    requests[0].release();await wait(()=>requests.length===2);
    if(doc.assistance.items[0]?.status!=='agree'||requests[1].items.some(i=>i.source==='新01各10'))throw new Error('第一笔被重复核验');
    requests[1].release();await wait(()=>doc.assistance.items.length===2&&doc.assistance.items.every(i=>i.status==='agree'));
    doc.text='\n'+doc.text;await wait(()=>doc.assistance.items[0]?.line===2);
    await new Promise(r=>setTimeout(r,1700));if(requests.length!==2)throw new Error('行号变化重复发起核验');
    cache.clear();generation++;doc.text='';await nextTick();await wait(()=>!doc.assistance);
    doc.text='新01各10';await wait(()=>requests.length===3);requests[2].release();await wait(()=>doc.assistance.items[0]?.status==='agree');
    return cancelled===0&&requests.map(r=>r.items.length).join()==='1,1,1';
  }finally{for(const r of requests)r.release();app.unmount();host.remove();}
}
