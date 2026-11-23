import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {settleDocuments,defaultOdds} from '../src/core/settlement.js';
import {receiptText} from '../src/core/receipt-text.js';
const date='2026-11-22';
function fixture(text,configure=()=>{}){
  const document={id:'text-receipt',name:'负责人',businessDate:date,text};
  const parsed={...parseDocument(text,document),originalText:text};
  const inputs={kind:'current',selection:document.id,documents:[parsed],draws:{},settings:{odds:{},rebates:{},playerOdds:{}},verification:{}};
  for(const market of ['新','旧','港']){inputs.draws[market]={market,date,issue:'2026326',numbers:[9,16,22,36,5,47,23]};inputs.settings.odds[market]=defaultOdds();inputs.settings.odds[market].confirmed=true;inputs.verification[market]={confirmed:true};}
  configure(inputs);
  const result=settleDocuments([parsed],inputs.draws,inputs.settings.odds,date,{rebates:inputs.settings.rebates,playerOdds:inputs.settings.playerOdds,drawDates:inputs.drawDates});
  return {document,result,inputs};
}
test('截图同额例：列出具体中奖生肖及组合，退水保留分，应收方向正确',()=>{
  const d=fixture('新23各163\n2连肖羊鸡、鸡虎各30\n3连肖羊鸡狗、虎狗猴各20\n平特兔150\n平特鸡300\n平特猴200\n01各31733',i=>{i.settings.odds.新.rates['flat-zodiac'].rate='2';i.settings.rebates.负责人={perTenThousandCents:30000,playRates:{}};});
  const before=JSON.stringify(d),text=receiptText(d);
  for(const line of ['新澳 · 2026-11-22 · 2026326期','总投注：32646元','特码23：163 × 47 = 7661元','2连肖羊鸡：30 × 4 = 120元','2连肖鸡虎：30 × 4 = 120元','3连肖羊鸡狗：20 × 10.5 = 210元','3连肖虎狗猴：20 × 10.5 = 210元','平特肖兔：150 × 2 = 300元','平特肖鸡：300 × 2 = 600元','平特肖猴：200 × 2 = 400元','中奖合计：9621元','退水：979.38元','合计返还：10600.38元','本单应收：22045.62元'])assert(text.includes(line),line+'\n'+text);
  assert(!text.includes('负责人'));assert(!text.includes('32646.00'));assert.equal(JSON.stringify(d),before);
});
test('重复投注及组选只列实际中奖组合，按完整结算合并，不因顺序重复展示',()=>{
  const d=fixture('2连肖羊鸡虎马各30\n2连肖鸡羊各20\n新23各2\n23各5'),text=receiptText(d);
  assert(text.includes('2连肖羊鸡：50 × 4 = 200元'));assert(!text.includes('2连肖鸡羊：'));
  assert(text.includes('2连肖羊虎：30 × 4 = 120元'));assert(text.includes('2连肖鸡虎：30 × 4 = 120元'));assert(!text.includes('2连肖羊马'));
  assert(text.includes('特码23：7 × 47 = 329元'));assert(text.includes('本单应付：'));
});
test('多市场、分档及玩家独立赔率分别展示',()=>{
  const d=fixture('三边23各10\n平特马猴各5',i=>{i.draws.新.numbers=[1,16,22,36,5,47,23];i.settings.playerOdds.负责人={markets:{新:{rates:{'special-number':{rate:'48'},'flat-zodiac':{rate:'2.1',specialRate:'1.9'}}}}};});
  const text=receiptText(d);
  assert(text.includes('【新澳】特码23：10 × 48 = 480元'));assert(text.includes('【旧澳】特码23：10 × 47 = 470元'));assert(text.includes('【香港】特码23：10 × 47 = 470元'));
  // The last line inherits all three markets, but only New Macau draws 马.
  assert(text.includes('【新澳】平特肖马（马年生肖档）：5 × 1.9 = 9.5元'));
  assert(text.includes('【新澳】平特肖猴：5 × 2.1 = 10.5元'));
});
test('号码组合、可选正特档和连尾使用同一套中奖规则',()=>{
  const d=fixture('二中二09 16 23各10\n特串09 23各5\n3连尾6 2 5各2',i=>{i.settings.odds.新.twoNumberSpecialEnabled=true;i.settings.odds.新.rates['linked-number-2-2-special']={rate:'30'};});
  const text=receiptText(d);assert(text.includes('09、16'));assert(text.includes('正码＋特码'));assert(text.includes('特串09、23'));assert(text.includes('3连尾6尾、2尾、5尾'));
});
test('净赔率、逐注舍入和退回本金保持结算快照金额',()=>{
  const d=fixture('23 23各1',i=>{i.settings.odds.新.includePrincipal=false;i.settings.odds.新.rates['special-number'].rate='1.005';});
  const text=receiptText(d);assert(text.includes('2 × (1.005＋1) = 4.02元'));assert(text.includes('本单应付：2.02元'));
  const refund=fixture('大100',i=>{i.draws.新.numbers=[1,2,3,4,5,6,49];i.settings.odds.新.refund49.attribute=true;});
  assert(receiptText(refund).includes('和局退回本金：100元'));assert(receiptText(refund).includes('本单持平：0元'));
});
test('未中奖、未完成、缺历史数据不得生成虚假确定明细或应收',()=>{
  assert(receiptText(fixture('01各10')).includes('无中奖\n\n中奖合计：0元'));
  const pending=receiptText(fixture('01各10\n包猪各十米'));assert(pending.includes('本单待结算'));assert(!pending.includes('本单应收：'));assert(pending.includes('已算退水'));
  const old=fixture('23各10');delete old.result.entries[0].tiers;const text=receiptText({...old,history:true});assert(text.includes('赔率未留存'));assert(text.includes('中奖合计：470元'));assert(text.includes('明细未展开'));
  const changed=fixture('23各10');changed.document.text='01各999';assert(receiptText(changed).includes('特码23：10 × 47 = 470元'));
});
test('姓名与分段开关按完整快照生成，长组合有限展开但总额完整',()=>{
  const d=fixture('23各10\n\n01各20'),text=receiptText(d,{showName:true,showSegments:true});assert(text.startsWith('负责人\n'));assert(text.endsWith('分段投注：\n1：10\n2：20'));
  const many=fixture('五不中'+Array.from({length:40},(_,i)=>i+1).join(' ')+'各1');const copy=receiptText(many);assert(copy.length<2000);assert(copy.includes('部分组合明细未展开'));assert(copy.includes('本单应收：'));assert(!copy.includes('待结算'));
});
