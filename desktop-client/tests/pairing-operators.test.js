import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ruleForDate} from '../src/core/rules.js';
import {defaultOdds,settleBet,settleDocuments} from '../src/core/settlement.js';
import {reviewInput,validateCandidate,reviewPayload,assistanceFor} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const zodiacSource='副号: 马串虎狗羊 二中二各50',tailSource='副号: 新澳，二连4串5尾各10元';
const date='2026-10-21';
const zodiacGroups=[1,13,25,37,49].flatMap(a=>[5,17,29,41,9,21,33,45,12,24,36,48].map(b=>[a,b]));
const tailGroups=[5,15,25,35,45].map(n=>[4,n]);
const tailPoolSource='副号: 3尾串5尾各10';
const tailPoolGroups=[3,13,23,33,43].flatMap(a=>[5,15,25,35,45].map(b=>[a,b]));
const doc=(text,businessDate=date)=>({id:'pairing-operators',name:'负责人',text,businessDate});
const parse=(text,businessDate=date)=>parseDocument(text,doc(text,businessDate));
const valid=(text,businessDate)=>{const p=parse(text,businessDate);assert.deepEqual(p.issues,[],text);return p;};

test('马串虎狗羊为60组二中二各50共3000，原文副号署名及全部配对保留',()=>{
  const p=valid(zodiacSource),b=p.bets[0];assert.equal(p.bets.length,1);
  assert.deepEqual([b.play,b.playType,b.basis,b.mode,b.count,b.unitCents,b.totalCents],['二中二','linked-number-2-2','每组','groups',60,5000,300000]);
  assert.deepEqual(b.groups,zodiacGroups);assert.equal(b.player,'副号');assert.equal(b.raw,zodiacSource);assert.deepEqual(b.markets,['新']);
  assert.equal(b.semantic.ruleId,'R53');assert.deepEqual(b.warnings,[]);assert.equal(summarize([p]).totalCents,300000);assert.deepEqual(reviewInput(doc(zodiacSource)).items,[]);
});

test('二连4串5尾为固定04拖五个尾数号码，每组10共50，不新增尾数内部配对',()=>{
  const b=valid(tailSource).bets[0];assert.deepEqual(b.groups,tailGroups);assert.equal(b.count,5);assert.equal(b.unitCents,1000);assert.equal(b.totalCents,5000);
  assert.equal(b.play,'二中二');assert.equal(b.playType,'linked-number-2-2');assert.equal(b.player,'副号');assert.deepEqual(b.markets,['新']);assert.equal(b.semantic.ruleId,'R54');
  assert.deepEqual(reviewInput(doc(tailSource)).items,[]);assert.equal(b.raw,tailSource);
});

test('串拖对打同义，前后置玩法、括号、全角、中文金额和单价续行保留含义',()=>{
  for(const operator of ['串','拖','对打']){
    for(const text of [`二中二马${operator}（虎、狗、羊）每组五十米`,`马${operator}虎狗羊：二中二各50`,`二中二\n马${operator}虎狗羊\n各50`]){
      const b=valid(text).bets[0];assert.deepEqual(b.groups,zodiacGroups,text);assert.equal(b.totalCents,300000);assert.equal(senderHeader(text.split('\n')[0]),null);
    }
    for(const text of [`新澳二连４${operator}５尾各十元`,`4号${operator}5尾二中二每组10`,`二中二\n4${operator}5尾\n各10`])assert.deepEqual(valid(text).bets[0].groups,tailGroups,text);
    assert.deepEqual(valid(`二中二05-15${operator}19-39各5`).bets[0].groups,[[5,19],[5,39],[15,19],[15,39]]);
    assert.equal(valid(`特串45${operator}鸡各10`).bets[0].playType,'special-pair');
  }
  for(const text of [zodiacSource,tailSource,'二中二马对打虎狗羊各50']){
    const tokens=highlightText(text);assert.equal(tokens.map(t=>t.text).join(''),text);assert(tokens.some(t=>t.kind==='play'&&/串|对打/.test(t.text)));
  }
  assert.equal(valid('特串龙狗各10').bets[0].count,16);assert.equal(valid('特 串 龙狗各10').bets[0].playType,'special-pair');
  // Previously unsupported single-zodiac drags now have an explicit rule.
  for(const [text,count,total] of [['二中二兔拖龙各48',16,76800],['二中二马拖（兔羊猪）各20',60,120000],['二中二猴拖鸡每组5',16,8000]]){
    const b=valid(text).bets[0];assert.equal(b.count,count);assert.equal(b.totalCents,total);assert.equal(b.semantic.ruleId,'R53');
  }
});

