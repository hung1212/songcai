import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {ledgerReceipt,receiptFormula,receiptPages,receiptSvg,receiptFilename,latestNewDrawDate} from '../src/core/ledger-receipt.js';
const date='2026-10-05',document={id:'receipt',name:'测试负责人',businessDate:date};
function fixture(text='49各100\n平特蛇1000\n20各900',configure=()=>{}){
  const parsed=parseDocument(text,{...document}),draw={date,market:'新',issue:'2026278',numbers:[1,2,3,4,5,6,49]};
  const inputs={kind:'current',selection:document.id,date,documents:[parsed],draws:{新:draw,旧:{...draw,market:'旧'},港:{...draw,market:'港'}},settings:{odds:{}},verification:{}};
  for(const m of ['新','旧','港']){inputs.settings.odds[m]=defaultOdds();inputs.settings.odds[m].confirmed=true;inputs.verification[m]={confirmed:true};}
  configure(inputs);
  const result=settleDocuments([parsed],inputs.draws,inputs.settings.odds,date,{drawDates:inputs.drawDates});
  return {document,inputs,result};
}
test('本账目示例总2000、特码100×47、平特肖1000×2.05，赔付6750且盈4750',()=>{
  const card=ledgerReceipt(fixture());assert.equal(card.stakeCents,200000);assert.equal(card.payoutCents,675000);assert.equal(card.netCents,475000);assert.equal(card.netLabel,'盈');assert.equal(card.status,'complete');
  assert.deepEqual(card.rows.map(r=>[r.play,receiptFormula(r),r.payoutCents]),[['特码','100 × 47',470000],['平特肖','1,000 × 2.05',205000]]);
  const svg=receiptSvg(receiptPages(card)[0]);assert(svg.svg.includes('4,750'));assert(svg.svg.includes('6,750'));assert(!svg.svg.includes('测试负责人'));
});
test('部分中奖、重复下注、同玩法不同市场或生肖档位分别核算',()=>{
  const card=ledgerReceipt(fixture('两边49 49 20各10\n新平特马蛇各100',i=>{i.settings.odds.旧.rates['special-number'].rate='48';}));
  assert.equal(card.stakeCents,26000);assert.equal(card.rows.length,4);
  assert.deepEqual(card.rows.filter(r=>r.play==='特码').map(r=>[r.market,r.stakeCents,r.rate,r.payoutCents]),[['新',2000,'47',94000],['旧',2000,'48',96000]]);
  assert.deepEqual(card.rows.filter(r=>r.play==='平特肖').map(r=>r.rate).sort(),['1.8','2.05']);
});
test('同市场同玩法同赔率合并中奖金额，三中二不同中奖档位不合并',()=>{
  const card=ledgerReceipt(fixture('49各10\n49各20'));assert.equal(card.rows.length,1);assert.equal(card.rows[0].stakeCents,3000);assert.equal(card.rows[0].payoutCents,141000);
  const mixed=ledgerReceipt(fixture('三中二01 02 03 20各10',i=>{i.settings.odds.新.rates['three-two'].rate='20';i.settings.odds.新.rates['three-three'].rate='90';}));
  assert.equal(mixed.rows.length,2);assert.deepEqual(mixed.rows.map(r=>r.detail).sort(),['中三正码','中二正码']);assert.equal(mixed.payoutCents,150000);
});
test('净赔率另返本金、逐注舍入取真实赔付，不重算汇总乘积',()=>{
  const net=ledgerReceipt(fixture('49各100',i=>{i.settings.odds.新.includePrincipal=false;}));assert.equal(receiptFormula(net.rows[0]),'100 × (47＋1)');assert.equal(net.payoutCents,480000);
  const rounded=ledgerReceipt(fixture('49 49各1',i=>{i.settings.odds.新.rates['special-number'].rate='1.005';}));assert.equal(rounded.rows[0].stakeCents,200);assert.equal(rounded.payoutCents,202);assert.equal(rounded.netCents,2);
});
test('亏、持平、和局退本金、缺开奖及真实原文错误各自显示正确状态',()=>{
  const lost=ledgerReceipt(fixture('20各100'));assert.equal(lost.netLabel,'亏');assert.equal(lost.netCents,-10000);assert.equal(lost.rows.length,0);
  const refund=ledgerReceipt(fixture('大100',i=>{i.settings.odds.新.refund49.attribute=true;}));assert.equal(refund.netLabel,'持平');assert.equal(refund.refundCents,10000);assert.equal(refund.payoutCents,10000);assert.equal(refund.rows.length,0);
  for(const data of [fixture('49各100',i=>{delete i.draws.新;}),fixture('49各100\n特码99各10')]){const card=ledgerReceipt(data);assert.equal(card.status,'pending');assert.equal(card.netCents,null);assert.equal(card.netLabel,'待结算');assert(card.warnings.length);}
  const empty=ledgerReceipt(fixture(''));assert.equal(empty.status,'empty');assert.equal(empty.netCents,0);
});
test('未核对赔率或开奖仍标试算，历史使用当时账名赔率和快照',()=>{
  for(const field of ['odds','draw']){const data=fixture('49各100',i=>{if(field==='odds')i.settings.odds.新.confirmed=false;else i.verification.新.confirmed=false;});assert.equal(ledgerReceipt(data).status,'trial');}
  const old=fixture();old.document={...document,name:'修改后的名称'};
  const card=ledgerReceipt({...old,history:true});assert.equal(card.name,'测试负责人');assert.equal(card.history,true);assert.equal(card.payoutCents,675000);
});
test('旧记录缺赔率时不捏造倍数，错账目和不一致的赔付拒绝生成',()=>{
  const old=fixture('49各100');delete old.result.entries[0].tiers;delete old.result.entries[0].unitCents;
  const card=ledgerReceipt(old);assert.equal(card.status,'trial');assert.equal(card.rows[0].stakeCents,10000);assert.equal(card.rows[0].payoutCents,470000);assert.match(receiptFormula(card.rows[0]),/赔率未留存/);
  const other=fixture();other.document={...document,id:'someone-else'};assert.throws(()=>ledgerReceipt(other),/当前账目/);
  const corrupt=fixture();corrupt.result.payoutCents++;assert.throws(()=>ledgerReceipt(corrupt),/汇总不一致/);
});
test('长名称不进入截图，明细安全转义，多页保留全单总额和页码',()=>{
  const card=ledgerReceipt(fixture());card.name='负责人的特别长账目名字'.repeat(5)+'<&"';
  card.rows=Array.from({length:45},(_,i)=>({...card.rows[0],play:'特码<&"',key:String(i)}));
  const pages=receiptPages(card);assert.deepEqual(pages.map(p=>p.rows.length),[18,18,9]);assert(pages.every(p=>p.stakeCents===200000&&p.payoutCents===675000));
  for(const page of pages){const {svg,height}=receiptSvg(page);assert(svg.includes('&lt;&amp;&quot;'));assert(height>1000&&height<5000);assert(svg.includes(`${page.page}/3`));assert(!svg.includes('负责人'));assert(!/[<>|"/\\]/.test(receiptFilename(page)));}
});
test('文件名日期保留最近新澳开奖，图片只显示实际参与市场的开奖日期',()=>{
  const settings={sources:{新:['macaujc-new']}};
  const records=[{market:'新',date:'2026-10-06',sourceId:'macaujc-new'},{market:'新',date:'2026-10-07',sourceId:'manual'},
    {market:'新',date:'2026-10-08',sourceId:'pengsai-new'}, // Disabled source.
    {market:'港',date:'2026-10-08',sourceId:'manual'},{market:'新',date:'2026-10-09',sourceId:'manual'}];
  const latestNewDate=latestNewDrawDate(records,settings,'2026-10-08');assert.equal(latestNewDate,'2026-10-07');
  const data=fixture('香港49各100'),before=JSON.stringify(data);
  const card=ledgerReceipt({...data,latestNewDate,history:true});assert.equal(card.date,'2026-10-07');assert.equal(card.payoutCents,470000);assert.equal(JSON.stringify(data),before);
  const {svg}=receiptSvg(receiptPages(card)[0]);assert(!svg.includes('开奖日期'));assert(!svg.includes('2026-10-07'));assert(svg.includes('2026-10-05 · 第2026278期'));
});
test('紧凑截图不显示标题、名称、试算与底部说明；缺开奖记录不借用账单日期',()=>{
  const card=ledgerReceipt({...fixture('49各100',i=>{i.verification.新.confirmed=false;}),latestNewDate:''});
  const {svg}=receiptSvg(receiptPages(card)[0]);assert.equal(card.status,'trial');assert.equal(card.date,'');
  for(const text of ['账目结算单','测试负责人','试算','账目日期','开奖尚未完成核对','松财','四舍五入','不代表已付款'])assert(!svg.includes(text),text);
  assert(!svg.includes('开奖日期'));assert(svg.includes('4,700'));assert(svg.includes('+4,600'));
  assert.equal(latestNewDrawDate([],{},'2026-10-08'),'');
});

test('中奖明细用新澳旧澳香港，三市场各显示一期完整号码且顺序和特码不变',()=>{
  const data=fixture('三边49各10',i=>{
    i.draws.旧={...i.draws.旧,issue:'2026279',numbers:[7,12,19,23,8,48,49]};
    i.draws.港={...i.draws.港,issue:'26/105',numbers:[31,23,34,43,29,8,49]};
  }),original=JSON.stringify(data),card=ledgerReceipt(data),{svg}=receiptSvg(receiptPages(card)[0]);
  assert.equal(JSON.stringify(data),original);
  assert.deepEqual(card.markets.map(m=>m.market),['新','旧','港']);
  for(const [market,name] of [['新','新澳'],['旧','旧澳'],['港','香港']]){
    const m=card.markets.find(v=>v.market===market);
    assert.equal(m.drawState,'available');assert.deepEqual(m.balls.map(b=>Number(b.number)),data.inputs.draws[market].numbers);
    assert.deepEqual(m.balls.map(b=>b.special),[false,false,false,false,false,false,true]);
    assert.equal((svg.match(new RegExp(`data-draw-market="${market}"`,'g'))||[]).length,1);
    assert(svg.includes(`>${name}</text>`));assert(!svg.includes(`${market}市场`));
  }
  assert.equal(card.markets[0].balls[0].wave,'红');assert.equal(card.markets[0].balls[2].wave,'蓝');assert.equal(card.markets[0].balls[4].wave,'绿');
  assert(svg.includes('2026-10-05 · 第26/105期'));assert.equal((svg.match(/aria-label="特码 /g)||[]).length,3);
});

test('只投香港就只显示香港开奖，未中奖的市场也保留，空账目不显示无关开奖',()=>{
  const card=ledgerReceipt(fixture('香港20各100')),{svg}=receiptSvg(receiptPages(card)[0]);
  assert.deepEqual(card.markets.map(m=>m.market),['港']);assert.equal(card.rows.length,0);
  assert(svg.includes('本单开奖'));assert(svg.includes('>香港</text>'));assert(!svg.includes('新澳'));assert(!svg.includes('旧澳'));
  assert(svg.indexOf('本单开奖')<svg.indexOf('总 · 投注金额'));
  assert(svg.includes('无中奖记录'));assert(svg.includes('特码 49'));
  const mixed=ledgerReceipt(fixture('新49各10\n香港20各100'));assert.deepEqual(mixed.rows.map(r=>r.market),['新']);assert.deepEqual(mixed.markets.map(m=>m.market),['新','港']);
  const empty=receiptSvg(receiptPages(ledgerReceipt(fixture('')))[0]);assert(!empty.svg.includes('本单开奖'));
});

test('开奖缺失或不完整时显示真实状态，不用其他市场或最近日期补造号码',()=>{
  for(const broken of [null,{market:'港',date,issue:'26/105',numbers:[1,2,3]}]){
    const card=ledgerReceipt({...fixture('香港49各100',i=>{i.draws.港=broken;}),latestNewDate:'2026-10-08'});
    const m=card.markets[0],{svg}=receiptSvg(receiptPages(card)[0]);
    assert.equal(m.drawState,broken?'incomplete':'missing');assert.deepEqual(m.balls,[]);
    assert(svg.includes(broken?'开奖资料不完整':'暂无开奖'));assert(!svg.includes('aria-label="特码'));
    assert(!svg.includes('开奖日期'));assert(!svg.includes('2026-10-08'));assert(svg.includes('>香港</text>'));
  }
});

test('生肖按本市场开奖日期跨农历年切换，历史号码不受最新新澳日期影响',()=>{
  for(const [drawDate,issue,animal] of [['2026-02-16','2026047','蛇'],['2026-02-17','2026048','马']]){
    const data=fixture('香港01各10',i=>{i.draws.港={...i.draws.港,date:drawDate,issue,numbers:[2,3,4,5,6,7,1]};i.drawDates={港:drawDate};});
    const card=ledgerReceipt({...data,history:true,latestNewDate:'2026-10-08'});
    assert.equal(card.markets[0].date,drawDate);assert.equal(card.markets[0].balls[6].animal,animal);assert.equal(card.markets[0].balls[6].special,true);
    const svg=receiptSvg(receiptPages(card)[0]).svg;assert(svg.includes(`特码 01，红波，${animal}`));
    data.inputs.draws.港.numbers[6]=49;
    assert.equal(card.markets[0].balls[6].number,'01');assert.equal(card.payoutCents,47000);
  }
});

test('多页截图保留本单全部市场开奖，号码区不会被明细分页切掉',()=>{
  const card=ledgerReceipt(fixture('三边49各10'));
  card.rows=Array.from({length:40},(_,i)=>({...card.rows[i%3],key:String(i)}));
  for(const page of receiptPages(card)){
    const {svg,height}=receiptSvg(page);
    assert.deepEqual(page.markets,card.markets);assert.equal((svg.match(/data-draw-market=/g)||[]).length,3);
    assert.equal((svg.match(/aria-label="特码 /g)||[]).length,3);assert(height*2<16000&&640*2*height*2<24000000);
    assert(svg.includes('赔付合计'));assert(svg.includes('玩家净输赢'));
  }
});
