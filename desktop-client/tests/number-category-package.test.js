import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ANIMALS,WAVES,ruleForDate} from '../src/core/rules.js';
import {specialCollection} from '../src/core/special-collection.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,validateCandidate,validateReply,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const source='包猪数+绿波数各十';
const doc=(text=source,businessDate='2026-10-11')=>({id:'number-category-package',name:'测试',text,businessDate,defaultPlayer:''});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);assert.deepEqual(reviewInput(doc(text,date)).items,[],text);return p;};

test('包猪数加绿波数共用逐号10元，分别40和160元，重叠号累计且无需确认',()=>{
  const p=valid(),s=summarize([p]);assert.equal(p.bets.length,2);
  assert.deepEqual(p.bets.map(b=>b.values),[[8,20,32,44],WAVES.绿]);
  assert.deepEqual(p.bets.map(b=>[b.playType,b.basis,b.count,b.unitCents,b.totalCents,b.semantic.ruleId]),[
    ['special-number','每号',4,1000,4000,'R35'],['special-number','每号',16,1000,16000,'R35'],
  ]);
  assert(p.bets.every(b=>b.raw===source&&b.line===1&&b.endLine===1&&!b.allocation&&b.warnings.length===0));
  assert.equal(s.totalCents,20000);assert.equal(s.numbers.find(n=>n.number===32).cents,2000);assert.equal(s.numbers.find(n=>n.number===44).cents,2000);
  assert.equal(s.numbers.find(n=>n.number===8).cents,1000);assert.equal(s.numbers.find(n=>n.number===49).cents,1000);
  assert.equal(s.numbers.reduce((n,b)=>n+b.cents,0),20000);
  const collection=specialCollection([p]);assert.equal(collection.summary.totalCents,20000);assert.equal(collection.bets.length,2);
});

test('支持数号码数字、全角加号、中文金融单价、小数、单价续行和不带包的等价写法',()=>{
  for(const text of ['包 猪 数 ＋ 绿波 数 各 十 米','包猪号码+绿波号码每号10元','包猪数字＋绿波数字各１０','包猪数+绿波数各壹拾圆','新澳特：包猪数+绿波数各10','猪数+绿波数各十','包猪数+绿波数\n各10']){
    const p=valid(text);assert.equal(summarize([p]).totalCents,20000,text);assert.equal(p.bets.length,2);
    assert(p.bets.every(b=>b.raw===text&&!b.allocation));assert.equal(senderHeader(text),null);
  }
  assert.equal(valid('包猪数+绿波数\n各10').bets[0].endLine,2);
  assert.equal(summarize([valid('包猪数+绿波数各0.25')]).totalCents,500);
});

test('逐号声明中止前文玩法继承，市场与玩家继承保持，多市场分别计费',()=>{
  const text='小明：旧平特牛各20\n包猪数+绿波数各十\n猪数+绿波数各十\n两边包猪数+绿波数各十\n张三：包猪数+绿波数各十';
  const p=valid(text);assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['flat-zodiac',['旧'],2000],['special-number',['旧'],4000],['special-number',['旧'],16000],
    ['special-number',['旧'],4000],['special-number',['旧'],16000],
    ['special-number',['新','旧'],8000],['special-number',['新','旧'],32000],
    ['special-number',['新'],4000],['special-number',['新'],16000],
  ]);
  assert(p.bets.slice(1).every(b=>!b.semantic.inherited));assert.equal(p.bets.at(-1).player,'张三');
  assert.equal(summarize([p]).totalCents,102000);
  assert.equal(summarize([valid('旧平特牛各20\n猪数+绿波数各十')]).totalCents,22000);
});

test('十二生肖逐号价格随农历年展开，波色固定，本命生肖五号计费',()=>{
  for(const date of ['2026-02-16','2026-02-17','2027-02-05','2027-02-06']){
    const rule=ruleForDate(date);
    for(const animal of ANIMALS){
      const p=valid(`包${animal}数+绿波数各10`,date);
      assert.deepEqual(p.bets[0].values,rule.zodiac[animal]);assert.equal(p.bets[0].unitCents,1000);
      assert.deepEqual(p.bets[1].values,WAVES.绿);assert.equal(summarize([p]).totalCents,(rule.zodiac[animal].length+16)*1000);
    }
  }
  assert.equal(summarize([valid('包马数+绿波数各10')]).totalCents,21000);
  assert.equal(summarize([valid('包猪数+包猪数+绿波数各10')]).totalCents,24000);
});

test('明确逐号不改变裸包生肖总额、每肖包号总额及波色整项，独立价格分别计算',()=>{
  assert.equal(valid('包猪40').bets[0].unitCents,1000);assert.equal(valid('包猪10').bets[0].unitCents,250);
  assert.equal(valid('包猪数10').bets[0].unitCents,1000);assert.equal(valid('包猪数各10').bets[0].totalCents,4000);
  assert.equal(valid('绿波10').bets[0].playType,'wave');assert.equal(valid('绿波各10').bets[0].totalCents,16000);
  assert.equal(summarize([valid('特包猪兔龙各十米一肖')]).totalCents,3000);
  const independent=valid('包猪数各10+绿波数各20');assert.deepEqual(independent.bets.map(b=>b.totalCents),[4000,32000]);
  for(const text of ['包猪各10','特肖包猪数+绿波数各十','平特包猪数+绿波数各十','三中三包猪数+绿波数各十','包猪数+绿波数各肖10','包猪数+绿波数每组10','包猪数+绿波数各-10','包猪数+绿波数各1.234','包猪数+绿波数']){
    const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('重叠号码32中特码合计20元按47赔940元，单方命中赔470元',()=>{
  const p=valid(),odds={...defaultOdds(),confirmed:true};
  const settle=special=>p.bets.map(b=>settleBet(b,{market:'新',date:doc().businessDate,issue:'2026284',numbers:[1,2,3,4,7,9,special]},odds));
  const overlap=settle(32);assert.equal(overlap.reduce((sum,b)=>sum+b.winningStakeCents,0),2000);assert.equal(overlap.reduce((sum,b)=>sum+b.payoutCents,0),94000);
  for(const special of [8,49])assert.equal(settle(special).reduce((sum,b)=>sum+b.payoutCents,0),47000);
  assert.equal(settle(10).reduce((sum,b)=>sum+b.payoutCents,0),0);
});

test('AI保留两份每号10元，可共用金额证据，拒绝均分、整项波色及去重遗漏',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0];
  const bets=['猪','绿波'].map(selection=>({markets:['新'],play:'特码',selection,basis:'每号',amount:'10',evidence:{market:'',play:'数',selection,amount:'十'}}));
  assert.equal(validateCandidate({bets},item,d).totalCents,20000);
  assert.equal(validateReply({items:[{line:1,candidates:[{bets}]}]},[item],d)[0].status,'agree');
  assert.throws(()=>validateCandidate({bets:[{...bets[0],amount:'2.5'},bets[1]]},item,d),/金额/);
  assert.throws(()=>validateCandidate({bets:[bets[0],{...bets[1],play:'绿波',basis:'整项'}]},item,d),/改变|玩法|计费/);
  assert.throws(()=>validateCandidate({bets:[bets[1]]},item,d),/改变/);
});

test('旧包号错误和AI失败缓存失效，原文与高亮保留，旧账自动计入200元',()=>{
  for(const status of ['review','failed','accepted']){
    const d=doc();d.parserVersion='parser-20261011-1';
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'包猪10；绿波10':''}]),version:'semantic-20261011-1'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);
    assert.equal(next.text,source);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,20000);assert.deepEqual(currentReviewItems(next),[]);
  }
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['十']);
});
