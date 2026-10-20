import {MARKETS,WAVES,formatMoney,pad,ruleForDate,today} from './rules.js';
import {normalizeSources,validateDraw} from './draws.js';
import {settlementBalance} from './ledger-overview.js';
import {receiptRebateSummary,rebatePercent} from './rebates.js';
import {REBATE_PLAYS,rebatePlayName} from './rebate-plays.js';
import {wonStake} from './winning-display.js';

export const receiptMoney=cents=>formatMoney(cents).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');
export const receiptMarketName=market=>({新:'新澳',旧:'旧澳',港:'香港'})[market]||market;
const sum=values=>{const value=values.reduce((n,v)=>n+BigInt(v),0n);if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('结算单金额超出精确范围');return Number(value);};
const rateText=rate=>/^\d+(?:\.\d+)?$/.test(String(rate))?String(rate).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):'';
const tierNames={'three-two':'中二正码','three-three':'中三正码','two-normal':'二正码','two-special':'正码＋特码','zero-tail':'0尾'};
const ballColors={红:['#f88487','#d93143','#a61930'],蓝:['#78b8f6','#2876d1','#1752a1'],绿:['#75c79d','#208857','#12633d']};
const rebatePlayOrder=new Map(REBATE_PLAYS.map((p,i)=>[p.id,i]));
// Include every recorded stake, regardless of win, refund or settlement status.
// Winning tiers and rebate turnover are smaller subsets and cannot be used here.
function receiptPlayStakeRows(entries,bets) {
  const groups=new Map();
  for(const entry of entries){
    const bet=bets.get(entry.betId),name=entry.play||bet?.play||'未分类玩法',type=entry.playType||bet?.playType||'';
    const key=JSON.stringify([type,name]),row=groups.get(key)||{key,name,stakeCents:0};
    row.stakeCents=sum([row.stakeCents,entry.stakeCents]);groups.set(key,row);
  }
  return [...groups.values()].sort((a,b)=>b.stakeCents-a.stakeCents||a.name.localeCompare(b.name,'zh-CN'));
}
// Use the already allocated cents from the settlement snapshot. Recomputing
// turnover × rate here would lose the per-player rounding allocation.
function receiptRebateRows(players) {
  const groups=new Map();let unclassifiedCents=0;
  for(const person of players) {
    if(!person.rebateBreakdown){unclassifiedCents=sum([unclassifiedCents,person.rebateCents||0]);continue;}
    if(sum(person.rebateBreakdown.map(r=>r.rebateCents))!==(person.rebateCents||0))throw new Error('玩法退水明细与退水合计不一致');
    for(const detail of person.rebateBreakdown) {
      if(!detail.perTenThousandCents&&!detail.rebateCents)continue;
      const key=detail.playKey;
      const row=groups.get(key)||{key,name:({'special-number':'特码','special-zodiac':'特肖'})[key]||rebatePlayName(key),turnoverCents:0,rebateCents:0,rates:new Set()};
      row.turnoverCents=sum([row.turnoverCents,detail.turnoverCents]);row.rebateCents=sum([row.rebateCents,detail.rebateCents]);row.rates.add(detail.perTenThousandCents);groups.set(key,row);
    }
  }
  const rows=[...groups.values()].sort((a,b)=>(rebatePlayOrder.get(a.key)??999)-(rebatePlayOrder.get(b.key)??999)||String(a.key).localeCompare(String(b.key)))
    .map(({rates,...row})=>({...row,rate:rates.size===1?rebatePercent([...rates][0]):'多档退水率'}));
  if(unclassifiedCents)rows.push({key:'unclassified',name:'未分类退水',turnoverCents:null,rebateCents:unclassifiedCents,rate:''});
  return rows;
}
function receiptDraw(draw,market) {
  if(!draw)return {drawState:'missing',date:'',issue:'',balls:[]};
  try {
    const selected=validateDraw(draw);
    if(selected.market!==market)throw new Error('开奖市场不符');
    const zodiac=ruleForDate(selected.date).zodiac;
    return {drawState:'available',date:selected.date,issue:selected.issue,balls:selected.numbers.map((number,index)=>({number:pad(number),
      wave:Object.keys(WAVES).find(w=>WAVES[w].includes(number)),animal:Object.keys(zodiac).find(a=>zodiac[a].includes(number)),special:index===6}))};
  }catch{return {drawState:'incomplete',date:'',issue:'',balls:[]};}
}

