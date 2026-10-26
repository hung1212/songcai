import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {reviewInput,reviewPayload,validateCandidate,assistanceFor,currentReviewItems,REVIEW_INSTRUCTIONS} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleBet,settleDocuments} from '../src/core/settlement.js';
import {highlightText} from '../src/core/highlight.js';

const source='新澳05-15-35-45拖19-39-25-13二中二各注5..';
const selection='05-15-35-45拖19-39-25-13';
const left=[5,15,35,45],right=[19,39,25,13];
const groups=left.flatMap(a=>right.map(b=>[a,b]));
const date='2026-10-20';
const doc=(text=source)=>({id:'number-pool-drag',name:'负责人',text,businessDate:date,defaultPlayer:''});
const parse=(text=source)=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('后置二中二号码互拖为16个明确组合，每组5元共80元',()=>{
  const p=valid(source),b=p.bets[0];assert.equal(p.bets.length,1);
  assert.deepEqual([b.playType,b.size,b.basis,b.mode,b.count,b.unitCents,b.totalCents],['linked-number-2-2',2,'每组','groups',16,500,8000]);
  assert.deepEqual(b.groups,groups);assert.deepEqual(new Set(b.values),new Set([...left,...right]));
  assert.deepEqual(b.drag,{ruleId:'R52',anchors:left,numbers:right,excluded:[]});
  assert.deepEqual(b.markets,['新']);assert.deepEqual(b.warnings,[]);assert.equal(b.semantic.ruleId,'R52');
  assert.equal(b.raw,source);assert.equal(b.line,1);assert.equal(b.endLine,1);assert.equal(senderHeader(source),null);
  assert.equal(summarize([p]).totalCents,8000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('前后置玩法、别名、括号、分隔符、全角和中文金额含义一致',()=>{
  for(const text of [
    `二中二${selection}每组5元`,`${selection}2中2每注五米`,`${selection}两中两各组5`,
    '二中二（05、15、35、45）拖（19、39、25、13）各5',
    '二中二【05 15 35 45】拖【19 39 25 13】各注5',
    '０５－１５－３５－４５拖１９－３９－２５－１３二中二各注５．．',
    '二中二 05号 15号 35号 45号 拖 19号 39号 25号 13号 每组5',
    '二中二05/15/35/45拖19/39/25/13：各5元',
  ]){const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,8000,text);assert.deepEqual(reviewInput(doc(text)).items,[]);}
  const b=valid('05-15拖19-39二中二各注5').bets[0];
  assert.deepEqual(b.groups,[[5,19],[5,39],[15,19],[15,39]]);assert.equal(b.totalCents,2000);
});

test('明确玩法与市场可继承，普通后笔不继承互拖选号，空行和玩家边界重置',()=>{
  const p=valid(`小明：旧二中二\n${selection}各注5\n01 02各5\n三边${selection}二中二各5\n张三：${selection}二中二各5`);
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets,b.count,b.totalCents]),[
    ['小明',['旧'],16,8000],['小明',['旧'],1,500],['小明',['新','旧','港'],16,24000],['张三',['新'],16,8000],
  ]);
  assert.equal(p.bets[0].semantic.inherited,true);assert.equal(p.bets[0].semantic.declaration.line,1);
  assert.equal(p.bets[1].drag,undefined);assert.deepEqual(p.bets[1].values,[1,2]);
  for(const text of [`二中二\n\n${selection}各5`,`小明：二中二\n张三：${selection}各5`]){
    const reset=valid(text);assert.equal(reset.bets[0].playType,'linked-number-2-2');assert.deepEqual(reset.bets[0].markets,['新']);assert.equal(summarize([reset]).totalCents,8000);
  }
  assert.deepEqual(valid(`香港二中二01 02各10\n\n${source}`).bets[1].markets,['新']);
});

test('单价续行合并并保留原文行号和玩法、选号、金额高亮',()=>{
  const text=`${selection}二中二\n各注五元`,b=valid(text).bets[0];
  assert.deepEqual(b.groups,groups);assert.equal(b.totalCents,8000);assert.equal(b.raw,text);assert.equal(b.endLine,2);
  const tokens=highlightText(source),of=kind=>tokens.filter(t=>t.kind===kind).map(t=>t.text);
  assert.equal(tokens.map(t=>t.text).join(''),source);assert.deepEqual(of('play'),['拖','二中二']);
  assert.deepEqual(of('selection'),['05','15','35','45','19','39','25','13']);assert.deepEqual(of('amount'),['5']);
});

