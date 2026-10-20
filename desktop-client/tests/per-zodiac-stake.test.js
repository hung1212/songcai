import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {specialCollection} from '../src/core/special-collection.js';
import {ledgerReceipt} from '../src/core/ledger-receipt.js';
import {reviewInput,validateCandidate,assistanceFor,REVIEW_INSTRUCTIONS} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';
import {sourceResults} from '../src/core/ledger-navigation.js';
const line='牛，猪，鸡，羊，各肖40元',date='2026-10-05';
const doc=(text='雨：\n'+line)=>({id:'per-zodiac-stake',name:'大洋',text,businessDate:date});
const parse=(text,extra={})=>{const d=doc(text);return parseDocument(d.text,{...d,...extra});};
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('截图第328行各肖40为4肖160，下一段龙马各二十仍按9号共180',()=>{
  const text='\n'.repeat(326)+'雨：\n'+line+'\n\n雨：\n龙，马，各二十米\n共180',p=valid(text),b=p.bets[0];
  assert.deepEqual([b.play,b.playType,b.basis,b.values,b.count,b.unitCents,b.totalCents],['特肖','special-zodiac','每肖',['牛','猪','鸡','羊'],4,4000,16000]);
  assert.equal(b.line,328);assert.equal(b.raw,line);assert.equal(b.semantic.ruleId,'R51');
  assert.equal(b.semantic.evidence[0].quote,'各肖');assert.equal(b.semantic.evidence[0].source,'original');
  assert.equal(p.bets[1].playType,'special-number');assert.equal(p.bets[1].totalCents,18000);
  assert.equal(summarize([p]).totalCents,34000);assert.equal(specialCollection([p]).summary.totalCents,18000);
  assert.equal(sourceResults(p,328).bets[0].id,b.id);
});

test('各肖和每肖支持常用分隔、全角、中文金额、重复生肖和单肖',()=>{
  for(const text of ['牛猪鸡羊每肖40','牛、猪、鸡、羊，各肖四十元','牛.猪.鸡.羊各肖４０米','牛 猪 鸡 羊每肖肆拾圆'])assert.equal(valid(text).bets[0].totalCents,16000,text);
  assert.equal(valid('牛每肖40').bets[0].totalCents,4000);
  assert.equal(valid('牛猪牛各肖0.5元').bets[0].totalCents,150);
  const both=valid('两边牛猪鸡羊各肖40').bets[0];assert.deepEqual(both.markets,['新','旧']);assert.equal(both.totalCents,32000);
  const category=valid('天肖各肖40').bets[0];assert.equal(category.playType,'special-zodiac');assert.equal(category.count,6);
  const mixed=valid('鸡羊各号40；牛猪各肖40');assert.deepEqual(mixed.bets.map(b=>b.totalCents),[32000,8000]);assert.equal(mixed.bets[1].semantic.evidence[0].quote,'各肖');
});

test('各号每号与裸各仍逐号，明确平特肖及声明继承保留',()=>{
  for(const marker of ['各号','每号','各数','每个号码','各']){const b=valid('牛猪鸡羊'+marker+'40').bets[0];assert.equal(b.playType,'special-number');assert.equal(b.totalCents,64000);}
  for(const text of ['平特肖牛猪鸡羊各肖40','平特肖\n牛猪鸡羊每肖40']){const b=valid(text).bets[0];assert.equal(b.playType,'flat-zodiac');assert.equal(b.totalCents,16000);}
  const p=valid('二连肖牛猪各10\n牛猪鸡羊各肖40');assert.equal(p.bets[1].playType,'special-zodiac');
  for(const text of ['特码牛猪各肖40','特码\n牛猪各肖40','二连肖牛猪各肖40','二连肖\n牛猪各肖40','牛猪数各肖40','01各肖40'])assert(parse(text).issues.length,text);
});

test('特肖只按特码生肖赔付，整单使用账单名的特肖赔率与退水，集合排除',()=>{
  const p=valid(),odds={新:defaultOdds()},settings={odds,rebates:{大洋:{perTenThousandCents:30000,playRates:{'special-zodiac':100000}}},playerOdds:{大洋:{markets:{新:{rates:{'special-zodiac':{rate:'10.5',specialRate:'8.5'}}}}}}};
  const draws={新:{market:'新',date,issue:'2026278',numbers:[6,8,10,12,1,2,18]}},r=settleDocuments([p],draws,odds,date,settings);
  assert.equal(r.complete,true);assert.equal(r.stakeCents,16000);assert.equal(r.payoutCents,42000);assert.equal(r.rebateCents,1600);
  assert.equal(r.entries[0].winCount,1);assert.equal(r.players[0].id,'大洋');assert.equal(r.players[0].rebateBreakdown[0].playKey,'special-zodiac');
  const normalOnly=settleDocuments([p],{新:{...draws.新,numbers:[6,8,10,12,1,2,3]}},odds,date,settings);assert.equal(normalOnly.payoutCents,0);assert.equal(normalOnly.rebateCents,1600);
  const year=settleDocuments([valid('马牛每肖40')],{新:{...draws.新,numbers:[6,8,10,12,2,3,1]}},odds,date,settings);assert.equal(year.payoutCents,34000);
  const card=ledgerReceipt({document:doc(),result:r,inputs:{kind:'current',selection:p.id,date,documents:[p],draws,settings}});
  assert.equal(card.rebateRows[0].name,'特肖');assert.equal(card.rebateTurnoverCents,16000);assert.equal(card.payableCents,43600);
  assert.equal(specialCollection([p]).summary.totalCents,0);
});

test('AI保留各肖160，拒绝改成逐号640，旧错误解释失效且原文历史保留',()=>{
  const d=doc(),item=reviewInput(d,'all').items.find(i=>i.line===2);
  const candidate={markets:['新'],play:'特肖',selection:'牛猪鸡羊',basis:'每肖',amount:'40',evidence:{market:'',play:'',selection:'牛，猪，鸡，羊',amount:'40'}};
  assert.equal(item.required,false);assert.equal(validateCandidate({bets:[candidate]},item,d).totalCents,16000);
  assert.throws(()=>validateCandidate({bets:[{...candidate,play:'特码',basis:'每号'}]},item,d),/已确定/);
  assert.match(REVIEW_INSTRUCTIONS,/R51/);
  const old={...d,parserVersion:'parser-20261019-2',history:[{stakeCents:64000}],assistance:{...assistanceFor(d,[{line:2,source:line,status:'accepted',replacement:'新 特码牛猪鸡羊各号40'}]),version:'semantic-20261019-2'}};
  const updated=upgradeDocument(old);assert.equal(updated.text,d.text);assert.deepEqual(updated.history,old.history);assert.equal(parseDocument(updated.text,updated).bets[0].totalCents,16000);
  const tokens=highlightText(d.text);assert.equal(tokens.map(t=>t.text).join(''),d.text);assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['40']);
});
