import test from 'node:test';
import assert from 'node:assert/strict';
import {averageExcessSpecialTransfer,specialTransferPlan,specialTransferScenarios} from '../src/core/special-transfer.js';
import {numberDistribution} from '../src/core/number-distribution.js';
import {parseDocument} from '../src/core/parser.js';
import {defaultOdds,settleBet} from '../src/core/settlement.js';

const date='2026-10-05',scope={date,market:'新'};
const doc=(text,id='a',businessDate=date)=>parseDocument(text,{id,name:id,businessDate});
const settings=()=>({odds:Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}])),rebates:{},playerOdds:{}});
const planFor=(docs,config=settings())=>{
  const book=specialTransferPlan(docs,config,scope);
  return {book,plan:specialTransferScenarios(book).find(p=>p.id==='average-excess')};
};

test('超出49号转出前平均的部分全转出，低于平均与等于平均为零，逐号整盘盈亏包含全部资金',()=>{
  // Total 4,900 yuan, mean 100. Number 01 has 200; 02 has 0; others 100.
  const stakes=[20000,0,...Array(47).fill(10000)],liabilities=stakes.map(n=>n*47);
  const p=averageExcessSpecialTransfer(stakes,liabilities,490000);
  assert.equal(p.averageCents,10000);assert.equal(p.transferNumberCount,1);
  assert.deepEqual(p.transferCents,[10000,...Array(48).fill(0)]);
  assert.equal(p.totalCents,10000);assert.equal(p.rebateCents,330);
  assert.equal(p.profitCents[0],13330);assert.equal(p.profitCents[1],480330);assert(p.profitCents.slice(2).every(n=>n===10330));
  const rebated=averageExcessSpecialTransfer(stakes,liabilities,490000-14700);
  assert.equal(rebated.profitCents[0],-1370);assert.equal(rebated.profitCents[1],465630);assert(rebated.profitCents.slice(2).every(n=>n===-4370));
  assert.equal(rebated.worstProfitCents,-4370);assert.equal(rebated.bestProfitCents,465630);
  assert.deepEqual(rebated.transferCents,p.transferCents,'玩家退水只影响盈亏，不改变按投注平均转出');
});

test('超额与号码分布显示一致，零投注号码计入平均，小数按分且赔付、退水分别取整',()=>{
  const stakes=[10000,5000,...Array(47).fill(0)],liabilities=stakes.map(n=>n*47);
  const p=averageExcessSpecialTransfer(stakes,liabilities,15000),distribution=numberDistribution(stakes.map((cents,i)=>({number:i+1,cents})));
  assert.equal(p.averageCents,306);assert.equal(p.unitYuan,0.01);
  assert.deepEqual(p.transferCents,distribution.numbers.map(n=>n.excessCents));
  assert.deepEqual(p.transferCents.slice(0,2),[9694,4694]);assert.equal(p.totalCents,14388);assert.equal(p.rebateCents,475);
  // After all outgoing costs and rebate the book retains 10.87 yuan.
  // Number 01 returns 4,585.26 but owes 4,700; number 02 returns 2,220.26
  // but owes 2,350. Profit includes the whole book, not only that number.
  assert.deepEqual(p.profitCents.slice(0,3),[-10387,-11887,1087]);
  // Five cents pays 2.365 -> 2.37. Three separate tiny transfer stakes
  // receive one aggregate rebate, not three independently rounded rebates.
  const tiny=[5,5,5,...Array(46).fill(0)];
  const t=averageExcessSpecialTransfer(tiny,Array(49).fill(0),15);
  assert.equal(t.transferCents[0],5);assert.equal(t.rebateCents,0);assert.equal(t.profitCents[0],237);
  const near=[...Array(48).fill(3),2];
  assert.equal(averageExcessSpecialTransfer(near,Array(49).fill(0),146).totalCents,0,'不足半分的超额不人为加到一元或一分');
});

