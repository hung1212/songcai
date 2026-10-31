import {createApp,h,nextTick,ref} from 'vue';
import TransferJournal from './components/TransferJournal.vue';
import SpecialTransferPanel from './components/SpecialTransferPanel.vue';
import {SPACE_CONTEXT} from './space-context.js';
import {parseDocument} from './core/parser.js';
import {defaultOdds} from './core/odds.js';
import {specialTransferPlan,specialTransferScenarios} from './core/special-transfer.js';
import {validateTransferRecord} from './core/transfer-journal.js';
export async function checkTransferJournalUI(){
 const date='2026-10-27',make=text=>parseDocument(text,{id:'journal-check',name:'分批测试玩家',businessDate:date,defaultPlayer:'玩家'});
 const results=ref([make('新01各1000\n新02各500')]),settings={odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),rebates:{},playerOdds:{}};
 const sourceError=ref(''),market=ref('新'),all=ref(false),rows=[],enabled=ref(true);let latest;
 const api={transferList:async({date,market})=>rows.filter(r=>r.date===date&&r.market===market),transferAdd:async r=>{const record={...validateTransferRecord(r),createdAt:new Date().toISOString()};if(!rows.some(x=>x.id===r.id))rows.push(record);return record;},transferVoid:async({id,reason})=>Object.assign(rows.find(r=>r.id===id),{voidedAt:new Date().toISOString(),voidReason:reason}),transferDelete:async({id,date,market})=>{const i=rows.findIndex(r=>r.id===id&&r.date===date&&r.market===market);if(i>=0)rows.splice(i,1);return {deleted:i>=0};}};
 const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:1000px;height:800px;overflow:auto;z-index:999999;background:white';document.body.append(host);
 const app=createApp({render:()=>h(TransferJournal,{book:specialTransferPlan(results.value,settings,{date,market:market.value,allowEmpty:true}),results:results.value,allRecords:all.value,enabled:enabled.value,sourceError:sourceError.value,onChange:s=>latest=s})});
 app.provide(SPACE_CONTEXT,{id:'journal-fixture',name:'测试',api:{settlement:api}});app.mount(host);
 const wait=async()=>{await new Promise(r=>setTimeout(r,15));await nextTick();};
 const require=(ok,message)=>{if(!ok)throw new Error('分批转出界面：'+message);};
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes(text));
 const click=async text=>{const b=button(text);require(b&&!b.disabled,'按钮不可用 '+text);b.click();await wait();};
 const input=async(label,value,kind='input')=>{const e=host.querySelector(`[aria-label="${label}"]`);require(e,'缺少输入 '+label);e.value=value;e.dispatchEvent(new Event(kind,{bubbles:true}));await wait();};
 try{
  await wait();require(latest?.plan?.totalCents>0,'未生成首批补打');const initial=latest.plan.totalCents;
  await click('核对清单并记录已打出');sourceError.value='正在更新解析';await wait();require(host.querySelector('[aria-label="记录实际打出"]')&&!latest.plan,'更新解析时丢失实际清单或仍显示旧方案');sourceError.value='';await wait();await input('实际打出赔率','45');await input('实际打出退水','2');
  await input('01号实际金额','300');await input('02号实际金额','100');await click('确认已打出并保存');
  require(rows.length===1&&rows[0].documentId==='journal-check'&&rows[0].rate===45,'归属或实际赔率没有保存');
  require(latest.actualByNumber[0]===30000&&latest.actualByNumber[1]===10000,'已打出未累计');require(latest.plan.totalCents===initial-40000,'补打未扣掉实际已打出');
  await input('本次补打赔率','44');require(rows[0].rate===45,'新报价改动了旧批次');
  await input('号码盈亏口径','actual','change');require(latest.plan.totalCents===0&&!latest.showProposal,'实际口径混入未执行建议');
  await input('号码盈亏口径','proposal','change');results.value=[make('新01各1500\n新02各500\n新03各1000')];await wait();require(latest.actualByNumber[0]===30000&&latest.plan.totalCents>initial-40000,'新增投注未保留已打出并补差');
  const chips=()=>[...host.querySelectorAll('[data-supplement-number]')];
  require(chips().map(e=>e.dataset.supplementNumber).join(',')==='1,3,2','默认没有按需补打金额降序');
  const totalBeforeSort=latest.plan.totalCents;
  await input('补打清单排序','number','change');require(chips().map(e=>e.dataset.supplementNumber).join(',')==='1,2,3','号码排序无效');
  await input('补打清单排序','amount-desc','change');require(latest.plan.totalCents===totalBeforeSort,'排序改变了计算金额');
  await click('核对清单并记录已打出');require([...host.querySelectorAll('.journal-entry-grid select')].map(e=>e.value).join(',')==='1,3,2','核对清单未沿用补打排序');await click('取消');
  await input('补打方式','few','change');await input('补打最大亏损','500');await input('最多新增号码','0');require(host.textContent.includes('无法达到'),'无法达标没有提示');
  await input('最多新增号码','8');require(latest.plan.worstProfitCents>=-50000&&host.textContent.includes('其中新增'),'目标补打不达标');
  market.value='港';await wait();require(latest.actualByNumber.every(v=>v===0),'市场串记录');market.value='新';await wait();require(latest.actualByNumber[0]===30000,'返回市场记录丢失');
  rows.push({...rows[0],id:'journal-common-test',documentId:'',ownerName:'集合公共'});await click('刷新记录');require(host.textContent.includes('未分摊到此玩家')&&latest.actualByNumber[0]===30000,'公共记录错误分摊');all.value=true;await wait();require(latest.actualByNumber[0]===60000,'集合没有汇总玩家及公共转出');
  const before=rows.length;await click('手动记录实际打出');await input('01号实际金额','10');await input('实际打出赔率','-1');await click('确认已打出并保存');require(rows.length===before&&host.textContent.includes('保存失败'),'无效金额仍保存');await click('取消');
  await click('记录有误，作废');const reason=host.querySelector('[placeholder="填写录入错误的原因"]');reason.value='测试录入错误';reason.dispatchEvent(new Event('input',{bubbles:true}));await wait();await click('确认作废记录');require(rows[0].voidedAt,'没有保留作废审计');
  await input('补打方式','average','change');
  const activeId=rows.find(r=>!r.voidedAt).id,priorTotal=latest.plan.totalCents;
  host.querySelector(`[data-transfer-record="${activeId}"] .journal-delete`).click();await wait();
  require(rows.length===2,'未确认就删除');await click('取消删除');require(rows.length===2&&!host.querySelector('.journal-delete-confirm'),'取消删除无效');
  host.querySelector(`[data-transfer-record="${activeId}"] .journal-delete`).click();await wait();await click('确认删除记录');
  require(rows.length===1&&latest.actualByNumber.every(v=>v===0),'删除后已打出未扣除');require(latest.plan.totalCents===priorTotal+40000,'删除后补打金额未恢复');
  require(!host.querySelector(`[data-transfer-record="${activeId}"]`),'删除后记录仍显示');
  await click('删除记录');await click('确认删除记录');require(rows.length===0&&latest.plan.totalCents===priorTotal+40000,'删除作废记录改变补打');
  await checkLegacyTransferIsolationUI();
  return true;
 }finally{app.unmount();host.remove();}
}

