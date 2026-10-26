import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {defaultOdds,settleBet,settleDocuments} from '../src/core/settlement.js';
import {reviewInput,reviewPayload,validateCandidate,assistanceFor,currentReviewItems,REVIEW_INSTRUCTIONS} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='3.27串7.31特串100', selection='3.27串7.31', date='2026-10-21';
const groups=[[3,7],[3,31],[27,7],[27,31]];
const doc=(text=source)=>({id:'special-pair-pools',name:'负责人',text,businessDate:date,defaultPlayer:''});
const parse=(text=source)=>parseDocument(text,doc(text));
const valid=(text=source)=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('截图两行同样跨侧配四组，二连与特串保留各自玩法和400元单笔金额',()=>{
  const text=`3.27串7.31二连一组100\n${source}`,p=valid(text);
  assert.deepEqual(p.bets.map(b=>[b.playType,b.count,b.unitCents,b.totalCents]),[
    ['linked-number-2-2',4,10000,40000],['special-pair',4,10000,40000],
  ]);
  for(const b of p.bets)assert.deepEqual(b.groups,groups);
  const b=p.bets[1];
  assert.deepEqual([b.size,b.basis,b.mode,b.semantic.ruleId],[2,'每组','groups','R59']);
  assert.deepEqual(b.drag,{ruleId:'R59',anchors:[3,27],numbers:[7,31],excluded:[]});
  assert.deepEqual([b.line,b.endLine,b.raw],[2,2,source]);assert.deepEqual(b.warnings,[]);
  assert.equal(summarize([p]).totalCents,80000);assert.deepEqual(reviewInput(doc(text)).items,[]);
});

test('特串数字互拖支持前后置玩法、特碰别名、串拖对打、括号和中文单价',()=>{
  for(const text of [source,'3.27拖7.31特串100','3.27对打7.31特串100',
    '特串3.27拖7.31各100','特碰3.27拖7.31每组100元','3.27串7.31特碰一百',
    '特串（03、27）拖（07、31）一组一百米','特串【3 27】拖【7 31】各注100',
    '３．２７串７．３１特串１００','3号 27号拖7号 31号特串各100',
    '3/27拖7/31特串：100','3.27串7.31特串一百元，',
  ]){const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,40000,text);assert.deepEqual(reviewInput(doc(text)).items,[]);}
  const b=valid('特串05-15拖19各5').bets[0];assert.deepEqual(b.groups,[[5,19],[15,19]]);assert.equal(b.totalCents,1000);
});

test('后置特串提供明确金额边界，支持小数并拒绝负数及超过分的精度',()=>{
  for(const text of ['3.27串7.31特串100.50','3.27串7.31特串：100.50元','3.27串7.31特串0.25']){
    const b=valid(text).bets[0];assert.deepEqual(b.groups,groups);assert.equal(b.unitCents,text.endsWith('0.25')?25:10050);
  }
  for(const text of ['3.27串7.31特串-100','3.27串7.31特串10.123元','特串3.27拖7.31每组-100']){
    const p=parse(text);assert(p.issues.some(i=>i.code==='INVALID_AMOUNT'),JSON.stringify(p.issues));assert.equal(p.bets.length,0);
  }
});

test('金额续行和相邻独立投注保留原文及金额高亮',()=>{
  const text='3.27串7.31特串\n各一百',b=valid(text).bets[0];
  assert.deepEqual(b.groups,groups);assert.equal(b.totalCents,40000);assert.deepEqual([b.line,b.endLine,b.raw],[1,2,text]);
  const p=valid(`${source}元，特串05拖19各5`);assert.deepEqual(p.bets.map(b=>b.totalCents),[40000,500]);
  const tokens=highlightText(source),of=kind=>tokens.filter(t=>t.kind===kind).map(t=>t.text);
  assert.equal(tokens.map(t=>t.text).join(''),source);assert.deepEqual(of('play'),['串','特串']);
  assert.deepEqual(of('selection'),['3','27','7','31']);assert.deepEqual(of('amount'),['100']);
});

test('特串标题可继承，多市场分别计费，空行或玩家变更后串拖默认二中二',()=>{
  const text='小明：旧特串\n3.27串7.31各100\n01 02各5\n三边3.27串7.31特串100\n张三：3.27串7.31各100';
  const p=valid(text);
  assert.deepEqual(p.bets.map(b=>[b.player,b.playType,b.markets,b.totalCents]),[
    ['小明','special-pair',['旧'],40000],['小明','special-number',['旧'],1000],
    ['小明','special-pair',['新','旧','港'],120000],['张三','linked-number-2-2',['新'],40000],
  ]);
  assert.equal(p.bets[0].semantic.declaration.line,1);assert.equal(p.bets[1].drag,undefined);
  for(const text of ['特串\n\n3.27串7.31各100','香港特串\n新澳3.27串7.31各100']){
    assert.equal(valid(text).bets[0].playType,'linked-number-2-2');
  }
});

