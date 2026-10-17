import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {marketTokens,structuralConflicts} from '../src/core/business-syntax.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';

const doc=text=>({id:'bare-macau',name:'测试',text,businessDate:'2026-10-08',defaultPlayer:''});
const parse=(text,options={})=>parseDocument(text,{...doc(text),...options});
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('单字澳奥标题从旧或港切换到新，后续投注继承新市场且不回改之前投注',()=>{
  for(const before of ['旧','港','两边'])for(const alias of ['澳','奥'])for(const colon of ['',':',' ： ']){
    const text=`${before}01各10\n${alias}${colon}\n02各20\n03各30`,p=valid(text);
    assert.deepEqual(p.bets.slice(1).map(b=>b.markets),[['新'],['新']]);
    assert(p.bets.slice(1).every(b=>b.marketSource===2));
    assert.equal(p.bets[0].markets.join(),before==='两边'?'新,旧':before);
    assert.equal(summarize([p]).markets.新,before==='两边'?6000:5000);
    assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
});

test('澳奥同行前缀和澳特奥特明确声明新，标题清除旧玩法，明确玩法仍优先',()=>{
  for(const prefix of ['澳','奥','澳：','奥：','澳特','奥特','澳特：','奥特：']){
    const p=valid(`旧01各10\n${prefix}02各20\n03各30`);
    assert.equal(p.bets[1].markets.join(),'新');assert.equal(p.bets[2].markets.join(),'新');
  }
  for(const heading of ['澳\n','奥\n','澳：','奥：']){
    const p=valid(`旧三中三01 02 03各10\n${heading}04 05各20\n06各10`);
    assert.deepEqual(p.bets.map(b=>[b.playType,b.markets]),[['linked-number-3-3',['旧']],['special-number',['新']],['special-number',['新']]]);
  }
  const p=valid('港01各10\n奥：二中二02 03各20\n04 05各10');
  assert(p.bets.slice(1).every(b=>b.playType==='linked-number-2-2'&&b.markets.join()==='新'));
});

test('完整旧澳老澳及双市场声明优先，不从澳奥内再拆出多余市场',()=>{
  for(const label of ['旧澳','老澳','旧奥','老奥','旧澳门','老澳门','澳门旧','澳门老','奥门旧','澳旧','奥老','旧 澳','老 奥']){
    const p=valid(`${label}01各10`);assert.deepEqual(p.bets[0].markets,['旧'],label);
    assert.deepEqual(marketTokens(label).map(t=>t.markets),[['旧']],label);
  }
  for(const label of ['新旧澳','新老奥','旧新澳','老新奥','澳门新旧','两边'])assert.deepEqual(valid(`${label}01各10`).bets[0].markets,['新','旧'],label);
  assert.deepEqual(valid('三边01各10').bets[0].markets,['新','旧','港']);
});

test('玩家不因澳奥变为业务标题，明确绑定同名玩家优先，普通说明不切市场',()=>{
  assert.equal(senderHeader('澳：01各10'),null);assert.equal(senderHeader('奥：01各10'),null);
  for(const name of ['阿奥','澳洲朋友','奥先生'])assert.equal(senderHeader(`${name}：01各10`)?.name,name);
  const p=valid('小明：港01各10\n澳02各20\n张三：03各30');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets]),[['小明',['港']],['小明',['新']],['张三',['新']]]);
  const bound=parse('奥：旧01各10\n奥：02各20',{defaultPlayer:'奥'});
  assert.deepEqual(bound.issues,[]);assert(bound.bets.every(b=>b.player==='奥'&&b.markets.join()==='旧'));
  assert.equal(valid('旧01各10\n澳洲旅游\n奥运加油\n02各20').bets[1].markets.join(),'旧');
});

test('合计尾注澳奥采用连续段范围，不能覆盖冲突的明确市场',()=>{
  for(const alias of ['澳','奥']){
    const p=valid(`旧01各10\n共10\n02各20\n03各30\n共50，${alias}`);
    assert.deepEqual(summarize([p]).markets,{新:5000,旧:1000,港:0});
    assert(p.metadata.some(m=>m.closingMarket?.join()==='新'&&m.expectedCents===5000&&m.actualCents===5000));
    assert(parse(`旧01各10\n共10，${alias}`).issues.some(i=>i.code==='TRAILING_MARKET'));
  }
});

test('AI和原文证据保留澳奥的新市场，旧缓存失效，赔付按新市场开奖',()=>{
  const d=doc('旧01各10\n奥02各20'),item=reviewInput(d,'all').items.find(i=>i.line===2);
  assert.deepEqual(item.context.markets,['新']);assert(item.evidence.some(e=>e.quote==='奥'&&e.markets?.join()==='新'));
  const b={markets:['新'],play:'特码',selection:'02',basis:'每号',amount:'20',evidence:{market:'奥',play:'',selection:'02',amount:'20'}};
  assert.equal(validateCandidate({bets:[b]},item,d).totalCents,2000);
  assert.throws(()=>validateCandidate({bets:[{...b,markets:['旧']}]},item,d),/市场/);
  assert(structuralConflicts('奥02各20',parse('旧02各20').bets).some(i=>i.code==='EXPLICIT_MARKET_LOST'));
  d.assistance={...assistanceFor(d,[{line:2,source:'奥02各20',status:'accepted',replacement:'旧02各20',candidates:[]}]),version:'semantic-20261008-1'};
  const p=parseDocument(d.text,d);assert.equal(p.bets[1].markets.join(),'新');assert.deepEqual(p.issues,[]);
  const odds=defaultOdds();odds.confirmed=true;
  const common={date:d.businessDate,issue:'2026281'};
  const s=settleDocuments([p],{新:{...common,market:'新',numbers:[1,3,4,5,6,7,2]},旧:{...common,market:'旧',numbers:[1,2,3,4,5,6,49]}},{新:odds,旧:odds},d.businessDate);
  assert.equal(s.complete,true);assert.equal(s.stakeCents,3000);assert.equal(s.payoutCents,94000);
});
