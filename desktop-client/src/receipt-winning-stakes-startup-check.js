import {createApp,h,nextTick} from 'vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {receiptPreferences} from './receipt-preferences.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds,settleDocuments} from './core/settlement.js';

export async function checkReceiptWinningStakesUI(context){
  const originalName=receiptPreferences.showName.value,originalStakes=receiptPreferences.showPlayStakes.value;
  try{
    receiptPreferences.setShowName(false);receiptPreferences.setShowPlayStakes(false);
    for(const history of [true,false]){
      const entry={id:'receipt-winning-stakes',name:'中奖金额构成示例',text:'新特码05各2\n新特码05各5\n新特码20各938',businessDate:'2026-10-20'};
      const parsed=parseDocument(entry.text,entry),odds={新:defaultOdds()},draws={新:{market:'新',date:entry.businessDate,issue:'2026293',numbers:[38,10,48,49,13,9,5]}};
      const result=settleDocuments([parsed],draws,odds,entry.businessDate),inputs={kind:'current',selection:entry.id,documents:[parsed],draws,settings:{odds}};
      const before=JSON.stringify({result,inputs}),host=document.createElement('div');document.body.append(host);
      const app=createApp({render:()=>h(LedgerReceipt,{open:true,document:entry,result,inputs,history})});
      app.provide(SPACE_CONTEXT,context);app.mount(host);
      try{
        await nextTick();await nextTick();
        const dialog=[...document.querySelectorAll('.receipt-dialog[open]')].at(-1),image=dialog.querySelector('.receipt-preview');
        await image.decode();
        const svg=decodeURIComponent(image.src.split(',').slice(1).join(',')),dom=new DOMParser().parseFromString(svg,'image/svg+xml');
        const rows=[...dom.querySelectorAll('[data-winning-stakes]')];
        if(rows.length!==1||rows[0].textContent!=='中奖投注：2＋5＝7元')throw new Error('结算单未正确展示中奖金额构成');
        if(!dialog.querySelector('.receipt-accessible').textContent.includes('中奖投注：2＋5＝7元'))throw new Error('中奖金额文字说明缺失');
        for(const text of ['总投注945元','赔付329元','亏616元'])if(!image.alt.includes(text))throw new Error('中奖金额明细影响了原结算总额');
        if(!svg.includes('7 × 47')||svg.includes('938'))throw new Error('中奖主行或亏损投注过滤有误');
        const save=[...dialog.querySelectorAll('.receipt-export-actions button')].find(b=>b.textContent==='保存图片');
        save.click();
        for(let retry=0;retry<80&&!dialog.querySelector('.receipt-success')&&!dialog.querySelector('.receipt-error');retry++)await new Promise(resolve=>setTimeout(resolve,50));
        if(!dialog.querySelector('.receipt-success')?.textContent.includes('图片已保存'))throw new Error('中奖金额构成截图导出失败：'+dialog.querySelector('.receipt-error')?.textContent);
        if(JSON.stringify({result,inputs})!==before)throw new Error('中奖金额展示修改了结算快照');
      }finally{app.unmount();host.remove();}
    }
    return true;
  }finally{receiptPreferences.setShowName(originalName);receiptPreferences.setShowPlayStakes(originalStakes);}
}
