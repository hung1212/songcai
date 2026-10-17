import {MARKETS,today,ruleForDate} from './rules.js';
import {DRAW_SOURCES,normalizeSources} from './draws.js';
import {compareDraws,normalizedIssue} from './draw-verification.js';
export function orderedDraws(records,sourceIds=[]){
  const rank=id=>{const i=sourceIds.indexOf(id);return i<0?sourceIds.length+1:i;};
  return [...records].sort((a,b)=>rank(a.sourceId)-rank(b.sourceId)||String(b.observedAt||'').localeCompare(String(a.observedAt||''))||a.id.localeCompare(b.id));
}
export function ledgerDrawSelection(all,settings,{mode='latest',date=today(),previous={},preserve=true,reports=[]}={}){
  if(!['latest','date'].includes(mode))throw new Error('开奖选择模式无效');ruleForDate(date);
  const sources=normalizeSources(settings.sources),drawIds={},drawDates={},choices={};
  for(const market of MARKETS){
    const eligible=(all[market]||[]).filter(d=>!DRAW_SOURCES.find(s=>s.id===d.sourceId)?.retired&&d.date<=today());
    const enabled=eligible.filter(d=>sources[market].includes(d.sourceId)||d.sourceId.startsWith('manual'));
    const latest=[...enabled].sort((a,b)=>b.date.localeCompare(a.date)||normalizedIssue(b.issue,b.date).localeCompare(normalizedIssue(a.issue,a.date),undefined,{numeric:true}))[0];
    const targetDate=mode==='latest'?(latest?.date||date):date;drawDates[market]=targetDate;
    choices[market]=orderedDraws(eligible.filter(d=>d.date===targetDate),sources[market]);
    const available=orderedDraws(enabled.filter(d=>d.date===targetDate&&(mode!=='latest'||normalizedIssue(d.issue,d.date)===normalizedIssue(latest.issue,latest.date))),sources[market]);
    const old=preserve&&available.find(d=>d.id===previous[market]);
    const first=old||available[0];
    if(!first){drawIds[market]='';continue;}
    const comparison=compareDraws(eligible,{market,date:targetDate,selectedId:first.id,sourceIds:sources[market],reports});
    drawIds[market]=comparison.status==='conflict'&&!old?'':first.id;
  }
  return {drawIds,drawDates,choices};
}