// Keep the existing filename date based on the latest acquired New Macau draw.
// The image itself shows only the dates of its actual settlement markets.
export function latestNewDrawDate(records=[],settings={},cutoff=today()) {
  const sources=normalizeSources(settings.sources).新;
  return records.filter(d=>d.market==='新'&&d.date<=cutoff&&(sources.includes(d.sourceId)||String(d.sourceId).startsWith('manual')))
    .map(d=>d.date).sort().at(-1)||'';
}

// A receipt is a view of ONE settlement snapshot. Amounts come from the
// recorded per-entry payouts, never a second multiplication of grouped stakes.
export function ledgerReceipt({document,result,inputs,history=false,latestNewDate}) {
  if(!result||!inputs)return null;
  if(inputs.kind!=='current'||inputs.selection!==document.id||inputs.documents?.length!==1||inputs.documents[0].id!==document.id
    ||result.entries.some(e=>e.fileId!==document.id))throw new Error('结算数据不属于当前账目');
  const snapshot=inputs.documents[0],odds=inputs.settings?.odds||{},verification=inputs.verification||{};
  const bets=new Map((snapshot.bets||[]).map(b=>[b.id,b])),groups=new Map();let missingDetails=false;
  const playStakeRows=receiptPlayStakeRows(result.entries,bets);
  if(sum(playStakeRows.map(r=>r.stakeCents))!==result.stakeCents)throw new Error('玩法投注明细与投注总额不一致');
  for(const entry of result.entries.filter(e=>e.status==='won')) {
    const unit=entry.unitCents??bets.get(entry.betId)?.unitCents;
    const tiers=entry.tiers?.length?entry.tiers:[{count:entry.winCount,rate:'',key:'unknown',payoutCents:entry.payoutCents}];
    for(const tier of tiers) {
      const rate=rateText(tier.rate),principal=odds[entry.market]?.includePrincipal;
      const stake=Number.isSafeInteger(unit)&&Number.isSafeInteger(tier.count)?sum([BigInt(unit)*BigInt(tier.count)]):tiers.length===1?wonStake(entry,bets.get(entry.betId)):null;
      const valid=stake!==null&&!!rate&&typeof principal==='boolean';if(!valid)missingDetails=true;
      const key=JSON.stringify([entry.market,entry.playType,entry.play,tier.key,tier.yearAnimal||'',rate,principal,valid]);
      const item=groups.get(key)||{key,market:entry.market,play:entry.play,detail:tier.yearAnimal?`${tier.yearAnimal}年生肖档`:tierNames[tier.key]||'',rate,includePrincipal:principal,stakeCents:0,payoutCents:0,count:0,complete:valid};
      item.stakeCents=stake===null?null:item.stakeCents===null?null:sum([item.stakeCents,stake]);
      item.payoutCents=sum([item.payoutCents,tier.payoutCents]);item.count=sum([item.count,tier.count||0]);groups.set(key,item);
    }
  }
  const rows=[...groups.values()].sort((a,b)=>MARKETS.indexOf(a.market)-MARKETS.indexOf(b.market)||b.payoutCents-a.payoutCents);
  const winningPayout=sum(result.entries.filter(e=>e.status==='won').map(e=>e.payoutCents));
  if(sum(rows.map(r=>r.payoutCents))!==winningPayout)throw new Error('中奖明细与赔付总额不一致');
  if(sum(result.entries.map(e=>e.payoutCents||0))!==result.payoutCents||sum([winningPayout,result.refundCents])!==result.payoutCents)throw new Error('赔付明细汇总不一致');
  const rebateCents=result.rebateCents||0,payableCents=result.payableCents??result.payoutCents;
  if(sum([result.payoutCents,rebateCents])!==payableCents||sum((result.players||[]).map(p=>p.rebateCents||0))!==rebateCents)throw new Error('退水与应付汇总不一致');
  const rebateSummary=receiptRebateSummary(result.players||[]);
  const rebateRows=receiptRebateRows(result.players||[]);
  if(sum(rebateRows.map(r=>r.rebateCents))!==rebateCents)throw new Error('玩法退水明细与退水合计不一致');
  const balance=settlementBalance(result,verification,odds),markets=MARKETS.filter(m=>result.entries.some(e=>e.market===m));
  const warnings=[];
  if(!result.complete&&result.entries.length||result.issues.length)warnings.push(`待结算 ${result.pending} 笔 · 原文待处理 ${result.issues.length} 项`);
  if(markets.some(m=>!inputs.draws?.[m]))warnings.push('部分市场缺少开奖');
  if(markets.some(m=>inputs.draws?.[m]&&!verification[m]?.confirmed))warnings.push('开奖尚未完成核对');
  if(markets.some(m=>!odds[m]?.confirmed))warnings.push('赔率尚未确认');
  if(missingDetails)warnings.push('部分历史中奖金额或赔率未留存');
  const status=balance.status==='empty'?'empty':balance.status==='pending'?'pending':balance.status==='trial'||missingDetails?'trial':'complete';
  return {name:snapshot.name||document.name||'未命名账目',date:latestNewDate??inputs.draws?.新?.date??'',history,
    status,statusLabel:{empty:'空账目',pending:'未完成',trial:'试算',complete:'已核对'}[status],
    stakeCents:result.stakeCents,payoutCents:result.payoutCents,refundCents:result.refundCents,winningPayoutCents:winningPayout,
    rebateCents,payableCents,hasRebate:rebateSummary.hasRebate||rebateCents>0,rebateTurnoverCents:rebateSummary.turnoverCents,rebateRate:rebateSummary.rate,rebateRows,hasUnclassifiedRebate:rebateRows.some(r=>r.key==='unclassified'),
    netCents:balance.netCents,netLabel:balance.netCents===null?'待结算':balance.netCents>0?'盈':balance.netCents<0?'亏':'持平',
    rows,playStakeRows,warnings,markets:markets.map(m=>({market:m,stakeCents:sum(result.entries.filter(e=>e.market===m).map(e=>e.stakeCents)),...receiptDraw(inputs.draws?.[m],m)}))};
}

