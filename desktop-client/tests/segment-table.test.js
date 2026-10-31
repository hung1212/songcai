import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentTableSvg} from '../src/core/segment-table.js';

test('分段表格只显示段号金额，全部段落不截断，双倍PNG符合原生剪贴板大小限制',()=>{
 for(const count of [1,31,120,121,480]){
  const rows=Array.from({length:count},(_,i)=>({index:i+1,stakeCents:(i+1)*100+5,raw:'不应导出原文',name:'不应导出名字'}));
  const {svg,width,height}=segmentTableSvg(rows);
  assert(width*2<=2560&&height*2<=16000&&width*height*4<=24_000_000);
  assert.equal((svg.match(/font-weight="600"/g)||[]).length,count);
  assert(svg.includes(`>${count}.05</text>`));assert(!svg.includes('不应导出'));
 }
 assert.throws(()=>segmentTableSvg([]),/没有/);
 assert.throws(()=>segmentTableSvg(Array(481).fill({index:1,stakeCents:100})),/复制金额文字/);
});
