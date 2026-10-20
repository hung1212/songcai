import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {highlightText} from '../src/core/highlight.js';
import {sourceResults} from '../src/core/ledger-navigation.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
const rows=['10-28-07','14-29-33','24-12-29','38-25-41','18-48-09','14-44-31'];
const groups=rows.map(s=>s.split('-').map(Number));
const source='雨: \n澳三中三。\n'+rows.join('\n')+'各10米';
const doc=(text=source)=>({id:'triples',name:'雨',text,businessDate:'2026-10-19'});
const parse=(text=source)=>parseDocument(text,doc(text));
test('用户原文六行三中三按六组各10元60元保留，不把末尾号码当单价',()=>{
  const p=parse();assert.deepEqual(p.issues,[]);assert.equal(p.bets.length,1);const b=p.bets[0];
  assert.deepEqual([b.playerId,b.markets,b.playType,b.mode,b.count,b.unitCents,b.totalCents],['雨',['新'],'linked-number-3-3','groups',6,1000,6000]);
  assert.deepEqual(b.groups,groups);assert.deepEqual(b.warnings,[]);assert.equal(b.line,3);assert.equal(b.endLine,8);assert.equal(b.raw,rows.join('\n')+'各10米');
  assert.deepEqual(b.continuation,{ruleId:'R49',kind:'groups',amountLine:8});assert.equal(b.semantic.ruleId,'R49');assert.equal(b.semantic.declaration.line,2);
  assert.deepEqual(reviewInput(doc()).items,[]);assert.equal(summarize([p]).totalCents,6000);
});
test('常用分隔符、全角、中文金额与金额独占一行仍按原行分组',()=>{
  for(const separator of ['-',',','，','、','.','/','\\',' ','　'])for(const ending of ['各十元','每组１０米','\n各10米']){
    const p=parse('雨：\n门三中三\n'+rows.map(s=>s.replaceAll('-',separator)).join('\n')+ending);
    assert.deepEqual(p.issues,[],separator+ending);assert.deepEqual(p.bets[0].groups,groups);assert.equal(p.bets[0].totalCents,6000);
  }
  const p=parse('港三中三\n１０－２８－０７\n１４－２９－３３各0.5元');assert.deepEqual(p.issues,[]);assert.equal(p.bets[0].totalCents,100);assert.equal(p.bets[0].markets.join(),'港');
});
test('已有金额的组独立计费，后续组及另一个共价段不混合',()=>{
  const p=parse('澳三中三\n01-02-03各5\n04-05-06\n07-08-09各10\n10-11-12\n13-14-15各20');
  assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets.map(b=>[b.count,b.unitCents,b.totalCents]),[[1,500,500],[2,1000,2000],[2,2000,4000]]);
  assert.equal(summarize([p]).totalCents,6500);
});
test('不跨空行、玩家、市场、玩法、合计或说明借单价，错误组保留待处理',()=>{
  for(const boundary of ['','张三：','旧三中三','特码','共10','谢谢']){
    const p=parse(`澳三中三\n01-02-03\n${boundary}\n04-05-06各10`);
    assert(!p.bets.some(b=>b.line===2&&b.endLine===4),boundary);assert(p.issues.some(i=>i.line===2),boundary);
  }
  for(const row of ['01-02','01-02-03-04','01-01-02','00-02-03','50-02-03']){
    const p=parse(`澳三中三\n${row}\n04-05-06各10`);assert(p.issues.length,row);
    assert(!p.bets.some(b=>b.line===2&&b.status==='parsed'),row);
  }
  const missing=parse('澳三中三\n01-02-03\n04-05-06');assert.equal(summarize([missing]).totalCents,0);assert(missing.issues.length);
});
test('原始组逐组判断正码，不能任取号码组成中奖，重复列组重复赔付',()=>{
  const p=parse(),odds={新:defaultOdds()},rebates={雨:{perTenThousandCents:30000,playRates:{'linked-number-3-3':100000}}};
  const playerOdds={雨:{markets:{新:{rates:{'linked-number-3-3':{rate:'600'}}}}}};
  const settle=(numbers,parsed=p)=>settleDocuments([parsed],{新:{market:'新',date:'2026-10-19',issue:'2026292',numbers}},odds,'2026-10-19',{rebates,playerOdds});
  const won=settle([10,28,7,14,29,33,24]);assert.equal(won.entries[0].winCount,2);assert.equal(won.payoutCents,1200000);assert.equal(won.rebateCents,600);
  assert.equal(settle([10,14,24,38,18,44,31]).payoutCents,0);
  assert.equal(settle([10,28,14,29,33,24,7]).entries[0].winCount,1);
  const duplicate=parse('雨：澳三中三\n10-28-07\n10-28-07\n14-29-33各10');assert.equal(duplicate.bets[0].count,3);assert.equal(settle([10,28,7,1,2,3,4],duplicate).entries[0].winCount,2);
});
test('高亮及定位保留每行号码，AI不得单行替换共价组，旧解释失效',()=>{
  const p=parse(),selectionLines=[3,4,5,6,7],tokens=highlightText(source,'',selectionLines);
  assert.equal(tokens.map(t=>t.text).join(''),source);assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['10']);
  for(let line=3;line<=8;line++)assert.equal(sourceResults(p,line).bets[0].id,p.bets[0].id);
  const d=doc(),items=reviewInput(d,'all').items.filter(i=>i.line>=3);assert(items.every(i=>i.spansLines));assert.throws(()=>validateCandidate({bets:[]},items[0],d),/单行/);
  d.parserVersion='parser-20261019-1';d.history=[{stakeCents:1000}];d.assistance={...assistanceFor(d,[{line:3,source:rows[0],status:'accepted',replacement:'特码10 28各7'}]),version:'semantic-20261019-1'};
  const next=upgradeDocument(d);assert.equal(next.text,source);assert.deepEqual(next.history,d.history);assert.equal(summarize([parseDocument(next.text,next)]).totalCents,6000);
});
