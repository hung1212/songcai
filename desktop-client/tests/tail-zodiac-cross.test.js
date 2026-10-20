import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ruleForDate} from '../src/core/rules.js';
import {defaultOdds,settleBet,settleDocuments} from '../src/core/settlement.js';
import {manualDraw} from '../src/core/draws.js';
import {reviewInput,reviewPayload,validateCandidate,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';

const source='二中二，5尾拖鸡各10';
const groups=[5,15,25,35,45].flatMap(a=>[10,22,34,46].map(b=>[a,b]));
const doc=(text=source,businessDate='2026-10-18')=>({id:'tail-zodiac-cross',text,businessDate});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};

test('二中二5尾拖鸡按5乘4展开20组，每组10元共200元',()=>{
  const p=valid(),b=p.bets[0];assert.equal(p.bets.length,1);
  assert.deepEqual([b.playType,b.size,b.basis,b.mode,b.count,b.unitCents,b.totalCents],['linked-number-2-2',2,'每组','groups',20,1000,20000]);
  assert.deepEqual(b.groups,groups);assert.deepEqual(b.warnings,[]);assert.equal(b.semantic.ruleId,'R46');
  assert.deepEqual(b.drag,{ruleId:'R46',tail:5,animal:'鸡',anchors:[5,15,25,35,45],numbers:[10,22,34,46],excluded:[]});
  assert.equal(b.raw,source);assert.equal(summarize([p]).totalCents,20000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('支持二中二别名、空格、冒号、全角、中文金额及金额续行',()=>{
  for(const text of ['2中2：5尾拖鸡每组十元','两中两 5 尾 拖 鸡 各十米','二中二５尾拖鸡各１０','二中二5尾拖鸡肖：各10','二中二5尾拖鸡\n各10','二中二\n5尾拖鸡各10']){
    const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,20000);
    assert.equal(senderHeader(text.split('\n')[0]),null);assert.deepEqual(reviewInput(doc(text)).items,[]);
    assert.equal(highlightText(text).map(t=>t.text).join(''),text);
  }
  const b=valid('二中二5尾拖鸡\n各10').bets[0];assert.equal(b.raw,'二中二5尾拖鸡\n各10');assert.equal(b.endLine,2);
  const tokens=highlightText(source);assert(tokens.some(t=>t.kind==='selection'&&t.text==='5尾'));
  assert(tokens.some(t=>t.kind==='amount'&&t.text==='10'));
});

test('尾数与生肖重合仅排除自身配对，0尾无00，本命年五号按实际组数',()=>{
  const zero=valid('二中二0尾拖鸡各10').bets[0];assert.equal(zero.count,15);assert.equal(zero.totalCents,15000);
  assert.deepEqual(zero.drag.anchors,[10,20,30,40]);assert.deepEqual(zero.drag.excluded,[10]);
  assert(!zero.groups.some(([a,b])=>a===b||a===0||b===0));
  assert(zero.groups.some(([a,b])=>a===10&&b===22));assert(zero.groups.some(([a,b])=>a===20&&b===10));
  const annual=valid('二中二5尾拖马各10').bets[0];assert.equal(annual.count,24);assert.equal(annual.totalCents,24000);
  assert.deepEqual(annual.drag.excluded,[25]);assert(!annual.groups.some(([a,b])=>a===25&&b===25));
  for(const date of ['2026-02-16','2026-02-17','2027-02-05','2027-02-06','2029-03-01']){
    const b=valid(source,date).bets[0],z=ruleForDate(date).zodiac.鸡,overlap=z.filter(n=>n%10===5).length;
    assert.equal(b.count,5*z.length-overlap,date);assert.equal(b.totalCents,b.count*1000);
    assert(b.groups.every(([a,c])=>a!==c&&a%10===5&&z.includes(c)));
    assert.equal(new Set(b.groups.map(g=>[...g].sort((a,c)=>a-c).join(','))).size,b.count);
  }
});

test('市场玩家和玩法标题正确继承，后笔不继承尾数选号，空行和玩家边界重置',()=>{
  const p=valid('小明：香港二中二\n5尾拖鸡各10\n01 02各5\n三边二中二5尾拖鸡各10\n张三：二中二5尾拖鸡各10');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets,b.count,b.totalCents]),[
    ['小明',['港'],20,20000],['小明',['港'],1,500],['小明',['新','旧','港'],20,60000],['张三',['新'],20,20000],
  ]);
  assert.equal(p.bets[0].semantic.inherited,true);assert.equal(p.bets[0].semantic.declaration.line,1);
  assert.equal(p.bets[1].drag,undefined);assert.deepEqual(p.bets[1].values,[1,2]);
  for(const text of ['香港二中二\n\n5尾拖鸡各10','小明：二中二\n张三：5尾拖鸡各10']){
    const p=parse(text);assert(p.issues.some(i=>i.code==='DAN_TUO'));assert.equal(summarize([p]).totalCents,0);
  }
});

