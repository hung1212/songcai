import {createApp,h,nextTick} from 'vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds,settleDocuments} from './core/settlement.js';
import {ledgerReceipt,receiptPages,receiptSvg} from './core/ledger-receipt.js';
import {receiptPng,exportReceiptImage} from './receipt-image.js';

// Only reached by the isolated packaged startup check; no live settings/data.
export async function checkIssueTitleRebateUI(context){
  const text='100元包狗，\n21，200元\n\n100包猪\n100包鼠\n\n09、300元\n\n澳289期：\n平肖虎100#\n2有虎蛇50#\n\n奥特34.22.30.42各五米、\n平特一肖虎五十米';
  const entry={id:'issue-title-check',name:'期号退水测试',text,businessDate:'2026-10-16'},parsed=parseDocument(text,entry);
  const odds={新:defaultOdds()},rebates={'document:issue-title-check:player':{perTenThousandCents:30000,playRates:{'flat-zodiac':10000,'linked-zodiac-2':10000}}};
  const draws={新:{market:'新',date:entry.businessDate,issue:'2026289',numbers:[12,29,19,28,47,34,38]}};
  const result=settleDocuments([parsed],draws,odds,entry.businessDate,{rebates});
  const inputs={kind:'current',selection:entry.id,documents:[parsed],date:entry.businessDate,draws,settings:{odds,rebates}};
  if(parsed.issues.length||result.players.length!==1||result.rebateCents!==2660||result.payableCents!==53410)throw new Error('期号标题未保留玩家及完整退水');
  const host=document.createElement('div');document.body.append(host);
  const app=createApp({render:()=>h(LedgerReceipt,{open:true,document:entry,result,inputs})});app.provide(SPACE_CONTEXT,context);app.mount(host);
  try{
    await nextTick();await nextTick();
    const dialog=[...document.querySelectorAll('.receipt-dialog[open]')].at(-1),image=dialog?.querySelector('.receipt-preview');
    if(!image)throw new Error('缺少期号退水结算预览');await image.decode();
    const content=dialog.querySelector('.receipt-accessible').textContent;
    for(const expected of ['特码退水：24.6元','平特肖退水：1.5元','2连肖退水：0.5元','应付：534.1'])if(!content.includes(expected))throw new Error('期号退水界面缺少'+expected);
    const card=ledgerReceipt({document:entry,result,inputs}),rendered=receiptSvg(receiptPages(card)[0]);
    if(card.rebateRows.length!==3||card.netCents!==-48590)throw new Error('期号退水截图汇总错误');
    await exportReceiptImage({dataUrl:await receiptPng(rendered),name:'期号标题退水核对.png',action:'copy'});
    return true;
  }finally{app.unmount();host.remove();}
}
