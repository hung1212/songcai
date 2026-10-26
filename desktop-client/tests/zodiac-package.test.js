import {upgradeDocument} from '../src/core/parser-upgrade.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ANIMALS,ruleForDate} from '../src/core/rules.js';
import {reviewInput,validateCandidate,validateReply,assistanceFor} from '../src/core/ai-review.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {specialCollection} from '../src/core/special-collection.js';

const doc=(text,date='2026-10-08')=>({id:'zodiac-package',name:'测试',text,businessDate:date,defaultPlayer:''});
const parse=(text,date)=>parseDocument(text,doc(text,date));
const valid=(text,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);return p;};

test('包龙40包蛇160按原总额分配，每号10和40，号码分布与特码集合守恒',()=>{
  for(const source of ['包龙 40\n包蛇 160','包龙40，包蛇160']){
    const p=valid(source),s=summarize([p]);
    assert.deepEqual(p.bets.map(b=>[b.playType,b.values,b.count,b.unitCents,b.totalCents,b.semantic.ruleId]),[
      ['special-number',[3,15,27,39],4,1000,4000,'R25'],
      ['special-number',[2,14,26,38],4,4000,16000,'R25'],
    ]);
    assert.deepEqual(p.bets.map(b=>b.allocation),[
      {method:'equal-total',source:'包龙',totalCents:4000,count:4},
      {method:'equal-total',source:'包蛇',totalCents:16000,count:4},
    ]);
    assert.equal(s.totalCents,20000);assert.equal(s.numbers.reduce((n,b)=>n+b.cents,0),20000);
    assert.equal(s.numbers.find(n=>n.number===3).cents,1000);assert.equal(s.numbers.find(n=>n.number===2).cents,4000);
    assert.equal(specialCollection([p]).summary.totalCents,20000);
    assert.deepEqual(reviewInput(doc(source)).items,[]);
  }
});

test('十二生肖均用实际号码均分；春节当天切换，本命生肖五号而非固定四号',()=>{
  for(const date of ['2026-01-01','2026-02-16','2026-02-17','2027-02-05','2027-02-06']){
    const rule=ruleForDate(date);
    for(const animal of ANIMALS){
      const b=valid(`包${animal}100`,date).bets[0];
      assert.deepEqual(b.values,rule.zodiac[animal]);
      assert.equal(b.totalCents,10000);assert.equal(b.unitCents,10000/b.count);
    }
  }
  assert.equal(valid('包蛇160','2026-02-16').bets[0].unitCents,3200);
  assert.equal(valid('包蛇160','2026-02-17').bets[0].unitCents,4000);
  assert.equal(valid('包马40','2026-02-17').bets[0].unitCents,800);
  assert.equal(valid('包羊40','2027-02-06').bets[0].unitCents,800);
});

test('生肖包号支持冒号中文金额和跨行总额，市场继承，包号分配不沿用到裸生肖',()=>{
  for(const source of ['包龙：40','包 龙 四十米','包龙４０元','特码包龙40','包龙\n40'])assert.equal(valid(source).bets[0].unitCents,1000);
  assert.equal(senderHeader('包龙：40'),null);
  const p=valid('小明：旧三中三01 02 03各10\n包龙40\n蛇50\n两边包蛇160\n张三：包龙40');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['linked-number-3-3',['旧'],1000],['special-number',['旧'],4000],['special-zodiac',['旧'],5000],
    ['special-number',['新','旧'],32000],['special-number',['新'],4000],
  ]);
  assert.equal(p.bets[2].allocation,undefined);
  assert.equal(valid('香菜\n包龙40\n包蛇160').bets[1].markets.join(),'港');
});

