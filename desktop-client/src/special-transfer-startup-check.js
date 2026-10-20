import {createApp,h,nextTick,ref} from 'vue';
import SpecialCollection from './components/SpecialCollection.vue';
import {parseDocument} from './core/parser.js';
import {defaultOdds} from './core/odds.js';
import {specialTransferPlan,specialTransferScenarios} from './core/special-transfer.js';
import {formatMoney} from './core/rules.js';

// Synthetic component check; no database writes or actual transfers.
export async function checkSpecialTransferUI(){
  const date='2026-10-05',parse=text=>parseDocument(text,{id:'transfer-ui',name:'转出测试',defaultPlayer:'测试玩家',businessDate:date});
  const results=ref([parse('新01各100\n新02各50\n旧03各10')]);
  const settings=ref({odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),rebates:{},playerOdds:{}});
  const host=document.createElement('div');host.hidden=true;document.body.append(host);
  const app=createApp({render:()=>h(SpecialCollection,{results:results.value,referenceDate:date,settings:settings.value})});app.mount(host);
  const require=(ok,message)=>{if(!ok)throw new Error('稳定转出界面：'+message);};
  const select=async(label,value)=>{const el=host.querySelector(`[aria-label="${label}"]`);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();};
  const input=async(label,value)=>{const el=host.querySelector(`[aria-label="${label}"]`);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();};
  const choose=async id=>{host.querySelector(`[data-transfer-scenario="${id}"] input`).click();await nextTick();};
  const expectedScenario=(id,custom)=>specialTransferScenarios(specialTransferPlan(results.value,settings.value,{date,market:'新'}),custom).find(p=>p.id===id);
  const checkNumbers=plan=>{
    require(plan.feasible&&plan.transferCents.every((n,i)=>displayed(i+1)===n),'所选方案与49个号码不一致');
    require(host.querySelectorAll('[data-profit-cents]').length===49,'必须显示49个号码的净盈亏');
    for(const [i,profit] of plan.profitCents.entries()){
      const number=host.querySelector(`[data-number="${i+1}"]`),el=number.querySelector('[data-profit-cents]');
      const label=profit>0?'预计净盈利':profit<0?'预计净亏损':'预计持平';
      require(Number(el.dataset.profitCents)===profit,'盈亏错配号码或使用了旧方案');
      require(el.classList.contains(profit>0?'number-profit-gain':profit<0?'number-profit-loss':'number-profit-flat'),'净盈亏颜色状态错误');
      require(el.textContent===label+(profit<0?'−':'')+'¥ '+formatMoney(Math.abs(profit)),'净盈亏文字或金额错误');
      require(number.querySelector('button').getAttribute('aria-label').includes(label+formatMoney(Math.abs(profit))+'元'),'号码盈亏说明缺失');
    }
    const profits=[...host.querySelectorAll('[data-profit-cents]')].map(el=>Number(el.dataset.profitCents));
    require(Math.min(...profits)===plan.worstProfitCents&&Math.max(...profits)===plan.bestProfitCents,'逐号净盈亏与方案利润范围不一致');
  };
  const checkHidden=()=>require(!host.querySelector('[data-transfer-cents],[data-profit-cents]'),'无有效方案时应同时隐藏打出和盈亏金额');
  const displayed=n=>Number(host.querySelector(`[data-number="${n}"] [data-transfer-cents]`)?.dataset.transferCents);
  try{
    checkHidden();
    host.querySelector('.transfer-toggle').click();await nextTick();
    require(host.querySelector('[aria-label="集合业务日期"]').value===date&&host.querySelector('[aria-label="集合市场"]').value==='新','启用时应选择单日及主要市场');
    require(host.querySelectorAll('[data-transfer-cents]').length===49,'每个号码都应显示金额');
    const original=displayed(1);require(original>0&&displayed(49)===0,'打出金额或零值错误');
    checkNumbers(expectedScenario('maximin'));
    require(host.querySelectorAll('[data-transfer-scenario]').length===8,'缺少方案比较');
    require(host.querySelector('[data-transfer-basis]').textContent.includes('150.00'),'百分比基准应为当前市场扣退水前总投注');
    await choose('none');require([...host.querySelectorAll('[data-transfer-cents]')].every(el=>el.dataset.transferCents==='0'),'不转出应显示49个零值');
    checkNumbers(expectedScenario('none'));
    await choose('loss-5');checkNumbers(expectedScenario('loss-5'));
    await input('转出目标百分比','2.5');checkNumbers(expectedScenario('custom',{mode:'loss',percent:'2.5'}));
    require(host.querySelector('[data-transfer-scenario="custom"]').classList.contains('transfer-chosen'),'修改比例未选中自定义方案');
    await select('转出目标类型','profit');await input('转出目标百分比','1');checkNumbers(expectedScenario('custom',{mode:'profit',percent:'1'}));
    const scenario=expectedScenario('custom',{mode:'profit',percent:'1'});
    require(host.querySelector('[data-transfer-margin]').textContent===scenario.expectedMarginPercent.toFixed(2)+'%','收益率显示错误');
    await input('转出目标百分比','100');require(!host.querySelector('[data-transfer-cents]')&&host.querySelector('[data-transfer-unavailable]').textContent.includes('无法达到'),'不可达目标不应显示旧金额');
    checkHidden();
    await input('转出目标百分比','');require(!host.querySelector('[data-transfer-cents]')&&host.querySelector('[data-transfer-unavailable]').textContent.includes('请输入'),'空输入不应当作0');
    checkHidden();
    await select('转出目标类型','loss');await input('转出目标百分比','5');checkNumbers(expectedScenario('custom',{mode:'loss',percent:'5'}));
    await choose('maximin');require(displayed(1)===original,'原稳定方案未保留');
    await select('集合号码排序','number');require(displayed(1)===original,'排序错配号码');
    checkNumbers(expectedScenario('maximin'));
    host.querySelector('[data-number="1"] button').click();await nextTick();require(displayed(1)===original,'来源筛选不应影响全盘方案');
    checkNumbers(expectedScenario('maximin'));
    results.value=[parse('新01各200\n新02各50\n旧03各10')];await nextTick();require(displayed(1)>original,'修改账目未重算');
    const beforeOdds=displayed(1);
    settings.value.playerOdds={'转出测试':{markets:{新:{rates:{'special-number':{rate:'40'}}}}}};await nextTick();require(displayed(1)<beforeOdds,'玩家赔率未重算');
    settings.value.rebates={'转出测试':{perTenThousandCents:30000}};await nextTick();
    checkNumbers(expectedScenario('maximin'));
    require(host.querySelector('.transfer-summary').textContent.includes('7.50'),'玩家退水未更新');
    await choose('loss-5');checkNumbers(expectedScenario('loss-5'));
    results.value=[parse('新01各300\n新02各50\n旧03各10')];await nextTick();checkNumbers(expectedScenario('loss-5'));
    require(host.querySelector('[data-transfer-basis]').textContent.includes('350.00'),'修改账目后比例基准未更新');
    await choose('maximin');
    await select('集合市场','旧');const expected=specialTransferPlan(results.value,settings.value,{date,market:'旧'});
    require(displayed(1)===0&&displayed(3)===expected.numbers[2].transferCents,'市场未隔离');
    checkNumbers({...expected,feasible:true});
    await select('集合市场','');require(!host.querySelector('[data-transfer-cents]')&&host.textContent.includes('请选择单个业务日期和市场'),'全部市场应隐藏旧方案');
    checkHidden();
    await select('集合市场','新');await select('集合业务日期','');require(!host.querySelector('[data-transfer-cents]'),'全部日期应隐藏旧方案');
    checkHidden();
    await select('集合业务日期',date);settings.value=null;await nextTick();require(!host.querySelector('[data-transfer-cents]'),'设置未加载时不应沿用旧金额');
    checkHidden();
    host.querySelector('.transfer-toggle').click();await nextTick();require(!host.querySelector('.transfer-summary'),'关闭方案失败');
    checkHidden();
    settings.value={odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),rebates:{},playerOdds:{}};
    results.value=[parse('新01各100\n新02各4600')];await nextTick();host.querySelector('.transfer-toggle').click();await nextTick();await choose('none');
    checkNumbers(expectedScenario('none'));require(host.querySelector('[data-number="1"] .number-profit-flat'),'零盈亏应显示持平');
    return true;
  }finally{app.unmount();host.remove();}
}
