import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {leadingIssuePrefix,statementEvidence} from '../src/core/business-syntax.js';
import {reviewInput,validateCandidate,validateReply,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {highlightText} from '../src/core/highlight.js';

const source='285新澳三中三：01、10、18、21、28、31、41、49每组3';
const values=[1,10,18,21,28,31,41,49];
const doc=(text=source)=>({id:'issue-prefix',name:'测试',text,businessDate:'2026-10-12',defaultPlayer:''});
const parse=(text=source)=>parseDocument(text,doc(text));
const valid=(text=source)=>{const p=parse(text);assert.deepEqual(p.issues,[],text);assert.deepEqual(reviewInput(doc(text)).items,[],text);return p;};

test('285新澳行首期号忽略，八号三中三56组各3元共168元，原文保留',()=>{
  const p=valid(),b=p.bets[0];assert.equal(p.bets.length,1);
  assert.deepEqual([b.playType,b.basis,b.size,b.count,b.unitCents,b.totalCents],['linked-number-3-3','每组',3,56,300,16800]);
  assert.deepEqual(b.values,values);assert.deepEqual(b.markets,['新']);assert.equal(b.raw,source);assert.equal(b.line,1);assert.equal(b.endLine,1);
  assert.equal(summarize([p]).totalCents,16800);assert.equal(senderHeader(source),null);
  assert.deepEqual(p.metadata.find(m=>m.kind==='期号备注'),{line:1,text:'285',kind:'期号备注',ruleId:'R37',ignored:true});
  assert(!p.metadata.some(m=>m.kind==='发送人'||m.kind==='期号'));
});

test('期号前后空格、全角、标点及市场别名等价，前导零保留',()=>{
  for(const text of ['２８５新澳三中三：01、10、18、21、28、31、41、49每组３',' 285 新奥三中三01 10 18 21 28 31 41 49每组3','285，新澳三中三01 10 18 21 28 31 41 49每组3','285：新澳三中三01 10 18 21 28 31 41 49每组3','285.新澳三中三01 10 18 21 28 31 41 49每组3']){
    const b=valid(text).bets[0];assert.deepEqual(b.values,values,text);assert.equal(b.totalCents,16800);assert.equal(b.raw,text);assert.equal(senderHeader(text),null);
  }
  for(const [label,market] of [['旧澳','旧'],['老澳','旧'],['香港','港'],['港','港'],['澳','新'],['奥','新']]){
    const p=valid(`001${label}01各10`);assert.deepEqual(p.bets[0].markets,[market]);assert.equal(p.metadata.find(m=>m.kind==='期号备注').text,'001');
  }
});

test('发送人后的期号仍属当前玩家，市场标题重置玩法，后续市场继承',()=>{
  const p=valid('小明：旧平特牛各10\n285新澳三中三01 10 18每组3\n285香港33 34各5\n36各5\n张三：285旧澳01各10');
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets,b.playType,b.totalCents]),[
    ['小明',['旧'],'flat-zodiac',1000],['小明',['新'],'linked-number-3-3',300],['小明',['港'],'special-number',1000],
    ['小明',['港'],'special-number',500],['张三',['旧'],'special-number',1000],
  ]);
  assert.equal(valid('285香港\n三中三01 10 18每组3').bets[0].markets.join(),'港');
  assert.equal(valid('285两边01各10').bets[0].totalCents,2000);
  const named=valid('285新澳玩家：01各10');assert.equal(named.bets[0].player,'285新澳玩家');assert(!named.metadata.some(m=>m.kind==='期号备注'));
});

test('不吞掉一两位投注号码、内部非法号、非市场前缀或长数字，金额285仍为金额',()=>{
  const normal=valid('01新澳02各5');assert.deepEqual(normal.bets[0].values,[1,2]);assert.equal(normal.bets[0].totalCents,1000);
  const amount=valid('新澳三中三01 10 18每组285');assert.equal(amount.bets[0].unitCents,28500);
  for(const text of ['285三中三01 10 18每组3','1234新澳01各10','新澳三中三285 01 02每组3','三中三01 10 18 285新澳每组3']){
    assert.equal(leadingIssuePrefix(text),null,text);const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
  const money=parse('285元新澳01各10');assert(money.issues.length);assert(!money.metadata.some(m=>m.kind==='期号备注'));
  assert.deepEqual(money.bets[0].values,[1]);
});

test('期号备注不自动绑定所选开奖，显式第几期的原校验保持',()=>{
  const odds={...defaultOdds(),confirmed:true};
  const draw={market:'新',date:doc().businessDate,issue:'2026001',numbers:[1,10,18,2,3,4,49]};
  const r=settleDocuments([valid()],{新:draw},{新:odds},draw.date);
  assert.equal(r.complete,true);assert.equal(r.stakeCents,16800);assert.equal(r.payoutCents,195000);
  const explicit=parse('第285期新澳01各10');assert(explicit.metadata.some(m=>m.kind==='期号'));
  assert.equal(settleDocuments([explicit],{新:draw},{新:odds},draw.date).entries[0].status,'pending');
});

test('AI证据把285标为期号而非选号，保留原八号和3元单价',()=>{
  const d=doc(),item=reviewInput(d,'all').items[0],selection='01、10、18、21、28、31、41、49';
  const b={markets:['新'],play:'三中三',selection,basis:'每组',amount:'3',evidence:{market:'新澳',play:'三中三',selection,amount:'每组3'}};
  const candidate={bets:[b]},r=validateCandidate(candidate,item,d);assert.deepEqual(r.bets[0].values,values);assert.equal(r.totalCents,16800);
  assert.equal(validateReply({items:[{line:1,candidates:[candidate]}]},[item],d)[0].status,'agree');
  assert(item.evidence.some(t=>t.field==='issue'&&t.quote==='285'));
  assert(!item.evidence.some(t=>['selection','amount'].includes(t.field)&&t.start<3));
  assert.throws(()=>validateCandidate({bets:[{...b,selection:'02 08 05 '+selection}]},item,d),/选号|改变/);
  assert.throws(()=>validateCandidate({bets:[{...b,amount:'285',evidence:{...b.evidence,amount:'285'}}]},item,d),/改变|金额/);
});

test('原文高亮保留期号为普通文字，全角和玩家前缀偏移准确',()=>{
  for(const text of [source,'小明：'+source,'２８５新澳三中三：01 10 18每组３']){
    const tokens=highlightText(text);assert.equal(tokens.map(t=>t.text).join(''),text);
    assert(!tokens.some(t=>t.kind&&/285|２８５/.test(t.text)));
    assert(tokens.some(t=>t.kind==='selection'&&t.text.includes('01')));
    const body=senderHeader(text)?.body||text,e=statementEvidence(body);assert.equal(e.find(t=>t.field==='issue').start,0);
  }
});

test('旧越界待处理与AI失败解释失效，升级后直接计入168元',()=>{
  for(const status of ['failed','review','accepted']){
    const d=doc();d.parserVersion='parser-20261011-3';
    d.assistance={...assistanceFor(d,[{line:1,source,status,replacement:status==='accepted'?'新澳三中三02 08 05 01 10 18 21 28 31 41 49每组3':''}]),version:'semantic-20261011-3'};
    const next=upgradeDocument(d),p=parseDocument(next.text,next);assert.equal(next.text,source);assert.deepEqual(p.issues,[]);
    assert.equal(summarize([p]).totalCents,16800);assert.deepEqual(currentReviewItems(next),[]);
  }
});
