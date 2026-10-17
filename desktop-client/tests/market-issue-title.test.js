import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {statementEvidence} from '../src/core/business-syntax.js';
import {settlementPlayers} from '../src/core/rebates.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {ledgerReceipt,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {reviewInput,assistanceFor,currentReviewItems,reviewItemKey} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='100元包狗，\n21，200元\n\n100包猪\n100包鼠\n\n09、300元\n\n澳289期：\n平肖虎100#\n2有虎蛇50#\n\n奥特34.22.30.42各五米、\n平特一肖虎五十米';
const date='2026-10-16';
const doc=(text=source)=>({id:'issue-title',name:'截图样例',text,businessDate:date});
const parse=(text=source,options={})=>parseDocument(text,{...doc(text),...options});
const valid=(text=source,options={})=>{const p=parse(text,options);assert.deepEqual(p.issues,[],text);return p;};
const odds=Object.fromEntries(['新','旧','港'].map(m=>[m,defaultOdds()]));
const draws=Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date,issue:m==='港'?'2026106':'2026289',numbers:[12,29,19,28,47,34,38]}]));
const rebates={'document:issue-title:player':{perTenThousandCents:30000,playRates:{'flat-zodiac':10000,'linked-zodiac-2':10000}}};
const settle=(p,rate=rebates)=>settleDocuments([p],draws,odds,date,{rebates:rate});

test('截图中的澳289期不新增玩家，全部1020元仍归原玩家及其退水设置',()=>{
  const p=valid();assert.equal(senderHeader('澳289期：'),null);assert.equal(summarize([p]).totalCents,102000);
  assert.equal(p.bets.length,9);assert.deepEqual([...new Set(p.bets.map(b=>b.playerId))],['document:issue-title:player']);
  assert.equal(settlementPlayers([p]).length,1);assert(!p.metadata.some(m=>m.kind==='发送人'));
  const r=settle(p);assert.equal(r.complete,true);assert.equal(r.players.length,1);
  assert.deepEqual([r.stakeCents,r.payoutCents,r.rebateCents,r.payableCents,r.players[0].netCents],[102000,50750,2660,53410,-48590]);
  assert.deepEqual(Object.fromEntries(r.players[0].rebateBreakdown.map(b=>[b.playKey,[b.turnoverCents,b.rebateCents]])),{
    'special-number':[82000,2460],'flat-zodiac':[15000,150],'linked-zodiac-2':[5000,50],
  });
  assert.deepEqual(reviewInput(doc()).items,[]);
});

test('结算截图完整展示特码、平肖和二连肖退水及534.10应付',()=>{
  const p=valid(),result=settle(p),document=doc(),inputs={kind:'current',selection:document.id,date,documents:[p],draws,settings:{odds,rebates}};
  const card=ledgerReceipt({document,inputs,result}),svg=receiptSvg(receiptPages(card)[0]).svg;
  assert.equal(card.rebateRows.length,3);assert.equal(card.rebateTurnoverCents,102000);assert.equal(card.rebateCents,2660);
  for(const key of ['special-number','flat-zodiac','linked-zodiac-2'])assert(svg.includes(`data-rebate-play="${key}"`));
  for(const label of ['有效流水 820 · 3%','有效流水 150 · 1%','有效流水 50 · 1%','26.6','534.1','485.9'])assert(svg.includes(label),label);
});

