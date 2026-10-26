const row = (key, label, rate, specialRate = '') => ({ key, label, rate, specialRate });
export const TWO_NUMBER_SPECIAL_RATE='linked-number-2-2-special';
export const TWO_NUMBER_SPECIAL_TOGGLE='twoNumberSpecialEnabled';
export const RATE_ROWS = [
  row('special-number', '特码（每号）', '47'), row('special-zodiac', '特肖／一肖中特', '11.7', '9'),
  ...['5.6','3.7','2.8','2.25','1.9'].map((rate,i) => row(`any-${i+2}`, `${i+2}肖中特（整项）`, rate, ['5','3.4','2.6','2.1','1.9'][i])),
  row('wave-红波','红波','2.7'), row('wave-蓝波','蓝波','2.8'), row('wave-绿波','绿波','2.8'),
  ...Object.entries({ 红单:'5.5',红双:'5',红大:'6.3',红小:'4.5',蓝单:'5.5',蓝双:'5.5',蓝大:'5',蓝小:'6.3',绿单:'5.5',绿双:'6.3',绿大:'5.5',绿小:'6.3' }).map(([key,rate])=>row(`half-${key}`,key,rate)),
  row('attribute','大小单双／合单合双','1.9'),
  row('linked-number-3-3','三中三','650'), row('linked-number-2-2','二中二','60'),
  {...row(TWO_NUMBER_SPECIAL_RATE,'二中二：一个正码＋特码',''),toggle:TWO_NUMBER_SPECIAL_TOGGLE},
  row('three-two','三中二：中2个正码（原图20/90待定）',''), row('three-three','三中二：中3个正码（原图20/90待定）',''),
  row('two-normal','二中特：两个正码（原图25/50待定）',''), row('two-special','二中特：一个正码+特码（原图25/50待定）',''),
  row('special-pair','特串：一个正码+特码','150'),
  ...['4','10.5','30','98'].map((rate,i)=>row(`zodiac-${i+2}`,`${i+2}连肖`,rate,['3.8','8.5','28','85'][i])),
  ...['3','6.3','15'].map((rate,i)=>row(`tail-${i+2}`,`${i+2}连尾`,rate)),
  ...['6.5','3.5','2.5','2','1.75'].map((rate,i)=>row(`flat-any-${i+1}`,`${i+1}粒平特任中`,rate)),
  ...['2','2.4','2.9','3.5','4','5'].map((rate,i)=>row(`not-hit-${i+5}`,`${i+5}不中`,rate)),
  row('flat-number','平码／平特号码','7'), row('flat-zodiac','平特肖','2.05','1.8'),
  row('flat-tail','平特尾（非0尾）','1.8'), row('zero-tail','平特0尾','2.05'),
];
export function defaultOdds() {
  return { includePrincipal: true, confirmed: false, specialAnimal: 'lunar', [TWO_NUMBER_SPECIAL_TOGGLE]:false,
    scopes: { 'flat-number': 'six', 'flat-zodiac': 'seven', 'flat-tail': 'seven', 'flat-any': 'seven', 'linked-zodiac': 'seven', 'linked-tail': 'seven', 'not-hit': 'seven' },
    refund49: { attribute: null, sixZodiac: null, halfWave: false },
    rates: Object.fromEntries(RATE_ROWS.map(r=>[r.key,{ rate:r.rate, specialRate:r.specialRate }])) };
}
// Old settings and historical snapshots predate this optional winning tier.
// Supply only the new fields; never infer opt-in from a stored rate.
export function withOptionalOdds(input) {
  return {...input,[TWO_NUMBER_SPECIAL_TOGGLE]:input[TWO_NUMBER_SPECIAL_TOGGLE]===undefined?false:input[TWO_NUMBER_SPECIAL_TOGGLE],
    rates:{...input.rates,[TWO_NUMBER_SPECIAL_RATE]:input.rates?.[TWO_NUMBER_SPECIAL_RATE]??{rate:'',specialRate:''}}};
}
export function validateOdds(input) {
  const base = defaultOdds();
  if (!input || typeof input.includePrincipal !== 'boolean' || !['lunar','马'].includes(input.specialAnimal)) throw new Error('赔率本金或特殊生肖配置无效');
  for (const key of Object.keys(base.scopes)) if (!['six','seven'].includes(input.scopes?.[key])) throw new Error('中奖号码范围配置无效');
  for (const key of Object.keys(base.refund49)) if (![true,false,null].includes(input.refund49?.[key])) throw new Error('49和局配置无效');
  const twoNumberSpecialEnabled=input[TWO_NUMBER_SPECIAL_TOGGLE]??false;
  if(input[TWO_NUMBER_SPECIAL_TOGGLE]!==undefined&&typeof input[TWO_NUMBER_SPECIAL_TOGGLE]!=='boolean')throw new Error('二中二正码＋特码开关须为开启或关闭');
  const rates = {};
  for (const r of RATE_ROWS) {
    const value = input.rates?.[r.key]??(r.toggle?{rate:'',specialRate:''}:null); if (!value) throw new Error(`缺少${r.label}赔率`);
    rates[r.key] = {};
    for (const k of ['rate','specialRate']) {
      const text = String(value[k] ?? '').trim();
      if (text && (!/^\d{1,5}(?:\.\d{1,4})?$/.test(text) || Number(text) <= 0 || Number(text)>10000)) throw new Error(`${r.label}赔率须为大于0、不超过10000的数字，最多4位小数`);
      rates[r.key][k] = text;
    }
  }
  if(twoNumberSpecialEnabled&&!rates[TWO_NUMBER_SPECIAL_RATE].rate)throw new Error('开启二中二正码＋特码中奖后，请填写对应赔率');
  return { ...base, includePrincipal: input.includePrincipal, specialAnimal:input.specialAnimal, confirmed:input.confirmed===true, scopes:{...input.scopes},refund49:{...input.refund49},rates,[TWO_NUMBER_SPECIAL_TOGGLE]:twoNumberSpecialEnabled };
}