export function receiptFormula(row) {
  if(!row.complete)return `${row.stakeCents===null?'中奖金额待核对':receiptMoney(row.stakeCents)} · 赔率未留存`;
  return `${receiptMoney(row.stakeCents)} × ${row.includePrincipal?row.rate:`(${row.rate}＋1)`}`;
}
export const receiptRebateFormula=row=>row.turnoverCents===null?'历史记录未保存玩法明细':`有效流水 ${receiptMoney(row.turnoverCents)} · ${row.rate}`;
export function receiptPages(receipt,{showPlayStakes=false}={}){
  const rebateRows=receipt.rebateRows||[],playStakeRows=receipt.playStakeRows||[];
  const total=Math.max(1,Math.ceil(receipt.rows.length/18),Math.ceil(rebateRows.length/18),showPlayStakes?Math.ceil(playStakeRows.length/18):0);
  return Array.from({length:total},(_,i)=>({...receipt,rows:receipt.rows.slice(i*18,(i+1)*18),rebateRows:rebateRows.slice(i*18,(i+1)*18),
    playStakeRows:playStakeRows.slice(i*18,(i+1)*18),playStakeRowCount:playStakeRows.length,
    winningRowCount:receipt.rows.length,rebateRowCount:rebateRows.length,page:i+1,pages:total}));
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

// Shared SVG preview and PNG source ensure the exported card has exactly the
// same content. Name visibility is a presentation preference, never a change
// to the saved settlement or its historical account name.
export function receiptSvg(card,{showName=false,showPlayStakes=false}={}) {
  const parts=[];let y=40;
  const text=(x,baseline,value,size=20,color='#243e36',weight=400,anchor='start',maxWidth)=>parts.push(`<text x="${x}" y="${baseline}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}"${maxWidth&&String(value).length*size*.62>maxWidth?` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`:''}>${escape(value)}</text>`);
  const rect=(x,top,width,height,color,r=0)=>parts.push(`<rect x="${x}" y="${top}" width="${width}" height="${height}" rx="${r}" fill="${color}"/>`);
  const line=top=>rect(32,top,576,1,'#e3ebe6');
  rect(0,0,640,8,'#28674e');
  if(showName&&card.name?.trim()){
    parts.push('<g data-receipt-name="true">');
    const chars=Array.from(card.name.trim().replace(/[\r\n\t]/g,' '));
    for(let i=0;i<chars.length;i+=22){text(32,y,chars.slice(i,i+22).join(''),26,'#264b3c',700,'start',576);y+=34;}
    parts.push('</g>');y+=12;
  }
  if(card.pages>1)text(608,y,`${card.page}/${card.pages}`,14,'#6e8278',400,'end');
  if(card.markets.length) {
    parts.push('<defs>'+Object.entries(ballColors).map(([wave,colors])=>`<radialGradient id="receipt-ball-${wave}" cx="32%" cy="22%" r="80%"><stop offset="0%" stop-color="${colors[0]}"/><stop offset="48%" stop-color="${colors[1]}"/><stop offset="100%" stop-color="${colors[2]}"/></radialGradient>`).join('')+'</defs>');
    text(32,y,'本单开奖',18,'#264b3c',650);y+=18;
    for(const market of card.markets) {
      const available=market.drawState==='available';
      parts.push(`<g data-draw-market="${escape(market.market)}">`);
      rect(32,y,576,available?104:68,'#f5f8f6',10);
      text(48,y+24,receiptMarketName(market.market),17,'#315842',650);
      if(available) {
        text(592,y+24,`${market.date} · 第${market.issue}期`,13,'#74867b',400,'end',430);
        for(const [index,ball] of market.balls.entries()) {
          const cx=ball.special?520:120+60*index,cy=y+56;
          parts.push(`<g aria-label="${escape(`${ball.special?'特码':'正码'} ${ball.number}，${ball.wave}波，${ball.animal}`)}">`);
          if(ball.special){text(470,cy+6,'＋',18,'#879587',400,'middle');parts.push(`<circle cx="${cx}" cy="${cy}" r="21" fill="none" stroke="#bc9254" stroke-width="1.5"/>`);}
          parts.push(`<circle cx="${cx}" cy="${cy+2}" r="17" fill="#243e3612"/><circle cx="${cx}" cy="${cy}" r="17" fill="url(#receipt-ball-${ball.wave})" stroke="${ballColors[ball.wave][2]}" stroke-width="1"/>`);
          text(cx,cy+6,ball.number,18,'#fff',700,'middle');
          text(cx,y+90,ball.special?`${ball.animal} · 特`:ball.animal,12,ball.special?'#8b591e':'#617464',ball.special?600:400,'middle');
          parts.push('</g>');
        }
      }else text(48,y+51,market.drawState==='missing'?'暂无开奖':'开奖资料不完整',15,'#8a7b60');
      parts.push('</g>');y+=available?114:78;
    }
    y+=4;
  }
  rect(32,y,576,108,'#f0f6f2',14);text(52,y+33,card.status==='pending'?'总 · 已识别投注':'总 · 投注金额',19,'#527266');
  text(52,y+80,`¥ ${receiptMoney(card.stakeCents)}`,38,'#1e553e',700,'start',536);y+=138;
  if(showPlayStakes){
    parts.push('<g data-receipt-play-stakes="true">');
    text(32,y,'各玩法投注金额',23,'#264b3c',700);y+=20;line(y);
    for(const row of card.playStakeRows||[]){
      parts.push(`<g data-stake-play="${escape(row.key)}">`);
      y+=30;text(32,y,`${row.name}投注`,20,'#527266',400,'start',330);
      text(608,y,`${receiptMoney(row.stakeCents)} 元`,22,'#245e44',600,'end',220);y+=14;line(y);parts.push('</g>');
    }
    if(!card.playStakeRows?.length){y+=32;text(32,y,card.playStakeRowCount?'玩法投注明细见其他页':'暂无已识别投注',19,'#7c8c82');y+=14;}
    parts.push('</g>');y+=38;
  }
  text(32,y,'中 · 中奖明细',23,'#264b3c',700);text(608,y,'金额单位：元',15,'#7d8d84',400,'end');y+=31;
  text(32,y,'玩法 / 市场',16,'#7c8c82');text(435,y,'中奖金额 × 赔率',16,'#7c8c82',400,'end');text(608,y,'赔付',16,'#7c8c82',400,'end');y+=16;line(y);
  if(!card.rows.length){y+=45;text(32,y,card.winningRowCount?'中奖明细见其他页':card.status==='pending'?'尚无已计算的中奖记录':'无中奖记录',21,'#7c8c82');y+=29;line(y);}
  for(const row of card.rows){
    y+=32;text(32,y,row.play,22,'#2e5142',600,'start',175);text(435,y,receiptFormula(row),21,'#567162',400,'end',220);text(608,y,receiptMoney(row.payoutCents),25,'#245e44',650,'end',155);
    y+=29;text(32,y,`${receiptMarketName(row.market)}${row.detail?' · '+row.detail:''}`,16,'#7b8b80',400,'start',540);y+=23;line(y);
  }
  if(card.refundCents){y+=34;text(32,y,'退本金',19,'#527266');text(608,y,receiptMoney(card.refundCents),23,'#355445',600,'end');y+=20;line(y);}
  y+=42;text(32,y,card.status==='pending'?'已算赔付':'赔付合计',21,'#385a49',600);text(608,y,`¥ ${receiptMoney(card.payoutCents)}`,29,'#285d42',700,'end',350);y+=26;
  if(card.hasRebate){
    text(32,y+17,'退水合计',21,'#356780',600);text(608,y+17,`¥ ${receiptMoney(card.rebateCents)}`,27,'#356780',650,'end');y+=46;
    text(32,y,card.hasUnclassifiedRebate?'按已保存的结算金额展示':`有效流水 ${receiptMoney(card.rebateTurnoverCents)} · ${card.rebateRate}`,16,'#718b96',400,'start',570);y+=18;
    if(card.rebateRows?.length){
      line(y);
      for(const row of card.rebateRows){
        parts.push(`<g data-rebate-play="${escape(row.key)}">`);
        y+=28;text(32,y,row.name,20,'#356780',600,'start',400);text(608,y,receiptMoney(row.rebateCents),23,'#356780',650,'end',155);
        y+=24;text(32,y,receiptRebateFormula(row),15,'#718b96',400,'start',570);y+=15;line(y);parts.push('</g>');
      }
    }else if(card.rebateRowCount){y+=19;text(32,y,'退水明细见其他页',16,'#718b96');y+=14;}
    y+=31;
    text(32,y,card.status==='pending'?'已算应付':'应付合计',21,'#385a49',600);text(608,y,`¥ ${receiptMoney(card.payableCents)}`,29,'#285d42',700,'end',350);y+=26;
  }
  const netColor=card.netCents<0?'#a34f36':card.netCents===null?'#986b2d':'#235f46';
  rect(32,y,576,114,card.netCents<0?'#fcf1ec':card.netCents===null?'#fff5e5':'#eaf4ed',14);
  text(52,y+34,`${card.netLabel} · 玩家净输赢`,20,netColor,600);
  text(52,y+83,card.netCents===null?'待结算':`${card.netCents>0?'+':card.netCents<0?'−':''}${receiptMoney(Math.abs(card.netCents))}`,38,netColor,700,'start',530);y+=138;
  return {width:640,height:y,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${y}" viewBox="0 0 640 ${y}" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"><rect width="640" height="${y}" fill="#ffffff"/>${parts.join('')}</svg>`};
}
export const receiptFilename=card=>`${card.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,80)}-${card.date||'无开奖日期'}-结算单${card.pages>1?`-${card.page}`:''}.png`;
