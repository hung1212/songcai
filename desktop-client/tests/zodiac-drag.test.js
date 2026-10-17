import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ruleForDate} from '../src/core/rules.js';
import {reviewInput,reviewPayload,validateCandidate,validateReply,assistanceFor} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {highlightText} from '../src/core/highlight.js';

const source='二中二30拖鼠各10';
const groups=[[30,7],[30,19],[30,31],[30,43]];
const doc=(text=source,businessDate='2026-10-10')=>({id:'zodiac-drag',name:'测试',text,businessDate,defaultPlayer:''});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};

test('30拖鼠明确四组二中二，每组10元共40元，保留原文且无需AI确认',()=>{
  const p=valid(),b=p.bets[0];
  assert.equal(p.bets.length,1);assert.equal(b.playType,'linked-number-2-2');
  assert.deepEqual(b.groups,groups);assert.deepEqual(b.values,[30,7,19,31,43]);
  assert.deepEqual([b.basis,b.mode,b.count,b.unitCents,b.perMarketCents,b.totalCents],['每组','groups',4,1000,4000,4000]);
  assert.equal(b.semantic.ruleId,'R30');assert.deepEqual(b.warnings,[]);
  assert.equal(b.raw,source);assert.equal(b.line,1);assert.equal(b.endLine,1);
  assert.equal(summarize([p]).totalCents,4000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('拖生肖支持明确别名、空格、冒号、全角、中文金额及跨行单价',()=>{
  for(const text of ['2中2：30号拖鼠肖每组十元','两中两 30 拖 鼠 各十米','二中二３０拖鼠各１０','二中二30拖鼠：各10','二中二：30拖鼠各组10元','二中二30拖鼠\n各10']){
    const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,4000,text);
    assert.equal(senderHeader(text),null);assert.equal(b.raw,text);
    assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
  assert.equal(valid('二中二30拖鼠\n各10').bets[0].endLine,2);
});

test('继承二中二和市场，但后续普通投注不继承固定拖号，换发送人重置',()=>{
  const text='小明：旧二中二\n30拖鼠各10\n01 02各5\n三边二中二30拖鼠各10\n张三：二中二30拖鼠各10';
  const p=valid(text);
  assert.deepEqual(p.bets.map(b=>[b.markets,b.count,b.totalCents]),[
    [['旧'],4,4000],[['旧'],1,500],[['新','旧','港'],4,12000],[['新'],4,4000],
  ]);
  assert.equal(p.bets[0].semantic.inherited,true);assert.equal(p.bets[0].semantic.declaration.line,1);
  assert.equal(p.bets[1].groups,null);assert.equal(p.bets[1].drag,undefined);
  assert.deepEqual(p.bets[1].values,[1,2]);assert.equal(summarize([p]).totalCents,20500);
  assert.equal(p.bets[3].player,'张三');assert.deepEqual(reviewInput(doc(text)).items,[]);
  assert.equal(parse('小明：二中二30拖鼠各10\n张三：30拖鼠各10').issues[0].code,'DAN_TUO');
});

test('拖生肖在农历新年切换号码，四号五号按实际组数计费',()=>{
  for(const date of ['2026-01-01','2026-02-16','2026-02-17','2027-02-05','2027-02-06','2032-04-01']){
    const b=valid(source,date).bets[0],numbers=ruleForDate(date).zodiac.鼠.filter(n=>n!==30);
    assert.deepEqual(b.groups,numbers.map(n=>[30,n]));assert.equal(b.totalCents,numbers.length*1000);
  }
  assert.deepEqual(valid(source,'2026-02-16').bets[0].groups,[[30,6],[30,18],[30,42]]);
  assert.equal(valid(source,'2032-04-01').bets[0].count,5);
});

test('固定号码属于所拖生肖时排除自身，明确列出实际分组',()=>{
  const b=valid('二中二07拖鼠各10').bets[0];
  assert.deepEqual(b.groups,[[7,19],[7,31],[7,43]]);assert.deepEqual(b.drag.excluded,[7]);
  assert.equal(b.count,3);assert.equal(b.totalCents,3000);
  assert.deepEqual(valid('二中二01拖马各10').bets[0].groups,[[1,13],[1,25],[1,37],[1,49]]);
});

test('其他拖法、不合法号码、计费冲突和缺少金额仍待处理，不误算普通复式',()=>{
  for(const [text,code] of [
    ['二中二兔拖龙各48','DAN_TUO'],['二中二30 31拖鼠各10','DAN_TUO'],
    ['二中二30拖鼠牛各10','DAN_TUO'],['三中三30拖鼠各10','DAN_TUO'],
    ['二中二复式30拖鼠各10','DAN_TUO'],['二中二30胆拖鼠各10','DAN_TUO'],
    ['30拖鼠各10','DAN_TUO'],['二中二00拖鼠各10','NUMBER_RANGE'],['二中二50拖鼠各10','NUMBER_RANGE'],
    ['二中二30拖鼠各号10','BASIS_CONFLICT'],['二中二30拖鼠每肖10','BASIS_CONFLICT'],
    ['二中二30拖鼠','MISSING_AMOUNT'],
  ]){
    const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);
    assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('只结算含固定30的二中二正码配对，不把生肖内部配对或第七号当中奖',()=>{
  const b=valid().bets[0],odds=defaultOdds();odds.confirmed=true;
  const settle=numbers=>settleBet(b,{market:'新',date:'2026-10-10',issue:'2026283',numbers},odds);
  const won=settle([30,7,19,31,1,2,43]);
  assert.equal(won.winCount,3);assert.equal(won.winningStakeCents,3000);assert.equal(won.payoutCents,180000);
  for(const numbers of [[7,19,31,43,1,2,30],[7,19,31,43,1,2,3],[30,1,2,3,4,5,7]]){
    const lost=settle(numbers);assert.equal(lost.winCount,0);assert.equal(lost.payoutCents,0);
  }
  assert.equal(settle([30,7,19,31,43,2,1]).winCount,4);
});

test('AI保留拖字和原金额，由本地展开；拒绝改成复式、特肖或其他金额',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'二中二',selection:'30拖鼠',basis:'每组',amount:'10',evidence:{market:'',play:'二中二',selection:'30拖鼠',amount:'10'}};
  const candidate={bets:[b]},result=validateCandidate(candidate,item,d);
  assert.deepEqual(result.bets[0].groups,groups);assert.equal(result.totalCents,4000);
  assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'30鼠'}]},item,d),/分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,play:'特肖',basis:'每肖',selection:'鼠'}]},item,d),/选号|玩法|分组/);
  assert.throws(()=>validateCandidate({bets:[{...b,amount:'40'}]},item,d),/金额/);
  const unsupported=doc('二中二兔拖龙各48'),pending=reviewInput(unsupported).items[0];
  assert.throws(()=>validateCandidate(candidate,pending,unsupported),/拖号分组未明确/);
});

test('旧版AI解释不会覆盖新拖号规则，升级直接计入正确40元',()=>{
  const d=doc(),old=assistanceFor(d,[{line:1,status:'accepted',replacement:'二中二 30鼠各10'}]);
  old.version='semantic-20261010-2';d.assistance=old;d.parserVersion='parser-20261010-2';
  const upgraded=upgradeDocument(d),p=parseDocument(upgraded.text,upgraded);
  assert.equal(upgraded.text,source);assert.deepEqual(p.bets[0].groups,groups);assert.equal(summarize([p]).totalCents,4000);
  assert.deepEqual(p.issues,[]);
});

test('拖号玩法、选号和金额高亮分开，并保留完整原文',()=>{
  const tokens=highlightText(source),of=kind=>tokens.filter(t=>t.kind===kind).map(t=>t.text);
  assert.deepEqual(of('play'),['二中二','拖']);assert.deepEqual(of('selection'),['30','鼠']);
  assert.deepEqual(of('amount'),['10']);assert.equal(tokens.map(t=>t.text).join(''),source);
});
