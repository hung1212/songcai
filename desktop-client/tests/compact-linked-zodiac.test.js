import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,summarize,senderHeader} from '../src/core/parser.js';
import {statementEvidence,PARSER_VERSION} from '../src/core/business-syntax.js';
import {defaultOdds,settleDocuments} from '../src/core/settlement.js';
import {ledgerReceipt,receiptPages,receiptSvg} from '../src/core/ledger-receipt.js';
import {reviewInput,validateCandidate,assistanceFor,currentReviewItems} from '../src/core/ai-review.js';
import {upgradeDocument} from '../src/core/parser-upgrade.js';
import {highlightText} from '../src/core/highlight.js';

const line='复四肖：兔虎牛羊马蛇。各5元。';
const source=`副号：\n新澳特：19、29、39。各15元。\n${line}`;
const date='2026-10-05';
const doc=(text=source)=>({id:'compact-linked',name:'副号',text,businessDate:date});
const parse=(text=source,extra={})=>parseDocument(text,{...doc(text),...extra});
const valid=(text=source,extra={})=>{const p=parse(text,extra);assert.deepEqual(p.issues,[],text);return p;};

test('复四肖保留原玩家和市场，六选四15组各5元，共75元',()=>{
  const p=valid(),b=p.bets[1];
  assert.equal(senderHeader(line),null);assert.equal(p.bets.length,2);
  assert.deepEqual([b.playType,b.size,b.count,b.unitCents,b.totalCents],['linked-zodiac',4,15,500,7500]);
  assert.deepEqual(b.values,[...'兔虎牛羊马蛇']);assert.equal(b.basis,'每组');assert.equal(b.mode,'combination');
  assert.equal(b.playerId,'副号');assert.deepEqual(b.markets,['新']);assert.equal(b.raw,line);assert.equal(b.line,3);
  assert.equal(summarize([p]).totalCents,12000);assert.deepEqual(reviewInput(doc()).items,[]);
});

test('复N肖简写支持数字、中文、全角、空格、标题续行及已有复式写法',()=>{
  for(const title of ['复四肖','复4肖','复４肖','复 四 肖','复四连肖','四肖复式','复式四肖']){
    for(const separator of ['：',':',' ','：\n']){
      const text=`副号：旧\n${title}${separator}兔虎牛羊马蛇各5元`,b=valid(text).bets[0];
      assert.deepEqual([b.playerId,b.markets,b.playType,b.size,b.count,b.totalCents],['副号',['旧'],'linked-zodiac',4,15,7500],text);
    }
  }
  for(const [title,size,count] of [['复二肖',2,15],['复两肖',2,15],['复3肖',3,20],['复五肖',5,6]]){
    const b=valid(`${title}：兔虎牛羊马蛇各5`).bets[0];assert.deepEqual([b.size,b.count,b.totalCents],[size,count,count*500]);
  }
});

test('市场和玩家边界不变，真实姓名及明确绑定的同名玩家保留',()=>{
  const p=valid('副号：旧复四肖\n兔虎牛羊马蛇各5\n港复四肖兔虎牛羊马蛇各5\n张三：01各10');
  assert.deepEqual(p.bets.map(b=>[b.playerId,b.markets,b.playType]),[['副号',['旧'],'linked-zodiac'],['副号',['港'],'linked-zodiac'],['张三',['新'],'special-number']]);
  for(const name of ['复四肖玩家','复兴','雨'])assert.equal(valid(`${name}：01各10`).bets[0].playerId,name);
  assert.equal(valid('复四肖：01各10',{defaultPlayer:'复四肖'}).bets[0].playerId,'复四肖');
  for(const text of ['复四肖：兔虎牛各5','复四肖：兔虎牛羊马蛇','复四肖：01 02 03 04各5']){
    const p=parse(text);assert(p.issues.length,text);assert.equal(summarize([p]).totalCents,0,text);
  }
});

test('四连肖按原玩家10%退水，中奖和本命生肖赔率逐组计算',()=>{
  const p=valid(`副号：${line}`),odds={新:defaultOdds()};
  const playerOdds={副号:{markets:{新:{rates:{'zodiac-4':{rate:'20',specialRate:'10'}}}}}};
  const rebates={副号:{perTenThousandCents:30000,playRates:{'linked-zodiac-4':100000}}};
  const settle=numbers=>settleDocuments([p],{新:{market:'新',date,issue:'2026278',numbers}},odds,date,{rebates,playerOdds});
  const lost=settle([39,10,18,23,16,4,36]);
  assert.deepEqual([lost.stakeCents,lost.payoutCents,lost.rebateCents,lost.payableCents],[7500,0,750,750]);
  // Five selected animals present; four groups include 马, one does not.
  const won=settle([4,5,6,12,1,10,11]);
  assert.equal(won.entries[0].winCount,5);assert.equal(won.payoutCents,30000);assert.equal(won.rebateCents,750);
});

test('结算截图显示完整四连肖流水和退水',()=>{
  const document=doc(`副号：${line}`),p=valid(document.text),odds={新:defaultOdds()};
  const draws={新:{market:'新',date,issue:'2026278',numbers:[39,10,18,23,16,4,36]}},rebates={副号:{perTenThousandCents:30000,playRates:{'linked-zodiac-4':100000}}};
  const result=settleDocuments([p],draws,odds,date,{rebates}),inputs={kind:'current',selection:document.id,date,documents:[p],draws,settings:{odds,rebates}};
  const card=ledgerReceipt({document,result,inputs});
  assert.deepEqual([card.rebateTurnoverCents,card.rebateCents,card.payableCents,card.netCents],[7500,750,750,-6750]);
  assert.equal(card.rebateRows[0].key,'linked-zodiac-4');assert(receiptSvg(receiptPages(card)[0]).svg.includes('有效流水 75 · 10%'));
});

test('高亮与AI证据保留复四肖玩法，拒绝改成逐号特码',()=>{
  const tokens=highlightText(line);assert.equal(tokens.map(t=>t.text).join(''),line);assert(tokens.some(t=>t.kind==='play'&&t.text==='复四肖'));
  const play=statementEvidence(line).find(t=>t.field==='play');assert.deepEqual(play.types,['linked-zodiac']);assert.equal(play.size,4);
  const d=doc(),item=reviewInput(d,'all').items.find(i=>i.line===3);
  const bet={markets:['新'],play:'4连肖',selection:'兔虎牛羊马蛇',basis:'每组',amount:'5',evidence:{market:'',play:'复四肖',selection:'兔虎牛羊马蛇',amount:'5'}};
  assert.equal(validateCandidate({bets:[bet]},item,d).totalCents,7500);
  assert.throws(()=>validateCandidate({bets:[{...bet,play:'特码',basis:'每号'}]},item,d),/玩法|计费|选号/);
});

test('升级失效旧AI误解，保留原文和历史记录',()=>{
  const d=doc();d.parserVersion='parser-20261018-1';d.history=[{stakeCents:17000,payoutCents:23500}];
  d.assistance={...assistanceFor(d,[{line:3,source:line,status:'accepted',replacement:'特码兔虎牛羊马蛇各5'}]),version:'semantic-20261018-1'};
  const next=upgradeDocument(d);assert.equal(next.parserVersion,PARSER_VERSION);assert.equal(next.text,source);
  assert.deepEqual(next.history,d.history);assert.deepEqual(currentReviewItems(next),[]);
  const p=parseDocument(next.text,next);assert.equal(p.bets[1].totalCents,7500);assert.equal(p.bets[1].playerId,'副号');
});
