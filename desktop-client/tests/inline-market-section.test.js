import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate} from '../src/core/ai-review.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
const doc=text=>({id:'inline-market',name:'测试',text,businessDate:'2026-10-07',defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};
const source='新奥\n蛇各号二十五米\n02/26/36/34/38/02/26/36各二十米\n26/36/38/02各十米\n\n26/34/02/36/35复式三中三各组十米\n\n共400\n\n新门：30–42–18–36–48–12–32–44–各5\n06–24–46–10–26–38–14–16–28–40–33–45–21–各3';
test('截图新门同行标题重置三中三，末两笔特码40加39，全单479',()=>{
 const p=valid(source),last=p.bets.slice(-2);assert.equal(summarize([p]).totalCents,47900);assert.equal(p.bets.length,6);
 assert.deepEqual(last.map(b=>[b.playType,b.count,b.unitCents,b.totalCents,b.line]),[['special-number',8,500,4000,10],['special-number',13,300,3900,11]]);
 assert(last.every(b=>b.markets.join()==='新'&&!b.semantic.inherited&&!b.semantic.declaration));
 assert.equal(p.bets[3].playType,'linked-number-3-3');assert.equal(p.bets[3].totalCents,10000);
 assert.deepEqual(reviewInput(doc(source)).items,[]);
});
test('同市场或换市场、全半角冒号、市场标题同行或分行均等价',()=>{
 for(const [market,markets] of [['新门',['新']],['新奥',['新']],['香港',['港']],['旧',['旧']],['两边',['新','旧']],['三边',['新','旧','港']]])for(const colon of [':','：',' ： ']){
  const before='新三中三01 02 03各10\n',after='04 05各5\n06各3\n总'+(13*markets.length)+'\n合计'+(10+13*markets.length);
  const inline=valid(before+market+colon+after),separate=valid(before+market+colon+'\n'+after);
  const shape=p=>p.bets.map(b=>[b.playType,b.values,b.totalCents,b.markets]);assert.deepEqual(shape(inline),shape(separate));
  assert.equal(inline.bets[1].playType,'special-number');assert.deepEqual(inline.bets[1].markets,markets);
 }
});
test('市场标题后明确玩法优先，普通续行继承但空行后重置玩法，合计仍可核对',()=>{
 const p=valid('三中三01 02 03各10\n新：二中二04 05各20\n06 07各5');
 assert.deepEqual(p.bets.map(b=>b.playType),['linked-number-3-3','linked-number-2-2','linked-number-2-2']);assert.equal(p.bets[2].semantic.declaration.line,2);
 const continuation=valid('三中三01 02 03各10\n\n共10\n04 05 06各20');assert.equal(continuation.bets[1].playType,'special-number');assert.equal(continuation.bets[1].totalCents,6000);assert.equal(continuation.metadata.find(m=>m.kind==='金额声明').actualCents,1000);
 const error=parse('三中三01 02 03各10\n新：特肖三中三04 05各20');assert(error.issues.some(i=>i.code==='PLAY_CONFLICT'));
});
test('AI上下文丢弃旧玩法来源并保留新市场，赔付按特码逐号金额',()=>{
 const d=doc(source),item=reviewInput(d,'all').items.find(i=>i.line===10);
 assert.equal(item.context.play,'');assert(!item.preceding.some(p=>p.line===6));assert.deepEqual(item.context.markets,['新']);
 const b={markets:['新'],play:'特码',selection:'30 42 18 36 48 12 32 44',basis:'每号',amount:'5',evidence:{market:'新门',play:'',selection:'30–42–18–36–48–12–32–44',amount:'5'}};
 assert.equal(validateCandidate({bets:[b]},item,d).totalCents,4000);
 const p=valid(source),odds=defaultOdds();odds.confirmed=true;
 const draw={market:'新',date:d.businessDate,issue:'2026280',numbers:[1,3,5,7,9,11,30]};
 const result=settleDocuments([p],{新:draw},{新:odds},d.businessDate);
 assert.equal(result.stakeCents,47900);assert.equal(result.payoutCents,23500);assert.equal(result.complete,true);
});
