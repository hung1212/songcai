import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceSegments,ledgerSegments,segmentWinningDetail,segmentCopyText} from '../src/core/ledger-segments.js';
import {parseDocument,summarize} from '../src/core/parser.js';
import {settleDocuments,defaultOdds} from '../src/core/settlement.js';
const date='2026-10-27';
const document=text=>({id:'segment-ledger',name:'副号',businessDate:date,text});
const odds=()=>Object.fromEntries(['新','旧','港'].map(m=>[m,{...defaultOdds(),confirmed:true}]));
const draws=()=>Object.fromEntries(['新','旧','港'].map(m=>[m,{market:m,date,issue:'2026300',numbers:[38,10,48,49,13,9,5]}]));
function fixture(text,custom={}){const doc=document(text),parsed=parseDocument(text,doc),basis={odds:odds(),draws:draws(),...custom};const result=settleDocuments([parsed],basis.draws,basis.odds,date,{rebates:basis.rebates,playerOdds:basis.playerOdds});return {doc,parsed,basis,result,data:ledgerSegments(doc,parsed,result)};}
const sample='副号: \n老澳45.13各100米\n46.24.13..08各60米\n18.30..08.45.34.46.12.24.01.13各50米\n红波各10O米\n\n副号: \n新澳门：包：兔鸡猪鼠马龙狗各号40米\n\n副号: \n新澳门：12，24，36，48，01，13，25，37，49，03，15，27，39各20米\n04，16，28，40各40米';
test('用户示例：空行分3段，段内普通换行不拆，2640＋1160＋420＝4220',()=>{
 const {doc,parsed,result,data}=fixture(sample);assert.equal(data.count,3);assert(data.ready&&data.settlementReady);assert.deepEqual(data.rows.map(r=>r.stakeCents),[264000,116000,42000]);assert.equal(data.stakeCents,422000);assert.equal(data.stakeCents,summarize([parsed]).totalCents);assert.equal(data.payoutCents,result.payoutCents);
 assert.deepEqual(data.rows.map(r=>[r.line,r.endLine]),[[1,5],[7,8],[10,12]]);assert.deepEqual(data.rows.map(r=>r.markets),[['旧'],['新'],['新']]);assert.equal(data.rows[1].raw,doc.text.split('\n').slice(6,8).join('\n'));
});
test('连续空行、空格全角空格不增加空段，Windows换行保留行号，空账目0段',()=>{
 assert.deepEqual(sourceSegments('\r\n\t\r\n副号:\u00a0\r\n01各5\r\n \r\n　\r\n\u200b\r\n02各10\r\n\r\n').map(r=>[r.index,r.line,r.endLine]),[[1,3,4],[2,8,8]]);
 assert.equal(sourceSegments(' \n　\n\u200b').length,0);assert.equal(sourceSegments('01\n各5').length,1);
});
test('沿用整单市场和跨行金额，不重复解析；多市场金额每段合计守恒',()=>{
 const {data,parsed}=fixture('副号:\n新老01各10\n02各5\n\n副号:\n香港05各7');assert.equal(data.count,2);assert.deepEqual(data.rows.map(r=>r.stakeCents),[3000,700]);assert.equal(data.stakeCents,summarize([parsed]).totalCents);
 const cross=fixture('14.41.23.32.13.31.11.\n各5\n\n05各10');assert.equal(cross.data.rows[0].bets.length,1);assert.equal(cross.data.rows[0].stakeCents,3500);assert.equal(cross.data.rows[1].stakeCents,1000);
});
test('同号重复投注分段保留；中奖投注、赔付来自整单，不重新舍入退水',()=>{
 const x=fixture('05各2\n\n05各5\n\n20各100',{rebates:{副号:{perTenThousandCents:10000}}});
 assert.deepEqual(x.data.rows.map(r=>r.winCount),[1,1,0]);assert.deepEqual(x.data.rows.map(r=>r.payoutCents),[9400,23500,0]);assert.deepEqual(x.data.rows.map(r=>r.winningStakeCents),[200,500,0]);assert.equal(x.data.payoutCents,x.result.payoutCents);assert.notEqual(x.data.payoutCents,x.result.payableCents);
 const detail=segmentWinningDetail(x.result.entries[0],x.parsed.bets[0],x.doc,x.basis);assert.deepEqual(detail,{text:'05',partial:false});
 assert.equal(segmentCopyText(x.data.rows[0]),'1:2');
});
test('缺开奖、原文歧义、历史及过期解析不伪装成未中奖，review金额不计入已计投注',()=>{
 const x=fixture('05各10\n\n香港05各20',{draws:{新:draws().新}});assert.equal(x.data.rows[1].pending,1);assert.equal(x.data.rows[1].complete,false);
 const pending=fixture('01各10\n\n特肖三中三1 2 100');assert(pending.data.rows[1].issueCount>0);assert.equal(pending.data.stakeCents,summarize([pending.parsed]).totalCents);
 const ambiguous=fixture('新01各10\n02各20港');assert.equal(ambiguous.data.stakeCents,summarize([ambiguous.parsed]).totalCents);assert(ambiguous.data.ready);
 assert.equal(ledgerSegments(x.doc,x.parsed,x.result,{fresh:false}).ready,false);assert.equal(ledgerSegments(x.doc,x.parsed,x.result,{history:true}).settlementReady,false);
 const stale=structuredClone(x.result);stale.entries[0].raw='other';assert.equal(ledgerSegments(x.doc,x.parsed,stale).settlementReady,false);
 const missing=structuredClone(x.result);missing.entries.pop();assert.equal(ledgerSegments(x.doc,x.parsed,missing).settlementReady,false);
});
test('投注跨空行仍只归起始段，给出跨段标记；段数按源文本稳定计算',()=>{
 const x=fixture('01各10\n\n02各20');x.parsed.bets[0].endLine=3;
 const data=ledgerSegments(x.doc,x.parsed,x.result);assert.equal(data.count,2);assert.equal(data.rows[0].crossBoundary.length,1);assert.equal(data.stakeCents,3000);
});
test('各类中奖展示复用原规则，包含玩家单独二中二正特赔率与组选重复',()=>{
 for(const text of ['特码05 05 20各2','平特肖蛇羊马鼠各10','二中二38 10 48 20各10','二连肖蛇羊马鼠各10','二连尾8 9 0 2各10','三中二38 10 48 20各10','特串38 05各10','平特任中一05各10','平特任中一38各10','平特2尾100']){
  const x=fixture(text);assert.equal(x.parsed.issues.length,0,text);
  for(const e of x.result.entries.filter(e=>e.status==='won')){const detail=segmentWinningDetail(e,x.parsed.bets.find(b=>b.id===e.betId),x.doc,x.basis);assert.equal(detail.partial,false,text);assert(detail.text.length>0);}
 }
 const x=fixture('二中二38 05各10',{playerOdds:{副号:{markets:{新:{twoNumberSpecialEnabled:true,rates:{'linked-number-2-2-special':{rate:'20'}}}}}}});assert.equal(x.result.entries[0].status,'won');assert.deepEqual(segmentWinningDetail(x.result.entries[0],x.parsed.bets[0],x.doc,x.basis),{text:'38·05',partial:false});
 const many=fixture('二中二38 10 48 13 9各10');const d=segmentWinningDetail(many.result.entries[0],many.parsed.bets[0],many.doc,many.basis,2);assert(d.partial);assert.equal(d.text.split('、').length,2);assert.equal(many.data.rows[0].winCount,10);
});

test('精简复制仅保留段号与金额，整数无小数尾缀，保留分且不添加千位符',()=>{
 assert.equal([{index:1,stakeCents:1000},{index:2,stakeCents:3000},{index:3,stakeCents:0},{index:4,stakeCents:100005},{index:5,stakeCents:150}].map(segmentCopyText).join('\n'),'1:10\n2:30\n3:0\n4:1000.05\n5:1.5');
 assert.throws(()=>segmentCopyText({index:1,stakeCents:null}),/尚未就绪/);
});
