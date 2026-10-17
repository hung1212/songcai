import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationHistory,visitLedger,rememberSearch,sourceSelection,sourceOffsets,sourceResults} from '../src/core/ledger-navigation.js';
import {parseDocument} from '../src/core/parser.js';
test('最近访问去重并保留5个真实账目，按ID跟随改名且不改变手动排序',()=>{
  const docs=Array.from({length:7},(_,i)=>({id:String(i),name:'玩家'+i}));
  let history=navigationHistory(null);for(const d of docs)history=visitLedger(history,d.id,docs);
  assert.deepEqual(history.recent,['6','5','4','3','2']);
  history=visitLedger(history,'3',docs);assert.deepEqual(history.recent,['3','6','5','4','2']);
  docs[3].name='玩家改名';assert.equal(docs.find(d=>d.id===history.recent[0]).name,'玩家改名');
  history=visitLedger(history,'6',docs.filter(d=>d.id!=='3'));assert.deepEqual(history.recent,['6','5','4','2']);
  assert.deepEqual(docs.map(d=>d.id),['0','1','2','3','4','5','6']);
});
test('搜索历史按最近使用排序、去除空白与等价词，保留10条且可持久化恢复',()=>{
  let h=navigationHistory(null);for(let i=0;i<12;i++)h=rememberSearch(h,'玩家'+i);
  assert.equal(h.searches.length,10);assert.equal(h.searches[0],'玩家11');
  h=rememberSearch(h,'  玩家5  ');assert.equal(h.searches[0],'玩家5');assert.equal(h.searches.filter(s=>s==='玩家5').length,1);
  h=rememberSearch(h,'ＡＢＣ');h=rememberSearch(h,'abc');assert.equal(h.searches.filter(s=>/abc|ＡＢＣ/.test(s)).length,1);
  assert.deepEqual(rememberSearch(h,'  '),h);assert.deepEqual(navigationHistory(JSON.parse(JSON.stringify(h))),h);
});
test('损坏的历史本地数据不会导致启动失败',()=>{
  assert.deepEqual(navigationHistory({recent:'bad',searches:[null,5,{},'a','A','']}),{recent:[],searches:['a']});
  assert.deepEqual(navigationHistory(null),{recent:[],searches:[]});
});
test('逻辑行定位支持空行、跨行选区、中文和结尾换行，不将下一行误算入选区',()=>{
  const text='小明：49各10\n\n01 02各20\n';
  const range=sourceOffsets(text,3,3);assert.equal(text.slice(range.start,range.end),'01 02各20');
  assert.deepEqual(sourceSelection(text,0,range.start),{line:1,endLine:2});
  assert.deepEqual(sourceSelection(text,range.start,range.end),{line:3,endLine:3});
  assert.deepEqual(sourceSelection(text,text.length),{line:4,endLine:4});
  assert.equal(sourceOffsets(text,999).line,4);
});
test('同一行多笔及跨行投注全部关联原文，声明行不指向其他投注',()=>{
  const p=parseDocument('新\n4.5各20米29.40各10米\n30.42.43.21.07.\n49.25.13.01.31.各20',{id:'a',businessDate:'2026-10-07'});
  assert.equal(sourceResults(p,1).bets.length,0);
  assert.equal(sourceResults(p,2).bets.length,2);
  const a=sourceResults(p,3),b=sourceResults(p,4);assert.equal(a.bets[0].id,b.bets[0].id);
  assert.equal(sourceResults(p,2,4).bets.length,3);
});
test('待处理原文定位到问题，重复原文用行号而非文本相似度区分',()=>{
  const p=parseDocument('49各10\n49各10\n特肖三中三1 2 100',{id:'a',businessDate:'2026-10-07'});
  assert.notEqual(sourceResults(p,1).bets[0].id,sourceResults(p,2).bets[0].id);
  assert(sourceResults(p,3).issues.length>0);assert.equal(sourceResults(p,3).bets.length,0);
});
