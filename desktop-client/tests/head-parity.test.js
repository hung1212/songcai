import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {specialCollection} from '../src/core/special-collection.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {reviewInput,validateCandidate,validateReply,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';
import {issueDetails} from '../src/core/issue-details.js';

const source='新奥，3，4头双数各十五，\n3，4头单数各五，';
const even=[30,32,34,36,38,40,42,44,46,48],odd=[31,33,35,37,39,41,43,45,47,49];
const doc=(text=source,businessDate='2026-10-11')=>({id:'head-parity',name:'测试',text,businessDate,defaultPlayer:''});
const parse=(text=source,date)=>parseDocument(text,doc(text,date));
const valid=(text=source,date)=>{const p=parse(text,date);assert.deepEqual(p.issues,[],text);assert.deepEqual(reviewInput(doc(text,date)).items,[],text);return p;};

test('用户3、4头单双样例取交集，两笔新澳特码150加50共200，无待处理',()=>{
  const p=valid(),s=summarize([p]);assert.equal(p.bets.length,2);assert.deepEqual(p.bets.map(b=>b.values),[even,odd]);
  assert.deepEqual(p.bets.map(b=>[b.playType,b.basis,b.count,b.unitCents,b.totalCents,b.markets,b.semantic.ruleId]),[
    ['special-number','每号',10,1500,15000,['新'],'R36'],['special-number','每号',10,500,5000,['新'],'R36'],
  ]);
  assert.deepEqual(p.bets.map(b=>[b.line,b.endLine,b.raw]),[[1,1,source.split('\n')[0]],[2,2,source.split('\n')[1]]]);
  assert(p.bets.every(b=>b.warnings.length===0));assert.equal(s.totalCents,20000);
  assert.equal(s.numbers.reduce((total,n)=>total+n.cents,0),20000);
  for(const n of s.numbers)assert.equal(n.cents,even.includes(n.number)?1500:odd.includes(n.number)?500:0);
  assert.equal(specialCollection([p]).summary.totalCents,20000);
  assert.deepEqual(p.bets[0].expansions[0].numbers,even);assert.equal(p.bets[0].expansions[0].parity,'双');
});

test('兼容中英文逗号顿号、空格、斜杠、全角及中文金额，金额可单独续行',()=>{
  for(const text of ['3,4头双数各15','3、4头双各十五','3 4头双数每号15元','3/4头双数各15','３，４头双数各１５','3.4头双数字各壹拾伍圆','3，4头双数\n各15']){
    const p=valid(text),b=p.bets[0];assert.deepEqual(b.values,even,text);assert.equal(b.totalCents,15000);assert.equal(b.raw,text);assert.equal(senderHeader(text),null);
  }
  assert.equal(valid('3，4头双数\n各15').bets[0].endLine,2);
  assert.equal(summarize([valid('3,4头双数各0.25')]).totalCents,250);
});

test('0头排除00，4头包含49；单头多头与普通头数筛选边界明确',()=>{
  for(const [text,values] of [
    ['0头双数各10',[2,4,6,8]],['0头单数各10',[1,3,5,7,9]],
    ['4头双数各10',[40,42,44,46,48]],['4头单数各10',[41,43,45,47,49]],
    ['1,3头双数各10',[10,12,14,16,18,30,32,34,36,38]],
  ]){const b=valid(text).bets[0];assert.deepEqual(b.values,values);assert.equal(b.totalCents,values.length*1000);}
  for(const date of ['2026-02-16','2026-02-17','2027-02-06'])assert.deepEqual(valid(source,date).bets.map(b=>b.values),[even,odd]);
  assert.equal(valid('3,4头各10').bets[0].count,20);
  assert.equal(valid('二中二复式3,4头双数各10').bets[0].count,45);
});

test('头后单双只过滤当前头数；明确加号保持原来按份累计含义',()=>{
  assert.deepEqual(valid('01+3头双数各10').bets[0].values,[1,30,32,34,36,38]);
  assert.deepEqual(valid('1头双数+3头单数各10').bets[0].values,[10,12,14,16,18,31,33,35,37,39]);
  const union=valid('3,4头+双数各10').bets[0];assert.equal(union.count,44);assert.equal(union.totalCents,44000);
  assert.equal(union.values.filter(n=>n===32).length,2);assert(union.values.includes(2));
});