test('互拖只排除自身配对，重复组、非法号码、缺价与计费冲突不擅自计账',()=>{
  const b=valid('特串03-27拖03-31各100').bets[0];
  assert.deepEqual(b.groups,[[3,31],[27,3],[27,31]]);assert.deepEqual(b.drag.excluded,[3]);assert.equal(b.totalCents,30000);
  for(const [text,code] of [
    ['特串3.27拖7.31','MISSING_AMOUNT'],['3.27拖7.31特串','MISSING_AMOUNT'],
    ['特串03拖03各5','INSUFFICIENT_SELECTION'],['特串03-03拖07各5','DAN_TUO'],
    ['特串03拖07-07各5','DAN_TUO'],['特串03-27拖03-27各5','DAN_TUO'],
    ['特串00-27拖07各5','NUMBER_RANGE'],['特串03拖50各5','NUMBER_RANGE'],['特串0327拖07各5','NUMBER_RANGE'],
    ['特串(03-27拖07各5','DAN_TUO'],['特串03拖07拖31各5','DAN_TUO'],['特串03拖各5','DAN_TUO'],
    ['特串复式03-27拖07各5','DAN_TUO'],['特串03胆拖07各5','DAN_TUO'],
    ['特串03-27拖07每号5','BASIS_CONFLICT'],['特串03-27拖07每尾5','BASIS_CONFLICT'],
    ['特串03-27拖07每肖5','BASIS_CONFLICT'],['二中二特串03-27拖07各5','DAN_TUO'],
  ]){const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);}
});

test('特串只赔跨侧一正一特，方向互换有效；二中二仅赔两个正码',()=>{
  const b=valid().bets[0],linked=valid('3.27串7.31二连一组100').bets[0],odds=defaultOdds();
  odds.rates['special-pair'].rate='150';odds.rates['linked-number-2-2'].rate='60';
  const settle=(bet,numbers)=>settleBet(bet,{market:'新',date,issue:'2026294',numbers},odds);
  const won=settle(b,[7,31,1,2,4,5,3]);
  assert.equal(won.winCount,2);assert.equal(won.winningStakeCents,20000);assert.equal(won.payoutCents,3000000);
  const reversed=settle(b,[3,27,1,2,4,5,7]);assert.equal(reversed.winCount,2);assert.equal(reversed.payoutCents,3000000);
  for(const numbers of [[3,7,27,31,1,2,49],[3,1,2,4,5,6,27],[7,1,2,4,5,6,31]])assert.equal(settle(b,numbers).winCount,0);
  assert.equal(settle(linked,[7,31,1,2,4,5,3]).winCount,0);
  assert.equal(settle(linked,[3,7,27,31,1,2,49]).winCount,4);
});

test('玩家独立特串赔率和退水使用400元实际流水，不套二中二',()=>{
  const p=valid(),odds=defaultOdds(),draw={market:'新',date,issue:'2026294',numbers:[7,31,1,2,4,5,3]};
  const result=settleDocuments([p],{新:draw},{新:odds},date,{
    playerOdds:{负责人:{name:'负责人',markets:{新:{rates:{'special-pair':{rate:'120'}}}}}},
    rebates:{负责人:{name:'负责人',perTenThousandCents:0,playRates:{'special-pair':100000,'linked-number-2-2':0}}},
  });
  assert.equal(result.complete,true);assert.equal(result.stakeCents,40000);assert.equal(result.payoutCents,2400000);assert.equal(result.rebateCents,4000);
});

test('AI保留原特串四组及单价，拒绝普通复式、二中二或改变金额',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'特串',selection,basis:'每组',amount:'100',evidence:{market:'',play:'特串',selection,amount:'100'}};
  assert.deepEqual(validateCandidate({bets:[b]},item,d).bets[0].groups,groups);
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);assert.match(REVIEW_INSTRUCTIONS,/R59/);
  for(const change of [{selection:'3 27 7 31'},{selection:'(3 7)(27 31)'},{play:'二中二'},{amount:'400'}]){
    assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/选号|分组|玩法|计费|金额|候选/);
  }
});

test('旧待处理或错误AI解释升级失效，保持原文及历史结算',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261021-4';d.settlements=[{id:'past',payoutCents:12345}];
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'二中二03 27 07 31各100':''}]),version:'semantic-20261021-4'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.equal(next.text,source);assert.deepEqual(next.settlements,d.settlements);assert.deepEqual(p.issues,[]);
    assert.deepEqual(p.bets[0].groups,groups);assert.equal(p.bets[0].playType,'special-pair');assert.equal(summarize([p]).totalCents,40000);
    assert.deepEqual(currentReviewItems(next),[]);
  }
});
