import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,reviewPayload,validateCandidate,validateReply,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='二连肖马拖（兔羊猪虎鸡）各20';
const groups=[['马','兔'],['马','羊'],['马','猪'],['马','虎'],['马','鸡']];
const doc=(text=source,businessDate='2026-10-05')=>({id:'linked-zodiac-drag',name:'测试',text,businessDate,defaultPlayer:''});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};

test('马拖五肖为五组二连肖各20共100，保存明确配对且无需AI确认',()=>{
  const p=valid(),b=p.bets[0];assert.equal(p.bets.length,1);
  assert.deepEqual(b.groups,groups);assert.deepEqual(b.values,['马','兔','羊','猪','虎','鸡']);
  assert.deepEqual([b.playType,b.size,b.mode,b.basis,b.count,b.unitCents,b.totalCents],['linked-zodiac',2,'groups','每组',5,2000,10000]);
  assert.equal(b.semantic.ruleId,'R33');assert.equal(b.raw,source);assert.equal(b.line,1);assert.equal(b.endLine,1);
  assert.deepEqual(b.drag,{ruleId:'R33',anchor:'马',animals:['兔','羊','猪','虎','鸡']});assert.deepEqual(b.warnings,[]);
  assert.equal(summarize([p]).totalCents,10000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('全半角括号、别名、空格、顿号、中文金额、无括号和单价续行等价',()=>{
  for(const text of ['二连肖马拖(兔羊猪虎鸡)各20','2连肖 马 拖【兔、羊、猪、虎、鸡】每组二十米','２连肖：马拖[兔 羊 猪 虎 鸡]各２０','两连肖马拖兔羊猪虎鸡各20','二连肖马拖（兔羊猪虎鸡）：各20','二连肖马拖（兔羊猪虎鸡）\n各20']){
    const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,10000,text);
    assert.equal(b.raw,text);assert.equal(senderHeader(text),null);assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
  assert.equal(valid('二连肖马拖（兔羊猪虎鸡）\n各20').bets[0].endLine,2);
  assert.deepEqual(valid('二连肖牛拖（兔）各10').bets[0].groups,[['牛','兔']]);
});

test('明确二连肖可继承，后续普通连肖不继承固定马，多市场和发送人分别处理',()=>{
  const text='小明：旧二连肖\n马拖（兔羊猪虎鸡）各20\n牛羊各30\n张三：三边'+source+'\n香港33 34各5';
  const p=valid(text);assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['linked-zodiac',['旧'],10000],['linked-zodiac',['旧'],3000],['linked-zodiac',['新','旧','港'],30000],['special-number',['港'],1000],
  ]);
  assert.deepEqual(p.bets[0].groups,groups);assert.equal(p.bets[0].semantic.declaration.line,1);
  assert.equal(p.bets[1].groups,null);assert.equal(p.bets[1].drag,undefined);assert.deepEqual(p.bets[1].values,['牛','羊']);
  assert.equal(p.bets[2].player,'张三');assert.deepEqual(p.bets[2].groups,groups);assert.deepEqual(reviewInput(doc(text)).items,[]);
  const context=valid('新澳平特兔羊猪各200\n'+source+'\n新澳平特羊猪兔各100\n二连肖羊猪、羊兔、兔猪各50');
  assert.equal(summarize([context]).totalCents,115000);assert.deepEqual(context.bets[1].groups,groups);
});

test('其他拖法、括号损坏、固定生肖重复或自配生肖及计费冲突保持待处理',()=>{
  for(const [text,code] of [
    ['二连肖马牛拖（兔羊）各20','DAN_TUO'],['三连肖马拖（兔羊猪）各20','DAN_TUO'],
    ['二中二马虎拖（兔羊猪）各20','DAN_TUO'],
    ['二连肖马拖（马兔羊）各20','DAN_TUO'],['二连肖马拖（）各20','DAN_TUO'],
    ['二连肖马拖（兔羊各20','DAN_TUO'],['二连肖马拖兔羊）各20','DAN_TUO'],
    ['二连肖马拖（兔羊）猪各20','DAN_TUO'],['二连肖马拖（兔羊01）各20','DAN_TUO'],
    ['二连肖复式马拖（兔羊）各20','DAN_TUO'],['二连肖马胆拖（兔羊）各20','DAN_TUO'],
    ['二连肖马拖（兔羊）每肖20','BASIS_CONFLICT'],['二连肖马拖（兔羊）每号20','BASIS_CONFLICT'],
    ['二连肖马拖（兔羊）','MISSING_AMOUNT'],
  ]){
    const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);
  }
});

test('只有含马的原五组中奖，遵循开奖范围及当年生肖赔率',()=>{
  const p=valid(),b=p.bets[0],odds=defaultOdds();odds.confirmed=true;
  const settle=(numbers,settings=odds)=>settleBet(b,{market:'新',date:doc().businessDate,issue:'2026278',numbers},settings);
  const all=settle([1,4,12,8,5,10,2]);assert.equal(all.winCount,5);assert.equal(all.winningStakeCents,10000);assert.equal(all.payoutCents,38000);
  for(const numbers of [[4,12,8,5,10,2,3],[1,2,3,6,7,9,11]]){const lost=settle(numbers);assert.equal(lost.winCount,0);assert.equal(lost.payoutCents,0);}
  const special=[4,12,2,3,6,7,1];assert.equal(settle(special).winCount,2);assert.equal(settle(special).payoutCents,15200);
  const six=structuredClone(odds);six.scopes['linked-zodiac']='six';assert.equal(settle(special,six).winCount,0);
  for(const [date,payout] of [['2026-02-16',40000],['2026-02-17',38000],['2027-02-06',39600]]){
    const parsed=valid(source,date),numbers=[...'马兔羊猪虎鸡龙'].map(a=>parsed.rule.zodiac[a][0]);
    const r=settleBet(parsed.bets[0],{market:'新',date,issue:date.slice(0,4)+'047',numbers},odds,Date.parse(date+'T23:00:00+08:00'));
    assert.equal(r.winCount,5,date);assert.equal(r.payoutCents,payout,date);
  }
});

test('AI保持固定马配对和20元单价，不能改成十五组普通复式',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'2连肖',selection:'马拖（兔羊猪虎鸡）',basis:'每组',amount:'20',evidence:{market:'',play:'二连肖',selection:'马拖（兔羊猪虎鸡）',amount:'20'}};
  for(const selection of [b.selection,'(马兔)(马羊)(马猪)(马虎)(马鸡)']){
    const candidate={bets:[{...b,selection}]},r=validateCandidate(candidate,item,d);
    assert.deepEqual(r.bets[0].groups,groups);assert.equal(r.totalCents,10000);
    assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  }
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'马兔羊猪虎鸡'}]},item,d),/分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'(马兔)(马羊)(马猪)(马虎)(兔鸡)'}]},item,d),/分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,amount:'100'}]},item,d),/金额/);
});

test('旧拖法待处理及AI失败缓存失效，旧账直接计入100元，原文高亮保留',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261010-5';
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'二连肖马兔羊猪虎鸡各20':''}]),version:'semantic-20261010-5'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);assert.equal(summarize([p]).totalCents,10000);assert.deepEqual(currentReviewItems(next),[]);
  }
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.deepEqual(tokens.filter(t=>t.kind==='play').map(t=>t.text),['二连肖','拖']);assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['20']);
});
