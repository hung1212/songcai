import {createApp,h,nextTick,ref} from 'vue';
import SettlementPage from './components/SettlementPage.vue';
import RebateSettings from './components/RebateSettings.vue';
import {parseDocument} from './core/parser.js';
import {SPACE_CONTEXT} from './space-context.js';
import {ledgerReceipt,receiptPages,receiptSvg} from './core/ledger-receipt.js';
import {receiptPng,exportReceiptImage} from './receipt-image.js';

// Only called with the packaged startup check's temporary SQLite directory.
export async function checkRebateUI(context,project,input){
  const api=context.api.settlement,original=(await api.load({date:input.date})).settings;
  const host=document.createElement('div');host.hidden=true;document.body.append(host);
  const owner=project.documents[0].name;
  const legacy=`document:${project.documents[0].id}:player`;
  await api.settings({...original,rebates:{...original.rebates,[legacy]:{name:`本单玩家（${owner}）`,perTenThousandCents:10000},小明:{perTenThousandCents:990000}}});
  const documents=[...project.documents.map(d=>parseDocument(d.text,d)),parseDocument('',{id:'rebate-empty',name:'张三',businessDate:input.date})];let component;
  const app=createApp({render:()=>h(RebateSettings,{ref:value=>component=value,documents,active:true})});
  app.provide(SPACE_CONTEXT,context);app.mount(host);
  const dailyActive=ref(true);
  const dailyHost=document.createElement('div');dailyHost.hidden=true;document.body.append(dailyHost);let daily;
  const wait=async predicate=>{for(let i=0;i<100;i++){await nextTick();if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw new Error('退水界面检查超时：'+host.querySelector('[role="alert"]')?.textContent);};
  const field=(label,value)=>{const element=host.querySelector(`[aria-label="${label}"]`);if(!element||element.disabled)throw new Error('缺少可编辑退水项：'+label);element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));};
  const person=id=>host.querySelector(`[data-player-id="${id}"]`).click();
  const save=async()=>{await nextTick();await component.flush();await nextTick();};
  try{
    if(!document.querySelector('.app-navigation [aria-label="玩家退水"]'))throw new Error('缺少独立退水菜单');
    await wait(()=>host.querySelector(`[data-player-id="${owner}"]`)&&!host.querySelector('.rebate-save').textContent.includes('处理中'));
    person(`${owner}`);await nextTick();field(`${owner}每万元退水`,'100');await nextTick();
    if(!host.querySelector('.rebate-default').textContent.includes('1%'))throw new Error('默认退水率未显示');
    await save();if((await api.preview(input)).result.rebateCents!==500)throw new Error('旧默认退水口径不兼容');
    field(`${owner} 特码（逐号）每万元退水`,'50');field(`${owner} 特肖／一肖中特每万元退水`,'200');await nextTick();
    person('张三');await nextTick();field('张三每万元退水','100');await nextTick();person(`${owner}`);await nextTick();
    if(host.querySelector(`[aria-label="${owner} 特码（逐号）每万元退水"]`).value!=='50')throw new Error('切换玩家丢失草稿');
    field('搜索退水玩家','张三');await nextTick();if(host.querySelectorAll('.rebate-player').length!==1)throw new Error('玩家搜索无效');field('搜索退水玩家','');await save();
    const preview=await api.preview(input);if(preview.result.players.length!==1||preview.result.turnoverCents!==50000||!preview.result.entries.every(e=>e.playerId===owner))throw new Error('正文署名仍拆分账单退水');
    if(Object.hasOwn(preview.settings.rebates,legacy)||!Object.hasOwn(preview.settings.rebates,owner))throw new Error('旧账单编号配置未转为账单名');
    const p=preview.result.players.find(p=>p.id===owner);
    if(p.rebateCents!==550||preview.result.rebateCents!==550||preview.result.payableCents!==234550)throw new Error('分玩法退水金额不正确');
    if(p.rebateBreakdown.find(r=>r.playKey==='special-number').rebateCents!==150)throw new Error('分玩法退水明细无效');
    const record=await api.save({...input,inputHash:preview.inputHash,reviewed:true});
    daily=createApp({render:()=>h(SettlementPage,{documents:project.documents,activeId:project.activeId,initialDate:input.date,prepare:async()=>{},active:dailyActive.value})});daily.provide(SPACE_CONTEXT,context);daily.mount(dailyHost);
    await wait(()=>dailyHost.querySelector('[aria-label="新市场开奖期号"]')&&!dailyHost.querySelector('[aria-label="新市场开奖期号"]').disabled);
    for(const m of ['新','旧']){const select=dailyHost.querySelector(`[aria-label="${m}市场开奖期号"]`);select.value=input.drawIds[m];select.dispatchEvent(new Event('change',{bubbles:true}));}
    await nextTick();[...dailyHost.querySelectorAll('button')].find(b=>b.textContent.trim()==='计算玩家赔付').click();await wait(()=>dailyHost.querySelector('.payout-summary'));
    if(!dailyHost.querySelector('.settlement-metrics').textContent.includes('2,345.50')||!dailyHost.querySelector('.payout-summary').textContent.includes('按玩法设置'))throw new Error('每日结算未展示分玩法退水');
    dailyHost.querySelector('.rebate-breakdown summary').click();await nextTick();
    if(!dailyHost.querySelector('.rebate-breakdown').textContent.includes('0.5%')||!dailyHost.querySelector('.rebate-breakdown').textContent.includes('2%'))throw new Error('退水明细没有显示实际费率');
    const card=ledgerReceipt({document:project.documents[0],result:preview.result,inputs:preview.inputs}),rendered=receiptSvg(receiptPages(card)[0]);
    if(!rendered.svg.includes('有效流水 500 · 多档退水率')||!rendered.svg.includes('2,345.5'))throw new Error('分玩法退水截图不正确');
    if(card.rebateRows.length!==2||card.rebateRows[0].name!=='特码'||card.rebateRows[0].rebateCents!==150||card.rebateRows[1].name!=='特肖'||card.rebateRows[1].rebateCents!==400)throw new Error('截图玩法退水分组错误');
    if(!rendered.svg.includes('有效流水 300 · 0.5%')||!rendered.svg.includes('有效流水 200 · 2%')||!rendered.svg.includes('data-rebate-play="special-number"'))throw new Error('截图缺少玩法退水明细');
    await exportReceiptImage({dataUrl:await receiptPng(rendered),name:'玩法退水结算测试.png',action:'copy'});
    dailyActive.value=false;await nextTick();
    field(`${owner} 特码（逐号）每万元退水`,'0');await save();if((await api.preview(input)).result.rebateCents!==400)throw new Error('0未关闭指定玩法退水');
    dailyActive.value=true;await wait(()=>dailyHost.querySelector('.settlement-metrics')?.textContent.includes('2,344.00'));
    field(`${owner} 特码（逐号）每万元退水`,'');await save();if((await api.preview(input)).result.rebateCents!==700)throw new Error('留空未恢复默认退水');
    field(`${owner}每万元退水`,'');field(`${owner} 特肖／一肖中特每万元退水`,'');person('张三');await nextTick();field('张三每万元退水','');await save();
    if((await api.preview(input)).result.rebateCents!==0)throw new Error('取消退水失败');
    if((await api.get({id:record.id})).result.rebateCents!==550)throw new Error('历史退水被覆盖');
    person(`${owner}`);await nextTick();field(`${owner} 平特肖（本命年）每万元退水`,'50');await save();
    if((await api.load({date:input.date})).settings.rebates[owner].playRates['flat-zodiac-year']!==5000)throw new Error('本命年退水未保存');
    host.querySelectorAll('[role="tab"]')[1].click();await nextTick();
    field(`${owner} 新 特肖／一肖中特普通赔率`,'10');field(`${owner} 新 平特肖普通赔率`,'2.4');field(`${owner} 新 平特肖本命年赔率`,'1.6');await nextTick();
    person('张三');await nextTick();
    if(host.querySelector('[aria-label="张三 新 平特肖本命年赔率"]').value!=='')throw new Error('玩家赔率串用');
    field('张三 新 特码（每号）普通赔率','44');await nextTick();person(`${owner}`);await nextTick();
    if(host.querySelector(`[aria-label="${owner} 新 平特肖本命年赔率"]`).value!=='1.6')throw new Error('切换玩家丢失赔率草稿');
    await save();if((await api.preview(input)).result.payoutCents!==217000)throw new Error('账单名独立赔率未覆盖正文署名');const configured=(await api.load({date:input.date})).settings;
    if(configured.playerOdds[owner].markets.新.rates['flat-zodiac'].specialRate!=='1.6'||configured.playerOdds.张三.markets.新.rates['special-number'].rate!=='44')throw new Error('玩家赔率未保存');
    const market=host.querySelector('[aria-label="玩家赔率市场"]');market.value='港';market.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
    if(host.querySelector(`[aria-label="${owner} 港 平特肖本命年赔率"]`).value!=='')throw new Error('市场赔率串用');
    field(`${owner} 港 平特肖本命年赔率`,'1.7');await save();
    field(`${owner} 港 平特肖本命年赔率`,'');await save();
    if((await api.load({date:input.date})).settings.playerOdds[owner].markets.港)throw new Error('清空赔率未恢复继承');
    const resetMarket=host.querySelector('[aria-label="玩家赔率市场"]');resetMarket.value='新';resetMarket.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
    field(`${owner} 新 平特肖本命年赔率`,'0');await nextTick();
    let invalid=false;try{await component.flush();}catch{invalid=true;}if(!invalid)throw new Error('无效玩家赔率未拦截');
    field(`${owner} 新 平特肖本命年赔率`,'1.6');await save();
    return true;
  }finally{
    daily?.unmount();dailyHost.remove();app.unmount();host.remove();const current=(await api.load({date:input.date})).settings;await api.settings({...current,rebates:original.rebates,playerOdds:original.playerOdds||{}});
  }
}
