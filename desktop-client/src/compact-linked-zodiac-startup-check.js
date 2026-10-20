import {createApp,h,nextTick} from 'vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds,settleDocuments} from './core/settlement.js';
import {ledgerReceipt,receiptPages,receiptSvg} from './core/ledger-receipt.js';
import {receiptPng} from './receipt-image.js';

// Synthetic data only, run inside the isolated packaged startup check.
export async function checkCompactLinkedZodiacUI(context){
  const entry={id:'compact-linked-check',name:'副号',businessDate:'2026-10-05',text:'副号：\n新澳特：19、29、39。各15元。\n复四肖：兔虎牛羊马蛇。各5元。'};
  const parsed=parseDocument(entry.text,entry),odds={新:defaultOdds()},rebates={副号:{perTenThousandCents:30000,playRates:{'linked-zodiac-4':100000}}};
  const draws={新:{market:'新',date:'2026-10-19',issue:'2026292',numbers:[39,10,18,23,16,4,36]}},drawDates={新:'2026-10-19'};
  const result=settleDocuments([parsed],draws,odds,entry.businessDate,{drawDates,rebates});
  const inputs={kind:'current',selection:entry.id,documents:[parsed],date:entry.businessDate,drawDates,draws,settings:{odds,rebates}};
  if(parsed.issues.length||parsed.bets[1]?.count!==15||result.players.length!==1||result.stakeCents!==12000||result.payoutCents!==0||result.rebateCents!==885)throw new Error('复四肖未保留正确分组、玩家及退水');
  const host=document.createElement('div');document.body.append(host);
  const app=createApp({render:()=>h(LedgerReceipt,{open:true,document:entry,result,inputs})});app.provide(SPACE_CONTEXT,context);app.mount(host);
  try{
    await nextTick();await nextTick();
    const dialog=[...document.querySelectorAll('.receipt-dialog[open]')].at(-1),image=dialog?.querySelector('.receipt-preview');
    if(!image)throw new Error('缺少复式连肖结算预览');await image.decode();
    const content=dialog.querySelector('.receipt-accessible').textContent;
    for(const expected of ['特码退水：1.35元','4连肖退水：7.5元','应付：8.85'])if(!content.includes(expected))throw new Error('复式连肖界面缺少'+expected);
    const card=ledgerReceipt({document:entry,result,inputs});
    if(card.rebateTurnoverCents!==12000||card.netCents!==-11115)throw new Error('复式连肖截图汇总错误');
    if(!(await receiptPng(receiptSvg(receiptPages(card)[0]))).startsWith('data:image/png;'))throw new Error('复式连肖截图生成失败');
    return true;
  }finally{app.unmount();host.remove();}
}
