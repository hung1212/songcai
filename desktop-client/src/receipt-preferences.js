import {ref,readonly} from 'vue';

export const RECEIPT_PREFERENCES_KEY='songcai.receipt.shared.v1';
export function createReceiptPreferences(storage){
  const visible=ref(false),playStakes=ref(false);
  const read=()=>{try{const saved=JSON.parse(storage?.getItem(RECEIPT_PREFERENCES_KEY)||'null');return {showName:saved?.showName===true,showPlayStakes:saved?.showPlayStakes===true};}catch{return {showName:false,showPlayStakes:false};}};
  const apply=saved=>{visible.value=saved.showName;playStakes.value=saved.showPlayStakes;};
  const reload=()=>apply(read());
  const save=(key,value)=>{
    if(!storage)throw new Error('无法保存结算单显示设置');
    const saved={...read(),[key]:value===true};
    storage.setItem(RECEIPT_PREFERENCES_KEY,JSON.stringify(saved));apply(saved);
  };
  reload();
  return {showName:readonly(visible),showPlayStakes:readonly(playStakes),reload,
    setShowName:value=>save('showName',value),setShowPlayStakes:value=>save('showPlayStakes',value)};
}
let storage;try{storage=globalThis.localStorage;}catch{}
// One preference for every ledger and space, including historical receipts.
export const receiptPreferences=createReceiptPreferences(storage);
globalThis.addEventListener?.('storage',event=>{if(event.key===RECEIPT_PREFERENCES_KEY||event.key===null)receiptPreferences.reload();});
