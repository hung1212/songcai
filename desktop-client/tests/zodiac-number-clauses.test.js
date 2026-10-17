import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
import {statementEvidence} from '../src/core/business-syntax.js';
import {formatBetLines,prepareBetPaste} from '../src/core/text-format.js';
import {settleBet,defaultOdds} from '../src/core/settlement.js';

const date='2026-10-06';
const source='新澳特：龙鸡羊兔马数10，猴鼠数各5';
const formatted='新澳特：龙鸡羊兔马数10，\n猴鼠数各5';
const doc=text=>({id:'number-clauses',name:'测试',text,businessDate:date,defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};
const first=[3,15,27,39,10,22,34,46,12,24,36,48,4,16,28,40,1,13,25,37,49];
const second=[11,23,35,47,7,19,31,43];

test('用户单行和换行写法均拆成两笔特码，21号各10、8号各5共250',()=>{
  for(const text of [source,formatted]) {
    const p=valid(text),s=summarize([p]);assert.equal(p.bets.length,2);assert.deepEqual(p.bets.map(b=>b.values),[first,second]);
    assert.deepEqual(p.bets.map(b=>[b.playType,b.basis,b.unitCents,b.totalCents,b.markets.join()]),[
      ['special-number','每号',1000,21000,'新'],['special-number','每号',500,4000,'新'],
    ]);
    assert.equal(s.totalCents,25000);assert.deepEqual(s.markets,{新:25000,旧:0,港:0});
    assert.equal(reviewInput(doc(text),'doubt').items.length,0);
    for(const {number,cents} of s.numbers)assert.equal(cents,first.includes(number)?1000:second.includes(number)?500:0);
    assert.equal(s.numbers.reduce((sum,n)=>sum+n.cents,0),s.totalCents);
    if(text===source)assert(p.bets.every(b=>b.raw===source&&b.line===1&&b.endLine===1));
  }
});

test('数金额兼容号码和数字、中文金融金额、全角、小数和分隔符，逗号仍可分隔选号',()=>{
  for(const word of ['数','号码','数字']) for(const separator of ['，',',','；',';',' ']) {
    const text=`新澳特：龙鸡羊兔马${word}十${separator}猴鼠${word}五`,p=valid(text);
    assert.deepEqual(p.bets.map(b=>b.values),[first,second]);assert.equal(summarize([p]).totalCents,25000);
  }
  for(const text of ['新澳特：龙鸡羊兔马数１０，猴鼠数各５','新澳特：龙鸡羊兔马数拾，猴鼠数各伍','新澳特：龙鸡羊兔马数：10，猴鼠数各5','新澳特：龙、鸡、羊、兔、马数10，猴、鼠数各5'])assert.equal(summarize([valid(text)]).totalCents,25000,text);
  const cents=valid('新澳特：龙鸡羊兔马数0.50，猴鼠数各1.25');
  assert.deepEqual(cents.bets.map(b=>b.unitCents),[50,125]);assert.equal(summarize([cents]).totalCents,2050);
});

test('省略各的逐号金额会中止旧玩法继承，保留玩家和市场并按农历生肖展开',()=>{
  const p=valid('小明：旧特肖牛20\n龙鸡羊兔马数10，猴鼠数各5\n张三：猴鼠数5');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets.join(),b.playType,b.totalCents]),[
    ['小明','旧','special-zodiac',2000],['小明','旧','special-number',21000],['小明','旧','special-number',4000],['张三','新','special-number',4000],
  ]);
  const snake=parseDocument(source,{...doc(source),businessDate:'2026-02-16'});assert.deepEqual(snake.issues,[]);assert.equal(summarize([snake]).totalCents,24000);
});

test('粘贴或整理换行只添加换行，金额10与5高亮正确且AI证据不再把10当选号',()=>{
  assert.equal(formatBetLines(source),formatted);assert.equal(formatBetLines(formatted),formatted);
  assert.equal(formatBetLines('龙鸡数10，猴鼠数5'),'龙鸡数10，\n猴鼠数5');
  assert.equal(prepareBetPaste('',0,0,source),formatted+'\n');
  assert.equal(prepareBetPaste('',0,0,'龙鸡数10'),'龙鸡数10\n');
  assert.equal(prepareBetPaste('龙鸡数100',3,6,'20'),'20');
  const highlighted=highlightText(source);assert.equal(highlighted.map(t=>t.text).join(''),source);
  assert.deepEqual(highlighted.filter(t=>t.kind==='amount').map(t=>t.text),['10','5']);
  const evidence=statementEvidence(source),pos=source.indexOf('10');
  assert(evidence.some(t=>t.field==='amount'&&t.start===pos&&t.quote==='10'));
  assert(!evidence.some(t=>t.field==='selection'&&t.start===pos));
});

