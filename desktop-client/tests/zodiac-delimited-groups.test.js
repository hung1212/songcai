import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,reviewPayload,validateCandidate,validateReply,assistanceFor} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='二连肖牛羊、羊猪、羊兔、牛兔各30';
const groups=[['牛','羊'],['羊','猪'],['羊','兔'],['牛','兔']];
const doc=(text=source)=>({id:'zodiac-delimited-groups',name:'测试',text,businessDate:'2026-10-05',defaultPlayer:''});
const parse=(text=source)=>parseDocument(text,doc(text));
const valid=(text=source)=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('顿号连肖保留四组各30共120，不合并为六组复式，不因跨组生肖重复而提示',()=>{
  const p=valid(),b=p.bets[0];
  assert.equal(p.bets.length,1);assert.deepEqual(b.groups,groups);
  assert.deepEqual([b.playType,b.size,b.mode,b.basis,b.count,b.unitCents,b.totalCents],['linked-zodiac',2,'groups','每组',4,3000,12000]);
  assert.deepEqual(b.warnings,[]);assert.equal(b.semantic.ruleId,'R32');
  assert.equal(b.line,1);assert.equal(b.endLine,1);assert.equal(b.raw,source);
  assert.equal(summarize([p]).totalCents,12000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('顿号逗号及括号组等价，兼容别名、空格、中文金额与金额续行',()=>{
  for(const text of [
    '二连肖牛羊、羊猪，羊兔、牛兔各30', '二连肖牛羊，羊猪，羊兔，牛兔各30',
    '２连肖：牛 羊 、羊 猪、羊 兔、牛 兔每组三十米',
    '二连肖（牛羊）、（羊猪）、（羊兔）、（牛兔）各30',
    '二连肖（牛、羊）、（羊、猪）、（羊、兔）、（牛、兔）各30',
    '二连肖牛羊、羊猪、羊兔、牛兔\n各30',
  ]){
    const p=valid(text);assert.deepEqual(p.bets[0].groups,groups,text);assert.equal(summarize([p]).totalCents,12000,text);
    assert.equal(p.bets[0].raw,text);assert.deepEqual(p.bets[0].warnings,[]);
  }
  assert.equal(valid('三连肖牛羊猪、羊猪兔各30').bets[0].count,2);
  assert.deepEqual(valid('四连肖牛羊猪兔、鼠牛羊猪各30').bets[0].groups,[['牛','羊','猪','兔'],['鼠','牛','羊','猪']]);
});

test('完整重复组按份数计费，组内重复、缺项、超项不以去重复式掩盖',()=>{
  const b=valid('二连肖牛羊、牛羊各30').bets[0];
  assert.deepEqual(b.groups,[['牛','羊'],['牛','羊']]);assert.equal(b.count,2);assert.equal(b.totalCents,6000);assert.deepEqual(b.warnings,[]);
  for(const text of ['二连肖牛牛、羊猪各30','二连肖牛羊、猪各30','二连肖牛羊、羊猪兔各30','三连肖牛羊、羊猪各30','二连肖（牛羊）、（羊猪）兔各30']){
    const p=parse(text);assert(p.issues.some(i=>['GROUP_SIZE','GROUP_EXTRA'].includes(i.code)),text);assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('普通逐肖列表和无分组复式保留，非连肖顿号也不变成组合',()=>{
  for(const text of ['二连肖牛、羊、猪、兔各30','二连肖牛羊猪兔各30','二连肖复式牛、羊、猪、兔各30']){
    const b=valid(text).bets[0];assert.equal(b.groups,null);assert.equal(b.count,6);assert.equal(b.totalCents,18000);
  }
  for(const [text,type,count] of [['特肖牛羊、羊猪各30','special-zodiac',4],['平特肖牛羊、羊猪各30','flat-zodiac',4],['特码33、34、36各5','special-number',3]]){
    const b=valid(text).bets[0];assert.equal(b.playType,type);assert.equal(b.groups,null);assert.equal(b.count,count);
  }
});

test('玩法标题继承、玩家市场边界及多市场计费保留，分组不污染下一行',()=>{
  const p=valid('小明：旧二连肖\n牛羊、羊猪、羊兔、牛兔各30\n鼠牛各10\n张三：两边'+source+'\n香港33 34各5');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['linked-zodiac',['旧'],12000],['linked-zodiac',['旧'],1000],['linked-zodiac',['新','旧'],24000],['special-number',['港'],1000],
  ]);
  assert.deepEqual(p.bets[0].groups,groups);assert.equal(p.bets[0].semantic.declaration.line,1);
  assert.equal(p.bets[1].groups,null);assert.deepEqual(p.bets[2].groups,groups);
  assert.deepEqual(reviewInput(doc('旧二连肖\n牛羊、羊猪各30')).items,[]);
});

test('只赔列出的分组，不赔遗漏的牛猪或猪兔，重复组和当年生肖赔率逐组计算',()=>{
  const odds=defaultOdds();odds.confirmed=true;
  const settle=(bet,numbers)=>settleBet(bet,{market:'新',date:doc().businessDate,issue:'2026278',numbers},odds);
  const b=valid().bets[0];
  const absent=settle(b,[6,8,2,1,3,7,14]);assert.equal(absent.winCount,0);assert.equal(absent.payoutCents,0);
  const two=settle(b,[6,12,8,1,2,3,7]);assert.equal(two.winCount,2);assert.equal(two.winningStakeCents,6000);assert.equal(two.payoutCents,24000);
  const all=settle(b,[6,12,8,4,1,2,3]);assert.equal(all.winCount,4);assert.equal(all.payoutCents,48000);
  assert.equal(settle(valid('二连肖牛羊、牛羊各30').bets[0],[6,12,8,1,2,3,7]).winCount,2);
  assert.equal(settle(valid('二连肖马牛、牛羊各30').bets[0],[6,12,8,1,2,3,7]).payoutCents,23400);
});

test('AI必须保留明确分组，不能因相同生肖集合而同意普通复式候选',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'2连肖',selection:'牛羊、羊猪、羊兔、牛兔',basis:'每组',amount:'30',evidence:{market:'',play:'二连肖',selection:'牛羊、羊猪、羊兔、牛兔',amount:'30'}};
  for(const selection of [b.selection,'(牛羊)(羊猪)(羊兔)(牛兔)']){
    const candidate={bets:[{...b,selection}]},checked=validateCandidate(candidate,item,d);
    assert.deepEqual(checked.bets[0].groups,groups);assert.equal(checked.totalCents,12000);
    assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  }
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'牛羊猪兔'}]},item,d),/分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'(牛羊)(羊猪)(牛猪)(牛兔)'}]},item,d),/分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'(牛羊)(羊猪)(羊兔)(牛兔)(牛羊)'}]},item,d),/分组/);
});

