import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {settleDocuments,defaultOdds} from '../src/core/settlement.js';
import {issueDetails} from '../src/core/issue-details.js';

const date='2026-10-09';
const doc=text=>({id:'market-direction',name:'市场方向',text,businessDate:date,defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('同组两个尾注例子只让第二笔待处理，原市场与尾注市场和定位范围可见',()=>{
  for(const suffix of ['\n港','港']){
    const text='新 1 2 各 100\n2 4 各 50'+suffix,p=parse(text);
    assert.deepEqual(p.bets.map(b=>[b.status,b.markets,b.totalCents]),[['parsed',['新'],20000],['review',['新'],10000]]);
    assert.deepEqual(summarize([p]).markets,{新:20000,旧:0,港:0});
    assert.equal(p.issues.length,1);
    const issue=p.issues[0];assert.equal(issue.code,'TRAILING_MARKET');
    assert.equal(issue.line,2);assert.equal(issue.endLine,suffix.includes('\n')?3:2);
    assert.deepEqual(issue.affectedBetIds,[p.bets[1].id]);
    assert.deepEqual(issue.marketChoices,['新','港']);assert.match(issueDetails(issue).reason,/新澳.*香港/);
    assert(!reviewInput(doc(text)).items.some(i=>i.line===1));
    assert.equal(p.coverage[0].status,'parsed');assert.equal(p.coverage[1].status,'review');
  }
});

test('第三个用户例子标题前向生效，空行重新默认新澳，总计新300港80',()=>{
  const text='新 1 2 各 100\n\n2 4 各 50\n\n港\n2 5 各40',p=valid(text);
  assert.deepEqual(p.bets.map(b=>b.markets),[['新'],['新'],['港']]);
  assert.deepEqual(summarize([p]).markets,{新:30000,旧:0,港:8000});
  assert.deepEqual(reviewInput(doc(text)).items,[]);
});

test('截图新标题后带澳特仍只前向生效，原来的香港连码不受影响',()=>{
  const text='香港三中三01 02 03各10\n\n新\n澳特 41 09 45 08 12 20 32 44 02 14 13 49 48 31各5米\n\n25#40米\n\n澳特 19.31.43.02.14.38.17.29各7\n\n01.13.25.37.各5';
  const p=valid(text);assert.equal(p.bets[0].playType,'linked-number-3-3');
  assert(p.bets.slice(1).every(b=>b.playType==='special-number'&&b.markets.join()==='新'));
  assert.deepEqual(summarize([p]).markets,{新:18600,旧:0,港:1000});
  assert.deepEqual(reviewInput(doc(text)).items,[]);
});

test('连续标题、带市场前缀或跨行金额的新投注均不会使标题倒灌',()=>{
  for(const tail of ['新\n澳特02各10','新\n澳\n特码\n02各10','新\n02\n各10','新\n香港02各10']){
    const p=valid('旧01各10\n'+tail);assert.equal(p.bets[0].markets.join(),'旧');
    assert.equal(summarize([p]).totalCents,2000);
  }
  const ended=parse('旧01各10\n新\n\n02各10');assert.equal(ended.bets[0].status,'review');assert.deepEqual(ended.bets[1].markets,['新']);
  assert.equal(summarize([valid('旧01各10\n\n新')]).markets.旧,1000);
  const p=valid('新01各10\n02各20\n港\n03各5');
  assert.deepEqual(summarize([p]).markets,{新:3000,旧:0,港:500});
});

test('同行多笔及跨行完整投注的尾注定位只覆盖紧邻完整投注',()=>{
  for(const suffix of ['港','\n港']){
    const p=parse('新01各10，02各20'+suffix);
    assert.deepEqual(p.bets.map(b=>b.status),['parsed','review']);assert.equal(summarize([p]).totalCents,1000);
    assert.deepEqual(p.issues[0].affectedBetIds,[p.bets[1].id]);
  }
  const p=parse('新01各10\n02 04\n06各50\n港');
  assert.deepEqual(p.bets.map(b=>b.status),['parsed','review']);assert.equal(p.issues[0].line,2);assert.equal(p.issues[0].endLine,4);
  assert.equal(summarize([p]).totalCents,1000);
});

test('尾注同市场无需提示，不同市场简写金额待处理且之后沿用新声明',()=>{
  for(const text of ['新01各10新','港01各10\n香港','两边01各10\n新旧','旧01各10，老澳'])assert.equal(valid(text).bets[0].status,'parsed');
  const p=parse('新01各10\n2 4 50港\n03各5');
  assert.deepEqual(p.bets.map(b=>[b.status,b.markets]),[['parsed',['新']],['review',['新']],['parsed',['港']]]);
  const multi=parse('两边01各10\n02各20三边');
  assert.equal(summarize([multi]).totalCents,2000);assert.equal(multi.bets[1].status,'review');
});

test('发送人边界不倒灌；同玩家继承尾部新声明，切换玩家默认新',()=>{
  const p=parse('小明：旧01各10\n02各20\n港\n小明：03各5\n张三：04各10');
  assert.deepEqual(p.bets.map(b=>[b.status,b.markets]),[['parsed',['旧']],['review',['旧']],['parsed',['港']],['parsed',['新']]]);
  assert.deepEqual(summarize([p]).markets,{新:1000,旧:1000,港:500});
  assert.equal(valid('小明：旧01各10\n张三：港\n02各20').bets[0].status,'parsed');
});

test('保留共金额市场的连续整段例外，并继续阻止覆盖明确冲突市场',()=>{
  const p=valid('新01各10\n\n02各20\n03各30\n共50米，香港');
  assert.deepEqual(summarize([p]).markets,{新:1000,旧:0,港:5000});
  assert(parse('新01各10\n02各20\n共30米，香港').issues.some(i=>i.code==='TRAILING_MARKET'));
});

test('AI不能代选尾部市场，AI状态不扩大同一行受影响的投注范围',()=>{
  for(const text of ['新01各10，02各20港','新01各10\n02各20\n港']){
    const d=doc(text),items=reviewInput(d,'all').items;
    const item=items.find(i=>i.issueCodes.includes('TRAILING_MARKET'));
    assert.throws(()=>validateCandidate({bets:[{markets:['港'],play:'特码',selection:'02',basis:'每号',amount:'20',evidence:{market:'港',play:'',selection:'02',amount:'20'}}]},item,d),/市场.*争议/);
    for(const status of ['pending','failed','review']){
      const assisted={...d,assistance:assistanceFor(d,[{line:item.line,source:item.source,replacement:'',status}])};
      const p=parseDocument(text,assisted);assert.equal(p.bets[0].status,'parsed');assert.equal(p.bets[1].status,'review');
      assert.equal(summarize([p]).totalCents,1000);
    }
  }
});

test('争议投注不参与赔付，确定的投注继续结算；旧AI缓存不再阻止标题解析',()=>{
  const text='新 1 2 各 100\n\n2 4 各 50港',p=parse(text);
  const odds=defaultOdds();odds.confirmed=true;
  const draw={market:'新',date,issue:'2026282',numbers:[5,6,7,8,9,10,2]};
  const settled=settleDocuments([p],{新:draw},{新:odds},date);
  assert.equal(summarize([p]).totalCents,20000);assert.equal(settled.payoutCents,470000);
  assert.deepEqual(settled.entries.map(e=>e.status),['won','pending']);
  assert.equal(settled.entries[1].payoutCents,null);assert.equal(settled.complete,false);
  const source='旧01各10\n\n新\n澳特02各10',d=doc(source);
  d.assistance={...assistanceFor(d,[{line:3,source:'新',status:'review',replacement:''}]),version:'semantic-20261008-2'};
  assert.deepEqual(parseDocument(source,d).issues,[]);
});
