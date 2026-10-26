import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,reviewPayload,validateCandidate,validateReply,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='新澳三连肖：兔蛇拖（牛羊鼠猪羊马鸡猴）各十';
const animals=[...'牛羊鼠猪羊马鸡猴'],groups=animals.map(a=>['兔','蛇',a]);
const doc=(text=source,businessDate='2026-10-14')=>({id:'triple-zodiac-drag',name:'测试',text,businessDate,defaultPlayer:''});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};
function drawnAnimals(parsed,animals){const used=new Set();return [...animals].map(a=>{const n=parsed.rule.zodiac[a].find(n=>!used.has(n));used.add(n);return n;});}

test('三连肖双固定肖拖八项保留两个羊，明确八组各10元共80元且无需确认',()=>{
  const p=valid(),b=p.bets[0];assert.equal(senderHeader(source),null);assert.equal(p.bets.length,1);assert.deepEqual(b.groups,groups);
  assert.deepEqual([b.playType,b.size,b.basis,b.mode,b.count,b.unitCents,b.totalCents],['linked-zodiac',3,'每组','groups',8,1000,8000]);
  assert.deepEqual(b.markets,['新']);assert.deepEqual(b.drag,{ruleId:'R41',anchors:['兔','蛇'],animals,repeatedAnimals:['羊']});
  assert.equal(b.groups.filter(g=>g.join('')==='兔蛇羊').length,2);assert.equal(b.raw,source);assert.equal(b.semantic.ruleId,'R41');assert.deepEqual(b.warnings,[]);
  assert.equal(summarize([p]).totalCents,8000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('三连肖括号、分隔符、全角、中文金额及金额续行等价，不跨空行借金额',()=>{
  for(const text of ['三连肖兔蛇拖牛羊鼠猪羊马鸡猴各10','３连肖：兔、蛇拖【牛 羊 鼠 猪 羊 马 鸡 猴】每组十元','3连肖兔/蛇拖[牛/羊/鼠/猪/羊/马/鸡/猴]组１０米','平特三肖全中：兔蛇拖（牛羊鼠猪羊马鸡猴）各十','三连肖兔蛇拖（牛羊鼠猪羊马鸡猴）\n各十']){
    const p=valid(text);assert.deepEqual(p.bets[0].groups,groups,text);assert.equal(p.bets[0].totalCents,8000);assert.equal(p.bets[0].raw,text);assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
  assert.equal(valid('三连肖兔蛇拖（牛羊鼠猪羊马鸡猴）\n各十').bets[0].endLine,2);
  assert.equal(summarize([parse('三连肖兔蛇拖（牛羊鼠猪羊马鸡猴）\n\n各十')]).totalCents,0);
  assert.equal(valid('三连肖兔蛇拖（羊羊）组0.5').bets[0].totalCents,100);
});

test('三连肖标题与市场继承，普通续行不继承固定生肖，多市场及换人独立计费',()=>{
  const text='小明：旧三连肖\n兔蛇拖（牛羊鼠猪羊马鸡猴）各十\n龙狗虎各20\n张三：三边三连肖兔蛇拖（羊羊）各10\n李四：三连肖兔蛇拖牛各10\n香港33 34各5';
  const p=valid(text);assert.deepEqual(p.bets.map(b=>[b.markets,b.count,b.totalCents]),[[['旧'],8,8000],[['旧'],1,2000],[['新','旧','港'],2,6000],[['新'],1,1000],[['港'],2,1000]]);
  assert.equal(p.bets[0].semantic.declaration.line,1);assert.equal(p.bets[1].drag,undefined);assert.deepEqual(p.bets[1].values,['龙','狗','虎']);assert.deepEqual(reviewInput(doc(text)).items,[]);
});

test('二连肖重复被拖项同样保留重复份数，组内重复仍不允许',()=>{
  const p=valid('二连肖马拖（兔羊兔）各20'),b=p.bets[0];assert.deepEqual(b.groups,[['马','兔'],['马','羊'],['马','兔']]);assert.equal(b.count,3);assert.equal(b.totalCents,6000);assert.deepEqual(b.drag.repeatedAnimals,['兔']);assert.deepEqual(b.warnings,[]);
  assert.deepEqual(reviewInput(doc(p.originalText)).items,[]);
  const odds=defaultOdds();odds.confirmed=true;
  const r=settleBet(b,{market:'新',date:p.rule.date,issue:'2026287',numbers:drawnAnimals(p,'马兔龙狗虎猴马')},odds);assert.equal(r.winCount,2);assert.equal(r.payoutCents,15200);
  assert(parse('二连肖马拖（兔马兔）各20').issues.some(i=>i.code==='DAN_TUO'));
});

test('固定生肖个数错误、组内重复、其他拖法、括号损坏和计费冲突均不猜组',()=>{
  for(const [text,code] of [
    ['三连肖兔拖（牛羊鼠）各10','DAN_TUO'],['三连肖兔蛇牛拖（羊鼠）各10','DAN_TUO'],['三连肖兔兔拖（牛羊）各10','DAN_TUO'],
    ['三连肖兔蛇拖（牛蛇羊）各10','DAN_TUO'],['三连肖兔蛇拖（）各10','DAN_TUO'],['三连肖兔蛇拖（牛羊各10','DAN_TUO'],
    ['三连肖兔蛇拖牛羊）各10','DAN_TUO'],['三连肖兔蛇拖（牛羊）鼠各10','DAN_TUO'],['三连肖兔蛇拖（牛羊01）各10','DAN_TUO'],
    ['三连肖兔蛇拖（牛拖羊）各10','DAN_TUO'],['四连肖兔蛇牛拖（羊鼠）各10','DAN_TUO'],
    ['三连肖复式兔蛇拖（牛羊）各10','DAN_TUO'],['三连肖兔蛇胆拖（牛羊）各10','DAN_TUO'],
    ['三连肖兔蛇拖（牛羊）每肖10','BASIS_CONFLICT'],['三连肖兔蛇拖（牛羊）每号10','BASIS_CONFLICT'],
    ['三连肖兔蛇拖（牛羊）','MISSING_AMOUNT'],['三连肖兔蛇拖（牛羊）各-10','INVALID_AMOUNT'],
  ]){const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0,text);}
});

test('逐组结算保留重复中奖羊，区分当年生肖档和六／七码范围，不重组被拖生肖',()=>{
  const p=valid(),b=p.bets[0],odds=defaultOdds();odds.confirmed=true;
  const settle=(names,settings=odds)=>settleBet(b,{market:'新',date:p.rule.date,issue:'2026287',numbers:drawnAnimals(p,names)},settings);
  const r=settle('兔蛇羊马鸡牛鼠');assert.equal(r.winCount,6);assert.equal(r.winningStakeCents,6000);assert.equal(r.payoutCents,61000);
  assert.deepEqual(r.tiers.map(t=>[t.yearAnimal,t.count,t.rate]),[['',5,'10.5'],['马',1,'8.5']]);
  const sheep=settle('兔蛇羊虎龙狗兔');assert.equal(sheep.winCount,2);assert.equal(sheep.payoutCents,21000);
  assert.equal(settle('牛羊鼠猪马鸡猴').winCount,0);
  assert.equal(settle('兔羊牛鼠鸡马蛇').winCount,6);
  const six=structuredClone(odds);six.scopes['linked-zodiac']='six';assert.equal(settle('兔羊牛鼠鸡马蛇',six).winCount,0);
  for(const [date,payout] of [['2026-02-16',17000],['2026-02-17',21000],['2027-02-06',17000]]){
    const p=valid(source,date),r=settleBet(p.bets[0],{market:'新',date,issue:date.slice(0,4)+'047',numbers:drawnAnimals(p,'兔蛇羊虎龙狗兔')},odds,Date.parse(date+'T23:00:00+08:00'));
    assert.equal(r.winCount,2,date);assert.equal(r.payoutCents,payout,date);
  }
});

test('AI可保留拖肖或等价八组，不得去重第二个羊、扁平复式或改变单价',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'3连肖',selection:'兔蛇拖（牛羊鼠猪羊马鸡猴）',basis:'每组',amount:'10',evidence:{market:'新澳',play:'三连肖',selection:'兔蛇拖（牛羊鼠猪羊马鸡猴）',amount:'十'}};
  for(const selection of [b.selection,groups.map(g=>'('+g.join('')+')').join('')]){
    const candidate={bets:[{...b,selection}]},result=validateCandidate(candidate,item,d);assert.deepEqual(result.bets[0].groups,groups);assert.equal(result.totalCents,8000);assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  }
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
  for(const change of [{selection:'兔蛇拖（牛羊鼠猪马鸡猴）'},{selection:'兔蛇牛羊鼠猪马鸡猴'},{play:'特肖',basis:'每肖'},{amount:'80'}])assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d));
});

test('旧版错误核验失效，新规则自动计入八组80元，原文和高亮完整保留',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261014-1';d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'三连肖兔蛇牛羊鼠猪马鸡猴各10':''}]),version:'semantic-20261014-1'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,source);assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);assert.equal(summarize([p]).totalCents,8000);assert.deepEqual(currentReviewItems(next),[]);
  }
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);assert.deepEqual(tokens.filter(t=>t.kind==='play').map(t=>t.text),['三连肖','拖']);assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['十']);
});
