import {RATE_ROWS,TWO_NUMBER_SPECIAL_TOGGLE,withOptionalOdds,validateOdds} from './odds.js';
import {MARKETS} from './rules.js';

const own=(value,key)=>value&&Object.hasOwn(value,key)?value[key]:undefined;
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const rate=value=>{
  const text=String(value??'').trim();
  if(!/^\d{1,5}(?:\.\d{1,4})?$/.test(text)||Number(text)<=0||Number(text)>10000)throw new Error('玩家赔率须大于0、不超过10000，最多4位小数；留空继承市场默认');
  return text;
};

// Store only explicit fields. A market default remains live when it changes.
export function validatePlayerOdds(input={}) {
  if(!record(input)||Object.keys(input).length>10000)throw new Error('玩家赔率设置格式无效');
  return Object.fromEntries(Object.entries(input).flatMap(([id,value])=>{
    if(!id||id.length>1000||!record(value)||!record(value.markets??{})||value.name!==undefined&&(typeof value.name!=='string'||value.name.length>1000))throw new Error('玩家赔率设置格式无效');
    const markets=Object.fromEntries(Object.entries(value.markets??{}).flatMap(([market,config])=>{
      if(!MARKETS.includes(market)||!record(config)||!record(config.rates??{}))throw new Error('玩家赔率市场无效');
      const toggle=own(config,TWO_NUMBER_SPECIAL_TOGGLE);
      if(toggle!==undefined&&typeof toggle!=='boolean')throw new Error('玩家二中二正码＋特码开关无效');
      const rates=Object.fromEntries(Object.entries(config.rates??{}).flatMap(([key,fields])=>{
        const row=RATE_ROWS.find(r=>r.key===key);
        if(!row||!record(fields))throw new Error('玩家赔率玩法无效');
        const entries=Object.entries(fields).flatMap(([field,value])=>{
          if(field!=='rate'&&!(field==='specialRate'&&row.specialRate))throw new Error('玩家赔率档位无效');
          return String(value??'').trim()===''?[]:[[field,rate(value)]];
        });
        return entries.length?[[key,Object.fromEntries(entries)]]:[];
      }));
      return Object.keys(rates).length||toggle!==undefined?[[market,{rates,...(toggle===undefined?{}:{[TWO_NUMBER_SPECIAL_TOGGLE]:toggle})}]]:[];
    }));
    return Object.keys(markets).length?[[id,{...(value.name?{name:value.name}:{}),markets}]]:[];
  }));
}

export function effectivePlayerOdds(defaults,players,playerId,market) {
  const config=own(players,playerId)?.markets?.[market];
  if(!config||!defaults)return defaults;
  const base=withOptionalOdds(defaults),toggle=own(config,TWO_NUMBER_SPECIAL_TOGGLE);
  return {...base,...(toggle===undefined?{}:{[TWO_NUMBER_SPECIAL_TOGGLE]:toggle}),rates:Object.fromEntries(Object.entries(base.rates).map(([key,fields])=>[key,{...fields,...own(config.rates,key)}]))};
}

// Validate after merging player overrides, since an enabled player may use a
// personal rate while the market remains disabled with no default rate.
export function validatePlayerOddsSettings(odds,players) {
  for(const [id,player] of Object.entries(players))for(const market of Object.keys(player.markets)){
    try{validateOdds(effectivePlayerOdds(odds[market],players,id,market));}
    catch(error){throw new Error(`${player.name||id} · ${market}市场：${error.message}`);}
  }
}

export function playerOddsDraft(value) {
  return Object.fromEntries(MARKETS.map(m=>[m,Object.fromEntries(RATE_ROWS.map(r=>[r.key,{rate:value?.markets?.[m]?.rates?.[r.key]?.rate||'',specialRate:value?.markets?.[m]?.rates?.[r.key]?.specialRate||'',...(r.toggle?{enabled:value?.markets?.[m]?.[r.toggle]??''}:{})}]))]));
}

export function mergePlayerOddsEdits(original,latest,before,after,names={}) {
  const result=structuredClone(latest||{});
  const normalized=value=>String(value??'').trim()===''?undefined:rate(value);
  for(const [id,draft] of Object.entries(after)) {
    const updated=structuredClone(own(latest,id)||{markets:{}});let changed=false;
    for(const market of MARKETS)for(const row of RATE_ROWS)for(const field of row.specialRate?['rate','specialRate']:['rate']) {
      const old=normalized(own(before,id)?.[market]?.[row.key]?.[field]),next=normalized(draft[market]?.[row.key]?.[field]);
      if(old===next)continue;
      const initial=own(original,id)?.markets?.[market]?.rates?.[row.key]?.[field],current=own(latest,id)?.markets?.[market]?.rates?.[row.key]?.[field];
      if(current!==initial&&current!==next)throw new Error(`${own(names,id)||id}的${market}市场${row.label}赔率已在其他页面修改，请重新载入后核对`);
      updated.markets??={};updated.markets[market]??={rates:{}};updated.markets[market].rates[row.key]??={};
      if(next===undefined)delete updated.markets[market].rates[row.key][field];
      else updated.markets[market].rates[row.key][field]=next;
      changed=true;
    }
    for(const market of MARKETS)for(const row of RATE_ROWS.filter(r=>r.toggle)){
      const normalize=value=>{if(value===undefined||value==='')return undefined;if(typeof value!=='boolean')throw new Error('玩家二中二正码＋特码开关无效');return value;};
      const old=normalize(own(before,id)?.[market]?.[row.key]?.enabled),next=normalize(draft[market]?.[row.key]?.enabled);
      if(old===next)continue;
      const initial=own(original,id)?.markets?.[market]?.[row.toggle],current=own(latest,id)?.markets?.[market]?.[row.toggle];
      if(current!==initial&&current!==next)throw new Error(`${own(names,id)||id}的${market}市场二中二中奖开关已在其他页面修改，请重新载入后核对`);
      updated.markets??={};updated.markets[market]??={rates:{}};
      if(next===undefined)delete updated.markets[market][row.toggle];else updated.markets[market][row.toggle]=next;
      changed=true;
    }
    if(changed)Object.defineProperty(result,id,{value:{...updated,...(own(names,id)?{name:own(names,id)}:{})},enumerable:true,writable:true,configurable:true});
  }
  return validatePlayerOdds(result);
}
