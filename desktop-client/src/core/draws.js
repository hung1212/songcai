import { MARKETS, ruleForDate } from './rules.js';
import { HKJC_RESULTS_QUERY } from './hkjc-query.js';

export const DRAW_SOURCES = [
  { id: 'lamlhc-old', name: 'lamlhc.com · 老澳门', markets: ['旧'], format: 'lamlhc', provider: 'lamlhc', page: 'https://www.lamlhc.com/result', note: '已核对2026277期07,12,49,19,23,08+48；读取页面最近5期，生肖由本软件按农历计算。' },
  ...['新','旧','港'].flatMap((market,i) => [
    { id: `pengsai-${['new','old','hk'][i]}`, name: `彭赛 · ${['新澳门','老澳门','香港'][i]}`, markets: [market], format: 'bridge', provider: 'pengsai', channel: ['newMacau','oldMacau','hk'][i], endpoint: 'https://x.pengsai.pro/fetch_lottery.php', page: 'https://x.pengsai.pro/', note: '页面最近号码与用户确认一致；接口仅接收带日期的完整记录，不推算无日期历史。' },
    { id: `liucai-${['new','old','hk'][i]}`, name: `六彩聚 · ${['新澳门','老澳门','香港'][i]}`, markets: [market], format: i === 0 ? 'macaujc' : 'bridge', provider: i === 0 ? 'macaujc' : 'pengsai', channel: ['macaujc2','oldMacau','hk'][i], type: i === 0 ? '8' : undefined, endpoint: 'https://api.pengsai.pro/fetch_lottery.php', page: 'https://liucaiju.com/', note: i === 0 ? '网页使用macaumarksix接口，与macaujc.com同源。' : '网页使用彭赛接口，与彭赛同源，不重复计算核对来源。' },
  ]),
  { id: 'macaujc-new', name: 'macaujc.com · 新澳门', markets: ['新'], format: 'macaujc', channel: 'macaujc2', type: '8', page: 'https://macaujc.com/api/', note: '已实测2026年历史；第三方来源，请核对所用盘面。' },
  { id: 'macaujc-normal', name: 'macaujc.com · 澳门（22:32，非用户旧频道）', retired: true, markets: ['旧'], format: 'macaujc', channel: 'macaujc', type: '7', page: 'https://macaujc.com/api/', note: '22:32频道；不能仅凭“澳门”名称认定为你的旧市场。' },
  { id: '1234-old', name: '1234开奖网 · ㊣澳门（非用户旧频道）', retired: true, markets: ['旧'], format: 'opencode', channel: '2032', page: 'https://www.1234kj.tv/post/?lotteryId=2032', note: '已确认不是用户使用的旧频道，历史记录仅供查看。' },
  { id: '1234-new', name: '1234开奖网 · 新澳门', markets: ['新'], format: 'opencode', channel: '2033', page: 'https://www.1234kj.tv/post/?lotteryId=2033', note: '可选第三方来源；按同一期实际号码核对。' },
  { id: 'hkjc', name: '香港马会 · 官方域名接口', markets: ['港'], format: 'hkjc', page: 'https://bet.hkjc.com/ch/marksix/results', note: '读取官方接口最近30期，按查询年份过滤；更早历史可能缺期。正码按大小排列。' },
  { id: '1234-hk', name: '1234开奖网 · 香港（第三方）', markets: ['港'], format: 'opencode', channel: '2034', page: 'https://www.1234kj.tv/post/?lotteryId=2034', note: '读取网页所用年度历史接口；2026105期已与香港马会和用户号码核对一致。' },
];
export const DRAW_REFERENCES = [
  { id: 'aa1396', name: 'aa1396.vip', page: 'https://aa1396.vip/', note: '2026-10-05访问时跳到澳门宝典下载页，尚未取得公开开奖接口。可人工核对后录入，不计作自动获取。' },
];
export const DEFAULT_DRAW_SOURCES = { 新: ['macaujc-new', 'pengsai-new', 'liucai-new'], 旧: ['lamlhc-old', 'pengsai-old', 'liucai-old'], 港: ['hkjc', '1234-hk', 'pengsai-hk', 'liucai-hk'] };
export function normalizeSources(input, expandLegacy = false) {
  return Object.fromEntries(MARKETS.map(m => {
    const value = input?.[m];
    let ids = Array.isArray(value) ? value : value ? [value] : [];
    if (expandLegacy && typeof value === 'string') ids = [...ids.filter(id => !DRAW_SOURCES.find(s => s.id === id)?.retired), ...DEFAULT_DRAW_SOURCES[m]];
    ids = [...new Set(ids)];
    ids.forEach(id => { if (drawSource(id, m).retired) throw new Error('该频道与用户确认的旧市场不符，请选择老澳门来源'); });
    return [m, ids];
  }));
}
export function manualDraw(input) {
  const reference = DRAW_REFERENCES.find(r => r.id === input.referenceId);
  if (input.referenceId && !reference) throw new Error('未知参考网站');
  return { ...input, sourceId: reference ? `manual-${reference.id}` : 'manual',
    sourceName: reference ? `${reference.name}（人工录入）` : input.sourceName || '手动核对录入', sourceUrl: reference?.page || '' };
}
export function drawSource(id, market) {
  const source = DRAW_SOURCES.find(s => s.id === id && s.markets.includes(market));
  if (!source) throw new Error('请选择与市场相符的开奖来源');
  return source;
}
export function drawRequest(source, year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('查询年份无效');
  if (source.retired) throw new Error('该频道与用户确认的旧市场不符');
  if (source.format === 'lamlhc') return { url: source.page, method: 'GET', responseType: 'text' };
  if (source.format === 'bridge') return { url: source.endpoint, method: 'GET' };
  if (source.format === 'macaujc') return { url: `https://history.macaumarksix.com/history/${source.channel}/y/${year}`, method: 'GET' };
  if (source.format === 'opencode') return { url: 'https://www.1234kj.tv/api/HistoryOpenInfo', method: 'POST', contentType: 'application/x-www-form-urlencoded; charset=UTF-8', body: new URLSearchParams({lotteryId: source.channel, issueNum: String(year)}).toString() };
  return { url: 'https://info.cld.hkjc.com/graphql/base/', method: 'POST', body: JSON.stringify({
    query: HKJC_RESULTS_QUERY, operationName: 'marksixResult', variables: { lastNDraw: 30 },
  }) };
}
export function validateDraw(input, now = Date.now()) {
  if (!MARKETS.includes(input.market)) throw new Error('开奖市场无效');
  const issue = String(input.issue || '').trim();
  if (!/^\d{2,4}[-/]?\d{1,4}$/.test(issue)) throw new Error('期号须为数字，可使用2026277或26/087');
  const date = String(input.date || ''); ruleForDate(date);
  if (/^\d{7}$/.test(issue) && !issue.startsWith(date.slice(0, 4))) throw new Error('期号年份与开奖日期不符');
  const numbers = Array.isArray(input.numbers) ? input.numbers : String(input.numbers || '').trim().split(/[\s,，、+]+/).map(Number);
  if (numbers.length !== 7 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 49) || new Set(numbers).size !== 7) throw new Error('开奖必须有7个不同的01–49号码，前6个为平码，最后1个为特码');
  if (Date.parse(`${date}T00:00:00+08:00`) > now) throw new Error('不能使用未来日期的开奖');
  const openedAt = String(input.openedAt || '');
  if (openedAt && (!Number.isFinite(Date.parse(openedAt)) || Date.parse(openedAt) > now + 60_000 || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(openedAt)) !== date)) throw new Error('开奖时间与日期不符或尚未开奖');
  return { market: input.market, issue, date, numbers: [...numbers], openedAt, sourceId: String(input.sourceId || 'manual'), sourceName: String(input.sourceName || '手动录入').slice(0, 160), sourceUrl: String(input.sourceUrl || '').slice(0, 500) };
}
export function decodeDraws(payload, source, market, year, now = Date.now()) {
  if (payload?.errors?.length) throw new Error('开奖接口返回查询错误');
  if (source.format === 'lamlhc') {
    if (typeof payload !== 'string') throw new Error('开奖页面格式不正确');
    const section = payload.match(/mchkl:\{[\s\S]*?results:\[([\s\S]*?)\]/)?.[1];
    if (!section) throw new Error('开奖页面结构已变化，无法读取');
    payload = [...section.matchAll(/\{openCode:"([0-9,]+)",issue:"(\d+)",openTime:"([0-9 :\-]+)"\}/g)].map(m => ({openCode:m[1], issue:m[2], openTime:m[3]}));
  }
  if (source.format === 'bridge') {
    const channel = payload?.[source.channel];
    if (!channel?.latest || channel.error) throw new Error('接口没有返回该市场的完整开奖');
    // The observed bridge history lists have no dates; only use dated latest.
    payload = [channel.latest];
  }
  let rows = source.format === 'hkjc' ? payload?.data?.lotteryDraws : Array.isArray(payload) ? payload : payload?.data;
  if (source.format === 'opencode' && rows && !Array.isArray(rows) && typeof rows === 'object' && Object.keys(rows).every(key => /^\d+$/.test(key))) rows = Object.values(rows);
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('接口未返回有效开奖记录列表');
  if (source.format === 'macaujc' && !Array.isArray(payload) && payload.code !== 200 || source.format === 'opencode' && payload.code !== 0) throw new Error('开奖接口返回失败状态');
  const records = [], rejected = [];
  for (const row of rows) {
    try {
      if (!row || typeof row !== 'object') throw new Error('开奖记录格式不正确');
      let issue, openedAt, date, numbers;
      if (source.format === 'hkjc') {
        if (!row.drawResult?.drawnNo || row.drawResult.xDrawnNo == null) throw new Error('未完成开奖');
        issue = `${row.year}${String(row.no).padStart(3, '0')}`;
        date = String(row.drawDate).slice(0, 10);
        numbers = [...row.drawResult.drawnNo, row.drawResult.xDrawnNo].map(Number); openedAt = '';
      } else {
        if (source.type && String(row.type) !== source.type) throw new Error('接口市场类型与来源不符');
        if (source.format === 'opencode' && row.lotteryId != null && String(row.lotteryId) !== source.channel) throw new Error('接口频道与来源不符');
        issue = row.expect || row.issue;
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.openTime)) throw new Error('接口开奖时间格式不正确');
        date = row.openTime.slice(0, 10); openedAt = row.openTime.replace(' ', 'T') + '+08:00'; numbers = row.openCode;
      }
      if (date.slice(0, 4) !== String(year)) continue;
      const value = validateDraw({ market, issue, date, openedAt, numbers, sourceId: source.id, sourceName: source.name, sourceUrl: source.page }, now);
      if (String(issue).length === 7 && !String(issue).startsWith(date.slice(0, 4))) throw new Error('期号年份与开奖日期不符');
      records.push(value);
    } catch (error) { rejected.push({ issue: String(row?.expect || row?.issue || row?.id || ''), reason: error.message }); }
  }
  if (!records.length) throw new Error(`没有可用的完整开奖记录${rejected.length ? '：' + rejected[0].reason : ''}`);
  return { records: records.sort((a, b) => b.date.localeCompare(a.date) || b.issue.localeCompare(a.issue)), rejected };
}
