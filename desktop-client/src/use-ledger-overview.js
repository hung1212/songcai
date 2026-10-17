import {readSpaceChoice,writeSpaceChoice} from './space-context.js';
import {computed,ref,watch} from 'vue';
import {browserSettlement} from './settlement-preview.js';
import {ledgerDrawSelection} from './core/draw-selection.js';
import {verifyDraws} from './core/draw-verification.js';
import {ledgerOverview} from './core/ledger-overview.js';
import {MARKETS,today,ruleForDate} from './core/rules.js';

export function useLedgerOverview(results,getDocuments,space={id:'default',api:window.songcai}) {
  const key='songcai.overview.draw-choice',choice=readSpaceChoice(key,space.id);
  const api=space.api?.settlement||browserSettlement(getDocuments,space.id);
  const loaded=ref(null),busy=ref(false),error=ref(''),mode=ref(choice.mode||'latest'),drawDate=ref(choice.date||today()),manualIds=ref(choice.ids||{}),decisions=ref(choice.decisions||{});
  watch([mode,drawDate,manualIds,decisions],()=>writeSpaceChoice(key,space.id,{mode:mode.value,date:drawDate.value,ids:manualIds.value,decisions:decisions.value}),{deep:true});
  let token=0;
  const selection=computed(()=>loaded.value?ledgerDrawSelection(loaded.value.draws,loaded.value.settings,{mode:mode.value,date:mode.value==='latest'?today():drawDate.value,previous:manualIds.value,reports:loaded.value.reports}):null);
  const verification=computed(()=>loaded.value&&selection.value?verifyDraws(loaded.value.draws,loaded.value.settings,selection.value.drawDates,selection.value.drawIds,decisions.value,loaded.value.reports):{});
  const draws=computed(()=>Object.fromEntries(MARKETS.flatMap(m=>{
    const draw=loaded.value?.draws[m]?.find(d=>d.id===selection.value?.drawIds[m]);return draw?[[m,draw]]:[];
  })));
  // Collection highlights always use the newest draw in each market, even
  // while the overview is inspecting a historical date.
  const latest=computed(()=>{
    if(!loaded.value)return {draws:{},verification:{},odds:{}};
    const cache=loaded.value;
    const selected=ledgerDrawSelection(cache.draws,cache.settings,{mode:'latest',previous:manualIds.value,reports:cache.reports});
    const checks=verifyDraws(cache.draws,cache.settings,selected.drawDates,selected.drawIds,decisions.value,cache.reports);
    const picked=Object.fromEntries(MARKETS.flatMap(m=>{const d=cache.draws[m]?.find(d=>d.id===selected.drawIds[m]);return d?[[m,d]]:[];}));
    return {draws:picked,verification:checks,odds:cache.settings.odds};
  });
  const calculation=computed(()=>{try{return {value:loaded.value?ledgerOverview(results.value,draws.value,loaded.value.settings,verification.value,selection.value.drawDates):null,error:''};}catch(e){return {value:null,error:e.message};}});
  const overview=computed(()=>calculation.value.value),problem=computed(()=>error.value||calculation.value.error);
  async function refresh({sync=false,latest=false,auto=false}={}) {
    const current=++token;busy.value=true;error.value='';
    const useLatest=latest||mode.value==='latest',date=useLatest?today():drawDate.value;
    try {
      const cache=await api.load({date,allDates:true});if(current!==token)return;loaded.value=cache;
      if(sync){await api.sync({date,latest:useLatest,auto});const next=await api.load({date,allDates:true});if(current===token)loaded.value=next;}
    }catch(e){if(current===token)error.value=e.message;}finally{if(current===token)busy.value=false;}
  }
  async function changeMode(value,date=drawDate.value){
    const chosen=value==='latest'?today():date;
    try{ruleForDate(chosen);}catch(e){error.value='请选择有效的开奖日期';return;}
    mode.value=value;drawDate.value=chosen;manualIds.value={};decisions.value={};await refresh();
  }
  function adopt(m,id){manualIds.value={...manualIds.value,[m]:id};const check=verification.value[m];decisions.value={...decisions.value,[m]:{drawId:id,reviewKey:check.reviewKey}};}
  function select(m,id){manualIds.value={...manualIds.value,[m]:id};decisions.value={...decisions.value,[m]:undefined};}
  return {overview,loaded,busy,problem,mode,drawDate,selection,verification,draws,latest,refresh,changeMode,adopt,select};
}