test('使用实际玩家赔率与退水，逐号赔付独立结算核对，平均只取选定日期市场的特码',()=>{
  const docs=[doc('新01.01.02各0.01\n旧03各999\n新平特肖马各100'),doc('新01.03各10','b'),doc('新04各900','c','2026-10-04')];
  const config=settings();config.odds.新.includePrincipal=false;
  config.playerOdds={a:{markets:{新:{rates:{'special-number':{rate:'1.5'}}}}},b:{markets:{新:{rates:{'special-number':{rate:'48.25'}}}}}};
  config.rebates={b:{perTenThousandCents:30000}};
  const {book,plan}=planFor(docs,config);assert.equal(book.stakeCents,2003);assert.equal(book.playerRebateCents,60);assert.equal(plan.averageCents,41);
  assert.deepEqual(plan.transferCents.slice(0,4),[961,0,959,0]);assert.equal(plan.totalCents,1920);assert.equal(plan.rebateCents,63);
  for(let number=1;number<=49;number++){
    const normal=Array.from({length:49},(_,i)=>i+1).filter(n=>n!==number).slice(0,6),draw={date,market:'新',issue:'2026278',numbers:[...normal,number]};
    let liability=0;
    for(const d of docs.filter(d=>d.rule.date===date))for(const b of d.bets.filter(b=>b.markets.includes('新')&&b.playType==='special-number')){
      const odds={...config.odds.新,rates:{...config.odds.新.rates,'special-number':config.playerOdds[d.id].markets.新.rates['special-number']}};
      liability+=settleBet(b,draw,odds).payoutCents;
    }
    const counterOdds=defaultOdds();counterOdds.rates['special-number'].rate='47.3';
    const outgoing=doc(`${number}各${(plan.transferCents[number-1]/100).toFixed(2)}`,'counterparty').bets[0];
    const received=settleBet(outgoing,draw,counterOdds).payoutCents;
    assert.equal(plan.profitCents[number-1],2003-60-liability-1920+63+received,`开${number}的整盘净盈亏`);
  }
  config.playerOdds.b.markets.新.rates['special-number'].rate='40';
  const changed=planFor(docs,config).plan;assert.deepEqual(changed.transferCents,plan.transferCents);assert(changed.profitCents[0]>plan.profitCents[0]);
});

test('均匀分布和空分布不转出，负利润照实保留，统计均值与49种结果一致',()=>{
  const p=averageExcessSpecialTransfer(Array(49).fill(10000),Array(49).fill(470000),475300);
  assert.equal(p.totalCents,0);assert.equal(p.transferNumberCount,0);assert(p.profitCents.every(n=>n===5300));
  const empty=averageExcessSpecialTransfer(Array(49).fill(0),Array(49).fill(0),0);assert.equal(empty.bestProfitCents,0);assert.equal(empty.worstProfitCents,0);
  const {plan,book}=planFor([doc('01各100\n02各50')]);
  assert.equal(plan.feasible,true);assert(plan.worstProfitCents<0);
  assert.equal(plan.worstProfitCents,Math.min(...plan.profitCents));assert.equal(plan.bestProfitCents,Math.max(...plan.profitCents));
  assert(Math.abs(plan.expectedProfitCents-plan.profitCents.reduce((n,p)=>n+p,0)/49)<1e-8);
  assert.equal(plan.nonLossCount,plan.profitCents.filter(n=>n>=0).length);
  assert.equal(plan.expectedMarginPercent,plan.expectedProfitCents/book.stakeCents*100);
});

test('不使用待处理投注或其他期号，输入金额与运算溢出不能静默产生建议',()=>{
  const {book,plan}=planFor([doc('01各100\n特码99各200')]);assert.equal(book.stakeCents,10000);assert(book.issueCount>0);assert.equal(plan.averageCents,204);
  assert.throws(()=>planFor([doc('第277期01各10'),doc('第278期02各10','b')]),/不同期号/);
  for(const stakes of [Array(48).fill(0),[NaN,...Array(48).fill(0)],[-1,...Array(48).fill(0)],[0.5,...Array(48).fill(0)]])assert.throws(()=>averageExcessSpecialTransfer(stakes,Array(49).fill(0),0));
  assert.throws(()=>averageExcessSpecialTransfer(Array(49).fill(0),Array(48).fill(0),0),/49/);
  assert.throws(()=>averageExcessSpecialTransfer(Array(49).fill(0),Array(49).fill(-1),0),/金额/);
  assert.throws(()=>averageExcessSpecialTransfer(Array(49).fill(0),Array(49).fill(0),NaN),/金额/);
  assert.throws(()=>averageExcessSpecialTransfer([Number.MAX_SAFE_INTEGER,...Array(48).fill(0)],Array(49).fill(0),0),/范围/);
});
