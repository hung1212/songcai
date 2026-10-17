import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {playTokens,statementEvidence} from '../src/core/business-syntax.js';
import {highlightText} from '../src/core/highlight.js';
import {assistanceFor,reviewInput,validateCandidate} from '../src/core/ai-review.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';

const source='香菜\nT:01 13 33 41 49(共5个各50斤)\nT:01(共一个150斤)';
const doc=text=>({id:'hong-kong-heading',name:'测试',text,businessDate:'2026-10-08',defaultPlayer:''});
const parse=(text,options={})=>parseDocument(text,{...doc(text),...options});

test('截图香菜加T标签：两笔香港特码250加150，原文和玩家保留，无待处理',()=>{
  const p=parse(source);
  assert.deepEqual(p.issues,[]);
  assert.deepEqual(summarize([p]).markets,{新:0,旧:0,港:40000});
  assert.deepEqual(p.bets.map(b=>[b.playType,b.values,b.count,b.unitCents,b.totalCents,b.marketSource]),[
    ['special-number',[1,13,33,41,49],5,5000,25000,1],
    ['special-number',[1],1,15000,15000,1],
  ]);
  assert.equal(new Set(p.bets.map(b=>b.playerId)).size,1);
  assert(!p.metadata.some(m=>m.kind==='发送人'));
  assert.deepEqual(p.bets.map(b=>b.raw),source.split('\n').slice(1));
  assert.deepEqual(p.coverage.map(c=>c.status),['metadata','parsed','parsed']);
  assert.deepEqual(reviewInput(doc(source)).items,[]);
});

test('香港简称、修饰词、大小写与全角T冒号等价；市场标签同行或分行均可',()=>{
  for(const heading of ['香','香菜','香彩','香港','港彩'])for(const t of ['T:','t：','Ｔ ：','ｔ：']){
    const p=parse(`${heading}\n${t}01各50\n谢谢老板🙂\n其他备注\n02各10`);
    assert.deepEqual(p.issues,[],`${heading} ${t}`);
    assert.equal(summarize([p]).markets.港,6000);
    assert(p.bets.every(b=>b.marketSource===1));
  }
  assert.equal(summarize([parse('香菜：01各50\n02各10')]).markets.港,6000);
  const p=parse('旧三中三01 02 03各10\n香菜\nT:04 05各50\n06各10');
  assert.deepEqual(p.issues,[]);
  assert.deepEqual(p.bets.map(b=>b.playType),['linked-number-3-3','special-number','special-number']);
  assert.deepEqual(summarize([p]).markets,{新:0,旧:1000,港:11000});
  assert.equal(parse('旧三中三01 02 03各10\nT:04 05各50').bets[1].playType,'special-number');
});

test('T不重置市场或消息合计，真实发送人切换仍重置，绑定T玩家仍可识别',()=>{
  const p=parse('小明：香菜\nT:01各50\nT:02各150\n合计200\n张三：03各10');
  assert.deepEqual(p.issues,[]);
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets]),[['小明',['港']],['小明',['港']],['张三',['新']]]);
  assert.equal(senderHeader('T:01各50'),null);
  assert.equal(senderHeader('T:01各50','T')?.name,'T');
  for(const name of ['Tom','Matt','小香哥','香菜姐姐'])assert.equal(senderHeader(`${name}：01各10`)?.name,name);
  for(const name of ['香香','小香','T'])assert.equal(senderHeader(`${name}：01各10`,name)?.name,name);
  const bound=parse('T：旧01各50\nT：02各10',{defaultPlayer:'T'});
  assert.deepEqual(bound.issues,[]);assert(bound.bets.every(b=>b.player==='T'&&b.markets.join()==='旧'));
  const prose=parse('香味很好\n新年快乐\n其他备注\n01各10');
  assert.deepEqual(prose.issues,[]);assert.deepEqual(prose.bets[0].markets,['新']);
});

test('T提供原文玩法证据和高亮，AI候选继承香菜市场且不能改成其他玩法',()=>{
  const raw='Ｔ：01各50',tokens=highlightText(raw),play=playTokens(raw)[0];
  assert.equal(tokens.map(t=>t.text).join(''),raw);
  assert(tokens.some(t=>t.kind==='play'&&t.text==='Ｔ'));
  assert.equal(play.phrase,'特码');assert.equal(raw.slice(play.start,play.end),'Ｔ');
  assert(!playTokens('Matt:01各50').length);
  for(const e of statementEvidence(raw))assert.equal(raw.slice(e.start,e.end),e.quote);
  const d=doc(source),item=reviewInput(d,'all').items.find(i=>i.line===2);
  assert.deepEqual(item.context.markets,['港']);
  assert(item.preceding.some(p=>p.line===1&&p.body==='香菜'));
  const bet={markets:['港'],play:'特码',selection:'01 13 33 41 49',basis:'每号',amount:'50',evidence:{market:'',play:'T',selection:'01 13 33 41 49',amount:'50'}};
  assert.equal(validateCandidate({bets:[bet]},item,d).totalCents,25000);
  assert.throws(()=>validateCandidate({bets:[{...bet,play:'平码'}]},item,d),/玩法|计费/);
});

test('无关文字不拦计账，旧AI记录失效，真正缺失、冲突及撤改指令仍提示',()=>{
  for(const status of ['failed','pending','review']){
    const d=doc(source);d.assistance=assistanceFor(d,[{line:1,source:'香菜',status,required:true,replacement:'',candidates:[],reason:'缺少金额'}]);
    if(status==='review')d.assistance.version='semantic-20261007-4';
    assert.deepEqual(parseDocument(d.text,d).issues,[],status);
  }
  for(const text of ['香菜\nT:01','香菜\nT:各50','香菜\nT:三中三01 02 03各50','香菜\nT:01各50\n上条取消']){
    const p=parse(text);assert(p.issues.some(i=>i.severity==='error'),text);assert.equal(summarize([p]).totalCents,0,text);
  }
  const odds=defaultOdds();odds.confirmed=true;
  const draw={market:'港',date:'2026-10-08',issue:'2026281',numbers:[2,3,4,5,6,7,1]};
  const settled=settleDocuments([parse(source)],{港:draw},{港:odds},draw.date);
  assert.equal(settled.complete,true);assert.equal(settled.stakeCents,40000);assert.equal(settled.payoutCents,940000);
});
