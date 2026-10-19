import { parseDocument, summarize } from './parser.js';
import { parseDocument as legacyParse } from './legacy/parser-v044.js';
import { PARSER_VERSION } from './business-syntax.js';
import { SEMANTIC_VERSION } from './semantic-rules.js';
import { settleDocuments } from './settlement.js';

const fields=['playerId','player','markets','playType','size','basis','values','groups','count','unitCents','totalCents','status'];
function row(b){return Object.fromEntries(['line','endLine','play',...fields].map(k=>[k,b[k]??null]));}
export function parsingSnapshot(parsed){
  return {totalCents:summarize([parsed]).totalCents,bets:parsed.bets.map(row),issues:parsed.issues.filter(i=>i.severity!=='warning').map(i=>({line:i.line,endLine:i.endLine,code:i.code,message:i.message}))};
}
export function compareParsing(before,after) {
  const lines=[...new Set([...before.bets,...after.bets,...before.issues,...after.issues].map(b=>b.line))].sort((a,b)=>a-b);
  return lines.flatMap(line=>{
    const old=before.bets.filter(b=>b.line===line),next=after.bets.filter(b=>b.line===line);
    const oldIssues=before.issues.filter(i=>i.line===line),nextIssues=after.issues.filter(i=>i.line===line);
    const value=(b,k)=>k==='playerId'&&b[k]?.startsWith('document:')?'@document-owner':b[k];
    const changedFields=fields.filter(k=>JSON.stringify(old.map(b=>value(b,k)))!==JSON.stringify(next.map(b=>value(b,k))));
    if(!changedFields.length&&JSON.stringify(oldIssues.map(i=>i.code))===JSON.stringify(nextIssues.map(i=>i.code)))return [];
    return [{line,before:old,after:next,beforeIssues:oldIssues,afterIssues:nextIssues,changedFields}];
  });
}
export function upgradeDocument(doc){
  if(doc.parserVersion===PARSER_VERSION&&(!doc.parserReview||doc.parserReview.status==='automatic'))return doc;
  // Keep the original audit record, including old manual decisions, but never
  // require approval of a deterministic parser correction.
  const next={...doc,autoTitle:doc.name?.trim()?false:doc.autoTitle,parserVersion:PARSER_VERSION};
  if(doc.parserReview){
    next.parserReview={...doc.parserReview,status:'automatic',toVersion:PARSER_VERSION,appliedAt:new Date().toISOString()};
    return next;
  }
  // Only unversioned ledgers need the frozen pre-upgrade baseline. Later
  // releases must not mislabel the 0.4.4 parser as the previous saved version.
  if(doc.parserVersion)return next;
  const original={id:doc.id,name:doc.name,text:doc.text,businessDate:doc.businessDate,defaultPlayer:doc.defaultPlayer||'',...(doc.assistance?{assistance:doc.assistance}:{})};
  const before=parsingSnapshot(legacyParse(doc.text,original));
  const after=parsingSnapshot(parseDocument(doc.text,{...original,parserReview:undefined}));
  const changes=compareParsing(before,after);
  const staleDecisions=doc.assistance?.version!==SEMANTIC_VERSION&&doc.assistance?.items?.some(i=>['accepted','original'].includes(i.status));
  if(changes.length||staleDecisions)next.parserReview={fromVersion:'0.4.4',toVersion:PARSER_VERSION,status:'automatic',original,before,staleDecisions:!!staleDecisions,createdAt:new Date().toISOString(),appliedAt:new Date().toISOString()};
  return next;
}
export function upgradeProject(project){
  const documents=project.documents.map(upgradeDocument);
  return documents.every((d,i)=>d===project.documents[i])?project:{...project,documents};
}
export function upgradeComparison(doc){
  if(!doc.parserReview)return null;
  const parsed=parseDocument(doc.text,{...doc,parserReview:undefined});
  const after=parsingSnapshot(parsed),before=doc.parserReview.before;
  return {before,after,changes:compareParsing(before,after),errors:parsed.issues.filter(i=>i.severity!=='warning'),staleDecisions:doc.parserReview.staleDecisions};
}
export function validateParserReview(value){
  if(value==null)return undefined;
  if(!value||!['pending','accepted','automatic'].includes(value.status)||typeof value.toVersion!=='string'||!value.original||typeof value.original.text!=='string'||!Array.isArray(value.before?.bets)||!Array.isArray(value.before?.issues)||!Number.isSafeInteger(value.before?.totalCents))throw new Error('解析升级记录格式无效');
  if(JSON.stringify(value).length>12_000_000)throw new Error('解析升级复核记录过大');
  return JSON.parse(JSON.stringify(value));
}

// Calculate against the exact stored draw and odds. Never write back to the old
// snapshot or silently substitute today's draw. Missing originals stay explicit.
export function reviewSettlement(snapshot){
  const stored=snapshot.inputs?.documents||[];
  if(stored.every(d=>d.parserVersion===PARSER_VERSION))return null;
  const changed=[],documents=[];
  for(const d of stored){
    if(typeof d.originalText!=='string')return {required:true,message:'旧版本缺少完整原文，需人工核对，原赔付记录保留。'};
    const options={id:d.id,name:d.name,businessDate:d.rule?.date||snapshot.inputs.date,defaultPlayer:d.defaultPlayer||'',assistance:d.assistance};
    // Preserve an explicitly bound single player from older snapshots, which
    // did not store defaultPlayer as a document field.
    if(!options.defaultPlayer&&!d.contexts?.some(c=>c.playerId?.startsWith('document:'))&&d.metadata?.every(m=>m.kind!=='发送人')&&new Set(d.bets.map(b=>b.playerId)).size===1)options.defaultPlayer=d.bets[0]?.player||'';
    const parsed=parseDocument(d.originalText,options);documents.push(parsed);
    const changes=compareParsing(parsingSnapshot(d),parsingSnapshot(parsed));
    if(changes.length)changed.push({id:d.id,name:d.name,changes});
  }
  if(!changed.length)return null;
  const result=settleDocuments(documents,snapshot.inputs.draws,snapshot.inputs.settings.odds,snapshot.inputs.date,{drawDates:snapshot.inputs.drawDates,rebates:snapshot.inputs.settings.rebates,playerOdds:snapshot.inputs.settings.playerOdds});
  return {required:true,message:'解析升级发现差异，以下为原开奖、原赔率下的复算；已保存版本保持不变。',documents:changed,beforeStakeCents:snapshot.result.stakeCents,afterStakeCents:result.stakeCents,beforePayoutCents:snapshot.result.payoutCents,afterPayoutCents:result.complete?result.payoutCents:null,complete:result.complete,result};
}
