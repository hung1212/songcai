import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,assistanceFor,validateCandidate} from '../src/core/ai-review.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {groupIssues,issueDetails} from '../src/core/issue-details.js';
import {ruleForDate} from '../src/core/rules.js';

const date='2026-10-20';
const doc=text=>({id:'structured',name:'副号',text,businessDate:date});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};

test('副号确定表达按原文结构、玩法和金额验收，不能只检查不报错',()=>{
  const cases=[
    ['香港特码马粒各200,\n猴虎龙粒各100,',2200,[5,12],['special-number','special-number']],
    ['香港特龙和6尾各10',90,[9],['special-number']],
    ['特串34@33@20米@@@@@',20,[1],['special-pair']],
    ['老的6@34@36@46各20米',80,[4],['special-number']],
    ['新澳，二连4串五尾各10元',50,[5],['linked-number-2-2']],
    ['新奥特龙各数200.     38.27各数450',1700,[4,2],['special-number','special-number']],
    ['虎狗兔龙猪复式三四五各连10米',160,[10,5,1],['linked-zodiac','linked-zodiac','linked-zodiac']],
    ['新澳门包，猴，狗。每个号10块',80,[8],['special-number']],
    ['平特复式五连肖羊鸡虎猴鼠龙各10元',60,[6],['linked-zodiac']],
    ['15 27 21 33一个10',40,[4],['special-number']],
  ];
  for(const [text,total,counts,types] of cases){const p=valid(text);assert.equal(summarize([p]).totalCents,total*100);assert.deepEqual(p.bets.map(b=>b.count),counts);assert.deepEqual(p.bets.map(b=>b.playType),types);assert(p.bets.every(b=>b.raw===text||text.includes(b.raw)));assert.deepEqual(reviewInput(doc(text)).items,[]);}
  const p=valid(cases[5][0]);assert.equal(summarize([p]).numbers.find(n=>n.number===27).cents,65000);
  assert.deepEqual(valid(cases[0][0]).bets.map(b=>b.markets),[['港'],['港']]);
  assert.deepEqual(valid(cases[3][0]).bets[0].markets,['旧']);
  assert.deepEqual(valid(cases[1][0]).bets[0].values,[3,15,27,39,6,16,26,36,46]);
});

test('多市场同句金额分段保留重叠选号与单价，短横装饰不构成新投注',()=>{
  const text='新澳：06/85米——03/20米——22/04各10米——港：包鸡各数10米——46/10米——',p=valid(text);
  assert.deepEqual(summarize([p]).markets,{新:12500,旧:0,港:5000});
  assert.deepEqual(p.bets.map(b=>b.unitCents),[8500,2000,1000,1000,1000]);
  assert.equal(summarize([p]).numbers.find(n=>n.number===46).cents,2000);
});

test('先绑定跨行各数20单价，47保持选号；空行和发送人不能借单价',()=>{
  const selection='新澳门特码03-13-23-33-43-07-17-27-37-47';
  for(const money of ['各数20元。','每个号码二十米']){
    const p=valid(selection+'\n'+money),b=p.bets[0];assert.deepEqual(b.values,[3,13,23,33,43,7,17,27,37,47]);assert.equal(b.totalCents,20000);assert.equal(b.unitCents,2000);assert.deepEqual([b.line,b.endLine,b.continuation.amountLine],[1,2,2]);
  }
  for(const boundary of ['\n\n','\n张三：']){const p=parse(selection+boundary+'各数20');assert(p.issues.length);assert(!p.bets.some(b=>b.line===1&&b.endLine>1));}
});

test('明确#分组和长点分隔保留组内号码，不能扩为全池复式',()=>{
  const text='香港三中三20-32-36#18-34-45各组50。三中三二中二20.32.36.18.34.45各5。合计275。';
  const p=valid(text);assert.equal(summarize([p]).totalCents,27500);assert.deepEqual(p.bets.map(b=>b.count),[2,20,15]);assert.deepEqual(p.bets[0].groups,[[20,32,36],[18,34,45]]);
  for(const [text,groups,total] of [['新二中二07.19........11..28两组各10',[[7,19],[11,28]],2000],['新二中二05.35......22.23两组各15',[[5,35],[22,23]],3000]]){const b=valid(text).bets[0];assert.deepEqual(b.groups,groups);assert.equal(b.totalCents,total);}
  assert.equal(valid('新二中二11..28组各10').bets[0].totalCents,1000);
  for(const text of ['三中三20-32#18-34-45各50','二中二07.19......11.11两组各10','二中二07.19......11.28三组各10']){const r=parse(text);assert(r.issues.length);assert.equal(summarize([r]).totalCents,0);}
});