test('非法尾数、未明确多尾多肖或玩法、单价冲突仍待处理',()=>{
  for(const [text,code] of [
    ['二中二10尾拖鸡各10','INVALID_TAIL'],['二中二5尾6尾拖鸡各10','DAN_TUO'],['二中二5尾拖鸡猴各10','DAN_TUO'],
    ['二中二5尾拖鸡拖猴各10','DAN_TUO'],['二中二复式5尾拖鸡各10','DAN_TUO'],['二中二5尾胆拖鸡各10','DAN_TUO'],
    ['5尾拖鸡各10','DAN_TUO'],['特串5尾拖鸡各10','DAN_TUO'],['三中三5尾拖鸡各10','DAN_TUO'],
    ['二中二5尾拖鸡每肖10','BASIS_CONFLICT'],['二中二5尾拖鸡每尾10','BASIS_CONFLICT'],['二中二5尾拖鸡每号10','BASIS_CONFLICT'],
    ['二中二5尾拖鸡','MISSING_AMOUNT'],['二中二5尾拖鸡每组-10','INVALID_AMOUNT'],
  ]){const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);}
  assert.equal(valid('二中二5拖鸡各10').bets[0].count,4);
  assert.equal(valid('三中二11.33拖5尾各10').bets[0].count,5);
});

test('仅赔跨侧两个正码，特码不计入，玩家二中二独立赔率可用',()=>{
  const p=valid(),b=p.bets[0],odds=defaultOdds();
  const settle=numbers=>settleBet(b,{market:'新',date:'2026-10-18',issue:'2026291',numbers},odds);
  const won=settle([5,15,10,22,1,2,34]);assert.equal(won.winCount,4);assert.equal(won.winningStakeCents,4000);assert.equal(won.payoutCents,240000);
  for(const numbers of [[5,15,25,35,45,1,10],[10,22,34,46,1,2,5],[5,1,2,3,4,6,10]])assert.equal(settle(numbers).payoutCents,0);
  const draw=manualDraw({market:'新',date:'2026-10-18',issue:'2026291',numbers:[5,15,10,22,1,2,34],sourceName:'固定测试'});
  const playerOdds={[p.name]:{name:p.name,markets:{新:{rates:{'linked-number-2-2':{rate:'70'}}}}}};
  const result=settleDocuments([p],{新:draw},{新:odds},draw.date,{playerOdds});
  assert.equal(result.complete,true);assert.equal(result.payoutCents,280000);
  const overlap=valid('二中二0尾拖鸡各10').bets[0];
  assert.equal(settleBet(overlap,{...draw,numbers:[10,20,22,34,1,2,46]},odds).winCount,5);
});

test('AI核验保持5尾拖鸡的20组和10元单价，拒绝丢尾字及改玩法金额',()=>{
  for(const text of [source,'香港二中二\n5尾拖鸡各10']){
    const d=doc(text),item=reviewInput(d,'all').items.at(-1),inherited=text.includes('\n');
    const b={markets:[inherited?'港':'新'],play:'二中二',selection:'5尾拖鸡',basis:'每组',amount:'10',evidence:{market:'',play:inherited?'':'二中二',selection:'5尾拖鸡',amount:'10'}};
    assert.deepEqual(validateCandidate({bets:[b]},item,d).bets[0].groups,groups);
    assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
    for(const change of [{selection:'5拖鸡'},{selection:'5尾鸡'},{play:'特串'},{amount:'200'}]){
      assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/选号|分组|玩法|计费|金额|校验/);
    }
  }
});

test('旧AI错误解释随升级失效，按20组200元重算而保留原文与已保存赔付',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261016-2';d.settlements=[{id:'past',payoutCents:12345}];
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'二中二5拖鸡各10':''}]),version:'semantic-20261016-2'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.equal(next.text,source);assert.deepEqual(next.settlements,d.settlements);assert.deepEqual(p.issues,[]);
    assert.equal(summarize([p]).totalCents,20000);assert.deepEqual(currentReviewItems(next),[]);
  }
});
