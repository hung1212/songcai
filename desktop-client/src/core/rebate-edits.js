import {rebateInput,validateRebates} from './rebates.js';
export const rebateDraft=value=>({default:String((value?.perTenThousandCents||0)/100),plays:Object.fromEntries(Object.entries(value?.playRates||{}).map(([k,v])=>[k,String(v/100)]))});
const config=draft=>({perTenThousandCents:rebateInput(draft?.default||''),playRates:Object.fromEntries(Object.entries(draft?.plays||{}).filter(([,v])=>String(v).trim()!=='').map(([k,v])=>[k,rebateInput(v)]))});
const own=(object,key)=>object&&Object.hasOwn(object,key)?object[key]:undefined;

// Merge only edited fields into the newest settings; preserve another player's
// edits, other play rates and unrelated odds. A conflicting field stays unsaved.
export function mergeRebateEdits(original,latest,before,after,names={}) {
  const result=structuredClone(latest||{});
  for(const [id,draft] of Object.entries(after)) {
    const old=config(own(before,id)),next=config(draft),base=own(original,id)||{perTenThousandCents:0},current=own(latest,id)||{perTenThousandCents:0};
    const updated={...current,playRates:{...current.playRates}};let changed=false;
    function change(key,previous,intended,initial,now){
      if(previous===intended)return;
      if(now!==initial&&now!==intended)throw new Error(`${names[id]||id}的${key==='default'?'默认':key}退水已在其他页面修改，请重新载入后核对`);
      if(key==='default')updated.perTenThousandCents=intended;
      else if(intended===undefined)delete updated.playRates[key];
      else updated.playRates[key]=intended;
      changed=true;
    }
    change('default',old.perTenThousandCents,next.perTenThousandCents,base.perTenThousandCents||0,current.perTenThousandCents||0);
    for(const key of new Set([...Object.keys(old.playRates),...Object.keys(next.playRates)]))change(key,old.playRates[key],next.playRates[key],base.playRates?.[key],current.playRates?.[key]);
    if(changed)Object.defineProperty(result,id,{value:{...updated,...(names[id]?{name:names[id]}:{})},enumerable:true,writable:true,configurable:true});
  }
  return validateRebates(result);
}
