import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';
import {optimizeSpecialTransfer,minimizeSpecialTransfer,specialTransferTarget,specialTransferScenarios,specialTransferPlan} from '../src/core/special-transfer.js';
const date='2026-10-05',scope={date,market:'新'};
const doc=(text,id='a',extra={})=>parseDocument(text,{id,name:id,businessDate:date,defaultPlayer:id,...extra});
const settings=()=>({odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),rebates:{},playerOdds:{}});

test('整数优化与逐元分配独立枚举一致，并逐号重算净利润',()=>{
  let seed=527;
  const random=()=>{seed=(seed*16807)%2147483647;return seed;};
  for(let sample=0;sample<60;sample++){
    const l=Array.from({length:49},()=>random()%25000),net=100000;
    const actual=optimizeSpecialTransfer(l,net),residual=l.slice(),x=Array(49).fill(0);
    let best=-Infinity,total=0;
    for(let k=0;k<400;k++){
      const maximum=Math.max(...residual),floor=net-100*k+Math.floor((33*k+5)/10)-maximum;
      if(floor>best){best=floor;total=k*100;}
      const i=residual.indexOf(maximum);x[i]++;residual[i]-=4730;
    }
    assert.equal(actual.worstProfitCents,best);
    assert.equal(actual.totalCents,total);
    assert.equal(actual.transferCents.reduce((a,b)=>a+b,0),actual.totalCents);
    assert.ok(actual.transferCents.every(x=>Number.isInteger(x)&&x>=0&&x%100===0));
    assert.deepEqual(actual.profitCents,l.map((v,i)=>net-v-actual.totalCents+actual.rebateCents+actual.transferCents[i]/100*4730));
  }
});

test('同额49号无需转出，超大流水无需逐元循环，金额溢出拒绝',()=>{
  assert.equal(optimizeSpecialTransfer(Array(49).fill(4700),4900).totalCents,0);
  assert.equal(optimizeSpecialTransfer(Array(49).fill(0),0).worstProfitCents,0);
  const result=optimizeSpecialTransfer(Array.from({length:49},(_,i)=>i*1_000_000_000),100_000_000_000);
  assert.ok(Number.isSafeInteger(result.totalCents));
  assert.throws(()=>optimizeSpecialTransfer(Array(48).fill(0),0),/49/);
  assert.throws(()=>optimizeSpecialTransfer(Array(49).fill(NaN),0),/金额/);
  assert.throws(()=>optimizeSpecialTransfer(Array.from({length:49},(_,i)=>i?Number.MAX_SAFE_INTEGER:0),0),/范围/);
});

test('单日期单市场，排除其他玩法；未选范围、空账和未加载赔率不显示方案',()=>{
  const docs=[doc('新01各100\n旧02各20\n平特肖马各5'),doc('新03各900','b',{businessDate:'2026-10-04'})];
  const plan=specialTransferPlan(docs,settings(),scope);
  assert.equal(plan.stakeCents,10000);assert.equal(plan.numbers[0].liabilityCents,470000);
  assert.equal(plan.numbers[1].cents,0);assert.equal(plan.numbers[2].cents,0);
  for(const filter of [{},{date},{market:'新'}])assert.throws(()=>specialTransferPlan(docs,settings(),filter),/请选择/);
  assert.throws(()=>specialTransferPlan([],settings(),scope),/没有/);
  assert.throws(()=>specialTransferPlan(docs,null,scope),/加载/);
});

test('玩家独立赔率、净赔本金和重复号码的逐份取整与真实结算一致',()=>{
  const config=settings();config.odds.新.includePrincipal=false;
  config.playerOdds={a:{markets:{新:{rates:{'special-number':{rate:'1.5'}}}}},b:{markets:{新:{rates:{'special-number':{rate:'48.25'}}}}}};
  const docs=[doc('新01.01.02各0.01'),doc('新01.03各10','b')];
  const plan=specialTransferPlan(docs,config,scope);
  for(let n=1;n<=49;n++){
    const normal=Array.from({length:49},(_,i)=>i+1).filter(v=>v!==n).slice(0,6);
    let payout=0;
    for(const d of docs)for(const b of d.bets){
      const odds={...config.odds.新,rates:{...config.odds.新.rates,'special-number':config.playerOdds[b.playerId].markets.新.rates['special-number']}};
      payout+=settleBet(b,{date,market:'新',issue:'2026278',numbers:[...normal,n]},odds).payoutCents;
    }
    assert.equal(plan.numbers[n-1].liabilityCents,payout);
  }
  assert.equal(plan.numbers[0].liabilityCents,49256);
  assert.equal(plan.numbers[1].liabilityCents,3);
});

