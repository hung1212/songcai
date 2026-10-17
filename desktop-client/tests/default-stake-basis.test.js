import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {playOverview} from '../src/core/play-overview.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {REVIEW_INSTRUCTIONS,reviewInput,validateCandidate} from '../src/core/ai-review.js';
const date='2026-10-07',options={id:'basis',name:'总额口径',businessDate:date};
const parse=text=>parseDocument(text,options);
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};
test('新奥大数200和羊50分别为大小整项与特肖，总250，保留句号及原文',()=>{
  const text='新奥大数200.\n羊50.',p=valid(text);assert.equal(summarize([p]).totalCents,25000);
  assert.deepEqual(p.bets.map(b=>[b.play,b.playType,b.values,b.count,b.totalCents]),[['大小·大数','attribute',['大'],1,20000],['特肖','special-zodiac',['羊'],1,5000]]);
  assert.deepEqual(p.bets.map(b=>b.raw),text.split('\n'));assert(p.bets.every(b=>b.markets.join()==='新'&&b.semantic.ruleId==='R21'));
  assert(summarize([p]).numbers.every(n=>n.cents===0));
});
test('大小数整项支持别名、中文金额、冒号与小数单价',()=>{
  for(const text of ['大数200','大数：二百元','大的数200','小数200','小的数200','单数200','双数200','大数200.50']){
    const p=valid(text);assert.equal(p.bets[0].playType,'attribute',text);assert.equal(p.bets[0].basis,'整项',text);assert.equal(p.bets[0].count,1,text);assert.equal(p.bets[0].totalCents,text==='大数200.50'?20050:20000,text);
  }
});
test('各、每号、每个数触发逐号，25至49大数共25个，1至24小数共24个',()=>{
  for(const marker of ['各','各号','每号','每个数','每个数字','每个号码']){
    for(const [word,count] of [['大数',25],['小数',24],['单数',25],['双数',24],['羊',4]]){
      const p=valid(`${word}${marker}50`);assert.equal(p.bets[0].playType,'special-number');assert.equal(p.bets[0].count,count);assert.equal(p.bets[0].totalCents,count*5000);
      if(word==='大数')assert.deepEqual(p.bets[0].values,Array.from({length:25},(_,i)=>25+i));
      if(word==='小数')assert.deepEqual(p.bets[0].values,Array.from({length:24},(_,i)=>1+i));
    }
  }
});
test('单生肖无逐号字眼默认特肖，生肖数金额和明确玩法保持原义',()=>{
  for(const text of ['羊50','羊五十元','羊：50','羊50.'])assert.equal(valid(text).bets[0].playType,'special-zodiac',text);
  assert.equal(valid('羊数50').bets[0].totalCents,20000);
  assert.equal(valid('特码羊50').bets[0].playType,'special-number');
  assert.equal(valid('特肖羊各50').bets[0].totalCents,5000);
  assert.equal(valid('牛鼠各十五').bets[0].playType,'special-number');
  assert.equal(valid('包单数1100').bets[0].totalCents,110000);
  assert.equal(valid('红波100').bets[0].playType,'wave');
});
test('声明继承优先且市场与玩家边界不变，默认羊50不继承上一笔大小',()=>{
  assert.equal(valid('特码\n羊50').bets[0].playType,'special-number');
  assert.equal(valid('平特肖\n羊50').bets[0].playType,'flat-zodiac');
  assert.equal(valid('二连肖\n牛羊50').bets[0].playType,'linked-zodiac');
  const p=valid('甲：旧大数200\n羊50\n乙：羊50');assert.deepEqual(p.bets.map(b=>[b.player,b.markets,b.totalCents]),[['甲',['旧'],20000],['甲',['旧'],5000],['乙',['新'],5000]]);
});
test('大小以25为边界，按配置的大小赔率赔付，49和局设置保留',()=>{
  const p=valid('大数200\n小数100'),odds={...defaultOdds(),refund49:{attribute:false,sixZodiac:true,halfWave:false}};
  const settle=n=>settleDocuments([p],{新:{id:'n'+n,market:'新',date,issue:'2026280',numbers:[2,3,4,5,6,7,n]}},{新:odds},date);
  for(const n of [1,24])assert.deepEqual(settle(n).entries.map(e=>e.status),['lost','won']);
  for(const n of [25,48,49]){const r=settle(n);assert.deepEqual(r.entries.map(e=>e.status),['won','lost']);assert.equal(r.payoutCents,38000);}
  odds.refund49.attribute=true;assert.deepEqual(settle(49).entries.map(e=>e.status),['refund','refund']);
});
test('羊50用特肖赔率结算，大小单独归类且与全部账目金额一致',()=>{
  const p=valid('大数200\n羊50'),r=settleDocuments([p],{新:{id:'test',market:'新',date,issue:'2026280',numbers:[1,2,3,4,5,6,48]}},{新:defaultOdds()},date);
  assert.equal(r.payoutCents,96500);assert.equal(r.entries[1].winningStakeCents,5000);
  assert.equal(playOverview(r.entries,{group:'attribute'}).stakeCents,20000);assert.equal(playOverview(r.entries,{group:'special-zodiac'}).stakeCents,5000);assert.equal(playOverview(r.entries,{group:'special-number'}).stakeCents,0);
});
test('标准同步AI规则并阻止把已确定的羊50重新改成逐号，旧账自动重算',()=>{
  assert.match(REVIEW_INSTRUCTIONS,/R21/);
  const d={...options,text:'羊50'},item=reviewInput(d,'all').items[0];assert.equal(item.required,false);
  const b={markets:['新'],play:'特肖',selection:'羊',basis:'每肖',amount:'50',evidence:{market:'',play:'',selection:'羊',amount:'50'}};
  assert.equal(validateCandidate({bets:[b]},item,d).totalCents,5000);
  assert.throws(()=>validateCandidate({bets:[{...b,play:'特码',basis:'每号'}]},item,d),/已确定/);
  const updated=upgradeDocument({...options,text:'新奥大数200.\n羊50.',parserVersion:'parser-20261007-2'});assert.equal(summarize([parseDocument(updated.text,updated)]).totalCents,25000);
});


test('单双整项标明玩法，按特码的奇偶和单双赔率赔付，不展开25或24份',()=>{
  const p=valid('单数200\n双数200');assert.deepEqual(p.bets.map(b=>b.play),['单双·单数','单双·双数']);assert.equal(summarize([p]).totalCents,40000);
  for(const n of [24,25,48,49]){
    const odds={...defaultOdds(),refund49:{attribute:false,sixZodiac:true,halfWave:false}};
    const r=settleDocuments([p],{新:{id:'n'+n,market:'新',date,issue:'2026280',numbers:[1,2,3,4,5,6,n]}},{新:odds},date);
    assert.deepEqual(r.entries.map(e=>e.status),n%2?['won','lost']:['lost','won']);assert.equal(r.payoutCents,38000);
  }
});