test('生肖号码按农历年展开，0尾只有四号，自身号码配对排除',()=>{
  for(const businessDate of ['2026-02-16','2026-02-17','2027-02-05','2027-02-06']){
    const b=valid(zodiacSource,businessDate).bets[0],z=ruleForDate(businessDate).zodiac;
    const expected=z.马.flatMap(a=>[...z.虎,...z.狗,...z.羊].map(n=>[a,n]));assert.deepEqual(b.groups,expected);assert.equal(b.totalCents,expected.length*5000);
  }
  assert.deepEqual(valid('二中二4串0尾各10').bets[0].groups,[10,20,30,40].map(n=>[4,n]));
  const same=valid('二中二5串5尾各10').bets[0];assert.deepEqual(same.groups,[15,25,35,45].map(n=>[5,n]));assert.deepEqual(same.drag.excluded,[5]);assert.equal(same.totalCents,4000);
});

test('市场及玩家继承不传播选号，空行和玩家边界不能借用旧玩法',()=>{
  const p=valid('副号：香港二中二\n马串虎狗羊各50\n01 02各5\n张三：新澳二连4对打5尾各10\n\n香港33 34各5');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets,b.totalCents]),[['副号',['港'],300000],['副号',['港'],500],['张三',['新'],5000],['张三',['港'],1000]]);
  assert.equal(p.bets[1].drag,undefined);assert.equal(p.bets[3].playType,'special-number');
  for(const text of ['二中二\n\n马串虎狗羊各50','小明：二中二\n张三：4串5尾各10'])assert.equal(valid(text).bets[0].playType,'linked-number-2-2',text);
});

test('缺玩法缺金额、重复生肖、非法尾数、多个连接词与计费冲突不静默算成复式',()=>{
  for(const text of [
    '二中二马串虎狗羊','二中二马串马狗各50','二中二马串虎虎各50','二中二马羊串虎狗各50',
    '二中二马串（虎狗各50','二中二马串虎串狗各50','二中二马串虎20各50','二中二复式马串虎狗各50',
    '二中二马串虎狗每肖50','二中二4串5尾每尾10','二中二4串5尾每号10','二中二0串5尾各10','二中二50串5尾各10',
    '二中二4串15尾各10','二中二4串5尾','二中二4串5尾每组-10','二中二4串5串6尾各10','二中二4 6串5尾各10',
    '三中三4串5尾各10','特串马串虎狗羊各50',
  ]){const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);}
});

test('仅跨侧两个正码中奖，特码及同侧组合不赔，账单独立赔率与退水沿用二中二',()=>{
  const b=valid(zodiacSource).bets[0],odds=defaultOdds();odds.rates['linked-number-2-2'].rate='60';
  const draw=numbers=>({market:'新',date,issue:'2026294',numbers});
  const r=settleBet(b,draw([1,13,5,9,12,2,25]),odds);assert.equal(r.winCount,6);assert.equal(r.payoutCents,1800000);assert.equal(r.winningStakeCents,30000);
  for(const numbers of [[1,13,25,37,49,2,5],[5,9,12,17,21,24,1]])assert.equal(settleBet(b,draw(numbers),odds).winCount,0);
  const tail=valid(tailSource).bets[0];assert.equal(settleBet(tail,draw([4,5,15,25,1,2,35]),odds).winCount,3);assert.equal(settleBet(tail,draw([5,15,25,35,45,1,4]),odds).winCount,0);
  const p=valid(zodiacSource),result=settleDocuments([p],{新:draw([1,13,5,9,12,2,25])},{新:odds},date,{
    playerOdds:{负责人:{markets:{新:{rates:{'linked-number-2-2':{rate:'70'}}}}}},rebates:{负责人:{perTenThousandCents:0,playRates:{'linked-number-2-2':10000}}},
  });
  assert.equal(result.complete,true);assert.equal(result.stakeCents,300000);assert.equal(result.payoutCents,2100000);assert.equal(result.rebateCents,3000);
});

