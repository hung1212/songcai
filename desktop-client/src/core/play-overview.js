export const PLAY_GROUPS = [
  {id:'linked-number',name:'连码',description:'二中二、三中三、三中二、二中特、特串'},
  {id:'linked-zodiac',name:'连肖',description:'二连肖、三连肖等连肖玩法'},
  {id:'flat',name:'平特',description:'平特肖、平特尾、平码、平特任中'},
  {id:'special-number',name:'特码',description:'逐号特码、波色、半波'},
  {id:'special-zodiac',name:'特肖',description:'特肖、一肖至多肖中特'},
  {id:'attribute',name:'大小单双',description:'大小、单双、合单、合双的整项投注'},
  {id:'linked-tail',name:'连尾',description:'二连尾、三连尾、四连尾'},
  {id:'not-hit',name:'不中',description:'各类不中玩法'},
  {id:'other',name:'其他',description:'尚未归入上述分类的玩法'},
];

export function playGroup(type = '') {
  if(type.startsWith('linked-number')||type==='special-pair')return 'linked-number';
  if(type.startsWith('flat-'))return 'flat';
  if(type.startsWith('special-zodiac'))return 'special-zodiac';
  if(['special-number','wave','half-wave'].includes(type))return 'special-number';
  if(type==='attribute')return 'attribute';
  if(['linked-zodiac','linked-tail','not-hit'].includes(type))return type;
  return 'other';
}

const sum = values => {
  const total=values.reduce((n,value)=>n+BigInt(value||0),0n);
  if(total>BigInt(Number.MAX_SAFE_INTEGER)||total<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('玩法汇总金额超出精确计算范围');
  return Number(total);
};
function totals(entries,verification,odds) {
  const pending=entries.filter(e=>e.status==='pending').length;
  const trial=entries.some(e=>!verification[e.market]?.confirmed||!odds[e.market]?.confirmed);
  const stakeCents=sum(entries.map(e=>e.stakeCents)),payoutCents=sum(entries.map(e=>e.payoutCents));
  const wins=entries.filter(e=>e.status==='won');
  return {stakeCents,payoutCents,refundCents:sum(entries.map(e=>e.refundCents)),
    winningStakeCents:sum(wins.map(e=>e.winningStakeCents)),winCount:sum(wins.map(e=>e.winCount)),
    winEntries:wins.length,entryCount:entries.length,ledgerCount:new Set(entries.map(e=>e.fileId)).size,
    pending,netCents:pending?null:sum([payoutCents,-stakeCents]),
    status:pending?'pending':!entries.length?'empty':trial?'trial':'complete'};
}
function grouped(entries,keyFor,nameFor,verification,odds) {
  const groups=new Map();
  for(const e of entries){const id=keyFor(e);if(!groups.has(id))groups.set(id,{id,name:nameFor(e),entries:[]});groups.get(id).entries.push(e);}
  return [...groups.values()].map(g=>({...g,...totals(g.entries,verification,odds)})).sort((a,b)=>b.stakeCents-a.stakeCents);
}

// Use the already-settled per-market entries. Never add saved payout snapshots.
export function playOverview(entries,{group='',market='',verification={},odds={}}={}) {
  const marketEntries=entries.filter(e=>!market||e.market===market);
  const categories=PLAY_GROUPS.map(g=>({...g,...totals(marketEntries.filter(e=>playGroup(e.playType)===g.id),verification,odds)}));
  const selected=marketEntries.filter(e=>!group||playGroup(e.playType)===group);
  return {...totals(selected,verification,odds),categories,entries:selected,
    plays:grouped(selected,e=>`${e.playType}:${e.play}`,e=>e.play,verification,odds),
    ledgers:grouped(selected,e=>e.fileId,e=>e.fileName,verification,odds)};
}