test('玩家退水按本单取整，玩法0覆盖默认，设置变化更新利润和打出金额',()=>{
  const config=settings(),docs=[doc('新01各100'),doc('新02各100','b')];
  config.rebates={a:{perTenThousandCents:30000},b:{perTenThousandCents:30000,playRates:{'special-number':0}}};
  const first=specialTransferPlan(docs,config,scope);
  assert.equal(first.playerRebateCents,300);assert.equal(first.zeroRebateStakeCents,10000);
  config.rebates.b.playRates['special-number']=30000;
  const second=specialTransferPlan(docs,config,scope);
  assert.equal(second.worstProfitCents,first.worstProfitCents-300);
  config.playerOdds.a={markets:{新:{rates:{'special-number':{rate:'40'}}}}};
  assert.notEqual(specialTransferPlan(docs,config,scope).numbers[0].transferCents,first.numbers[0].transferCents);
});

test('期号冲突阻止合算，同一期号的完整和缩写形式兼容',()=>{
  assert.throws(()=>specialTransferPlan([doc('第277期01各10'),doc('第278期02各10','b')],settings(),scope),/不同期号/);
  const p=specialTransferPlan([doc('第2026278期01各10'),doc('第278期02各10','b')],settings(),scope);
  assert.equal(p.stakeCents,2000);
});

test('待核对记录不计入方案，缺失赔率不采用默认，亏损结果照实返回',()=>{
  const config=settings(),docs=[doc('新01各10\n特码99各10')];
  const plan=specialTransferPlan(docs,config,scope);
  assert.equal(plan.stakeCents,1000);assert.ok(plan.issueCount>0);
  config.odds.新.rates['special-number'].rate='';
  assert.throws(()=>specialTransferPlan(docs,config,scope),/未配置/);
  const losing=optimizeSpecialTransfer(Array(49).fill(10000),100);
  assert.equal(losing.worstProfitCents,-9900);
});

test('指定利润下限的最少转出与逐元枚举一致，涵盖零转出、负利润和不可达目标',()=>{
  let seed=1729;
  const random=()=>{seed=(seed*16807)%2147483647;return seed;};
  for(let sample=0;sample<45;sample++){
    const liabilities=Array.from({length:49},()=>random()%25000),net=random()%30000-10000;
    const residual=liabilities.slice(),outcomes=[];
    for(let k=0;k<400;k++){
      const maximum=Math.max(...residual);
      outcomes.push(net-100*k+Math.floor((33*k+5)/10)-maximum);
      residual[residual.indexOf(maximum)]-=4730;
    }
    const peak=Math.max(...outcomes);
    for(const target of [outcomes[0]-1,outcomes[0],outcomes[0]+1,Math.floor((outcomes[0]+peak)/2),peak-1,peak,peak+1]){
      const expected=outcomes.findIndex(p=>p>=target),actual=minimizeSpecialTransfer(liabilities,net,target);
      assert.equal(actual.feasible,expected>=0);
      assert.equal(actual.maximumWorstProfitCents,peak);
      if(expected<0){assert.equal(actual.transferCents,undefined);continue;}
      assert.equal(actual.totalCents,expected*100);
      assert.ok(actual.worstProfitCents>=target);
      assert.ok(actual.transferCents.every(x=>Number.isSafeInteger(x)&&x>=0&&x%100===0));
      assert.equal(actual.transferCents.reduce((a,b)=>a+b,0),actual.totalCents);
      assert.deepEqual(actual.profitCents,liabilities.map((l,i)=>net-l-actual.totalCents+actual.rebateCents+4730*actual.transferCents[i]/100));
    }
  }
});

