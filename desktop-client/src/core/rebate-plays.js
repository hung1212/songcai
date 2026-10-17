const row=(id,name,group)=>({id,name,group});
export const REBATE_PLAYS=[
  row('special-number','特码（逐号）','特码'),row('wave','波色（整项）','特码'),row('half-wave','半波（整项）','特码'),
  row('special-zodiac','特肖／一肖中特','特肖'),
  ...[2,3,4,5,6].map(n=>row(`special-zodiac-any-${n}`,`${n}肖中特`,'特肖')),
  row('linked-number-2-2','二中二','连码'),row('linked-number-3-3','三中三','连码'),row('linked-number-3-2','三中二','连码'),row('linked-number-2-special','二中特','连码'),row('special-pair','特串','连码'),
  ...[2,3,4,5].map(n=>row(`linked-zodiac-${n}`,`${n}连肖`,'连肖')),
  row('flat-zodiac','平特肖','平特'),row('flat-tail','平特尾','平特'),row('flat-number','平码','平特'),row('flat-seven-number','平特号码（含特码）','平特'),
  ...[1,2,3,4,5].map(n=>row(`flat-any-${n}`,`${n}粒平特任中`,'平特')),
  ...[2,3,4].map(n=>row(`linked-tail-${n}`,`${n}连尾`,'连尾')),
  ...[5,6,7,8,9,10].map(n=>row(`not-hit-${n}`,`${n}不中`,'不中')),
  row('attribute','大小单双／合单合双','大小单双'),
];
export const REBATE_PLAY_IDS=new Set(REBATE_PLAYS.map(p=>p.id));
const names=new Map(REBATE_PLAYS.map(p=>[p.id,p.name]));
export function rebatePlayKey(bet) {
  if(bet.rebatePlayKey)return bet.rebatePlayKey;
  const type=bet.playType;
  if(type==='special-zodiac-any'&&bet.size===1)return 'special-zodiac';
  if(type==='flat-number'&&bet.play==='平特号码')return 'flat-seven-number';
  if(['special-zodiac-any','linked-zodiac','linked-tail','flat-any','not-hit'].includes(type))return `${type}-${bet.size}`;
  return type;
}
export const rebatePlayName=key=>names.get(key)||key||'其他玩法';
