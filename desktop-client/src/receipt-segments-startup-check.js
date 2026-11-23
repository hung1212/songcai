import {createApp,h,nextTick} from 'vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {receiptPreferences,createReceiptPreferences} from './receipt-preferences.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds,settleDocuments} from './core/settlement.js';
import {exportReceiptImage,receiptPng} from './receipt-image.js';

export async function checkReceiptSegmentsUI(context){
 const previous=receiptPreferences.showSegments.value;
 const host=document.createElement('div');document.body.append(host);let app;
 try{
  receiptPreferences.setShowSegments(false);
  const entry={id:'receipt-segments-check',name:'分段附表检查',businessDate:'2026-11-11',text:'新49各100\n\n新01各300\n\n新02各1250'};
  const parsed={...parseDocument(entry.text,entry),originalText:entry.text};
  const odds={新:defaultOdds()},draws={新:{market:'新',date:entry.businessDate,issue:'2026315',numbers:[1,2,3,4,5,6,49]}};
  const result=settleDocuments([parsed],draws,odds,entry.businessDate),inputs={kind:'current',selection:entry.id,documents:[parsed],draws,settings:{odds}};
  const before=JSON.stringify({result,inputs});
  app=createApp({render:()=>h(LedgerReceipt,{open:true,document:entry,result,inputs})});app.provide(SPACE_CONTEXT,context);app.mount(host);
  await nextTick();await nextTick();
  const dialog=[...document.querySelectorAll('.receipt-dialog[open]')].at(-1);
  const toggle=[...dialog.querySelectorAll('label')].find(el=>el.textContent==='附上分段表格')?.querySelector('input');
  const image=dialog.querySelector('.receipt-preview'),svg=()=>decodeURIComponent(image.src.split(',').slice(1).join(','));
  if(!toggle||toggle.checked||svg().includes('data-receipt-segments'))throw new Error('附表开关默认状态错误');
  toggle.click();await nextTick();await image.decode();
  const section=new DOMParser().parseFromString(svg(),'image/svg+xml').querySelector('[data-receipt-segments]');
  const values=[...section.querySelectorAll('text')].map(el=>el.textContent).join('|');
  if(values!=='段号|投注金额|1|100|2|300|3|1250')throw new Error('附表内容不一致：'+values);
  if(!createReceiptPreferences(localStorage).showSegments.value)throw new Error('附表选项未保存');
  const png=await receiptPng({svg:svg(),width:640,height:image.naturalHeight});
  const exported=await exportReceiptImage({dataUrl:png,name:'结算附表检查.png',action:'copy'});
  if(!exported.copied)throw new Error('拼接结算图片未复制');
  toggle.click();await nextTick();await image.decode();
  if(svg().includes('data-receipt-segments'))throw new Error('取消勾选仍显示附表');
  if(JSON.stringify({result,inputs})!==before)throw new Error('附表改动结算数据');
  return true;
 }finally{app?.unmount();host.remove();receiptPreferences.setShowSegments(previous);}
}