test('旧已采纳复式解释自动失效，原文与高亮保持不变',()=>{
  const d=doc();d.parserVersion='parser-20261010-4';
  d.assistance={...assistanceFor(d,[{line:1,source,status:'accepted',replacement:'二连肖牛羊猪兔各30'}]),version:'semantic-20261010-4'};
  const upgraded=upgradeDocument(d),p=parseDocument(upgraded.text,upgraded);
  assert.equal(upgraded.text,source);assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);assert.equal(summarize([p]).totalCents,12000);
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['30']);
});

const slashSource='新门平特三肖全中：鼠狗猪／鼠猪马／鼠猪兔／鼠猪牛／各10';
const slashGroups=[['鼠','狗','猪'],['鼠','猪','马'],['鼠','猪','兔'],['鼠','猪','牛']];
test('平特三肖全中与斜杠明确四组，不把冒号前市场玩法识别成发送人',()=>{
  for(const source of [slashSource,slashSource.replaceAll('／','/'),slashSource.replaceAll('／','\\'),slashSource.replaceAll('／','、'),slashSource.replace('三肖全中','三连肖'),slashSource.replace('：',' '),slashSource.replace('各10','\n每组十米')]){
    const p=valid(source),b=p.bets[0];assert.equal(p.bets.length,1);assert.deepEqual(b.groups,slashGroups);assert.deepEqual(b.markets,['新']);assert.equal(b.playerId,'document:zodiac-delimited-groups:player');assert.equal(b.playType,'linked-zodiac');assert.equal(b.size,3);assert.equal(b.totalCents,4000);assert.equal(b.mode,'groups');assert.deepEqual(b.warnings,[]);assert.deepEqual(reviewInput(doc(source)).items,[]);
    assert.equal(highlightText(source).map(t=>t.text).join(''),source);
  }
  const p=valid('小明：'+slashSource);assert.equal(p.bets[0].player,'小明');assert.deepEqual(p.bets[0].groups,slashGroups);
});
test('斜杠分组仍校验组内重复与缺项，无全中的平特几肖不猜玩法',()=>{
  for(const text of ['三连肖鼠狗猪/鼠猪各10','三连肖鼠狗猪/鼠猪猪各10','三连肖鼠狗猪/鼠猪马牛各10','平特三肖：鼠狗猪/鼠猪马各10'])assert(parse(text).issues.length,text);
  const singletons=valid('三连肖鼠/狗/猪/马各10').bets[0];assert.equal(singletons.groups,null);assert.equal(singletons.mode,'combination');assert.equal(singletons.count,4);
  const repeated=valid('三连肖鼠狗猪/鼠狗猪/各10').bets[0];assert.equal(repeated.count,2);assert.equal(repeated.totalCents,2000);
});
test('三肖全中按四组全中核算，马组用马年赔率，未列出的组合不赔',()=>{
  const b=valid(slashSource).bets[0],draw={market:'新',date:doc().businessDate,issue:'2026278'},odds=defaultOdds();
  const all=settleBet(b,{...draw,numbers:[7,9,8,1,4,6,2]},odds);assert.equal(all.winCount,4);assert.equal(all.payoutCents,40000);assert.deepEqual(all.tiers.map(t=>[t.rate,t.count]),[['10.5',3],['8.5',1]]);
  const missing=settleBet(b,{...draw,numbers:[7,9,1,4,6,2,3]},odds);assert.equal(missing.winCount,0);assert.equal(missing.payoutCents,0);
});
test('斜杠分组AI证据与旧缓存升级保持40元，不接受去重后的复式',()=>{
  const d=doc(slashSource),item=reviewInput(d,'all').items[0];
  const proposal={bets:[{markets:['新'],play:'3连肖',selection:'鼠狗猪/鼠猪马/鼠猪兔/鼠猪牛',basis:'每组',amount:'10',evidence:{market:'新门',play:'平特三肖全中',selection:'鼠狗猪／鼠猪马／鼠猪兔／鼠猪牛',amount:'10'}}]};
  assert.equal(validateCandidate(proposal,item,d).totalCents,4000);
  const pooled=structuredClone(proposal);pooled.bets[0].selection='鼠狗猪马兔牛';assert.throws(()=>validateCandidate(pooled,item,d),/分组|选号/);
  d.parserVersion='parser-20261012-1';d.assistance={...assistanceFor(d,[{line:1,source:slashSource,status:'accepted',replacement:'新 3连肖鼠狗猪马兔牛各10'}]),version:'semantic-20261012-1'};
  const upgraded=upgradeDocument(d);assert.equal(upgraded.text,slashSource);assert.equal(summarize([parseDocument(upgraded.text,upgraded)]).totalCents,4000);
});

