import test from 'node:test';
import assert from 'node:assert/strict';
import {createReceiptPreferences,RECEIPT_PREFERENCES_KEY} from '../src/receipt-preferences.js';
import {ledgerReceipt,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';

test('账单名开关默认关闭，跨实例和重启读取同一配置，关闭可保存',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const first=createReceiptPreferences(storage);assert.equal(first.showName.value,false);first.setShowName(true);
  const next=createReceiptPreferences(storage);assert.equal(next.showName.value,true);next.setShowName(false);first.reload();assert.equal(first.showName.value,false);
  assert.deepEqual([...values.keys()],[RECEIPT_PREFERENCES_KEY]);
  for(const value of ['broken','null','{"showName":"true"}']){storage.setItem(RECEIPT_PREFERENCES_KEY,value);assert.equal(createReceiptPreferences(storage).showName.value,false);}
});

test('配置保存失败不假装已经保存',()=>{
  const settings=createReceiptPreferences({getItem:()=>null,setItem:()=>{throw new Error('disk full');}});
  assert.throws(()=>settings.setShowName(true),/disk full/);assert.equal(settings.showName.value,false);
});

test('名称开关对多页历史账单生效，原快照金额和名称不改变，内容安全转义',()=>{
  const name='历史账单<&>"名称',document={id:'name-check',name,businessDate:'2026-10-05'};
  const parsed=parseDocument('49各10',document),draws={新:{market:'新',date:document.businessDate,issue:'2026278',numbers:[1,2,3,4,5,6,49]}},odds={新:defaultOdds()};
  const result=settleDocuments([parsed],draws,odds,document.businessDate),inputs={kind:'current',selection:document.id,documents:[parsed],date:document.businessDate,draws,settings:{odds}};
  const before=JSON.stringify({result,inputs}),card=ledgerReceipt({document:{...document,name:'当前改名'},result,inputs,history:true});
  card.rows=Array.from({length:20},(_,i)=>({...card.rows[0],key:String(i)}));
  for(const page of receiptPages(card)){
    const off=receiptSvg(page),on=receiptSvg(page,{showName:true});
    assert(!off.svg.includes('历史账单'));assert(on.svg.includes('历史账单&lt;&amp;&gt;&quot;名称'));assert(!on.svg.includes('当前改名'));
    assert(on.svg.indexOf('历史账单')<on.svg.indexOf('本单开奖'));assert(on.height>off.height);assert(on.svg.includes('data-receipt-name="true"'));
    assert(on.svg.includes('470'));assert.equal(receiptSvg(page,{showName:false}).svg,off.svg);
  }
  assert.equal(JSON.stringify({result,inputs}),before);
  const long=receiptSvg({...card,name:'长'.repeat(200)},{showName:true});assert.equal((long.svg.match(/长/g)||[]).length,200);assert(long.height<5000);
});