test('总额需精确到分，不丢失选号、金额或其他明确玩法；普通特肖与每号旧规则保留',()=>{
  for(const [source,code] of [['包龙40.01','PACKAGE_SPLIT_PRECISION'],['包龙各40','BASIS_CONFLICT'],['包蛇每组160','BASIS_CONFLICT'],['特肖包龙40','BASIS_CONFLICT'],['平特包龙40','BASIS_CONFLICT'],['三中三包蛇160','BASIS_CONFLICT'],['包龙蛇40','PACKAGE_SELECTION'],['包龙01 40','PACKAGE_SELECTION'],['包龙01/03 40','PACKAGE_SELECTION'],['包龙','MISSING_AMOUNT']]){
    const p=parse(source);assert(p.issues.some(i=>i.code===code),`${source}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);
  }
  assert.equal(valid('包龙40.04').bets[0].unitCents,1001);
  for(const [source,type,total] of [['龙40','special-zodiac',4000],['龙各40','special-number',16000],['龙数40','special-number',16000],['特肖包40钱牛','special-zodiac',4000]]){
    const b=valid(source).bets[0];assert.equal(b.playType,type);assert.equal(b.totalCents,total);assert.equal(b.allocation,undefined);
  }
});

test('AI只返回包生肖原总额，不把40替换成每号40或造出10，使用本地号码表均分',()=>{
  const d=doc('香菜\n包龙40'),item=reviewInput(d,'all').items.find(i=>i.line===2);
  const b={markets:['港'],play:'包龙',selection:'龙',basis:'每号',amount:'40',evidence:{market:'',play:'包龙',selection:'龙',amount:'40'}};
  const candidate={bets:[b]},result=validateCandidate(candidate,item,d);
  assert.equal(result.totalCents,4000);assert.equal(result.bets[0].unitCents,1000);
  assert.equal(validateReply({items:[{line:2,candidates:[candidate]}]},[item],d)[0].status,'agree');
  assert.throws(()=>validateCandidate({bets:[{...b,play:'特码'}]},item,d),/改变|计费/);
  assert.throws(()=>validateCandidate({bets:[{...b,amount:'10'}]},item,d),/金额/);
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'蛇'}]},item,d),/包号/);
});

test('赔付使用均分后的中奖号码金额乘特码赔率，不使用生肖赔率或包号总额',()=>{
  const odds=defaultOdds();odds.confirmed=true;
  const draw={market:'新',date:'2026-10-08',issue:'2026281',numbers:[1,2,4,5,6,7,3]};
  const [dragon,snake]=valid('包龙40\n包蛇160').bets;
  assert.equal(settleBet(dragon,draw,odds).payoutCents,47000);
  assert.equal(settleBet(snake,draw,odds).payoutCents,0);
  assert.equal(settleBet(snake,{...draw,numbers:[1,3,4,5,6,7,2]},odds).payoutCents,188000);
});

test('金额在包生肖前后等价，保留原文、单价、总额和农历生肖表',()=>{
 for(const date of ['2026-10-09','2027-02-06'])for(const [front,normal] of [['40元包羊','包羊40'],['40包羊','包羊40'],['四十米包羊','包羊40'],['４０元 包 羊','包羊40'],['40.04元包羊','包羊40.04'],['40元：包羊','包羊40'],['特码40元包羊','包羊40'],['40元\t包\t羊','包羊40']]){
   if(date==='2027-02-06'&&front.includes('40.04'))continue;
   const b=valid(front,date).bets[0],expected=valid(normal,date).bets[0];
   assert.deepEqual([b.playType,b.values,b.unitCents,b.totalCents,b.allocation],[expected.playType,expected.values,expected.unitCents,expected.totalCents,expected.allocation]);assert.equal(b.raw,front);assert.equal(b.line,1);assert.deepEqual(reviewInput(doc(front,date)).items,[]);
 }
 assert.equal(valid('40元包马').bets[0].unitCents,800);
 assert.equal(valid('1100元包单数').bets[0].unitCents,4400);
 assert.equal(valid('240元包双数').bets[0].unitCents,1000);
});

test('正反包号相邻及多市场继承不互相拿金额，截图全单820元且无待处理',()=>{
 for(const source of ['40元包羊\n包蛇60元','40元包羊，包蛇60元','40元包羊60元包蛇','包蛇60元包羊40元','11各10元，40元包羊，包蛇60元']){
  const p=valid(source);assert.equal(summarize([p]).totalCents,source.startsWith('11')?11000:10000);assert.equal(p.bets.find(b=>b.allocation?.source==='包羊').unitCents,1000);assert.equal(p.bets.find(b=>b.allocation?.source==='包蛇').unitCents,1500);
 }
 const source='新澳。\n鼠，羊，各10。\n猴，各15。\n兔，鸡，猪，各25。\n蛇，狗，各35。\n\n40元包羊\n包蛇60元',p=valid(source);
 assert.equal(summarize([p]).totalCents,82000);assert.equal(specialCollection([p]).summary.totalCents,82000);assert.deepEqual(p.bets.slice(-2).map(b=>[b.line,b.endLine,b.totalCents]),[[7,7,4000],[8,8,6000]]);
 const multi=valid('小明：旧40元包羊\n包蛇60元\n张三：两边40元包羊');assert.deepEqual(multi.bets.map(b=>[b.markets,b.totalCents]),[[['旧'],4000],[['旧'],6000],[['新','旧'],8000]]);
});

test('反写包号不丢掉额外选号或真实金额冲突',()=>{
 for(const text of ['40元包羊蛇','40元包羊01 10','40元包羊各10','各40元包羊','特肖40元包羊','平特40元包羊','三中三40元包羊','40.01元包羊','40.001元包羊','-40元包羊','包羊']){
  const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
 }
});

test('金额前置的包号AI只可保留总额，本地按每号单价赔付',()=>{
 const d=doc('40元包羊'),item=reviewInput(d,'all').items[0];
 const bet={markets:['新'],play:'包羊',selection:'羊',basis:'每号',amount:'40',evidence:{market:'',play:'包羊',selection:'羊',amount:'40'}};
 const result=validateCandidate({bets:[bet]},item,d);assert.equal(result.totalCents,4000);assert.equal(validateReply({items:[{line:1,candidates:[{bets:[bet]}]}]},[item],d)[0].status,'agree');
 assert.throws(()=>validateCandidate({bets:[{...bet,play:'特码'}]},item,d),/改变|计费/);
 const odds=defaultOdds();odds.confirmed=true;assert.equal(settleBet(valid(d.text,d.businessDate).bets[0],{market:'新',date:d.businessDate,issue:'2026281',numbers:[1,2,3,4,5,6,12]},odds).payoutCents,47000);
});

test('旧AI待处理随规则版本升级失效，重开旧账直接采用包号解释且原文不变',()=>{
 const d=doc('40元包羊\n包蛇60元');d.parserVersion='parser-20261009-1';
 d.assistance={...assistanceFor(d,[{line:1,source:'40元包羊',status:'review',required:true,replacement:'',candidates:[],reason:'只有金额，缺少号码或生肖'}]),version:'semantic-20261009-1'};
 const updated=upgradeDocument(d);assert.equal(updated.text,d.text);const p=parseDocument(updated.text,updated);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,10000);assert.equal(reviewInput(updated).items.length,0);
});