test('数金额不掩盖玩法冲突、负数、小数精度或斜杠金额歧义',()=>{
  for(const text of ['特肖龙鸡数10','三连肖龙鸡羊数10','龙鸡数-10','龙鸡数1.234','龙鸡数1/2米']) {
    const p=parse(text);assert(p.issues.some(i=>i.severity==='error'),text);assert.equal(summarize([p]).totalCents,0,text);
  }
  assert.equal(formatBetLines('三中三(1,2,3)(4,5,6)各10元'),'三中三(1,2,3)(4,5,6)各10元');
});

test('AI核验可复核两笔原始单价，不能继续合成一笔；旧核验随规则升级重新解析',()=>{
  const d=doc(source),item=reviewInput(d,'all').items[0];
  const bets=[{markets:['新'],play:'特码',selection:'龙鸡羊兔马',basis:'每号',amount:'10',evidence:{market:'新澳',play:'数',selection:'龙鸡羊兔马',amount:'10'}},
    {markets:['新'],play:'特码',selection:'猴鼠',basis:'每号',amount:'5',evidence:{market:'',play:'数',selection:'猴鼠',amount:'5'}}];
  assert.equal(validateCandidate({bets},item,d).totalCents,25000);
  assert.throws(()=>validateCandidate({bets:[{...bets[0],amount:'5',evidence:{...bets[0].evidence,amount:'5'}}]},item,d),/改变/);
  d.assistance={...assistanceFor(d,[{line:1,source,status:'accepted',replacement:'新 特码 龙鸡羊兔马10猴鼠 各号5元'}]),version:'semantic-20261006-3'};
  const p=parseDocument(d.text,d);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,25000);
});

test('包大数各五为25至49每号5元，单价不均分且包含49',()=>{
  const text='新澳特包大数各五',p=valid(text),b=p.bets[0],s=summarize([p]);
  assert.equal(p.bets.length,1);assert.equal(b.playType,'special-number');assert.equal(b.basis,'每号');
  assert.deepEqual(b.values,Array.from({length:25},(_,i)=>i+25));assert.equal(b.unitCents,500);assert.equal(b.totalCents,12500);
  assert.deepEqual(b.markets,['新']);assert.equal(b.raw,text);assert.equal(b.allocation,undefined);
  assert.deepEqual(reviewInput(doc(text),'doubt').items,[]);
  for(const {number,cents} of s.numbers)assert.equal(cents,number>=25?500:0);
  const odds=defaultOdds();odds.confirmed=true;odds.refund49.attribute=true;
  const draw={market:'新',date,issue:'2026279',numbers:[1,2,3,4,5,6,49]};
  assert.equal(settleBet(b,draw,odds).payoutCents,23500);
  assert.equal(settleBet(b,{...draw,numbers:[1,2,3,4,5,6,24]},odds).payoutCents,0);
});

test('包大数每号与市场继承兼容，包单数总额和独立大小旧规则不改变',()=>{
  for(const text of ['包大数各5','包大数每号五元','包 大 数：各５米','新澳特包大数各号五'])assert.equal(valid(text).bets[0].totalCents,12500,text);
  const p=valid('小明：旧特肖牛10\n包大数各五\n两边包大数各0.5\n张三：包大数各5');
  assert.deepEqual(p.bets.map(b=>[b.markets.join(),b.totalCents]),[['旧',1000],['旧',12500],['新,旧',2500],['新',12500]]);
  assert.equal(valid('包单数1100').bets[0].unitCents,4400);
  assert.equal(valid('大5').bets[0].playType,'attribute');
  for(const text of ['包大数5','包大数各肖5','包大数每组5','特肖包大数各5','三中三包大数各5']){
    const p=parse(text);assert(p.issues.length>0,text);assert.equal(summarize([p]).totalCents,0,text);
  }
  const d=doc('新澳特包大数各五'),item=reviewInput(d,'all').items[0];
  const b={markets:['新'],play:'特码',selection:'大数',basis:'每号',amount:'5',evidence:{market:'新澳',play:'包大数',selection:'大数',amount:'五'}};
  assert.equal(validateCandidate({bets:[b]},item,d).totalCents,12500);
  assert.throws(()=>validateCandidate({bets:[{...b,amount:'0.2'}]},item,d),/金额/);
});