test('市场期号标题支持别名、空格、全角和同一行投注，真实玩家名字保持',()=>{
  for(const [title,market] of [['澳289期','新'],['奥289期','新'],['新澳第289期','新'],['旧澳289期','旧'],['香港第106期','港'],['新凹第 ２８９ 期','新']]){
    for(const separator of ['：\n',':','\n']){
      const text=`小明：01各10\n${title}${separator}平肖虎100`;
      const p=valid(text);assert(p.bets.every(b=>b.playerId==='小明'),text);assert.deepEqual(p.bets.at(-1).markets,[market]);
      assert.equal(p.bets.at(-1).playType,'flat-zodiac');assert.deepEqual(reviewInput(doc(text)).items,[]);
    }
  }
  for(const name of ['澳289期玩家','香港第106期小明','期期好运'])assert.equal(valid(`${name}：01各10`).bets[0].player,name);
  assert.equal(valid('澳289期：01各10',{defaultPlayer:'澳289期'}).bets[0].player,'澳289期');
  const p=valid('澳289期：\n平肖虎100\n张三：平肖虎50');assert.equal(p.bets[1].playerId,'张三');
});

test('期号高亮及AI证据不将289当选号或金额，原始文本和行号保留',()=>{
  for(const text of ['澳289期：','新澳第 ２８９ 期：','小明：澳289期：平肖虎100']){
    const tokens=highlightText(text);assert.equal(tokens.map(t=>t.text).join(''),text);
    assert(!tokens.some(t=>t.kind&&/289|２８９/.test(t.text)),text);
    const body=senderHeader(text)?.body??text,fields=statementEvidence(body),issue=fields.find(e=>e.field==='issue');assert(issue,text);
    assert(!fields.some(e=>['selection','amount'].includes(e.field)&&e.start<issue.end&&issue.start<e.end));
  }
  const p=valid();assert.equal(p.bets[5].line,10);assert.equal(p.bets[5].raw,'平肖虎100#');
  const declaration=p.metadata.find(m=>m.kind==='期号');assert.equal(declaration.text,'289期');assert.deepEqual(declaration.markets,['新']);
});

test('市场期号只校验本玩家当前消息的后续对应市场，最近声明优先',()=>{
  const text='小明：01各10\n新澳288期：\n02各10\n新澳289期：\n03各10\n香港106期：\n04各10\n旧澳289期：\n05各10\n张三：06各10';
  const p=valid(text),r=settle(p,{});
  assert.deepEqual(r.entries.map(e=>e.status),['lost','pending','lost','lost','lost','lost']);
  assert.match(r.entries[1].note,/期号/);assert.equal(r.pending,1);
  const inline=valid('香港第106期：平码12各10');assert.equal(settle(inline,{}).entries[0].status,'won');
  const bare=valid('第288期\n01各10');assert.equal(settle(bare,{}).entries[0].status,'pending');
});

test('未设置退水或显式零仍为不退水，小金额按比例到分而无万元门槛',()=>{
  assert.equal(settle(valid(),{}).rebateCents,0);
  const config={'document:issue-title:player':{perTenThousandCents:30000,playRates:{'flat-zodiac':0,'linked-zodiac-2':0}}};
  assert.equal(settle(valid(),config).rebateCents,2460);
  const tiny=valid('澳289期：\n平肖虎1\n二连肖虎蛇每组1');
  const r=settle(tiny);assert.equal(r.rebateCents,2);assert.deepEqual(r.players[0].rebateBreakdown.map(b=>b.rebateCents),[1,1]);
});

test('升级消除澳289期虚假玩家与旧核验，但不覆盖历史结算快照',()=>{
  const d=doc();d.parserVersion='parser-20261016-1';d.history=[{rebateCents:2400,payableCents:53150}];
  d.assistance={...assistanceFor(d,[{line:10,source:'平肖虎100#',status:'accepted',replacement:'新 特肖虎100'}]),version:'semantic-20261016-1'};
  const next=upgradeDocument(d),p=parseDocument(next.text,next);
  assert.equal(next.text,source);assert.deepEqual(next.history,d.history);assert.deepEqual(currentReviewItems(next),[]);
  assert.equal(settle(p).rebateCents,2660);assert.equal(settlementPlayers([p]).length,1);
  const item=reviewInput(d,'all').items.find(i=>i.line===10),wrong={...item,playerId:'澳289期'};
  assert.notEqual(reviewItemKey(d,item),reviewItemKey(d,wrong));
});
