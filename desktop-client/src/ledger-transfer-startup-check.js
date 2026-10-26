import {nextTick} from 'vue';
import {parseDocument} from './core/parser.js';
import {defaultOdds} from './core/odds.js';
import {specialTransferPlan,specialTransferScenarios} from './core/special-transfer.js';

// Exercises the actual ledger result panel using only the startup check's
// isolated fixtures. No real ledger or outgoing bet is created.
export async function checkLedgerTransferUI(state){
  const {documents,activeId,scope,player,market,tab,numberSort,overviewLoaded,parseAll}=state;
  const refs={documents,activeId,scope,player,market,tab,numberSort,overviewLoaded};
  const saved=Object.fromEntries(Object.entries(refs).map(([key,ref])=>[key,ref.value]));
  const date='2026-10-05';
  const fixture=(id,name,text)=>({id,name,text,businessDate:date,defaultPlayer:'原文署名',autoTitle:false});
  const a=fixture('ledger-transfer-a','转出玩家甲','新01各100\n新02各50\n旧03各10\n特肖虎100');
  const b=fixture('ledger-transfer-b','转出玩家乙','新03各200\n旧04各30');
  const settings={odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),
    playerOdds:{转出玩家甲:{markets:{新:{rates:{'special-number':{rate:'40'}}}}},转出玩家乙:{markets:{新:{rates:{'special-number':{rate:'43'}}}}}},
    rebates:{转出玩家甲:{perTenThousandCents:30000},转出玩家乙:{perTenThousandCents:10000}}};
  const require=(ok,message)=>{if(!ok)throw new Error('单个玩家转出界面：'+message);};
  const panel=()=>document.querySelector('.number-area');
  const hidden=()=>require(!panel().querySelector('[data-transfer-cents],[data-profit-cents]'),'不可用时仍显示旧打出或盈亏金额');
  const click=async selector=>{const element=panel().querySelector(selector);require(element,'缺少控件 '+selector);element.click();await nextTick();};
  const change=async(ref,value)=>{ref.value=value;await nextTick();};
  const check=(docs,id='average-excess')=>{
    const parsed=docs.map(d=>parseDocument(d.text,d));
    const book=specialTransferPlan(parsed,settings,{date:docs[0].businessDate,market:market.value});
    const plan=specialTransferScenarios(book).find(p=>p.id===id);
    require(plan.feasible,'预期方案不可用');
    require(panel().querySelectorAll('[data-transfer-cents]').length===49,'未显示全部49个打出金额');
    require(panel().querySelectorAll('[data-profit-cents]').length===49,'未显示全部49个预计盈亏');
    for(let i=0;i<49;i++){
      const card=panel().querySelector(`[data-number="${i+1}"]`);
      require(Number(card.querySelector('[data-transfer-cents]')?.dataset.transferCents)===plan.transferCents[i],`号码${i+1}打出金额没有跟随当前玩家和市场`);
      require(Number(card.querySelector('[data-profit-cents]')?.dataset.profitCents)===plan.profitCents[i],`号码${i+1}盈亏未使用当前玩家赔率和退水`);
    }
    return book;
  };
  try{
    documents.value=[...saved.documents,a,b];activeId.value=a.id;scope.value='current';tab.value='numbers';parseAll();await nextTick();
    overviewLoaded.value={...saved.overviewLoaded,settings};await nextTick();
    hidden();await click('.transfer-toggle');
    require(market.value==='新','开启时没有选择当前玩家投注最多的市场');
    require(check([a],'maximin').stakeCents===15000,'混入其他玩家或非特码投注');
    require(panel().querySelector('.transfer-summary header').textContent.includes(a.name),'未标明当前玩家');
    await click('.average-transfer-toggle');check([a]);
    require(panel().querySelector('[data-number="1"] [data-transfer-cents]').dataset.transferCents==='9694','超额未包含49个号码，或未保留到分');
    await change(numberSort,'amount-desc');check([a]);await change(numberSort,'zodiac');check([a]);
    await change(market,'旧');require(check([a]).stakeCents===1000,'市场没有隔离');
    await change(market,'');hidden();await change(market,'新');check([a]);

    await change(scope,'all');await change(player,a.name);await click('.average-transfer-toggle');check([a]);
    await change(player,b.name);require(check([b]).stakeCents===20000,'切换玩家仍沿用上一位玩家');
    await change(player,'');require(check([a,b]).stakeCents===35000,'全部玩家范围错误');
    documents.value.find(d=>d.id===b.id).businessDate='2026-10-06';parseAll();await nextTick();hidden();
    require(panel().textContent.includes('多个业务日期'),'混合日期未说明原因');
    await change(player,a.name);check([a]);

    await change(scope,'current');await change(player,'');await click('.average-transfer-toggle');check([a]);
    const current=documents.value.find(d=>d.id===a.id);
    current.text='新01各200\n新02各50\n旧03各10';await nextTick();hidden();
    require(panel().textContent.includes('解析完成后自动重算'),'解析过期仍显示可用方案');
    parseAll();await nextTick();check([current]);
    const oldProfit=Number(panel().querySelector('[data-number="1"] [data-profit-cents]').dataset.profitCents);
    settings.playerOdds.转出玩家甲.markets.新.rates['special-number'].rate='41';
    overviewLoaded.value={...overviewLoaded.value,settings:structuredClone(settings)};await nextTick();check([current]);
    require(Number(panel().querySelector('[data-number="1"] [data-profit-cents]').dataset.profitCents)<oldProfit,'赔率调整未重算净盈亏');
    settings.rebates.转出玩家甲.perTenThousandCents=40000;
    overviewLoaded.value={...overviewLoaded.value,settings:structuredClone(settings)};await nextTick();
    require(check([current]).playerRebateCents===1000,'退水调整未重算');
    overviewLoaded.value=null;await nextTick();hidden();
    overviewLoaded.value={...saved.overviewLoaded,settings};await nextTick();check([current]);
    const target=panel().querySelector('[aria-label="转出目标类型"]');target.value='profit';target.dispatchEvent(new Event('change',{bubbles:true}));
    const percent=panel().querySelector('[aria-label="转出目标百分比"]');percent.value='100';percent.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();hidden();
    require(panel().querySelector('[data-transfer-unavailable]'),'不可达目标未提示');
    await click('.average-transfer-toggle');check([current]);
    await change(activeId,b.id);hidden();await click('.average-transfer-toggle');check([documents.value.find(d=>d.id===b.id)]);
    require(panel().querySelector('.transfer-summary header').textContent.includes(b.name),'切换账目仍显示旧名字');
    documents.value.find(d=>d.id===b.id).text='特肖虎100';parseAll();await nextTick();hidden();
    require(panel().textContent.includes('没有已解析的特码投注'),'无特码时未说明原因');
    await click('.transfer-toggle');require(!panel().querySelector('.transfer-summary'),'关闭方案失败');
    return true;
  }finally{
    for(const [key,ref] of Object.entries(refs))ref.value=saved[key];
    parseAll();await nextTick();
    // The active-ledger watcher clears filters; restore their original values after it.
    market.value=saved.market;player.value=saved.player;await nextTick();
  }
}