test('AI保持串号两侧与单价，串拖可等价返回，不接受普通复式或改特串',()=>{
  for(const [text,selection,playProof,amount,expected] of [[zodiacSource,'马串虎狗羊','二中二','50',zodiacGroups],[tailSource,'4串5尾','二连','10',tailGroups]]){
    const d=doc(text),item=reviewInput(d,'all').items[0],b={markets:['新'],play:'二中二',selection,basis:'每组',amount,evidence:{market:text.includes('新澳')?'新澳':'',play:playProof,selection,amount}};
    for(const s of [selection,selection.replace('串','拖'),selection.replace('串','对打')])assert.deepEqual(validateCandidate({bets:[{...b,selection:s}]},item,d).bets[0].groups,expected);
    assert.deepEqual(reviewPayload([item])[0].local[0].groups,expected);
    for(const change of [{selection:selection.replace('串',' ')},{play:'特串'},{amount:'3000'}])assert.throws(()=>validateCandidate({bets:[{...b,...change}]},item,d),/分组|选号|玩法|金额|候选/);
  }
});

test('旧核验与错误解释失效，当前按新规则重算，历史快照和原文保留',()=>{
  for(const text of [zodiacSource,tailSource,tailPoolSource])for(const status of ['accepted','review','failed']){
    const d=doc(text);d.parserVersion='parser-20261021-1';d.settlements=[{id:'past',payoutCents:12345}];
    d.assistance={...assistanceFor(d,[{line:1,source:text,status,replacement:status==='accepted'?'新二中二1 2 3各50':''}]),version:'semantic-20261021-1'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,text);assert.deepEqual(next.settlements,d.settlements);assert.deepEqual(p.issues,[]);
    assert.equal(summarize([p]).totalCents,text===zodiacSource?300000:text===tailSource?5000:25000);
  }
});

test('尾数串尾数无玩法默认二中二25组各10共250，0尾使用4个号码',()=>{
  const b=valid(tailPoolSource).bets[0];assert.deepEqual(b.groups,tailPoolGroups);assert.equal(b.play,'二中二');assert.equal(b.playType,'linked-number-2-2');
  assert.equal(b.count,25);assert.equal(b.unitCents,1000);assert.equal(b.totalCents,25000);assert.equal(b.player,'副号');assert.equal(b.raw,tailPoolSource);
  assert.equal(b.semantic.ruleId,'R55');assert.deepEqual(b.warnings,[]);assert.deepEqual(reviewInput(doc(tailPoolSource)).items,[]);
  for(const operator of ['串','拖','对打'])for(const text of [`旧3尾${operator}5尾每组十元`,`二中二３尾${operator}５尾各10`,`3尾${operator}5尾二中二各10`,`3尾${operator}5尾\n各10`])assert.deepEqual(valid(text).bets[0].groups,tailPoolGroups,text);
  const zero=valid('0尾串5尾各10').bets[0];assert.equal(zero.count,20);assert.equal(zero.totalCents,20000);assert.deepEqual(zero.drag.anchors,[10,20,30,40]);
  assert.equal(valid('5尾串0尾各10').bets[0].count,20);
});

test('尾数互拖沿用市场但不借旧玩法，明确冲突和同尾重复继续待处理',()=>{
  const p=valid('副号：香港平特肖马各10\n3尾对打5尾各10\n\n3尾拖5尾各10');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[['flat-zodiac',['港'],1000],['linked-number-2-2',['港'],25000],['linked-number-2-2',['新'],25000]]);
  for(const text of ['3尾串3尾各10','10尾串5尾各10','3尾串15尾各10','3尾串5尾每尾10','3尾串5尾每号10','3尾串5尾','3尾串5尾每组-10','三中三3尾串5尾各10','特串3尾串5尾各10','平特3尾串5尾各10']){
    const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('尾数互拖仅赔跨侧正码，AI不能改为同池复式或连尾',()=>{
  const b=valid(tailPoolSource).bets[0],odds=defaultOdds();odds.rates['linked-number-2-2'].rate='60';
  const settle=numbers=>settleBet(b,{market:'新',date,issue:'2026294',numbers},odds);
  assert.equal(settle([3,13,5,15,25,1,35]).winCount,6);assert.equal(settle([3,13,5,15,25,1,35]).payoutCents,360000);
  assert.equal(settle([3,13,23,33,43,1,5]).winCount,0);
  const d=doc(tailPoolSource),item=reviewInput(d,'all').items[0],proposal={markets:['新'],play:'二中二',selection:'3尾串5尾',basis:'每组',amount:'10',evidence:{market:'',play:'',selection:'3尾串5尾',amount:'10'}};
  assert.deepEqual(validateCandidate({bets:[proposal]},item,d).bets[0].groups,tailPoolGroups);
  for(const change of [{selection:'3尾5尾'},{play:'2连尾',selection:'3 5'},{amount:'250'}])assert.throws(()=>validateCandidate({bets:[{...proposal,...change}]},item,d),/分组|选号|玩法|金额|候选/);
});
