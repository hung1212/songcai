import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {senderHeader,playTokens,statementEvidence,structuralConflicts} from '../src/core/business-syntax.js';
import {highlightText} from '../src/core/highlight.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {defaultOdds,settleBet,settleDocuments} from '../src/core/settlement.js';
import {reviewSettlement,upgradeDocument} from '../src/core/parser-upgrade.js';

const date='2026-10-13';
const source='新澳平特任中一：44/75。\n香港平特任中一：32/75。';
const doc=text=>({id:'flat-any-suffix',name:'任中账目',text,businessDate:date,defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};
const odds=()=>({...defaultOdds(),confirmed:true});
const draw=(market,numbers)=>({market,date,issue:market==='港'?'26/111':'2026286',numbers});

test('用户任中一原文保留新澳香港市场和同一玩家，两组75元共150元',()=>{
  const p=valid(source);
  assert.deepEqual(p.bets.map(b=>[b.playType,b.size,b.values,b.markets,b.basis,b.count,b.unitCents,b.totalCents]),[
    ['flat-any',1,[44],['新'],'每组',1,7500,7500],['flat-any',1,[32],['港'],'每组',1,7500,7500],
  ]);
  assert.equal(new Set(p.bets.map(b=>b.playerId)).size,1);
  assert(p.bets.every(b=>b.player==='本单玩家（任中账目）'&&b.semantic.ruleId==='R39'));
  assert.deepEqual(summarize([p]).markets,{新:7500,旧:0,港:7500});
  assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.raw]),source.split('\n').map((raw,i)=>[i+1,i+1,raw]));
  assert(!p.metadata.some(m=>m.kind==='发送人'));
  for(const line of source.split('\n'))assert.equal(senderHeader(line),null);
});

test('任中后置中文粒数、粒字、全角及字段空格，独立标题和金额续行等价',()=>{
  for(const name of ['平特任中一','任中一','平特任中一粒','任中1粒','平特任中１粒','一粒任中','平特任中一 粒','平 特 任 中 一']){
    for(const sep of ['：',' ', '']){
      const p=valid(`香港${name}${sep}４４／７５。`);assert.equal(p.bets[0].playType,'flat-any');
      assert.equal(p.bets[0].size,1);assert.deepEqual(p.bets[0].markets,['港']);assert.equal(p.bets[0].totalCents,7500);
    }
  }
  for(const [i,name] of [...'一二三四五'].entries()){
    const values=Array.from({length:i+1},(_,j)=>j+1);
    const b=valid(`平特任中${name}：${values.join('/')}各七十五元`).bets[0];
    assert.equal(b.size,i+1);assert.deepEqual(b.values,values);assert.equal(b.totalCents,7500);
  }
  const p=valid('小明：香港平特任中一：44/75。\n32/75。\n张三：新澳平特任中一\n44\n各75');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets.join(),b.size]),[['小明','港',1],['小明','港',1],['张三','新',1]]);
  assert.equal(p.bets.at(-1).endLine,5);
});

