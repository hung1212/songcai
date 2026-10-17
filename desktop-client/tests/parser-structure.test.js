import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {ledgerTitle} from '../src/core/ledger.js';
import {highlightText} from '../src/core/highlight.js';
import {statementEvidence,structuralConflicts} from '../src/core/business-syntax.js';
import {reviewInput,reviewPayload,validateCandidate} from '../src/core/ai-review.js';
const doc=text=>({id:'structure',text,name:'测试',businessDate:'2026-10-06',defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
test('用户定向16条案例逐项符合预期，不仅检查是否成功',()=>{
 const audit=JSON.parse(fs.readFileSync(new URL('../reports/parser-structure-audit-2026-10-06.json',import.meta.url)));
 for(const c of audit.results){const p=parse(c.text);assert.deepEqual(p.issues,[],c.text);assert.equal(summarize([p]).totalCents,c.expected.totalCents,c.text);assert.equal(p.bets[0].playType,c.expected.playType,c.text);assert.deepEqual(p.bets[0].markets,c.expected.markets,c.text);}
});
test('多肖中特的合法格式、数字、市场变体保持玩家、选号、整项与金额',()=>{
 for(const market of [['新澳奥',['新']],['旧',['旧']],['港',['港']],['两边',['新','旧']],['三边',['新','旧','港']]])
 for(const play of ['四肖中特','4肖中特','四 肖 中 特','４ 肖 中 特'])
 for(const colon of ['',':','：'])for(const space of [' ','　','\t'])for(const money of ['200','２００','二百','贰佰']){
  const text=`小明：${market[0]}${space}${play}${space}${colon}龙牛狗蛇 ${money}`;const p=parse(text),b=p.bets[0];
  assert.deepEqual(p.issues,[],text);assert.equal(p.bets.length,1,text);assert.equal(b.player,'小明');assert.deepEqual(b.markets,market[1]);assert.equal(b.playType,'special-zodiac-any');assert.equal(b.basis,'整项');assert.equal(b.size,4);assert.deepEqual(b.values,['龙','牛','狗','蛇']);assert.equal(b.count,1);assert.equal(b.unitCents,20000);assert.equal(b.totalCents,market[1].length*20000);
 }
});
test('各玩法的冒号和字段空格不能改变计费口径',()=>{
 const cases=[['特码','1 2 各100','special-number','每号',20000],['特肖','牛鼠各100','special-zodiac','每肖',20000],['三连肖','虎牛兔100','linked-zodiac','每组',10000],['二中二','1 2各100','linked-number-2-2','每组',10000],['三中三','1 2 3各100','linked-number-3-3','每组',10000],['三中二','1 2 3各100','linked-number-3-2','每组',10000],['二中特','1 2各100','linked-number-2-special','每组',10000],['特串','1 2各100','special-pair','每组',10000],['五不中','1 2 3 4 5各100','not-hit','每组',10000],['二连尾','1 2各100','linked-tail','每组',10000],['平特肖','牛鼠各100','flat-zodiac','每肖',20000],['平码','1 2各100','flat-number','每号',20000],['平尾','1 2各100','flat-tail','每尾',20000],['二粒任中','1 2各100','flat-any','每组',10000],['红波','100','wave','整项',10000],['红单','100','half-wave','整项',10000],['大','100','attribute','整项',10000],['天肖','各100','special-number','每号',250000],['红波','各100','special-number','每号',170000]];
 for(const [play,body,type,basis,total] of cases)for(const colon of [' ',':',' ： ']){
  const text=`旧 ${play}${colon}${body}`,p=parse(text);assert.deepEqual(p.issues,[],text);assert.equal(p.bets[0].playType,type,text);assert.equal(p.bets[0].basis,basis,text);assert.deepEqual(p.bets[0].markets,['旧']);assert.equal(summarize([p]).totalCents,total,text);
 }
});
test('声明续行、已完成投注和消息边界采用不同继承策略',()=>{
 let p=parse('小明：旧1各10\n四肖中特：龙牛狗蛇200\n特肖虎100');assert.equal(summarize([p]).totalCents,31000);assert(p.bets.every(b=>b.player==='小明'&&b.markets.join()==='旧'));
 p=parse('小明：两边 四肖中特\n龙牛狗蛇200\n张三：龙牛狗蛇200');assert.equal(p.bets[0].totalCents,40000);assert.equal(p.bets[0].semantic.inherited,true);assert.equal(p.bets[0].semantic.declaration.line,1);assert.equal(p.bets[1].playType,'special-number');assert.deepEqual(p.bets[1].markets,['新']);
 p=parse('小明：旧 四肖中特\n小明：龙牛狗蛇200');assert.equal(p.bets[0].playType,'special-number');assert.deepEqual(p.bets[0].markets,['旧']);
 p=parse('四肖中特龙牛狗蛇200\n龙牛狗蛇200');assert.deepEqual(p.bets.map(b=>b.playType),['special-zodiac-any','special-number']);assert.equal(p.bets[1].semantic.inherited,false);
});
test('真实玩家、高亮和标题共用业务前缀判断',()=>{
 for(const name of ['小明','新的一天','老友','阿平特','玩家123'])assert.equal(senderHeader(`${name}：旧1各100`)?.name,name);
 assert.equal(senderHeader('四肖中特：龙牛狗蛇200'),null);
 assert.equal(senderHeader('四肖中特：旧1各100','四肖中特')?.name,'四肖中特');
 assert.equal(ledgerTitle({...doc('新澳奥 四肖中特：龙牛狗蛇200'),name:'',autoTitle:true}),'未命名账目');
 const text='新澳奥 四 肖 中 特：龙牛狗蛇２００';const tokens=highlightText(text);assert.equal(tokens.map(t=>t.text).join(''),text);assert(tokens.some(t=>t.kind==='play'&&t.text==='四 肖 中 特'));assert(tokens.some(t=>t.kind==='amount'&&t.text==='２００'));
 const evidence=statementEvidence(text);for(const e of evidence)assert.equal(text.slice(e.start,e.end),e.quote);assert(evidence.some(e=>e.field==='amount'));assert(evidence.some(e=>e.field==='selection'));assert(evidence.some(e=>e.field==='play'));
});
test('成功结果检查发现显式玩法或市场丢失，疑难项仍不补造数字',()=>{
 const wrong=parse('龙牛狗蛇200').bets;assert.equal(structuralConflicts('旧 四肖中特：龙牛狗蛇200',wrong).length,2);
 for(const text of ['四肖中特：龙牛狗200','四肖中特：龙牛狗狗200','特肖三中三1 2 100','四肖中特：龙牛狗蛇','取消四肖中特龙牛狗蛇200']){const p=parse(text);assert(p.issues.some(i=>i.severity==='error'),text);assert.equal(summarize([p]).totalCents,0,text);}
});
test('AI收到完整业务前缀、匿名玩家和原始前文；拒绝静默改成逐号',()=>{
 const d=doc('秘密玩家：旧 四肖中特\n龙牛狗蛇200');const item=reviewInput(d,'all').items.find(i=>i.line===2);const payload=reviewPayload([item]);assert(!JSON.stringify(payload).includes('秘密玩家'));assert.equal(payload[0].preceding[0].body,'旧 四肖中特');
 const colon=doc('秘密玩家：旧 四肖中特：龙牛狗蛇200'),i=reviewInput(colon,'all').items[0];assert.equal(i.body,'旧 四肖中特：龙牛狗蛇200');
 const b={markets:['旧'],play:'4肖中特',selection:'龙牛狗蛇',basis:'整项',amount:'200',evidence:{market:'旧',play:'四肖中特',selection:'龙牛狗蛇',amount:'200'}};
 assert.equal(validateCandidate({bets:[b]},i,colon).totalCents,20000);
 assert.throws(()=>validateCandidate({bets:[{...b,play:'特码',basis:'每号'}]},i,colon),/玩法|计费/);
});
