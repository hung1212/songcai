import {createApp,h,nextTick} from 'vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {receiptPreferences} from './receipt-preferences.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds,settleDocuments} from './core/settlement.js';

export async function checkReceiptTextUI(context){
  const previous={name:receiptPreferences.showName.value,segments:receiptPreferences.showSegments.value};
  const host=document.createElement('div');document.body.append(host);let app,copied='';
  const clipboard=navigator.clipboard,descriptor=Object.getOwnPropertyDescriptor(clipboard,'writeText');
  const check=(value,message)=>{if(!value)throw new Error('结算文字：'+message);};
  try{
    receiptPreferences.setShowName(false);receiptPreferences.setShowSegments(false);
    Object.defineProperty(clipboard,'writeText',{configurable:true,value:async text=>{copied=text;}});
    const document={id:'receipt-text-check',name:'文字负责人',businessDate:'2026-11-22',text:'23各2\n23各5\n\n2连肖羊鸡、鸡虎各30\n平特兔150'};
    const parsed={...parseDocument(document.text,document),originalText:document.text};
    const draws={新:{market:'新',date:document.businessDate,issue:'2026326',numbers:[9,16,22,36,5,47,23]}},odds={新:defaultOdds()};
    const result=settleDocuments([parsed],draws,odds,document.businessDate),inputs={kind:'current',selection:document.id,documents:[parsed],draws,settings:{odds}};
    const original=JSON.stringify({result,inputs});
    app=createApp({render:()=>h(LedgerReceipt,{open:true,document,result,inputs})});app.provide(SPACE_CONTEXT,context);app.mount(host);
    await nextTick();await nextTick();
    const dialog=[...window.document.querySelectorAll('.receipt-dialog[open]')].at(-1),button=dialog.querySelector('.receipt-copy-text');
    check(button&&!button.disabled,'复制入口不可用');button.click();await nextTick();await nextTick();
    check(copied.includes('特码23：7 × 47 = 329元')&&copied.includes('2连肖羊鸡：30 × 4 = 120元')&&copied.includes('平特肖兔'),'复制内容缺少中奖组合');
    check(!copied.includes('文字负责人')&&dialog.querySelector('.receipt-success')?.textContent.includes('完整结算文字已复制'),'复制状态错误');
    [...dialog.querySelectorAll('.receipt-view-tabs button')].find(b=>b.textContent==='文字预览').click();await nextTick();
    check(dialog.querySelector('.receipt-text-preview')?.value===copied,'文字预览与复制不一致');
    const name=[...dialog.querySelectorAll('label')].find(l=>l.textContent==='显示账单名').querySelector('input');name.click();await nextTick();button.click();await nextTick();await nextTick();
    check(copied.startsWith('文字负责人\n'),'姓名开关未同步');
    Object.defineProperty(clipboard,'writeText',{configurable:true,value:async()=>{throw new Error('测试剪贴板失败');}});
    button.click();await nextTick();await nextTick();check(dialog.querySelector('.receipt-error')?.textContent.includes('全选复制')&&dialog.querySelector('.receipt-text-preview'),'失败未提供文字预览');
    check(JSON.stringify({result,inputs})===original,'复制修改了结算快照');
    return true;
  }finally{if(descriptor)Object.defineProperty(clipboard,'writeText',descriptor);else delete clipboard.writeText;app?.unmount();host.remove();receiptPreferences.setShowName(previous.name);receiptPreferences.setShowSegments(previous.segments);}
}
