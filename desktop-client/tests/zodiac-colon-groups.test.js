import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,reviewPayload,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='马猴虎狗:猴鼠羊狗:四连肖各200米',selection='马猴虎狗:猴鼠羊狗';
const groups=[['马','猴','虎','狗'],['猴','鼠','羊','狗']];
const doc=(text=source)=>({id:'colon-groups',name:'负责人',text,businessDate:'2026-10-21',defaultPlayer:''});
const parse=(text=source)=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('后置四连肖的冒号保留两组各200共400，不转为六选四15组',()=>{
  const p=valid(source),b=p.bets[0];assert.equal(p.bets.length,1);assert.equal(senderHeader(source),null);
  assert.deepEqual(b.groups,groups);assert.deepEqual([b.playType,b.size,b.mode,b.basis,b.count,b.unitCents,b.totalCents],['linked-zodiac',4,'groups','每组',2,20000,40000]);
  assert.equal(b.semantic.ruleId,'R32');assert.deepEqual(b.warnings,[]);assert.equal(b.raw,source);assert.equal(summarize([p]).totalCents,40000);
  assert.equal(b.playerId,'document:colon-groups:player');assert.deepEqual(reviewInput(doc()).items,[]);
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['200']);
});

test('全半角冒号、前置玩法、混合分隔符、括号与中文单价含义一致',()=>{
  for(const text of [
    source.replaceAll(':','：'),source.replaceAll(':','::'),source.replace('200','２００'),
    '四连肖：马猴虎狗：猴鼠羊狗：各二百米','4连肖马 猴 虎 狗:猴 鼠 羊 狗每组200',
    '四连肖(马猴虎狗):(猴鼠羊狗)各200','四连肖马猴虎狗:／猴鼠羊狗各200',
    '马猴虎狗:猴鼠羊狗:四连肖\n各200米',
  ]){const b=valid(text).bets[0];assert.deepEqual(b.groups,groups,text);assert.equal(b.totalCents,40000,text);assert.deepEqual(b.warnings,[],text);}
  assert.deepEqual(valid('三连肖牛羊猪:羊猪兔各30').bets[0].groups,[['牛','羊','猪'],['羊','猪','兔']]);
  assert.equal(valid('二连肖牛羊:羊猪:羊兔:牛兔各30').bets[0].count,4);
});

test('玩家姓名和市场标题仍可识别，继承及单价续行不改原文行号',()=>{
  const text='小明：旧四连肖\n马猴虎狗:猴鼠羊狗:\n各200米\n张三：香港'+source+'\n香港33 34各5';
  const p=valid(text);
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets,b.totalCents]),[['小明',['旧'],40000],['张三',['港'],40000],['张三',['港'],1000]]);
  assert.deepEqual(p.bets[0].groups,groups);assert.deepEqual([p.bets[0].line,p.bets[0].endLine],[2,3]);
  assert.equal(p.bets[0].raw,'马猴虎狗:猴鼠羊狗:\n各200米');assert.equal(p.bets[2].playType,'special-number');
  assert.deepEqual(senderHeader('小明：四连肖：马猴虎狗：猴鼠羊狗各200'),{name:'小明',body:'四连肖：马猴虎狗：猴鼠羊狗各200'});
  assert.equal(senderHeader('四连肖：马猴虎狗：猴鼠羊狗各200'),null);
  assert.equal(senderHeader('马猴虎狗：四连肖猴鼠羊狗各200','马猴虎狗').name,'马猴虎狗');
});

test('组内缺项、多项和重复仍待处理；重复整组累计，普通复式和其他玩法保持原义',()=>{
  for(const text of ['四连肖马猴虎狗:猴鼠羊各200','四连肖马猴虎狗:猴鼠羊狗牛各200','四连肖马猴虎狗:猴鼠羊羊各200']){
    const p=parse(text);assert(p.issues.some(i=>i.code==='GROUP_SIZE'),text);assert.equal(summarize([p]).totalCents,0,text);
  }
  const repeat=valid('四连肖马猴虎狗:马猴虎狗各200').bets[0];assert.equal(repeat.count,2);assert.deepEqual(repeat.groups,[groups[0],groups[0]]);
  for(const text of ['四连肖马猴虎狗鼠羊各200','四连肖马:猴:虎:狗:鼠:羊各200']){const b=valid(text).bets[0];assert.equal(b.count,15);assert.equal(b.groups,null);}
  for(const [text,type,count] of [['特肖马猴:鼠羊各200','special-zodiac',4],['平特肖马猴:鼠羊各200','flat-zodiac',4],['特码01:02各5','special-number',2]]){
    const b=valid(text).bets[0];assert.equal(b.playType,type);assert.equal(b.count,count);assert.equal(b.groups,null);
  }
});

test('只赔原文列出的两组，马年档和普通档分开，不能赔未投注的交叉组合',()=>{
  const b=valid(source).bets[0],odds=defaultOdds();
  const settle=numbers=>settleBet(b,{market:'新',date:doc().businessDate,issue:'2026294',numbers},odds);
  const first=settle([1,11,5,9,2,3,4]);assert.equal(first.winCount,1);assert.equal(first.payoutCents,560000);
  const second=settle([11,7,12,9,2,3,4]);assert.equal(second.winCount,1);assert.equal(second.payoutCents,600000);
  const both=settle([1,11,5,9,7,12,4]);assert.equal(both.winCount,2);assert.equal(both.winningStakeCents,40000);assert.equal(both.payoutCents,1160000);
  const notListed=settle([1,11,7,12,2,3,4]);assert.equal(notListed.winCount,0);assert.equal(notListed.payoutCents,0);
});

test('AI候选保留冒号或等价括号分组，不接受合并池或漏掉一组',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'4连肖',selection,basis:'每组',amount:'200',evidence:{market:'',play:'四连肖',selection,amount:'200'}};
  for(const s of [selection,'(马猴虎狗)(猴鼠羊狗)']){
    const candidate=validateCandidate({bets:[{...b,selection:s}]},item,d);assert.deepEqual(candidate.bets[0].groups,groups);assert.equal(candidate.totalCents,40000);
  }
  assert.deepEqual(reviewPayload([item])[0].local[0].groups,groups);
  for(const s of ['马猴虎狗鼠羊','(马猴虎狗)(马鼠羊狗)','马猴虎狗'])assert.throws(()=>validateCandidate({bets:[{...b,selection:s}]},item,d),/分组|选号/);
  for(const change of [{selection:'马猴虎狗:小明:猴鼠羊狗'},{selection:'马猴虎狗:\n猴鼠羊狗'},{play:'特肖',basis:'每肖'}])assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/候选选号或金额格式/);
});

test('旧错误复式与待核验缓存失效，原文和历史赔付快照保留',()=>{
  for(const status of ['accepted','review','failed']){
    const d=doc();d.parserVersion='parser-20261020-2';d.settlements=[{id:'old',stakeCents:300000,payoutCents:0}];
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'四连肖马猴虎狗鼠羊各200':''}]),version:'semantic-20261020-2'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,source);assert.deepEqual(next.settlements,d.settlements);
    assert.deepEqual(p.issues,[]);assert.deepEqual(p.bets[0].groups,groups);assert.equal(summarize([p]).totalCents,40000);
  }
});
