import {spaceKey} from './space-context.js';
import {reviewSettlement} from './core/parser-upgrade.js';
import { defaultOdds, validateOdds, validateRebates, settleDocuments } from './core/settlement.js';
import { validateDraw, manualDraw, DRAW_SOURCES, DRAW_REFERENCES, DEFAULT_DRAW_SOURCES, normalizeSources } from './core/draws.js';
import { verifyDraws, requireVerified } from './core/draw-verification.js';
import { parseDocument } from './core/parser.js';
import {ledgerDrawSelection} from './core/draw-selection.js';
import { MARKETS, ruleForDate } from './core/rules.js';
const KEY='songcai.settlement.preview.v1';
export function browserSettlement(getDocuments,spaceId='default') {
  const localKey=spaceKey(KEY,spaceId);
  const sharedDraws=()=>JSON.parse(localStorage.getItem(KEY)||'null')?.draws||[];
  const state=()=>{const s=JSON.parse(localStorage.getItem(localKey)||'null')||{settings:{revision:0,sources:DEFAULT_DRAW_SOURCES,odds:Object.fromEntries(MARKETS.map(m=>[m,defaultOdds()]))},draws:[],history:[]};if(!s.settings)s.settings={revision:0,sources:DEFAULT_DRAW_SOURCES,odds:Object.fromEntries(MARKETS.map(m=>[m,defaultOdds()]))};s.settings.rebates||={};s.history||=[];s.draws||=[];if(MARKETS.some(m=>!Array.isArray(s.settings.sources[m]))){s.settings.sources=normalizeSources(s.settings.sources,true);s.settings.revision++;localStorage.setItem(localKey,JSON.stringify(s));}if(spaceId!=='default')s.draws=sharedDraws();return s;};
  const save=value=>{if(spaceId!=='default'){const shared=JSON.parse(localStorage.getItem(KEY)||'null')||{};localStorage.setItem(KEY,JSON.stringify({...shared,draws:value.draws}));}localStorage.setItem(localKey,JSON.stringify(value));};
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');
  async function preview(input){
    if(input.kind==='inbox')throw new Error('收件箱赔付请在桌面客户端操作');
    const s=state();ruleForDate(input.date);
    const documents=getDocuments().filter(d=>d.businessDate===input.date&&(input.kind!=='current'||d.id===input.activeId)).map(d=>({...parseDocument(d.text,d),originalText:d.text}));
    if(input.drawMode&&(!['latest','date'].includes(input.drawMode)||input.kind!=='current'))throw new Error('开奖选择模式无效');
    if(input.drawMode==='date')ruleForDate(input.drawDate);
    const drawDates=input.drawMode?{}:null;
    const draws={};for(const m of MARKETS)if(input.drawIds[m]){const d=s.draws.find(d=>d.id===input.drawIds[m]);if(!d||d.market!==m||(!input.drawMode&&d.date!==input.date)||(input.drawMode==='date'&&d.date!==input.drawDate))throw new Error('开奖日期或市场不符');draws[m]=d;if(drawDates)drawDates[m]=d.date;}
    if(drawDates){const selected=ledgerDrawSelection(Object.fromEntries(MARKETS.map(m=>[m,s.draws.filter(d=>d.market===m)])),s.settings,{mode:input.drawMode,date:input.drawDate||input.date,preserve:false});for(const m of MARKETS)drawDates[m] ||= selected.drawDates[m];}
    const verification=verifyDraws(Object.fromEntries(MARKETS.map(m=>[m,s.draws.filter(d=>d.market===m)])),s.settings,drawDates?Object.fromEntries(MARKETS.map(m=>[m,drawDates[m]||input.drawDate||input.date])):input.date,input.drawIds,input.decisions);
    const inputs={spaceId,documents,draws,verification,settings:s.settings,date:input.date,kind:input.kind,selection:input.kind==='current'?input.activeId:'all',...(drawDates?{drawDates}:{})};
    return {inputHash:await digest(inputs),result:settleDocuments(documents,draws,s.settings.odds,input.date,{drawDates,rebates:s.settings.rebates}),draws,settings:s.settings,inputs};
  }
  return {
    players:async()=>[],
    load:async({date,allDates=false})=>{const s=state();return {settings:s.settings,reports:[],draws:Object.fromEntries(MARKETS.map(m=>[m,s.draws.filter(d=>d.market===m&&(allDates||d.date.startsWith(date.slice(0,4)))).sort((a,b)=>b.date.localeCompare(a.date))])),history:s.history.filter(h=>h.result.date===date).map(h=>({id:h.id,date,createdAt:h.createdAt,stakeCents:h.result.stakeCents,payoutCents:h.result.payoutCents,rebateCents:h.result.rebateCents||0,payableCents:h.result.payableCents??h.result.payoutCents,kind:h.inputs.kind,selection:h.inputs.selection,entries:h.result.entries.length,...(reviewSettlement(h)?.required?{parserReviewRequired:true}:{})}))};},
    settings:async input=>{const s=state();if(s.settings.revision!==input.revision)throw new Error('设置已有更新，请重新加载');for(const m of MARKETS){input.odds[m]=validateOdds(input.odds[m]);}s.settings=JSON.parse(JSON.stringify({...input,rebates:validateRebates(input.rebates??s.settings.rebates),sources:normalizeSources(input.sources),revision:input.revision+1}));save(s);return s.settings;},
    sync:async()=>{throw new Error('联网获取请使用桌面客户端；浏览器预览支持手动输入开奖并试算');},
    manual:async input=>{const s=state(),value=validateDraw(manualDraw(input));if(!s.draws.some(d=>JSON.stringify({...d,id:undefined,observedAt:undefined})===JSON.stringify(value)))s.draws.unshift({...value,id:crypto.randomUUID(),observedAt:new Date().toISOString()});save(s);return {added:1};},
    openSource:async({id})=>{const source=[...DRAW_SOURCES,...DRAW_REFERENCES].find(s=>s.id===id);if(!source)throw new Error('未知开奖来源');window.open(source.page,'_blank','noopener,noreferrer');},
    preview,
    save:async input=>{const p=await preview(input);if(input.inputHash!==p.inputHash)throw new Error('账目、开奖或赔率发生变化，请重新试算');if(!input.reviewed||!p.result.complete)throw new Error('请完成核对及待结算处理');for(const m of new Set(p.result.entries.map(e=>e.market)))if(!p.settings.odds[m].confirmed)throw new Error(`${m}市场赔率尚未确认`);requireVerified(p.result,p.inputs.verification);const s=state(),old=s.history.find(h=>h.inputHash===p.inputHash);if(old)return {...old,reused:true};const result={id:crypto.randomUUID(),createdAt:new Date().toISOString(),inputHash:p.inputHash,inputs:p.inputs,result:p.result,paid:false};s.history.unshift(result);save(s);return result;},
    get:async({id})=>{const h=state().history.find(h=>h.id===id);if(!h)throw new Error('记录不存在');const parserReview=reviewSettlement(h);return parserReview?{...h,parserReview}:h;},
  };
}
