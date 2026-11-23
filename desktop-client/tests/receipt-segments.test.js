import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {settleDocuments,defaultOdds} from '../src/core/settlement.js';
import {ledgerReceipt,receiptSegmentRows,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {createReceiptPreferences} from '../src/receipt-preferences.js';
function fixture(count=3){
 const document={id:'segments-receipt',name:'负责人',businessDate:'2026-11-11',text:Array.from({length:count},(_,i)=>`新49各${i+1}`).join('\n\n')};
 const parsed={...parseDocument(document.text,document),originalText:document.text};
 const draws={新:{market:'新',date:document.businessDate,issue:'2026315',numbers:[1,2,3,4,5,6,49]}},odds={新:defaultOdds()};
 const result=settleDocuments([parsed],draws,odds,document.businessDate);
 const inputs={kind:'current',selection:document.id,documents:[parsed],draws,settings:{odds}};
 return {document,inputs,result};
}
test('附表默认关闭；开启后在盈亏后显示全部段号金额，使用快照不混入当前编辑内容',()=>{
 const data=fixture(),before=JSON.stringify(data),card=ledgerReceipt(data);
 card.segmentRows=receiptSegmentRows(data.inputs,data.result);
 assert.deepEqual(card.segmentRows,[{index:1,stakeCents:100},{index:2,stakeCents:200},{index:3,stakeCents:300}]);
 assert(!receiptSvg(receiptPages(card)[0]).svg.includes('段号'));
 const on=receiptSvg(receiptPages(card,{showSegments:true})[0],{showSegments:true});
 assert(on.svg.indexOf('data-receipt-segments')>on.svg.indexOf('玩家净输赢'));
 assert(on.svg.includes('段号')&&on.svg.includes('投注金额'));
 assert.equal(JSON.stringify(data),before);
 data.document.text='新49各9999';
 assert.deepEqual(receiptSegmentRows(data.inputs,data.result),card.segmentRows);
 delete data.inputs.documents[0].originalText;
 assert.throws(()=>receiptSegmentRows(data.inputs,data.result),/未保存分段原文/);
});
test('分段金额或原文与结算不一致时不生成错误附表',()=>{
 const data=fixture();data.result.stakeCents++;
 assert.throws(()=>receiptSegmentRows(data.inputs,data.result),/不一致/);
 const other=fixture();other.inputs.documents[0].originalText='新49各1';
 assert.throws(()=>receiptSegmentRows(other.inputs,other.result),/行号/);
});
test('长表接续分页不漏段不重复，所有图片符合高清导出限制',()=>{
 const data=fixture(481),card=ledgerReceipt(data);card.segmentRows=receiptSegmentRows(data.inputs,data.result);
 const pages=receiptPages(card,{showSegments:true,showPlayStakes:true,showName:true});
 assert(pages.length>1);
 assert.deepEqual(pages.flatMap(p=>p.segmentRows),card.segmentRows);
 for(const p of pages){
  const image=receiptSvg(p,{showSegments:true,showPlayStakes:true,showName:true});
  assert(image.height*2<=16000&&image.width*image.height*4<=24_000_000);
  assert.equal(p.stakeCents,card.stakeCents);
 }
});
test('附表选项独立保存，重启恢复，失败时保留原选项',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const p=createReceiptPreferences(storage);assert.equal(p.showSegments.value,false);
 p.setShowSegments(true);p.setShowName(true);p.setShowPlayStakes(true);
 const next=createReceiptPreferences(storage);assert.equal(next.showSegments.value,true);
 next.setShowSegments(false);assert.equal(next.showName.value,true);assert.equal(next.showPlayStakes.value,true);
 const failed=createReceiptPreferences({...storage,setItem:()=>{throw new Error('disk full');}});
 assert.throws(()=>failed.setShowSegments(true),/disk full/);assert.equal(failed.showSegments.value,false);
});