test('确定同句合计不符拦住本行，其他行继续算；范围不明仍保留核对提醒',()=>{
  const p=parse('香港三中三20-32-36#18-34-45各50。合计275。\n新01各10');
  assert.equal(p.issues[0].code,'TOTAL_MISMATCH');assert.equal(p.issues[0].severity,'error');assert.equal(summarize([p]).totalCents,1000);
  assert.deepEqual(p.issues[0].affectedBetIds,[p.bets[0].id]);
  const broad=parse('1 2 3各10\n合计100');assert.equal(broad.issues[0].severity,'warning');assert.equal(summarize([broad]).totalCents,3000);
});

test('同句前半段也是可追溯的玩法声明，不再额外触发AI待处理',()=>{
  for(const [text,total] of [
    ['香港三中三20.32.36下25，，18.34.45下25，复式二连三连20.32.36.18.34.45各5',225],
    ['复四肖：虎牛鼠羊马蛇、各5元。鸡猴羊虎牛鼠。各5元。羊牛鼠马10元。',160],
  ]){const p=valid(text);assert.equal(summarize([p]).totalCents,total*100);assert(p.bets.filter(b=>b.semantic.inherited).every(b=>b.semantic.declaration.line===1));assert.deepEqual(reviewInput(doc(text)).items,[]);}
});

test('四中肖固定为四连肖，别称与中文数字按同一组选规则',()=>{
  const b=valid('四中肖马羊猴猪狗鼠各50').bets[0];assert.equal(b.playType,'linked-zodiac');assert.equal(b.size,4);assert.equal(b.count,15);assert.equal(b.totalCents,75000);
  assert.equal(valid('三中肖猴鼠猪狗马各50').bets[0].totalCents,50000);
  assert(parse('四中肖马羊猴各50').issues.length);assert(parse('四中肖马羊猴猪各号50').issues.length);
  assert(parse('四中肖马羊猴猪狗鼠各50\n五中各30').issues.some(i=>i.line===2));
});

test('省略玩法串拖默认二中二，多个明确操作共享每组金额',()=>{
  for(const [text,count,total] of [['鼠串狗各数5',16,80],['羊串兔、兔串蛇、羊串蛇每个数5元',48,240],['马串羊狗各10',40,400],['马串虎狗羊各50',60,3000],['49打猴各5米',4,20],['05-15拖19各5',2,10],['11.33拖5尾组10',10,100],['兔蛇拖（牛羊）各10',64,640],['30拖鼠各10',4,40],['45拖鸡各10',4,40],['猴拖鸡每组5',16,80],['5尾拖鸡各10',20,200]]){
    const p=valid(text),b=p.bets[0];assert.equal(b.playType,'linked-number-2-2');assert.equal(b.count,count,text);assert.equal(b.totalCents,total*100,text);assert.equal(b.mode,'groups');assert.deepEqual(reviewInput(doc(text)).items,[]);
  }
  for(const operator of ['串','拖','打','对打'])assert.equal(valid(`鼠${operator}狗各十`).bets[0].totalCents,16000);
  assert.equal(valid('特串鼠串狗各5').bets[0].playType,'special-pair');
  assert.equal(valid('特串\n鼠串狗各5').bets[0].playType,'special-pair');
  assert.equal(valid('特串\n\n鼠串狗各5').bets[0].playType,'linked-number-2-2');
  const continued=valid('鼠串狗各数5\n01 02各10');assert.deepEqual(continued.bets[1].values,[1,2]);assert.equal(continued.bets[1].count,1);assert.equal(continued.bets[1].drag,undefined);
  assert.deepEqual(valid('01,02串03,04各10').bets[0].groups,[[1,3],[1,4],[2,3],[2,4]]);
});

