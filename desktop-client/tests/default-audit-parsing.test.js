import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize} from '../src/core/parser.js';
import {assistanceFor,reviewInput,validateCandidate} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {flatZodiacCollection} from '../src/core/flat-zodiac-collection.js';
import {specialCollection} from '../src/core/special-collection.js';
import {highlightText} from '../src/core/highlight.js';
const doc=text=>({id:'audit-default',name:'测试',text,businessDate:'2026-10-05'});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};
const cross=(a,b)=>a.flatMap(x=>b.map(y=>[x,y]));
const compound='14.26.19.31.21.33个号一百特。14.26..19.31.21.33个复式二连一组一百。14.26.19.31.33.21复试一组二十特串';

test('一肖、独肖默认平特肖，位置、金额和空格变体都保持原生肖及单价',()=>{
  for(const text of ['蛇一肖3000米','独肖蛇3000','蛇独肖三千米','蛇3000米独肖','一肖：蛇3000米','蛇各三千一肖','蛇各3000元1肖','蛇 一 肖 ３０００米','平特肖蛇一肖3000米','奥特蛇3000米一肖']){
    const p=valid(text),b=p.bets[0];assert.equal(p.bets.length,1,text);assert.equal(b.playType,'flat-zodiac',text);
    assert.deepEqual(b.values,['蛇']);assert.equal(b.basis,'每肖');assert.equal(b.unitCents,300000);assert.equal(b.totalCents,300000);assert.equal(b.raw,text);
    assert.deepEqual(reviewInput(doc(text)).items,[]);
    assert.equal(flatZodiacCollection([p]).animals.find(a=>a.animal==='蛇').cents,300000);
    assert.equal(specialCollection([p]).summary.totalCents,0);
    assert.equal(highlightText(text).map(t=>t.text).join(''),text);
  }
});

test('单肖简称优先于上一笔玩法，明确特肖及特包继续保持，金额后的新一肖不带走前笔',()=>{
  const p=valid('特肖\n蛇一肖3000米\n独肖马各50\n特肖蛇独肖100米\n特包龙虎各二十一肖');
  assert.deepEqual(p.bets.map(b=>[b.playType,b.totalCents]),[['flat-zodiac',300000],['flat-zodiac',5000],['special-zodiac',10000],['special-number',2000],['special-number',2000]]);
  assert.deepEqual(valid('特肖蛇各10米一肖牛各20米').bets.map(b=>[b.playType,b.totalCents]),[['special-zodiac',1000],['flat-zodiac',2000]]);
  assert.equal(valid('一肖中特蛇3000米').bets[0].playType,'special-zodiac-any');
  assert.equal(valid('三肖中特蛇马龙100').bets[0].playType,'special-zodiac-any');
  for(const text of ['独肖蛇各号100','特肖平特肖蛇100','平特蛇三中三100','独肖蛇','特肖蛇一肖各号100'])assert(parse(text).issues.length,text);
});

test('平特肖中奖覆盖正码或特码，同肖开出多个号码只赔一份，遵守已配置中奖范围',()=>{
  const b=valid('蛇一肖3000米').bets[0],odds=defaultOdds();
  for(const numbers of [[2,14,26,38,1,3,4],[1,3,4,5,6,7,2]]){
    const r=settleBet(b,{market:'新',date:'2026-10-05',issue:'2026278',numbers},odds);
    assert.equal(r.winCount,1);assert.equal(r.payoutCents,615000);assert.equal(r.winningStakeCents,300000);
  }
  const onlySpecial={market:'新',date:'2026-10-05',issue:'2026278',numbers:[1,3,4,5,6,7,2]};
  assert.equal(settleBet(b,onlySpecial,{...odds,scopes:{...odds.scopes,'flat-zodiac':'six'}}).winCount,0);
});

