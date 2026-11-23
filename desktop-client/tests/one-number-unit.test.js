import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {reviewInput,validateCandidate} from '../src/core/ai-review.js';
import {numberBasisEvidence} from '../src/core/semantic-rules.js';
import {highlightText} from '../src/core/highlight.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
const lines=['牛，鸡，羊，猪，狗一个数二十','兔，鸡，猪，蛇一个数二十','20.22.10.32一个数五十'];
const doc=text=>({id:'one-number',name:'测试',text,businessDate:'2026-11-22'});
const parse=text=>parseDocument(text,doc(text));
test('截图三个一个数表达按每号特码计费，保留原文分别400、320、200元',()=>{
 const source=lines.join('\n\n'),p=parse(source);assert.deepEqual(p.issues,[]);
 assert.deepEqual(p.bets.map(b=>[b.playType,b.count,b.unitCents,b.totalCents,b.line]),[['special-number',20,2000,40000,1],['special-number',16,2000,32000,3],['special-number',4,5000,20000,5]]);
 assert.deepEqual(p.bets.map(b=>b.raw),lines);assert.equal(summarize([p]).totalCents,92000);
 assert.deepEqual(reviewInput(doc(source)).items,[]);
});
test('一个数、号、号码、数字支持空格中文金额，包号明确每号不再均分',()=>{
 for(const unit of ['一个数','一个号','一个号码','一个数字','一 个 数'])for(const amount of ['五十','５０','伍拾']){
  const p=parse(`20.22.10.32${unit}${amount}`);assert.deepEqual(p.issues,[]);assert.equal(p.bets[0].totalCents,20000);
 }
 assert.equal(parse('包鸡一个数100').bets[0].totalCents,40000);
 assert.equal(parse('包鸡100').bets[0].totalCents,10000);
 const year= parse('马一个数20');assert.equal(year.bets[0].count,5);assert.equal(year.bets[0].totalCents,10000);
 const old=parseDocument('马一个数20',{...doc(''),businessDate:'2026-02-16'});assert.equal(old.bets[0].count,4);
});
test('明确每号中止旧玩法继承，明确冲突、缺价、负价和非法号码仍待处理',()=>{
 const p=parse('旧平特肖\n牛一个数二十');assert.deepEqual(p.issues,[]);assert.equal(p.bets[0].playType,'special-number');assert.deepEqual(p.bets[0].markets,['旧']);
 for(const text of ['特肖牛一个数20','二连肖牛羊一个数20','牛一个数','牛一个数-20','01.50一个数20']){const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);}
 assert.equal(parse('二中二01.02一组50').bets[0].totalCents,5000);
 assert.equal(parse('蛇一肖100').bets[0].playType,'flat-zodiac');
});
test('原文逐号证据、金额高亮、AI核验和特码赔付使用正确单价',()=>{
 const d=doc(lines[2]),item=reviewInput(d,'all').items[0];
 const evidence=numberBasisEvidence(d.text);assert.equal(evidence.quote,'一个数');assert.equal(d.text.slice(evidence.start,evidence.end),'一个数');
 const b={markets:['新'],play:'特码',selection:'20.22.10.32',basis:'每号',amount:'50',evidence:{market:'',play:'',selection:'20.22.10.32',amount:'五十'}};
 assert.equal(validateCandidate({bets:[b]},item,d).totalCents,20000);assert.throws(()=>validateCandidate({bets:[{...b,amount:'200'}]},item,d));
 const tokens=highlightText(d.text);assert.equal(tokens.map(t=>t.text).join(''),d.text);assert.equal(tokens.filter(t=>t.kind==='amount').map(t=>t.text).join(''),'五十');
 const result=settleBet(parse(d.text).bets[0],{market:'新',date:d.businessDate,issue:'2026326',numbers:[1,2,3,4,5,6,20]},defaultOdds());assert.equal(result.payoutCents,235000);
});
