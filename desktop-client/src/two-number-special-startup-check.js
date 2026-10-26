import {createApp,h,nextTick} from 'vue';
import SettlementPage from './components/SettlementPage.vue';
import RebateSettings from './components/RebateSettings.vue';
import LedgerReceipt from './components/LedgerReceipt.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {parseDocument} from './core/parser.js';
import {settleDocuments} from './core/settlement.js';
import {TWO_NUMBER_SPECIAL_RATE as key,TWO_NUMBER_SPECIAL_TOGGLE as toggle} from './core/odds.js';

// Runs only in the packaged startup check's isolated SQLite directory.
export async function checkTwoNumberSpecialUI(context){
  const date='2026-10-05',api=context.api.settlement,original=(await api.load({date})).settings;
  const fixtures=['二中二测试甲','二中二测试乙'].map(name=>({id:name,name,text:'二中二1 2 49各10',businessDate:date}));
  const parsed=fixtures.map(d=>parseDocument(d.text,d));
  const draw={market:'新',date,issue:'2026278',numbers:[1,2,3,4,5,6,49]};
  const hosts=[],apps=[];
  const mount=(Component,props)=>{
    const host=document.createElement('div');host.hidden=true;document.body.append(host);hosts.push(host);let component;
    const app=createApp({render:()=>h(Component,{...props,ref:value=>component=value})});app.provide(SPACE_CONTEXT,context);app.mount(host);apps.push(app);
    return {host,component:()=>component};
  };
  const wait=async predicate=>{for(let i=0;i<100;i++){await nextTick();if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw new Error('二中二设置界面检查超时');};
  const field=async(host,label,value,event='input')=>{const el=host.querySelector(`[aria-label="${label}"]`);if(!el||el.disabled)throw new Error('二中二设置缺少可编辑项：'+label);el.value=String(value);el.dispatchEvent(new Event(event,{bubbles:true}));await nextTick();};
  const compute=async()=>{const settings=(await api.load({date})).settings;return settleDocuments(parsed,{新:draw},settings.odds,date,{playerOdds:settings.playerOdds});};
  try{
    const daily=mount(SettlementPage,{documents:fixtures,parsedDocuments:parsed,activeId:fixtures[0].id,initialDate:date,active:true});
    [...daily.host.querySelectorAll('button')].find(b=>b.textContent==='赔率与来源设置').click();
    await wait(()=>daily.host.querySelector('[aria-label="市场二中二正码加特码中奖"]'));
    if(daily.host.querySelector('[aria-label="市场二中二正码加特码中奖"]').value!=='false')throw new Error('二中二额外中奖未默认关闭');
    await field(daily.host,'市场二中二正码加特码中奖',true,'change');
    let rejected=false;try{await daily.component().flush();}catch(e){rejected=e.message.includes('请填写对应赔率');}
    if(!rejected)throw new Error('开启未填写二中二独立赔率仍可保存');
    await field(daily.host,'二中二：一个正码＋特码普通赔率','20');await daily.component().flush();
    let settings=(await api.load({date})).settings;
    if(!settings.odds.新[toggle]||settings.odds.新.rates[key].rate!=='20')throw new Error('市场二中二开关或赔率未保存');
    await field(daily.host,'设置哪个市场赔率','旧','change');
    if(daily.host.querySelector('[aria-label="市场二中二正码加特码中奖"]').value!=='false'||daily.host.querySelector('[aria-label="二中二：一个正码＋特码普通赔率"]').value!=='')throw new Error('市场二中二设置串用');
    const personal=mount(RebateSettings,{documents:parsed,active:true});
    await wait(()=>personal.host.querySelector('[data-player-id="二中二测试甲"]')&&!personal.host.querySelector('.rebate-save').textContent.includes('处理中'));
    personal.host.querySelector('[data-player-id="二中二测试甲"]').click();await nextTick();personal.host.querySelectorAll('[role="tab"]')[1].click();await nextTick();
    const label='二中二测试甲 新 二中二正码加特码中奖',price='二中二测试甲 新 二中二：一个正码＋特码普通赔率';
    if(personal.host.querySelector(`[aria-label="${label}"]`).value!=='')throw new Error('玩家二中二未默认继承');
    await field(personal.host,label,false,'change');await personal.component().flush();
    let result=await compute();if(result.players[0].payoutCents!==60000||result.players[1].payoutCents!==100000)throw new Error('单独关闭影响其他玩家或原正码赔付');
    await field(personal.host,label,true,'change');await field(personal.host,price,'25');
    personal.host.querySelector('[data-player-id="二中二测试乙"]').click();await nextTick();
    if(personal.host.querySelector('[aria-label="二中二测试乙 新 二中二正码加特码中奖"]').value!=='')throw new Error('玩家二中二开关串用');
    personal.host.querySelector('[data-player-id="二中二测试甲"]').click();await nextTick();
    if(personal.host.querySelector(`[aria-label="${price}"]`).value!=='25')throw new Error('切换玩家丢失二中二草稿');
    await personal.component().flush();result=await compute();
    if(result.players[0].payoutCents!==110000||result.players[1].payoutCents!==100000)throw new Error('二中二玩家独立赔率未生效');
    settings=(await api.load({date})).settings;settings.odds.新[toggle]=false;settings.odds.新.rates[key].rate='';await api.settings(settings);
    [...personal.host.querySelectorAll('button')].find(b=>b.textContent==='重新载入').click();
    await wait(()=>!personal.host.querySelector('.rebate-save').textContent.includes('处理中')&&personal.host.querySelector(`[aria-label="${label}"]`)?.textContent.includes('跟随市场（关闭）'));
    result=await compute();if(result.players[0].payoutCents!==110000||result.players[1].payoutCents!==60000)throw new Error('全局关闭时玩家不能独立开启');
    await field(personal.host,label,'','change');await personal.component().flush();
    result=await compute();if(result.players[0].payoutCents!==60000)throw new Error('恢复继承后仍采用单独开启');
    await field(personal.host,label,true,'change');await field(personal.host,price,'');
    rejected=false;try{await personal.component().flush();}catch{rejected=true;}
    if(!rejected||!personal.host.querySelector('[role="alert"]')?.textContent.includes('请填写对应赔率'))throw new Error('玩家缺少有效赔率未显示原因');
    await field(personal.host,price,'25');await personal.component().flush();
    settings=(await api.load({date})).settings;
    const payout=settleDocuments([parsed[0]],{新:draw},settings.odds,date,{playerOdds:settings.playerOdds});
    const receipt=mount(LedgerReceipt,{open:true,document:fixtures[0],result:payout,inputs:{kind:'current',selection:fixtures[0].id,documents:[parsed[0]],draws:{新:draw},settings}});
    await nextTick();await nextTick();
    const dialog=[...document.querySelectorAll('.receipt-dialog[open]')].at(-1),image=dialog.querySelector('.receipt-preview');await image.decode();
    const svg=decodeURIComponent(image.src.split(',').slice(1).join(','));
    if(!svg.includes('正码＋特码')||!svg.includes('10 × 60')||!svg.includes('20 × 25'))throw new Error('二中二结算截图没有分别展示两档中奖');
    return true;
  }finally{
    apps.reverse().forEach(app=>app.unmount());hosts.forEach(host=>host.remove());
    const current=(await api.load({date})).settings;await api.settings({...current,odds:original.odds,playerOdds:original.playerOdds});
  }
}
