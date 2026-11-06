import test from 'node:test';
import assert from 'node:assert/strict';
import {createLaunchShortcut,navigationGroups,navigationUrl} from '../src/core/launch-navigation.js';

function setup(){let time=10000,entries=0;const shortcut=createLaunchShortcut({now:()=>time,onUnlock:()=>entries++});return {shortcut,key:(key='o',extra={})=>shortcut.handle({key,...extra}),tick:ms=>{time+=ms;},entries:()=>entries};}
test('five separate O presses unlock once, accepting either case',()=>{
  const s=setup();for(const key of ['o','O','o','O'])s.key(key);assert.equal(s.entries(),0);s.key();assert.equal(s.entries(),1);s.key();assert.equal(s.entries(),1);
});
test('held keys, other keys, modifiers, focus loss and pauses cannot complete a sequence',()=>{
  for(const interrupt of [s=>s.key('x'),s=>s.key('o',{ctrlKey:true}),s=>s.key('o',{altKey:true}),s=>s.key('o',{metaKey:true}),s=>s.key('o',{isComposing:true}),s=>s.shortcut.reset(),s=>s.tick(2001)]){
    const s=setup();for(let i=0;i<4;i++)s.key();interrupt(s);s.key();assert.equal(s.entries(),0);for(let i=0;i<4;i++)s.key();assert.equal(s.entries(),1);
  }
  const held=setup();held.key();for(let i=0;i<20;i++)held.key('o',{repeat:true});assert.equal(held.entries(),0);
});
test('search and editable controls never unlock; a new session starts locked',()=>{
  for(const target of [{isContentEditable:true},{closest:()=>({tagName:'INPUT'})}]){
    const s=setup();for(let i=0;i<4;i++)s.key();for(let i=0;i<5;i++)s.key('o',{target});s.key();assert.equal(s.entries(),0);
  }
  const first=setup();for(let i=0;i<5;i++)first.key();assert.equal(first.entries(),1);const next=setup();next.key();assert.equal(next.entries(),0);
});
test('navigation resolves only curated HTTPS sites or encoded Baidu search',()=>{
  const ids=navigationGroups.flatMap(group=>group.sites.map(([id])=>id));assert.equal(new Set(ids).size,ids.length);
  for(const id of ids)assert.equal(new URL(navigationUrl({siteId:id})).protocol,'https:');
  const query='天气 & #出行 /? javascript:alert(1)';const url=new URL(navigationUrl({query}));assert.equal(url.hostname,'www.baidu.com');assert.equal(url.searchParams.get('wd'),query);assert.equal([...url.searchParams].length,1);
  for(const input of [null,'https://example.com',{url:'file:///C:/Windows'},{siteId:'javascript:alert(1)'},{query:''},{query:' '.repeat(3)},{query:'a'.repeat(201)},{siteId:'__proto__'}])assert.throws(()=>navigationUrl(input));
});
