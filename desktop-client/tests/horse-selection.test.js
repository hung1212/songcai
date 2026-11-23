import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {statementEvidence,canonicalPlayText} from '../src/core/business-syntax.js';
import {highlightText} from '../src/core/highlight.js';
import {assistanceFor,reviewInput,validateCandidate} from '../src/core/ai-review.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
const source='预备号: \n新门特马狗猴蛇各20';
const doc=(text=source,businessDate='2026-11-11')=>({id:'horse',name:'副号',text,businessDate,defaultPlayer:''});
const parse=d=>parseDocument(d.text,d);
test('特马狗猴蛇：特是玩法，马是选号，17号各20共340，马号中奖按特码赔付',()=>{
 const p=parse(doc()),b=p.bets[0];assert.deepEqual(p.issues,[]);assert.equal(b.playerId,'预备号');assert.deepEqual(b.markets,['新']);assert.equal(b.playType,'special-number');assert.equal(b.count,17);assert.equal(b.unitCents,2000);assert.equal(summarize([p]).totalCents,34000);
 for(const n of [1,13,25,37,49])assert(b.values.includes(n));
 assert.equal(settleBet(b,{id:'horse-draw',market:'新',issue:'2026315',date:'2026-11-11',sourceId:'manual',numbers:[3,4,5,6,7,8,49]},defaultOdds()).payoutCents,94000);
 for(const text of ['新门特 马 狗 猴 蛇 各２０','新门特马、狗、猴、蛇各二十','新门特马各20','新门特马20']){const d=doc(text),p=parse(d);assert.deepEqual(p.issues,[],text);assert(p.bets[0].values.includes(49),text);assert.equal(canonicalPlayText(canonicalPlayText(text)),canonicalPlayText(text));}
 assert.equal(summarize([parse(doc(source,'2027-03-01'))]).totalCents,32000);
});
test('明确号码列表的特马别字及平特马、特肖马、特包马均不受影响',()=>{
 for(const text of ['特马01 02各20','特马\n01 02各20'])assert.equal(summarize([parse(doc(text))]).totalCents,4000);
 for(const [text,type,total] of [['平特马各20','flat-zodiac',2000],['特肖马各20','special-zodiac',2000],['特包马40','special-number',4000]]){const p=parse(doc(text));assert.deepEqual(p.issues,[],text);assert.equal(p.bets[0].playType,type);assert.equal(summarize([p]).totalCents,total);}
});
test('原文高亮与核验均保留马，旧漏马AI解释失效，新候选也不能漏掉马',()=>{
 const text=source.split('\n')[1],tokens=highlightText(text);assert.equal(tokens.map(t=>t.text).join(''),text);assert(tokens.some(t=>t.kind==='selection'&&t.text.includes('马')));
 const evidence=statementEvidence(text);assert(evidence.some(e=>e.field==='selection'&&e.quote==='马'));assert(evidence.some(e=>e.field==='play'&&e.quote==='特'));
 const d=doc(),item=reviewInput(d,'all').items.find(i=>i.line===2);
 const candidate={markets:['新'],play:'特码',selection:'马狗猴蛇',basis:'每号',amount:'20',evidence:{market:'新门',play:'特',selection:'马狗猴蛇',amount:'20'}};
 assert.equal(validateCandidate({bets:[candidate]},item,d).totalCents,34000);
 assert.throws(()=>validateCandidate({bets:[{...candidate,selection:'狗猴蛇',evidence:{...candidate.evidence,selection:'狗猴蛇'}}]},item,d),/选号|计费/);
 d.assistance={...assistanceFor(d,[{line:2,source:text,status:'accepted',replacement:'新 特码狗猴蛇各20'}]),version:'semantic-20261022-1'};
 assert.equal(summarize([parse(d)]).totalCents,34000);
});