test('四行独立的平特三肖全中每行一组三连肖，末尾双斜杠不改为特码',()=>{
  const text='新门平特三肖全中：鼠狗猪／／各10\n\n新门平特三肖全中：鼠猪马／／各10\n\n新门平特三肖全中：鼠猪兔／各10\n\n新门平特三肖全中：鼠猪牛／各10';
  const p=valid(text);assert.equal(p.bets.length,4);assert.equal(summarize([p]).totalCents,4000);
  assert.deepEqual(p.bets.map(b=>b.values),slashGroups);assert.deepEqual(p.bets.map(b=>b.line),[1,3,5,7]);
  assert(p.bets.every(b=>b.playType==='linked-zodiac'&&b.size===3&&b.mode==='single'&&b.count===1&&b.totalCents===1000&&b.markets.join()==='新'&&b.playerId==='document:zodiac-delimited-groups:player'));
  assert.deepEqual(reviewInput(doc(text)).items,[]);
  const odds=defaultOdds(),draw={market:'新',date:doc().businessDate,issue:'2026278',numbers:[7,9,8,1,4,6,2]};
  assert.equal(p.bets.reduce((n,b)=>n+settleBet(b,draw,odds).payoutCents,0),settleBet(valid(slashSource).bets[0],draw,odds).payoutCents);
});