test('重合号码仅排除自身配对；不能确定重复份数时继续待处理',()=>{
  const b=valid('二中二05-15拖05-19各注5').bets[0];
  assert.deepEqual(b.groups,[[5,19],[15,5],[15,19]]);assert.deepEqual(b.drag.excluded,[5]);assert.equal(b.totalCents,1500);
  for(const [text,code] of [
    ['二中二05拖05各5','INSUFFICIENT_SELECTION'],
    ['二中二05-05拖19各5','DAN_TUO'],['二中二05拖19-19各5','DAN_TUO'],
    ['二中二05-15拖05-15各5','DAN_TUO'],
  ]){const p=parse(text);assert(p.issues.some(i=>i.code===code),text);assert.equal(summarize([p]).totalCents,0);}
});

test('号码范围、括号、多个拖字、混合玩法和每号金额冲突不静默计费',()=>{
  for(const [text,code] of [
    ['二中二00-15拖19各5','NUMBER_RANGE'],['二中二05拖50各5','NUMBER_RANGE'],['二中二0515拖19各5','NUMBER_RANGE'],
    ['二中二(05-15拖19各5','DAN_TUO'],['二中二05拖19拖39各5','DAN_TUO'],['二中二05拖各5','DAN_TUO'],
    ['二中二05至15拖19各5','DAN_TUO'],['二中二复式05-15拖19各5','DAN_TUO'],['二中二05胆拖19各5','DAN_TUO'],
    ['三中三05-15拖19各5','DAN_TUO'],
    ['二中二05拖19每号5','BASIS_CONFLICT'],['二中二05拖19每肖5','BASIS_CONFLICT'],['二中二05拖19每尾5','BASIS_CONFLICT'],
    ['二中二05-15拖19','MISSING_AMOUNT'],['二中二05拖19每组-5','INVALID_AMOUNT'],
  ]){const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);}
});

test('仅跨侧两个正码中奖，左右各自内部配对及特码不计入，赔付按二中二赔率',()=>{
  const b=valid(source).bets[0],odds=defaultOdds();odds.rates['linked-number-2-2'].rate='60';
  const settle=numbers=>settleBet(b,{market:'新',date,issue:'2026293',numbers},odds);
  const won=settle([5,15,35,19,39,1,45]);
  assert.equal(won.winCount,6);assert.equal(won.winningStakeCents,3000);assert.equal(won.payoutCents,180000);
  for(const numbers of [[5,15,35,45,1,2,19],[19,39,25,13,1,2,5],[5,1,2,3,4,6,19]])assert.equal(settle(numbers).payoutCents,0);
  assert.equal(settle([5,15,35,19,39,25,45]).winCount,9);
});

test('账单独立赔率和二中二退水使用80元实际流水',()=>{
  const p=valid(source),odds=defaultOdds(),draw={market:'新',date,issue:'2026293',numbers:[5,15,35,19,39,1,45]};
  const result=settleDocuments([p],{新:draw},{新:odds},date,{
    playerOdds:{负责人:{name:'负责人',markets:{新:{rates:{'linked-number-2-2':{rate:'70'}}}}}},
    rebates:{负责人:{name:'负责人',perTenThousandCents:0,playRates:{'linked-number-2-2':100000}}},
  });
  assert.equal(result.complete,true);assert.equal(result.stakeCents,8000);assert.equal(result.payoutCents,210000);assert.equal(result.rebateCents,800);
});

test('AI保留16组与5元原单价，拒绝改为普通复式、同位置配对或特串',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'二中二',selection,basis:'每组',amount:'5',evidence:{market:'新澳',play:'二中二',selection,amount:'5'}};
  assert.deepEqual(validateCandidate({bets:[b]},item,d).bets[0].groups,groups);
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);assert.match(REVIEW_INSTRUCTIONS,/R52/);
  for(const change of [{selection:'05 15 35 45 19 39 25 13'},{selection:'(05 19)(15 39)(35 25)(45 13)'},{play:'特串'},{amount:'80'},{selection:'05-15-35-45拖19-39-25-12'}]){
    assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/选号|分组|玩法|计费|金额|候选/);
  }
});

test('旧AI待处理和错误解释随规则升级失效，原文及历史结算保留',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261020-1';d.settlements=[{id:'past',payoutCents:12345}];
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'新 二中二05 15 35 45 19 39 25 13各5':''}]),version:'semantic-20261020-1'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.equal(next.text,source);assert.deepEqual(next.settlements,d.settlements);assert.deepEqual(p.issues,[]);
    assert.deepEqual(p.bets[0].groups,groups);assert.equal(summarize([p]).totalCents,8000);assert.deepEqual(currentReviewItems(next),[]);
  }
});
