import {createApp,h,nextTick} from 'vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {receiptPreferences,createReceiptPreferences} from './receipt-preferences.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds,settleDocuments} from './core/settlement.js';
import {exportReceiptImage,receiptPng} from './receipt-image.js';

export async function checkReceiptPlayStakesUI(context){
  const originalName=receiptPreferences.showName.value,originalStakes=receiptPreferences.showPlayStakes.value;
  try{
    receiptPreferences.setShowName(false);receiptPreferences.setShowPlayStakes(false);
    for(const index of [0,1]){
      const entry={id:'receipt-play-stakes-'+index,name:'玩法投注显示测试',text:'新特码49各10\n新特码20各90\n新平特蛇各20\n新特肖虎各30',businessDate:'2026-10-05'};
      const parsed=parseDocument(entry.text,entry),odds={新:defaultOdds()},draws={新:{market:'新',date:entry.businessDate,issue:'2026278',numbers:[1,2,3,4,5,6,49]}};
      const result=settleDocuments([parsed],draws,odds,entry.businessDate),inputs={kind:'current',selection:entry.id,documents:[parsed],draws,settings:{odds}};
      const before=JSON.stringify({result,inputs}),host=document.createElement('div');document.body.append(host);
      const app=createApp({render:()=>h(LedgerReceipt,{open:true,document:entry,result,inputs,history:Boolean(index)})});
      app.provide(SPACE_CONTEXT,index?{...context,id:'another-space'}:context);app.mount(host);
      try{
        await nextTick();await nextTick();
        const dialog=[...document.querySelectorAll('.receipt-dialog[open]')].at(-1),image=dialog.querySelector('.receipt-preview');
        const toggle=[...dialog.querySelectorAll('.receipt-display-settings label')].find(label=>label.textContent==='显示各玩法投注金额')?.querySelector('input');
        const nameToggle=dialog.querySelector('.receipt-display-settings input'),svg=()=>decodeURIComponent(image.src.split(',').slice(1).join(','));
        if(!toggle||toggle.checked!==Boolean(index)||svg().includes('各玩法投注金额')!==Boolean(index))throw new Error('玩法投注开关默认值或跨账单配置丢失');
        if(!index){toggle.click();await nextTick();}
        await image.decode();
        const section=new DOMParser().parseFromString(svg(),'image/svg+xml').querySelector('[data-receipt-play-stakes]');
        const amounts=[...section.querySelectorAll('[data-stake-play]')].map(row=>row.textContent);
        if(amounts.join('|')!=='特码投注100 元|特肖投注30 元|平特肖投注20 元')throw new Error('玩法投注没有统计全部投注金额：'+amounts.join('|'));
        for(const text of ['特码投注100元','特肖投注30元','平特肖投注20元'])if(!image.alt.includes(text)||!dialog.querySelector('.receipt-accessible').textContent.includes(text))throw new Error('玩法投注文字说明未同步');
        if(!createReceiptPreferences(localStorage).showPlayStakes.value)throw new Error('玩法投注开关未保存');
        nameToggle.click();await nextTick();
        if(!toggle.checked||!svg().includes(entry.name))throw new Error('账单名开关覆盖玩法金额设置');
        nameToggle.click();await nextTick();await image.decode();
        const dataUrl=await receiptPng({svg:svg(),width:640,height:image.naturalHeight});
        if(!dataUrl.startsWith('data:image/png;'))throw new Error('玩法投注图片无法导出');
        if(!index){
          const exported=await exportReceiptImage({dataUrl,name:'各玩法投注金额示例.png',action:'save'});
          if(!exported.saved)throw new Error('玩法投注图片未保存');
        }else{
          toggle.click();await nextTick();await image.decode();
          if(svg().includes('各玩法投注金额')||image.alt.includes('特码投注100元')||createReceiptPreferences(localStorage).showPlayStakes.value)throw new Error('关闭玩法金额后预览或配置未同步');
        }
        if(JSON.stringify({result,inputs})!==before)throw new Error('显示开关修改了结算快照');
      }finally{app.unmount();host.remove();}
    }
    return true;
  }finally{receiptPreferences.setShowName(originalName);receiptPreferences.setShowPlayStakes(originalStakes);}
}