// Verify the real shared panel, including existing records, failed reads and a
// delayed journal response after switching back to a legacy preview.
async function checkLegacyTransferIsolationUI(){
 const date='2026-10-27',results=[parseDocument('新01各1000\n新02各500',{id:'legacy-isolation',name:'独立方案测试',businessDate:date})];
 const settings={odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),rebates:{},playerOdds:{}};
 const record={id:'isolation-batch-001',date,market:'新',documentId:'legacy-isolation',ownerName:'独立方案测试',rate:42,rebatePercent:1,entries:[{number:1,cents:50000}],createdAt:new Date().toISOString()};
 let reads=0,fail=true,delay=false,resolvePending,snapshot;
 const api={transferList:async()=>{reads++;if(fail)throw new Error('测试：转出库读取失败');if(delay)return new Promise(resolve=>{resolvePending=resolve;});return [record];}};
 const host=document.createElement('div');host.hidden=true;document.body.append(host);
 const app=createApp({render:()=>h(SpecialTransferPanel,{results,settings,date,market:'新',allRecords:false},{default:s=>{snapshot=s;return h('div');}})});
 app.provide(SPACE_CONTEXT,{id:'legacy-isolation',api:{settlement:api}});app.mount(host);
 const wait=async()=>{await new Promise(r=>setTimeout(r,15));await nextTick();};
 const require=(ok,message)=>{if(!ok)throw new Error('旧转出方案隔离：'+message);};
 const click=async selector=>{const e=host.querySelector(selector);require(e,'缺少入口 '+selector);e.click();await wait();};
 const journalButton=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='分批打出／补打记录');
 const check=id=>{
  const expected=specialTransferScenarios(specialTransferPlan(results,settings,{date,market:'新'})).find(p=>p.id===id);
  require(!snapshot.journalMode&&snapshot.plan,'被分批模式或加载状态接管');
  require(snapshot.plan.totalCents===expected.totalCents,'打出总额被记录改变');
  require(snapshot.plan.expectedMarginPercent===expected.expectedMarginPercent,'收益率被记录改变');
  for(let i=0;i<49;i++){require(snapshot.transferByNumber[i+1]===expected.transferCents[i],'逐号转出金额改变');require(snapshot.profitByNumber[i+1]===expected.profitCents[i],'逐号盈亏改变');}
  require(!host.querySelector('.transfer-journal'),'旧方案挂载了分批功能');
 };
 try{
  await click('.transfer-toggle');check('maximin');require(reads===0,'稳定方案不应读取转出库');
  await click('.average-transfer-toggle');check('average-excess');require(reads===0,'平均方案不应读取转出库');
  journalButton().click();await wait();require(host.textContent.includes('转出库读取失败'),'分批读库失败未提示');
  await click('.transfer-toggle');check('maximin');require(reads===1,'回到稳定方案仍读库');
  fail=false;journalButton().click();await wait();require(snapshot.journalMode&&snapshot.actualByNumber[1]===50000,'分批未读取既有记录');
  require(host.querySelector('.average-transfer-toggle'),'分批界面隐藏了平均入口');
  await click('.average-transfer-toggle');check('average-excess');require(reads===2,'平均方案受已打出记录影响');
  delay=true;journalButton().click();await wait();require(resolvePending,'未发起延迟读取');
  await click('.transfer-toggle');check('maximin');resolvePending([record]);await wait();check('maximin');
  await click('.transfer-toggle');require(!snapshot.plan,'关闭后仍显示方案');await click('.transfer-toggle');check('maximin');require(reads===3,'重新打开旧方案触发读库');
 }finally{app.unmount();host.remove();}
}
