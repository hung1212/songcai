import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {reviewInput,reviewPayload,validateCandidate,validateReply,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {highlightText} from '../src/core/highlight.js';

const source='新澳门三中二:11.33拖5尾，组10米。',groups=[5,15,25,35,45].map(n=>[11,33,n]);
const doc=(text=source,businessDate='2026-10-14')=>({id:'tail-drag',name:'测试',text,businessDate,defaultPlayer:''});
const parse=text=>parseDocument(text??source,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('三中二双号拖5尾明确五组每组10元共50元，保留原文并直接计账',()=>{
  const p=valid(),b=p.bets[0];assert.equal(p.bets.length,1);assert.equal(b.playType,'linked-number-3-2');assert.equal(senderHeader(source),null);
  assert.deepEqual(b.groups,groups);assert.deepEqual(b.markets,['新']);assert.deepEqual(b.values,[11,33,5,15,25,35,45]);
  assert.deepEqual([b.basis,b.mode,b.count,b.unitCents,b.totalCents],['每组','groups',5,1000,5000]);
  assert.deepEqual(b.drag,{ruleId:'R40',anchors:[11,33],tail:5,numbers:[5,15,25,35,45],excluded:[]});
  assert.equal(b.semantic.ruleId,'R40');assert.deepEqual(b.warnings,[]);assert.equal(b.raw,source);assert.equal(summarize([p]).totalCents,5000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('常用分隔符、全角、中文金额和组金额兼容，金额续行不丢失原文定位',()=>{
  for(const text of ['三中二11，33拖5尾组10','三中二 11 33 拖 5 尾 每组十元','三中二１１．３３拖５尾，组１０米。','三中二11/33拖5尾各组10元','三中二11号、33号拖5尾各10','三中二11.33拖5尾\n组10米','三中二11.33拖5尾，组10米；三中二11.33拖5尾每组10']){
    const p=valid(text);assert(p.bets.every(b=>JSON.stringify(b.groups)===JSON.stringify(groups)),text);assert(p.bets.every(b=>b.unitCents===1000),text);
    assert(p.bets.every(b=>b.raw===text),text);
    assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
  assert.equal(valid('三中二11.33拖5尾\n组10米').bets[0].endLine,2);
  assert.equal(valid('三中二11.33拖5尾组0.5').bets[0].totalCents,250);
});

test('明确三中二标题可继承，多市场各自计费；后续普通投注不继承固定号',()=>{
  const p=valid('小明：旧三中二\n11.33拖5尾组10\n01 02 03各5\n三边三中二11.33拖5尾组10\n张三：三中二11.33拖5尾组10');
  assert.deepEqual(p.bets.map(b=>[b.markets,b.count,b.totalCents]),[[['旧'],5,5000],[['旧'],1,500],[['新','旧','港'],5,15000],[['新'],5,5000]]);
  assert.equal(p.bets[1].drag,undefined);assert.deepEqual(p.bets[1].values,[1,2,3]);assert.deepEqual(reviewInput(doc(p.originalText)).items,[]);
});

test('0尾只有四个有效号码，尾数包含固定号时排除重复，号码不随生肖年份改变',()=>{
  assert.deepEqual(valid('三中二11.33拖0尾组10').bets[0].groups,[10,20,30,40].map(n=>[11,33,n]));
  const b=valid('三中二05.15拖5尾组10').bets[0];assert.deepEqual(b.groups,[25,35,45].map(n=>[5,15,n]));assert.deepEqual(b.drag.excluded,[5,15]);assert.equal(b.totalCents,3000);
  for(const date of ['2026-02-16','2026-02-17','2027-02-07'])assert.deepEqual(parseDocument(source,doc(source,date)).bets[0].groups,groups);
});

test('固定号或尾数不明确、非法金额、计费冲突及其他拖法不误算成复式',()=>{
  for(const [text,code] of [
    ['三中二11拖5尾组10','DAN_TUO'],['三中二11.33.22拖5尾组10','DAN_TUO'],['三中二11.11拖5尾组10','DAN_TUO'],
    ['三中二00.33拖5尾组10','NUMBER_RANGE'],['三中二11.50拖5尾组10','NUMBER_RANGE'],['三中二11.33拖15尾组10','INVALID_TAIL'],
    ['三中二11.33拖5尾6尾组10','DAN_TUO'],['三中二11.33拖5.6尾组10','DAN_TUO'],['三中二11.33拖5头组10','DAN_TUO'],
    ['三中二复式11.33拖5尾组10','DAN_TUO'],['三中二11.33胆拖5尾组10','DAN_TUO'],['11.33拖5尾组10','DAN_TUO'],
    ['三中二11.33拖5尾每尾10','BASIS_CONFLICT'],['三中二11.33拖5尾每肖10','BASIS_CONFLICT'],['三中二11.33拖5尾每号10','BASIS_CONFLICT'],
    ['三中二11.33拖5尾','MISSING_AMOUNT'],['三中二11.33拖5尾组-10','INVALID_AMOUNT'],['三中二11.33拖5尾组10.123','INVALID_AMOUNT'],
  ]){
    const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('五个明确分组按中二及中三正码分别赔付，特码不算正码，不重组号码池',()=>{
  const b=valid().bets[0],odds=defaultOdds();odds.confirmed=true;odds.rates['three-two'].rate='20';odds.rates['three-three'].rate='90';
  const settle=numbers=>settleBet(b,{market:'新',date:'2026-10-14',issue:'2026287',numbers},odds);
  const mixed=settle([11,33,5,15,1,2,25]);assert.equal(mixed.winCount,5);assert.equal(mixed.winningStakeCents,5000);assert.equal(mixed.payoutCents,240000);
  assert.deepEqual(Object.fromEntries(mixed.tiers.map(t=>[t.key,t.count])),{'three-two':3,'three-three':2});
  const two=settle([11,33,1,2,3,4,5]);assert.equal(two.winCount,5);assert.equal(two.payoutCents,100000);
  const oneAnchor=settle([11,5,15,1,2,3,33]);assert.equal(oneAnchor.winCount,2);assert.equal(oneAnchor.payoutCents,40000);
  const lost=settle([5,15,25,35,45,1,11]);assert.equal(lost.winCount,0);assert.equal(lost.payoutCents,0);
});

test('AI保留固定号、拖尾和原单价，不可改成号码池、其他玩法或总额',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const bet={markets:['新'],play:'三中二',selection:'11.33拖5尾',basis:'每组',amount:'10',evidence:{market:'新澳门',play:'三中二',selection:'11.33拖5尾',amount:'10'}};
  const candidate={bets:[bet]};assert.deepEqual(validateCandidate(candidate,item,d).bets[0].groups,groups);
  assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
  for(const change of [{selection:'11.33.5.15.25.35.45'},{selection:'11.33.5尾'},{play:'三中三'},{play:'特码',basis:'每号'},{amount:'50'}])assert.throws(()=>validateCandidate({bets:[{...bet,...change}]},item,d));
});

test('新规则使旧AI错误解释失效，原文保留并自动计入50元，高亮不混淆尾数和金额',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261013-2';d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'新三中二11 33 5 15 25 35 45各10':''}]),version:'semantic-20261013-2'};
    const upgraded=upgradeDocument(d),p=parseDocument(upgraded.text,upgraded);assert.equal(upgraded.text,source);assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);assert.equal(summarize([p]).totalCents,5000);assert.deepEqual(currentReviewItems(upgraded),[]);
  }
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);assert.deepEqual(tokens.filter(t=>t.kind==='play').map(t=>t.text),['三中二','拖']);assert.deepEqual(tokens.filter(t=>t.kind==='selection').map(t=>t.text),['11','33','5尾']);assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['10']);
});