test('明确三侧串拖每侧取一号是三中三，两侧号码池不因数量变三中三',()=>{
  const b=valid('01串02串03各10').bets[0];assert.equal(b.playType,'linked-number-3-3');assert.deepEqual(b.groups,[[1,2,3]]);assert.equal(b.totalCents,1000);
  assert.equal(valid('3尾串5尾串7尾各10').bets[0].count,125);
  const pair=valid('01 02串03各10').bets[0];assert.equal(pair.playType,'linked-number-2-2');assert.deepEqual(pair.groups,[[1,3],[2,3]]);
  for(const text of ['鼠串狗每肖10','鼠串鼠各10','鼠串狗狗各10','01串02串03串04各10','鼠串狗','05拖19','鼠拖（狗各10','3尾拖15尾各10','10尾拖鸡各10','特串鼠串狗各号10']){const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);}
});

test('新默认串拖按农历展号且只结算正码，特串仍需一正一特',()=>{
  for(const businessDate of ['2026-02-16','2026-02-17','2027-02-06']){const p=parseDocument('鼠串狗各数5',{businessDate}),z=ruleForDate(businessDate).zodiac;assert.deepEqual(p.bets[0].groups,z.鼠.flatMap(a=>z.狗.map(b=>[a,b])));}
  const b=valid('鼠串狗各数5').bets[0],odds=defaultOdds(),draw=numbers=>({date,market:'新',issue:'2026293',numbers});
  assert.equal(settleBet(b,draw([7,19,9,21,2,3,31]),odds).winCount,4);
  assert.equal(settleBet(b,draw([7,19,31,43,2,3,9]),odds).winCount,0);
  assert.equal(settleBet(valid('特串鼠串狗各5').bets[0],draw([7,19,31,43,2,3,9]),odds).winCount,4);
});

test('AI不能改变已确定的默认串拖玩法或分组，旧错误解释升级失效',()=>{
  const d=doc('鼠串狗各数5'),item=reviewInput(d,'all').items[0];
  const bet={markets:['新'],play:'二中二',selection:'鼠串狗',basis:'每组',amount:'5',evidence:{market:'',play:'',selection:'鼠串狗',amount:'5'}};
  assert.equal(validateCandidate({bets:[bet]},item,d).totalCents,8000);
  for(const change of [{play:'特串'},{selection:'鼠狗'},{amount:'80'}])assert.throws(()=>validateCandidate({bets:[{...bet,...change}]},item,d));
  d.assistance={...assistanceFor(d,[{line:1,source:d.text,status:'review',replacement:''}]),version:'semantic-20261021-3'};
  const p=parseDocument(d.text,d);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,8000);assert.equal(p.bets[0].raw,d.text);
});

test('相同原文提示合为一张卡，保留本地原因、AI入口、严重级别和定位ID',()=>{
  const base={fileId:'a',line:2,endLine:2,raw:'原文',playerId:'p',severity:'error'};
  const local={...base,id:'local',code:'MISSING_AMOUNT',message:'缺少金额'};
  const ai={...base,id:'ai',code:'AI_REVIEW',aiStatus:'pending',reviewReasons:['缺少金额']};
  const g=groupIssues([ai,local,{...local,id:'other-line',line:3,endLine:3},{...local,id:'other-file',fileId:'b'}]);
  assert.equal(g.length,3);assert.equal(g[0].id,'local');assert.deepEqual(g[0].memberIds,['ai','local']);assert(g[0].hasAIReview);assert.equal(g[0].members.length,2);assert.equal(issueDetails(g[0]).reason,'缺少金额');assert.equal(issueDetails(g[0]).aiStatus,'正在核验');
  assert.equal(groupIssues([{...local,severity:'warning'},ai])[0].severity,'error');
  const continued=groupIssues([{...local,endLine:3}, {...ai,line:3,endLine:3}]);assert.equal(continued.length,1);assert.deepEqual(continued[0].memberIds,['local','ai']);assert.equal(continued[0].line,2);assert.equal(continued[0].endLine,3);
  assert.equal(ai.id,'ai');
});

test('有真实争议的尾注、计费与跨空行单价保持待处理，不以少提示换静默入账',()=>{
  for(const text of ['新01各10\n02各20港','34.44.42.38.49各6O.米','包红波280米','特肖牛二中二各10','三中二19 09 23\n\n1 2 3\n\n11 12 6各5'])assert(parse(text).issues.length,text);
});
