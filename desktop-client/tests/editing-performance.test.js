import test from 'node:test';
import assert from 'node:assert/strict';
import {createParseCache,parseLedger} from '../src/core/parse-cache.js';
import {createEditorHighlighter} from '../src/core/editor-highlight.js';
import {highlightText} from '../src/core/highlight.js';
import {highlightRows} from '../src/core/workspace.js';

const doc=(id,text='新01各10')=>({id,name:id,text,businessDate:'2026-10-21',defaultPlayer:''});
test('editing one ledger parses only that ledger; reorder retains results; removed ledgers are evicted',()=>{
  let calls=0;
  const cache=createParseCache(d=>{calls++;return parseLedger(d);}),a=doc('a'),b=doc('b');
  const first=cache.read([a,b]);assert.equal(calls,2);
  a.text='香港02各20';const next=cache.read([b,a]);
  assert.equal(calls,3);assert.equal(next.results[0],first.results[1]);
  assert.deepEqual(next.results[1],parseLedger(a));
  cache.read([a]);cache.read([a,b]);assert.equal(calls,4);
  for(const [field,value] of [['businessDate','2027-02-07'],['defaultPlayer','小明'],['name','新标题'],['assistance',{}],['parserReview',{}]]){
    a[field]=value;assert.deepEqual(cache.missing([a,b]),[a]);cache.read([a,b]);
  }
});
test('worker results and synchronous parsing have identical accounting and inherited context',()=>{
  const cache=createParseCache(),documents=[doc('a','香港\n01各10\n02各20\n\n03各30'),doc('b','二连肖马拖兔羊猪各20')];
  cache.accept(documents,documents.map(parseLedger));assert.deepEqual(cache.missing(documents),[]);
  assert.deepEqual(cache.read(documents).results,documents.map(parseLedger));
  documents[0].text='旧澳\n01各10\n02各20';assert.equal(cache.missing(documents).length,1);
  assert.deepEqual(cache.read(documents).results[0],parseLedger(documents[0]));
});
test('editing one of 3000 highlighted lines tokenizes only the changed line',()=>{
  let calls=0;const highlight=createEditorHighlighter((...args)=>{calls++;return highlightText(...args);});
  const lines=Array.from({length:3000},(_,i)=>`第${i}条：新01各10`);
  const before=highlight(lines.join('\n'));assert.equal(calls,3000);
  lines[1500]='新02各20';const after=highlight(lines.join('\n'));
  assert.equal(calls,3001);assert.equal(after[1499],before[1499]);assert.notEqual(after[1500],before[1500]);
  assert.deepEqual(after[1500],highlightRows(highlightText(lines[1500]))[0]);
});
test('cached highlighting preserves blank rows, player and multiline selection amount semantics',()=>{
  const highlight=createEditorHighlighter();
  for(const player of ['', '小明'])for(const selected of [[],[2]]){
    const text='小明：旧01各10\n14.41.23\n各5\n\n包鸡每号100\n';
    assert.deepEqual(highlight(text,player,selected),highlightRows(highlightText(text,player,selected)));
  }
});
