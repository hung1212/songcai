import {createApp,h,nextTick,ref} from 'vue';
import LedgerSegments from './components/LedgerSegments.vue';
import {parseDocument} from './core/parser.js';
import {settleDocuments,defaultOdds} from './core/settlement.js';

export async function checkLedgerSegmentsUI(){
 const date='2026-10-27',doc=ref({id:'segments-ui',name:'分段检查',businessDate:date,text:'副号:\n05各2\n\n副号:\n05各5\n\n香港20各100'});
 const basis=ref({ready:true,draws:Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date,issue:'2026300',numbers:[38,10,48,49,13,9,5]}])),odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),verification:Object.fromEntries(['新','旧','港'].map(m=>[m,{confirmed:true}]))});
 const fresh=ref(true),host=document.createElement('div');host.hidden=true;document.body.append(host);let located,drawClicked=false;
 const app=createApp({render:()=>{const p=parseDocument(doc.value.text,doc.value),result=settleDocuments([p],basis.value.draws,basis.value.odds,date);return h(LedgerSegments,{document:doc.value,parsed:p,result,basis:basis.value,fresh:fresh.value,onLocate:r=>located=r,onDraws:()=>drawClicked=true});}});app.mount(host);
 const wait=async check=>{for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,25));await nextTick();if(check())return;}throw new Error('分段复制未完成');};
 const clipboard=navigator.clipboard,oldWrite=Object.getOwnPropertyDescriptor(clipboard,'writeText');let copied='';
 Object.defineProperty(clipboard,'writeText',{configurable:true,value:async text=>{copied=text;}});
 const require=(ok,message)=>{if(!ok)throw new Error('分段对账界面：'+message);};
 const change=async value=>{const select=host.querySelector('[aria-label="分段筛选"]');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();};
 try{
  await nextTick();require(host.querySelectorAll('[data-segment]').length===3,'没有按空白行分成3段');require(host.querySelector('[data-segment-total]').textContent.includes('107.00'),'投注合计错误');
  require(host.querySelector('[data-segment="1"] [data-segment-stake]').dataset.segmentStake==='200','首段金额错误');require(host.querySelector('[data-segment="2"] [data-segment-payout]').dataset.segmentPayout==='23500','第二段赔付错误');
  require(host.querySelector('[data-segment="1"] .segment-winning-values').textContent.includes('05'),'没有显示中的号码');
  host.querySelector('[aria-label="定位第2段原文"]').click();await nextTick();require(located.fileId===doc.value.id&&located.line===4&&located.endLine===5,'段落定位范围错误');
  host.querySelector('.segment-basis button').click();require(drawClicked,'无法选择开奖');
  await change('won');require(host.querySelectorAll('[data-segment]').length===2,'中奖筛选错误');
  host.querySelector('[data-segment-copy-text]').click();await wait(()=>copied!=='');require(copied==='1:2\n2:5\n3:100','复制金额必须完整且只含段号金额');
  host.querySelector('[data-segment-copy-image]').click();await wait(()=>host.textContent.includes('表格图片已复制'));await change('all');
  delete basis.value.draws.港;await nextTick();require(host.querySelector('[data-segment="3"]').textContent.includes('待结算')&&!host.querySelector('[data-segment="3"]').textContent.includes('本段未中奖'),'缺开奖被当成未中奖');
  fresh.value=false;await nextTick();require(host.querySelector('[data-segment-copy-image]').disabled&&host.querySelector('[data-segment-copy-text]').disabled,'旧金额仍可复制');require(!host.querySelector('[data-segment-stake]')&&host.textContent.includes('更新解析'),'编辑期间仍显示旧金额');fresh.value=true;await nextTick();
  basis.value.history=true;await nextTick();require(host.textContent.includes('历史赔付')&&!host.querySelector('.segment-winning-values'),'历史中奖污染当前原文');basis.value.history=false;await nextTick();
  doc.value={...doc.value,text:Array.from({length:12},(_,i)=>`${i+1}各10`).join('\n\n')};await nextTick();require(host.querySelectorAll('[data-segment]').length===10,'长账目未分页');
  [...host.querySelectorAll('button')].find(b=>b.textContent==='下一页').click();await nextTick();require(host.querySelector('[data-segment="11"]'),'翻页丢失段落编号');copied='';host.querySelector('[data-segment-copy-text]').click();await wait(()=>copied!=='');require(copied.split('\n').length===12&&copied.endsWith('12:10'),'复制只包含当前页');
  doc.value={...doc.value,id:'segments-other',text:'05各8'};await nextTick();require(host.querySelector('[data-segment="1"] [data-segment-stake]').dataset.segmentStake==='800','切换账目未重置页码');
  return true;
 }finally{if(oldWrite)Object.defineProperty(clipboard,'writeText',oldWrite);else delete clipboard.writeText;app.unmount();host.remove();}
}