test('百分比按总投注计算，分以下向上取利润下限，拒绝空值和越界输入',()=>{
  assert.equal(specialTransferTarget(3662000,'loss','5'),-183100);
  assert.equal(specialTransferTarget(3662000,'profit','1'),36620);
  assert.equal(specialTransferTarget(12345,'loss','5'),-617);
  assert.equal(specialTransferTarget(12345,'profit','5'),618);
  assert.equal(specialTransferTarget(1,'loss','0.01'),0);
  assert.equal(specialTransferTarget(1,'profit','0.01'),1);
  assert.equal(specialTransferTarget(12345,'profit','0'),0);
  assert.equal(specialTransferTarget(12345,'loss','100'),-12345);
  for(const percent of ['',null,undefined,'-1','100.01','1.001','NaN','Infinity','1e2','a'])assert.throws(()=>specialTransferTarget(10000,'loss',percent),/百分比/);
  assert.throws(()=>specialTransferTarget(10000,'unknown','5'),/请选择/);
  assert.throws(()=>minimizeSpecialTransfer(Array(48).fill(0),100,0),/49/);
  assert.throws(()=>minimizeSpecialTransfer(Array(49).fill(-1),100,0),/金额/);
  assert.throws(()=>minimizeSpecialTransfer(Array(49).fill(0),100,NaN),/利润金额/);
});

test('超大金额、重复断点、同额分布和空号仍按整数精确求最小转出',()=>{
  const liabilities=Array.from({length:49},(_,i)=>i*1_000_000_000),net=100_000_000_000;
  const peak=optimizeSpecialTransfer(liabilities,net);
  const result=minimizeSpecialTransfer(liabilities,net,peak.worstProfitCents-1000000);
  assert.ok(result.feasible&&result.totalCents<=peak.totalCents);
  assert.ok(result.worstProfitCents>=peak.worstProfitCents-1000000);
  assert.equal(minimizeSpecialTransfer(liabilities,net,peak.worstProfitCents).totalCents,peak.totalCents);
  assert.equal(minimizeSpecialTransfer(liabilities,net,peak.worstProfitCents+1).feasible,false);
  const even=Array(49).fill(4700);
  assert.equal(minimizeSpecialTransfer(even,4900,200).totalCents,0);
  assert.equal(minimizeSpecialTransfer(even,4900,201).feasible,false);
  const empty=[470000,...Array(48).fill(0)],partial=minimizeSpecialTransfer(empty,10000,-500);
  assert.ok(partial.feasible&&partial.worstProfitCents>=-500);
  assert.ok(partial.transferCents.slice(1).every(n=>n===0));
  assert.equal(minimizeSpecialTransfer(Array(49).fill(0),0,0).totalCents,0);
});

test('对比方案共用账目范围，收益率按收到投注计算，退水与自定义目标动态更新',()=>{
  const config=settings(),docs=[doc('新01各100\n新02各50\n旧03各10')];
  const firstBook=specialTransferPlan(docs,config,scope),plans=specialTransferScenarios(firstBook,{mode:'loss',percent:'5'});
  const custom=plans.find(p=>p.id==='custom'),preset=plans.find(p=>p.id==='loss-5');
  assert.equal(plans.length,9);assert.equal(custom.targetProfitCents,-750);
  assert.deepEqual(custom.transferCents,preset.transferCents);
  for(const p of plans.filter(p=>p.feasible)){
    const average=p.profitCents.reduce((s,n)=>s+n,0)/49;
    assert.ok(Math.abs(p.expectedProfitCents-average)<1e-8);
    assert.ok(Math.abs(p.expectedMarginPercent-average/firstBook.stakeCents*100)<1e-8);
    assert.equal(p.nonLossCount,p.profitCents.filter(v=>v>=0).length);
  }
  assert.equal(specialTransferScenarios(firstBook,{mode:'profit',percent:'100'}).at(-1).feasible,false);
  const invalid=specialTransferScenarios(firstBook,{mode:'profit',percent:''}).at(-1);
  assert.ok(invalid.error);assert.equal(invalid.transferCents,undefined);
  config.rebates.a={perTenThousandCents:30000};
  const secondBook=specialTransferPlan(docs,config,scope);
  const second=specialTransferScenarios(secondBook,{mode:'loss',percent:'5'}).at(-1);
  assert.equal(second.targetProfitCents,custom.targetProfitCents,'玩家退水不应改变百分比基准');
  assert.ok(second.feasible&&second.worstProfitCents>=second.targetProfitCents);
  assert.ok(second.expectedProfitCents<=custom.expectedProfitCents-450+1e-8,'额外退水必须计入利润');
  assert.deepEqual(second.profitCents,secondBook.numbers.map((n,i)=>15000-450-n.liabilityCents-second.totalCents+second.rebateCents+4730*second.transferCents[i]/100));
});
