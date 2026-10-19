import fs from 'node:fs';
import assert from 'node:assert/strict';
import {settleBet} from '../../src/core/settlement.js';
import {ruleForDate} from '../../src/core/rules.js';
const root=new URL('./',import.meta.url),load=name=>JSON.parse(fs.readFileSync(new URL(name,root)));
const settings=load(fs.existsSync(new URL('settings.json',root))?'settings.json':'settings.example.json'),rows=load('results.json').rows;
const odds=settings.spaces.find(s=>s.id===settings.activeSpaceId).odds.新;
const numbers=Array.from({length:49},(_,i)=>i+1),date='2026-10-15',rule=ruleForDate(date);
function C(n,k){if(n<k||k<0)return 0;let v=1n;for(let i=1;i<=k;i++)v=v*BigInt(n-i+1)/BigInt(i);return Number(v);}
let settlements=0;
function payout(bet,draw,config){
  const result=settleBet({status:'parsed',assigned:true,businessDate:date,markets:['新'],unitCents:10000,perMarketCents:10000,...bet},
    {date,issue:'2026288',numbers:draw,market:'新',sourceId:'manual'},config,Date.parse('2026-10-16T00:00:00+08:00'));
  assert.notEqual(result.status,'pending',result.note);settlements++;return result.payoutCents/10000;
}
function distribution(groups,callback){
  const occupied=new Set(groups.flat()),all=[...groups,numbers.filter(n=>!occupied.has(n))];
  function recurse(index,left,weight,selected){
    if(index===all.length){if(!left)callback(selected,weight);return;}
    for(let count=0;count<=Math.min(left,all[index].length);count++)recurse(index+1,left-count,weight*C(all[index].length,count),[...selected,...all[index].slice(0,count)]);
  }
  recurse(0,7,1,[]);
}
for(const row of rows){
  const config=structuredClone(odds),key=row.rateKey;
  let bet,groups,rtp;
  const horse=row.label.includes('含马')?!row.label.includes('不含马'):row.label.endsWith('：马');
  const zero=row.label.includes('含0尾')&&!row.label.includes('不含0尾');
  const isSingle=['特码','特肖 / 多肖中特','波色','半波','49和局待确认'].includes(row.group);
  if(key==='special-number')bet={playType:key,values:[1]};
  else if(key==='special-zodiac')bet={playType:key,values:[horse?'马':'鼠']};
  else if(key.startsWith('any-')){
    const size=Number(key.split('-')[1]);const values=[...(horse?['马']:[]),...Object.keys(rule.zodiac).filter(a=>a!=='马')].slice(0,size);
    bet={playType:'special-zodiac-any',size,values};
    if(size===6)config.refund49.sixZodiac=row.refundProbability.value>0;
  }else if(key.startsWith('wave-'))bet={playType:'wave',values:[key.slice(5)]};
  else if(key.startsWith('half-'))bet={playType:'half-wave',values:[key.slice(5)]};
  else if(key==='attribute'){bet={playType:key,values:[row.label.split('：')[0]]};config.refund49.attribute=row.refundProbability.value>0;}
  else if(key.startsWith('zodiac-')){
    const size=Number(key.split('-')[1]),values=[...(horse?['马']:[]),...Object.keys(rule.zodiac).filter(a=>a!=='马')].slice(0,size);
    bet={playType:'linked-zodiac',size,values};groups=values.map(a=>rule.zodiac[a]);
  }else if(key.startsWith('tail-')){
    const size=Number(key.split('-')[1]),values=Array.from({length:size},(_,i)=>i+(zero?0:1));
    bet={playType:'linked-tail',size,values};groups=values.map(v=>numbers.filter(n=>n%10===v));
  }else if(key==='flat-zodiac'){
    const value=horse?'马':'鼠';bet={playType:key,values:[value]};groups=[rule.zodiac[value]];
  }else if(['flat-tail','zero-tail'].includes(key)){
    const value=key==='zero-tail'?0:1;bet={playType:'flat-tail',values:[value]};groups=[numbers.filter(n=>n%10===value)];
  }else if(key==='flat-number'){
    bet={playType:key,play:row.label.startsWith('平特号码')?'平特号码':'平码',values:numbers};rtp=payout(bet,[1,2,3,4,5,6,7],config)/49;
  }else{
    const type=key.startsWith('three-')?'linked-number-3-2':key.startsWith('two-')?'linked-number-2-special':key.startsWith('flat-any-')?'flat-any':key.startsWith('not-hit-')?'not-hit':key;
    const size=['linked-number-3-2','linked-number-3-3'].includes(type)?3:['special-pair','linked-number-2-2','linked-number-2-special'].includes(type)?2:Number(key.split('-').at(-1));
    if(row.tiers)for(const tier of row.tiers)config.rates[tier.key].rate=String(tier.rate);
    bet={playType:type,size,values:numbers};rtp=payout(bet,[1,2,3,4,5,6,7],config)/C(49,size);
  }
  if(isSingle)rtp=numbers.reduce((sum,special)=>sum+payout(bet,[...numbers.filter(n=>n!==special).slice(0,6),special],config),0)/49;
  else if(groups){let weighted=0,total=0;distribution(groups,(draw,weight)=>{weighted+=payout(bet,draw,config)*weight;total+=weight;});assert.equal(total,C(49,7));rtp=weighted/total;}
  assert(Math.abs(rtp-row.rtp.value)<1e-10,`${row.label}: engine=${rtp}, formula=${row.rtp.value}`);
}
const report={date,rowsVerified:rows.length,settlementEvaluations:settlements,allSavedRateKeys:52,method:'Exact weighted category occupancy and full-combination settlement against current settleBet',passed:true};
fs.writeFileSync(new URL('verification.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