test('保留未声明粒数的号码列表，不吞掉选号；非法号码、缺金额和分组冲突仍报错',()=>{
  const b=valid('平特任中1 2 3 100').bets[0];assert.equal(b.size,3);assert.deepEqual(b.values,[1,2,3]);
  for(const text of ['平特任中一：44。','平特任中一：75/75。','平特任中一：44 32各75','平特任中六：1 2 3 4 5 6各75','平特任中一粒二粒44各75','特码平特任中一44各75']){
    const p=parse(text);assert(p.issues.length,text);assert(!p.metadata.some(m=>m.kind==='发送人'),text);
    assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('原文高亮和AI证据完整区分玩法、44和75，冒号不伪造玩家',()=>{
  assert.equal(highlightText(source).map(t=>t.text).join(''),source);
  const line=source.split('\n')[0],tokens=highlightText(line);
  assert(tokens.some(t=>t.kind==='play'&&t.text==='平特任中一'));
  assert(tokens.some(t=>t.kind==='selection'&&t.text==='44'));
  assert(tokens.some(t=>t.kind==='amount'&&t.text==='75'));
  const evidence=statementEvidence(line);
  assert(evidence.some(t=>t.field==='amount'&&t.quote==='75'));
  assert(evidence.some(t=>t.field==='play'&&t.quote==='平特任中一'&&t.size===1));
  assert.equal(playTokens(line).length,1);
  assert.deepEqual(structuralConflicts(line,valid(line).bets),[]);
});

test('AI采用任中一的每组单价，拒绝特码、普通平码和错市场，旧错误解释失效',()=>{
  const d=doc(source);assert.deepEqual(reviewInput(d).items,[]);
  const item=reviewInput(d,'all').items[1];assert.equal(item.body,source.split('\n')[1]);
  const bet={markets:['港'],play:'1粒任中',selection:'32',basis:'每组',amount:'75',evidence:{market:'香港',play:'平特任中一',selection:'32',amount:'75'}};
  assert.equal(validateCandidate({bets:[bet]},item,d).totalCents,7500);
  for(const play of ['特码','平码','平特号码'])assert.throws(()=>validateCandidate({bets:[{...bet,play,basis:'每号'}]},item,d));
  assert.throws(()=>validateCandidate({bets:[{...bet,markets:['新']}]},item,d));
  assert.throws(()=>validateCandidate({bets:[{...bet,play:'2粒任中'}]},item,d));
  d.assistance={...assistanceFor(d,[{line:2,source:item.source,status:'accepted',replacement:'新特码32各75'}]),version:'semantic-20261013-1'};
  assert.deepEqual(parseDocument(source,d).bets[1].markets,['港']);
  assert.equal(parseDocument(source,d).bets[1].playType,'flat-any');
});

test('任中一在正码或特码任一位置都中奖，采用任中赔率且不受旧六码范围影响',()=>{
  const b=valid('新澳平特任中一：44/75。').bets[0];
  const o=odds();o.scopes['flat-any']='six';const before=JSON.stringify(o);
  for(let index=0;index<7;index++){
    const numbers=[1,2,3,4,5,6];numbers.splice(index,0,44);
    const r=settleBet(b,draw('新',numbers),o);
    assert.equal(r.status,'won');assert.equal(r.winCount,1);assert.equal(r.winningStakeCents,7500);assert.equal(r.payoutCents,48750);
    assert.equal(r.tiers[0].key,'flat-any-1');
  }
  assert.equal(JSON.stringify(o),before);
  assert.equal(settleBet(b,draw('新',[1,2,3,4,5,6,7]),o).status,'lost');
  const ordinary=valid('新平码44各75').bets[0];assert.equal(settleBet(ordinary,draw('新',[1,2,3,4,5,6,44]),o).status,'lost');
  o.rates['flat-any-1'].rate='8';assert.equal(settleBet(b,draw('新',[1,2,3,4,5,6,44]),o).payoutCents,60000);
  const two=valid('平特任中二：44 32各75').bets[0];
  const r=settleBet(two,draw('新',[1,2,3,4,5,32,44]),o);assert.equal(r.winCount,1);assert.equal(r.payoutCents,26250);
});

test('新澳香港独立中奖汇总，升级自动采用新解析而保留原账目和历史快照',()=>{
  const p=valid(source),draws={新:draw('新',[1,2,3,4,5,44,9]),港:draw('港',[1,2,3,4,5,6,32])},settings={新:odds(),港:odds()};
  const r=settleDocuments([p],draws,settings,date);
  assert(r.complete);assert.equal(r.stakeCents,15000);assert.equal(r.payoutCents,97500);
  assert.deepEqual(r.entries.map(e=>[e.market,e.winningStakeCents,e.payoutCents]),[['新',7500,48750],['港',7500,48750]]);
  const upgraded=upgradeDocument({...doc(source),parserVersion:'parser-20261013-1'});
  assert.equal(upgraded.text,source);assert.equal(upgraded.name,'任中账目');assert.equal(upgraded.parserReview,undefined);
  const old=valid('新44/75\n新32/75');old.originalText=source;old.parserVersion='parser-20261013-1';
  const snapshot={inputs:{documents:[old],date,draws,settings:{odds:settings}},result:settleDocuments([old],draws,settings,date)};
  const before=JSON.stringify(snapshot),review=reviewSettlement(snapshot);
  assert(review.required);assert.equal(review.beforePayoutCents,0);assert.equal(review.afterPayoutCents,97500);assert.equal(JSON.stringify(snapshot),before);
});
