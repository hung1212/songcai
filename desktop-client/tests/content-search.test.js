import test from 'node:test';
import assert from 'node:assert/strict';
import {searchLedgerText} from '../src/core/content-search.js';
test('搜索原文重复次数、账目内序号、全局序号与行列精确可定位',()=>{
 const docs=[{id:'a',name:'副号',text:'预备号: \r\n01各10\r\n预备号:预备号\n🐎预备号'},{id:'b',name:'另一个',text:'预备号\n02各20'}],before=JSON.stringify(docs);
 const r=searchLedgerText(docs,'预备号');assert.equal(r.total,5);assert.equal(r.documentCount,2);
 assert.deepEqual(r.matches.map(m=>[m.index,m.documentIndex,m.line,m.column]),[[1,1,1,1],[2,2,3,1],[3,3,3,5],[4,4,4,3],[5,1,1,1]]);
 for(const m of r.matches)assert.equal(docs.find(d=>d.id===m.fileId).text.slice(m.start,m.end),'预备号');
 assert.equal(searchLedgerText([docs[0]],'预备号').total,4);assert.equal(JSON.stringify(docs),before);
});
test('默认不区分大小写，搜索特殊符号按字面量，不匹配相似错别字',()=>{
 const d=[{id:'a',text:'ABC abc a.b [a] 预备号 预报号'}];
 assert.equal(searchLedgerText(d,'abc').total,2);assert.equal(searchLedgerText(d,'abc',{caseSensitive:true}).total,1);
 for(const q of ['a.b','[a]','预备号'])assert.equal(searchLedgerText(d,q).total,1);
 assert.equal(searchLedgerText(d,'').total,0);assert.equal(searchLedgerText(d,'.*').total,0);
});
test('大量结果只限制展示不丢总数，跨行和最新原文使用准确索引',()=>{
 const d={id:'a',text:'预备号\n'.repeat(10005)},r=searchLedgerText([d],'预备号');assert.equal(r.total,10005);assert.equal(r.matches.length,10000);assert(r.truncated);
 const updated=searchLedgerText([{...d,text:'新一行\n预备号\n01各20'}],'预备号\n01');assert.equal(updated.total,1);assert.equal(updated.matches[0].line,2);assert.equal(updated.matches[0].endLine,3);
});