test('无明确其他玩法时头单双为特码，保留市场和玩家，多市场各自计费',()=>{
  const p=valid('小明：旧平码01各10\n3,4头双数各15\n3,4头单数各5\n两边3,4头双数各15\n张三：3,4头单数各5');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.markets,b.totalCents]),[
    ['flat-number',['旧'],1000],['special-number',['旧'],15000],['special-number',['旧'],5000],
    ['special-number',['新','旧'],30000],['special-number',['新'],5000],
  ]);
  assert(p.bets.slice(1).every(b=>!b.semantic.inherited));assert.equal(p.bets.at(-1).player,'张三');
  assert.equal(summarize([p]).totalCents,56000);
});

test('非法头数、单双混写、明确玩法冲突和缺金额不计账，原因可见',()=>{
  for(const [text,code] of [
    ['3,5头双数各15','INVALID_HEAD'],['9头单数各5','INVALID_HEAD'],
    ['3,4头单双各15','HEAD_PARITY_CONFLICT'],['3,4头单数双数各15','HEAD_PARITY_CONFLICT'],
    ['特肖3,4头双数各15','SELECTION_TYPE'],['平特尾3,4头双数各15','SELECTION_TYPE'],
    ['3,4头双数每肖15','BASIS_CONFLICT'],['3,4头双数每组15','BASIS_CONFLICT'],
    ['3,4头双数','MISSING_AMOUNT'],['3,4头双数各1.234','INVALID_AMOUNT'],
  ]){const p=parse(text);assert(p.issues.some(i=>i.code===code),`${text}: ${JSON.stringify(p.issues)}`);assert.equal(summarize([p]).totalCents,0);}
  assert.equal(issueDetails(parse('3,4头单双各15').issues[0]).title,'头数单双条件冲突');
});

test('只有交集内特码中奖，30双数赔705、49单数赔235，范围外单双不赔',()=>{
  const p=valid(),odds={...defaultOdds(),confirmed:true};odds.refund49.attribute=true;
  const settle=special=>p.bets.map(b=>settleBet(b,{market:'新',date:doc().businessDate,issue:'2026284',numbers:[1,2,3,4,5,6,special]},odds));
  for(const special of [30,32,40,48]){const rows=settle(special);assert.equal(rows[0].winningStakeCents,1500);assert.equal(rows.reduce((s,b)=>s+b.payoutCents,0),70500);}
  for(const special of [31,49])assert.equal(settle(special).reduce((s,b)=>s+b.payoutCents,0),23500);
  for(const special of [7,8,29])assert.equal(settle(special).reduce((s,b)=>s+b.payoutCents,0),0);
});

test('AI保持头数单双范围和原单价，不能扩大到全部单双或漏掉30、40',()=>{
  const d=doc(),items=reviewInput(d,'all').items;
  for(const [index,selection,amount,proofAmount,values] of [[0,'3，4头双数','15','十五',even],[1,'3，4头单数','5','五',odd]]){
    const item=items[index],b={markets:['新'],play:'特码',selection,basis:'每号',amount,evidence:{market:index?'':'新奥',play:'',selection,amount:proofAmount}};
    const candidate={bets:[b]},r=validateCandidate(candidate,item,d);assert.deepEqual(r.bets[0].values,values);
    assert.equal(validateReply({items:[{line:item.line,candidates:[candidate]}]},[item],d)[0].status,'agree');
    assert.throws(()=>validateCandidate({bets:[{...b,selection:index?'单数':'双数'}]},item,d),/选号|改变/);
    assert.throws(()=>validateCandidate({bets:[{...b,selection:values.filter(n=>n!==30&&n!==40&&n!==49).join(' ')}]},item,d),/选号|改变/);
    assert.throws(()=>validateCandidate({bets:[{...b,amount:'20'}]},item,d),/金额/);
  }
});

test('旧错误解释失效后自动重算200元，原文、高亮和行号保留',()=>{
  for(const status of ['failed','review','accepted']){
    const d=doc();d.parserVersion='parser-20261011-2';
    d.assistance={...assistanceFor(d,[{line:1,source:source.split('\n')[0],status,replacement:status==='accepted'?'新3,4头+双数各15':''}]),version:'semantic-20261011-2'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,source);assert.deepEqual(p.issues,[]);
    assert.equal(summarize([p]).totalCents,20000);assert.deepEqual(currentReviewItems(next),[]);
  }
  const tokens=highlightText(source);assert.equal(tokens.map(t=>t.text).join(''),source);
  assert.deepEqual(tokens.filter(t=>t.kind==='amount').map(t=>t.text),['十五','五']);
});