test('AI须遵守新的单肖默认，不得改成特肖或逐号特码',()=>{
  for(const text of ['蛇一肖3000米','独肖蛇3000米']){
    const d=doc(text),item=reviewInput(d,'all').items[0];
    const b={markets:['新'],play:'平特肖',selection:'蛇',basis:'每肖',amount:'3000',evidence:{market:'',play:text.includes('独肖')?'独肖':'一肖',selection:'蛇',amount:'3000'}};
    assert.equal(validateCandidate({bets:[b]},item,d).totalCents,300000);
    for(const play of ['特肖','特码'])assert.throws(()=>validateCandidate({bets:[{...b,play,basis:play==='特码'?'每号':'每肖'}]},item,d),/玩法|计费|改变/);
  }
  const tokens=highlightText('蛇各三千一肖');
  assert(tokens.some(t=>t.kind==='amount'&&t.text==='三千'));
  assert(tokens.some(t=>t.kind==='play'&&t.text==='一肖'));
});

test('选号之间的对等价拖，显式特串和特连保留自身玩法，四组及六组金额正确',()=>{
  for(const text of ['37对龙各20','37 对 龙各20','３７对龙各二十']){
    const b=valid(text).bets[0];assert.equal(b.playType,'linked-number-2-2');assert.deepEqual(b.groups,cross([37],[3,15,27,39]));assert.equal(b.totalCents,8000);
  }
  for(const text of ['特串37对龙10','特连37对龙各10']){
    const b=valid(text).bets[0];assert.equal(b.playType,'special-pair');assert.deepEqual(b.groups,cross([37],[3,15,27,39]));assert.equal(b.totalCents,4000);
  }
  const source='新特连02.26.串35.23.38.各10',b=valid(source).bets[0];
  assert.equal(b.playType,'special-pair');assert.deepEqual(b.groups,cross([2,26],[35,23,38]));assert.equal(b.totalCents,6000);
  assert(highlightText(source).some(t=>t.kind==='play'&&t.text==='特连'));
  assert(highlightText('37 对 龙各20').some(t=>t.kind==='play'&&t.text==='对'));
  assert.equal(valid('这句话是对的\n01各10').bets.length,1);
  for(const text of ['37对龙','37对50各10','特串37对龙每肖10'])assert(parse(text).issues.length,text);
});

test('一组一百不把一组中的一当金额，复式六个号码15组100元，同句三笔共2400元',()=>{
  const p=valid(compound);assert.deepEqual(p.bets.map(b=>[b.playType,b.count,b.unitCents,b.totalCents]),[['special-number',6,10000,60000],['linked-number-2-2',15,10000,150000],['special-pair',15,2000,30000]]);
  assert.equal(summarize([p]).totalCents,240000);assert(p.bets.every(b=>b.line===1&&b.raw===compound));
  for(const phrase of ['个复式二连一组一百','个复式二连一组100','个复式二连每组一百','个复式二连组一百']){
    const b=valid('14.26.19.31.21.33'+phrase).bets[0];assert.equal(b.count,15);assert.equal(b.unitCents,10000);
  }
  for(const text of ['14.26.19.31.21.33个复式二连一组','14.26.19.31.21.33个复式二连一组1.234','14.26.19.31.21.33个复式二连各1/2米'])assert(parse(text).issues.length,text);
});

test('旧AI待处理不再挡住修复结果，旧特肖解释失效，原文与历史快照不覆盖',()=>{
  const text='37对龙各20\n特串37对龙10\n蛇一肖3000米\n新特连02.26.串35.23.38.各10\n'+compound,d=doc(text);
  d.parserVersion='parser-20261021-6';d.settlements=[{id:'history',payoutCents:12345}];
  d.assistance={...assistanceFor(d,text.split('\n').map((source,i)=>({line:i+1,source,status:'failed',required:true,replacement:''}))),version:'semantic-20261021-6'};
  const before=JSON.stringify(d),upgraded=upgradeDocument(d),p=parseDocument(upgraded.text,upgraded);
  assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,558000);assert.equal(p.bets.length,7);
  assert.equal(p.bets[2].playType,'flat-zodiac');assert.equal(upgraded.text,text);assert.deepEqual(upgraded.settlements,d.settlements);assert.equal(JSON.stringify(d),before);
  const duplicate=valid('01.37.49.31.19.36.48.11.35.47.09.33.21.22.34.46各80\n\n01.37.49.31.19.36.48.11.35.47.09.33.21.22.34.46各80');
  assert.equal(summarize([duplicate]).totalCents,256000);
});
