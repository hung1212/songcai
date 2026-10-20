import {createApp,h,nextTick} from 'vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {receiptPreferences,RECEIPT_PREFERENCES_KEY} from './receipt-preferences.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds,settleDocuments} from './core/settlement.js';
import {receiptPng} from './receipt-image.js';

export async function checkReceiptNameUI(context){
  const original=receiptPreferences.showName.value;
  try{
    receiptPreferences.setShowName(false);
    for(const [index,name] of ['账单名称测试','另一空间账单名称'].entries()){
      const entry={id:'receipt-name-'+index,name,text:'49各10',businessDate:'2026-10-05'},parsed=parseDocument(entry.text,entry);
      const odds={新:defaultOdds()},draws={新:{market:'新',date:entry.businessDate,issue:'2026278',numbers:[1,2,3,4,5,6,49]}};
      const result=settleDocuments([parsed],draws,odds,entry.businessDate),inputs={kind:'current',selection:entry.id,documents:[parsed],date:entry.businessDate,draws,settings:{odds}};
      const host=document.createElement('div');document.body.append(host);
      const app=createApp({render:()=>h(LedgerReceipt,{open:true,document:entry,result,inputs})});app.provide(SPACE_CONTEXT,index?{...context,id:'another-space'}:context);app.mount(host);
      try{
        await nextTick();await nextTick();
        const dialog=[...document.querySelectorAll('.receipt-dialog[open]')].at(-1),toggle=dialog.querySelector('.receipt-display-settings input'),image=dialog.querySelector('.receipt-preview');
        const svg=()=>decodeURIComponent(image.src.split(',').slice(1).join(','));
        if(toggle.checked!==Boolean(index)||svg().includes(name)!==Boolean(index))throw new Error('账单名默认值或跨账单配置丢失');
        toggle.click();await nextTick();await image.decode();
        if(toggle.checked!==!index||svg().includes(name)!==!index||image.alt.includes(name)!==!index)throw new Error('账单名开关未同步预览');
        if(JSON.parse(localStorage.getItem(RECEIPT_PREFERENCES_KEY)).showName!==!index)throw new Error('账单名设置未保存');
        if(!(await receiptPng({svg:svg(),width:image.naturalWidth,height:image.naturalHeight})).startsWith('data:image/png;'))throw new Error('账单名设置下的图片无法导出');
      }finally{app.unmount();host.remove();}
    }
    return true;
  }finally{receiptPreferences.setShowName(original);}
}
