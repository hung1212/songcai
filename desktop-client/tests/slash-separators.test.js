import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {reviewInput,assistanceFor} from '../src/core/ai-review.js';
import {highlightText} from '../src/core/highlight.js';
import {formatBetLines} from '../src/core/text-format.js';

const doc=text=>({id:'slash',name:'测试账目',text,businessDate:'2026-10-05',defaultPlayer:''});
const parse=text=>parseDocument(text,doc(text));
const valid=text=>{const p=parse(text);assert.deepEqual(p.issues,[],text);return p;};
const screenshot=String.raw`新澳平特5尾60米，

老澳特\05+14+23+32+41各号6米

香港特：05+14+23+32+41各号5米`;

test('截图原文三笔均入账，反斜杠不引发解析或AI待处理',()=>{
  const p=valid(screenshot),s=summarize([p]);
  assert.equal(p.bets.length,3);assert.deepEqual(s.markets,{新:6000,旧:3000,港:2500});assert.equal(s.totalCents,11500);
  assert.equal(p.bets[0].playType,'flat-tail');assert.deepEqual(p.bets[0].values,[5]);
  assert.equal(p.bets[1].playType,'special-number');assert.deepEqual(p.bets[1].values,[5,14,23,32,41]);
  assert.equal(p.bets[1].unitCents,600);assert.equal(p.bets[1].raw,screenshot.split('\n')[2]);
  assert.equal(new Set(p.bets.map(b=>b.playerId)).size,1);assert.equal(reviewInput(doc(screenshot),'doubt').items.length,0);
  assert.equal(highlightText(screenshot).map(t=>t.text).join(''),screenshot);assert.equal(formatBetLines(screenshot),screenshot);
});

test('正反斜杠、转义斜杠、重复和全角形式都保留五个号码而不拼接',()=>{
  for(const slash of ['/', '\\', '\\/', '//', '\\\\', '／', '＼', '﹨']) {
    const text=`老澳特${slash}05${slash}14${slash}23${slash}32${slash}41各号6米${slash}`;
    const p=valid(text),b=p.bets[0];assert.equal(p.bets.length,1);assert.equal(b.totalCents,3000);
    assert.deepEqual(b.markets,['旧']);assert.deepEqual(b.values,[5,14,23,32,41]);assert.equal(b.raw,text);
  }
  const repeated=valid(String.raw`特码08\32\/08各20`).bets[0];assert.deepEqual(repeated.values,[8,32,8]);assert.equal(repeated.totalCents,6000);
});

test('业务冒号与市场、玩法标题旁的反斜杠不能误当玩家或选号',()=>{
  assert.equal(senderHeader(String.raw`老澳特\：05+14各6`),null);
  const p=valid(String.raw`小明：新01各10
香港\
\/特\/
05\14各6
\/`);
  assert.deepEqual(p.bets.map(b=>[b.player,b.markets.join(),b.totalCents]),[['小明','新',1000],['小明','港',1200]]);
  assert.equal(valid(String.raw`老澳特\：05+14各6`).bets[0].totalCents,1200);
  assert.deepEqual(valid(String.raw`\/
\\
//`).bets,[]);
});

test('反斜杠仍保留连码显式分组，不擅自合成复式',()=>{
  for(const text of [String.raw`三中三01\02\03 04\05\06各10`,String.raw`三中三(01\02\03)\/(04\05\06)各10`]) {
    const b=valid(text).bets[0];assert.equal(b.mode,'groups');assert.equal(b.count,2);assert.deepEqual(b.groups,[[1,2,3],[4,5,6]]);assert.equal(b.totalCents,2000);
  }
});

test('斜杠不能用于猜金额、忽略越界号码或绕过玩法矛盾',()=>{
  for(const text of [String.raw`老澳特\05\50各6`,String.raw`特码05各1\2米`,String.raw`特码05各1/2`,String.raw`特肖\三中三1 2 100`]) {
    const p=parse(text);assert(p.issues.some(i=>i.severity==='error'),text);assert.equal(summarize([p]).totalCents,0);
  }
  const separated=valid(String.raw`特码05各1 \/ 06各2米`);
  assert.equal(separated.bets.length,2);assert.equal(summarize([separated]).totalCents,300);
});

test('旧AI失败或待确认不再阻塞已明确的分隔符原文',()=>{
  for(const status of ['failed','pending','review']) {
    const d=doc(screenshot);d.assistance={...assistanceFor(d,[{line:3,source:screenshot.split('\n')[2],replacement:'',status,required:true}]),version:'semantic-20261006-2'};
    const p=parseDocument(d.text,d);assert.deepEqual(p.issues,[]);assert.equal(summarize([p]).totalCents,11500);
  }
});
