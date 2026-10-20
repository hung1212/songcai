import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {marketTokens} from '../src/core/business-syntax.js';
import {reviewInput,validateCandidate,assistanceFor} from '../src/core/ai-review.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
const source='雨：\n门猴龙每个号5米\n10，19，21各5米';
const doc=(text=source)=>({id:'men-market',text,businessDate:'2026-10-19'});
const parse=(text=source,extra={})=>parseDocument(text,{...doc(text),...extra});
test('门猴龙每个号5米为新澳8号40元，下一行继承新澳15元，原玩家保留',()=>{
  const p=parse();assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,5500);
  assert.deepEqual(p.bets.map(b=>[b.playerId,b.markets,b.playType,b.count,b.unitCents,b.totalCents]),[['雨',['新'],'special-number',8,500,4000],['雨',['新'],'special-number',3,500,1500]]);
  assert.deepEqual(p.bets[0].values,[11,23,35,47,3,15,27,39]);assert.equal(p.bets[0].raw,source.split('\n')[1]);assert.deepEqual(reviewInput(doc()).items,[]);
});
test('门标题及同行前缀从旧港切换到新并重置玩法，续行沿用新市场',()=>{
  for(const prefix of ['门','门：','门:\n','门\n']){
    const p=parse(`雨：港三中三01 02 03各10\n${prefix}猴龙每个号5米\n10 19 21各5`);assert.deepEqual(p.issues,[],prefix);
    assert.deepEqual(p.bets.map(b=>[b.markets,b.playType]),[[['港'],'linked-number-3-3'],[['新'],'special-number'],[['新'],'special-number']]);
  }
  assert.equal(senderHeader('门：01各10'),null);
  for(const name of ['门先生','厦门朋友','澳门玩家'])assert.equal(senderHeader(`${name}：01各10`)?.name,name);
  const bound=parse('门：旧01各10\n门：02各10',{defaultPlayer:'门'});assert(bound.bets.every(b=>b.playerId==='门'&&b.markets.join()==='旧'));
  assert.deepEqual(marketTokens('厦门朋友'),[]);assert.equal(parse('旧01各10\n门口等你\n02各10').bets.at(-1).markets.join(),'旧');
});
test('新门旧门及完整澳门名称按完整词识别，尾部冲突继续提示',()=>{
  for(const [text,market] of [['新门','新'],['老门','旧'],['旧门','旧'],['旧澳门','旧'],['澳门旧','旧'],['澳门新旧','新,旧']])assert.equal(parse(text+'01各10').bets[0].markets.join(),market,text);
  assert(parse('旧01各10\n共10，门').issues.some(i=>i.code==='TRAILING_MARKET'));
  const p=parse('旧01各10\n共10\n02各20\n03各30\n共50，门');assert.deepEqual(p.issues,[]);assert.deepEqual(summarize([p]).markets,{新:5000,旧:1000,港:0});
});
test('AI证据、旧缓存及赔付均使用门声明的新市场',()=>{
  const d=doc('雨：旧01各10\n门02各20'),item=reviewInput(d,'all').items.find(i=>i.line===2);
  assert.equal(item.context.markets.join(),'新');assert(item.evidence.some(e=>e.field==='market'&&e.quote==='门'&&e.markets.join()==='新'));
  const bet={markets:['新'],play:'特码',selection:'02',basis:'每号',amount:'20',evidence:{market:'门',play:'',selection:'02',amount:'20'}};
  assert.equal(validateCandidate({bets:[bet]},item,d).totalCents,2000);assert.throws(()=>validateCandidate({bets:[{...bet,markets:['旧']}]},item,d),/市场/);
  d.assistance={...assistanceFor(d,[{line:2,source:'门02各20',status:'accepted',replacement:'旧02各20'}]),version:'semantic-20261019-1'};
  const p=parseDocument(d.text,d),draws=Object.fromEntries(['新','旧'].map(m=>[m,{market:m,date:d.businessDate,issue:'2026292',numbers:m==='新'?[1,3,4,5,6,7,2]:[1,2,3,4,5,6,49]}]));
  const result=settleDocuments([p],draws,{新:defaultOdds(),旧:defaultOdds()},d.businessDate);assert.equal(result.payoutCents,94000);assert(result.complete);
});
