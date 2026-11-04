import { summarizeAutdFees } from './autd-fees.js'
import { sourceLabel } from './source-labels.js'
import { annualizedBasisChange } from './futures-basis.js'
// 每日速递复用源序列；报告日、观察日及快照/缓存时间各自独立。
export const isNumber = value => typeof value === 'number' && Number.isFinite(value)
export const numberText = (value, digits = 2) => isNumber(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '数据暂缺'
const signedText = (value, digits = 2) => isNumber(value) ? (value > 0 ? '+' : '') + numberText(value, digits) : '暂不可计算'
const thresholdOrder = ['spread', 'price', 'volatility', 'rates', 'shares', 'volume', 'position']
export const dailyIndicatorGroups = [
  ['spread', '价差', ['spread', 'futures-spread']],
  ['spot', '现期', ['domestic-price', 'international-price', 'usdcnh']],
  ['forward', '远期', ['domestic-futures', 'international-futures', 'fx-futures']],
  ['risk', '风险波动', ['volatility', 'gvz']],
  ['macro', '宏观', ['treasury-10y', 'treasury-2y', 'treasury-spread', 'treasury-bei']],
  ['etf', 'ETF份额', ['domestic-etf', 'spdr', 'global-etf-weekly', 'global-etf-monthly']],
  ['trading', '交易与持仓', ['futures-volume', 'futures', 'autd', 'cftc']],
  ['inventory', '库存与交割', ['central-bank', 'london-inventory', 'comex']],
].map(([id, title, cards]) => ({ id, title, cards }))
export const dailyThresholdGroups = [
  { id: 'price', label: '价格阈值', max: 5, step: 0.05, initial: 1, indicators: [
    { id: 'gold_price_anchor', label: '上金所Au99.99收盘价', category: 'price', page: 'domestic', section: 'gold-price' },
    { id: 'london_gold_spot', label: '伦敦金现（北京时间15:30）', category: 'price', page: 'foreign', section: 'overseas-price' },
    { id: 'usdcnh', label: '美元兑离岸人民币', category: 'price', page: 'foreign', section: 'overseas-price' },
    { id: 'daily_domestic_futures_close', label: '国内黄金期货（最近偶数月合约）', metric: 'domestic', category: 'price', page: 'domestic', section: 'domestic-futures' },
    ...['comex', 'sgx_usdcnh'].flatMap(product => [0, 1].map(rank => ({
      id: `daily_${product}_${rank}`, metric: product, rank, digits: product === 'comex' ? 2 : 4,
      label: `${product === 'comex' ? '国际黄金期货' : '美元兑离岸人民币期货'}（${rank === 0 ? '最近' : '第二近'}偶数月合约）`,
      category: 'price', page: 'foreign', section: 'overseas-futures',
    }))),
  ] },
  { id: 'volatility', label: '波动率阈值', max: 5, step: 0.05, initial: 1, description: '按波动率相对上一观察期的百分比变化筛选，同时展示百分点变化。', indicators: [
    { id: 'gold_hv20', label: '20日年化历史波动率', category: 'price', page: 'domestic', section: 'gold-volatility' },
    { id: 'gold_hv60', label: '60日年化历史波动率', category: 'price', page: 'domestic', section: 'gold-volatility' },
    { id: 'gold_etf_volatility_index', label: '黄金ETF波动率指数（GVZ）', category: 'price', page: 'foreign', section: 'gold-etf-volatility' },
  ] },
  { id: 'volume', label: '成交量阈值', max: 10, step: 0.1, initial: 5, indicators: [
    { id: 'au_td_volume', label: 'Au(T+D) 成交量', category: 'au-td', page: 'domestic', section: 'au-td' },
    { id: 'futures_volume', label: '上期所黄金期货总成交量', category: 'futures', page: 'domestic', section: 'futures' },
  ] },
  { id: 'rates', label: '利率阈值', max: 5, step: 0.05, initial: 1, description: '按利率指标较上一观察期的相对变动百分比筛选；利差和利率为零或负值时，以比较期绝对值为分母。', indicators: [
    { id: 'ust_10y_yield', label: '10年美债收益率', category: 'price', page: 'foreign', section: 'treasury-yields' },
    { id: 'ust_2y_yield', label: '2年美债收益率', category: 'price', page: 'foreign', section: 'treasury-yields' },
    { id: 'ust_10y_2y_spread', label: '10年－2年期限利差', category: 'price', page: 'foreign', section: 'treasury-yields' },
    { id: 'ust_10y_breakeven_inflation', label: '10年盈亏平衡通胀率（BEI）', category: 'price', page: 'foreign', section: 'treasury-yields' },
  ] },
  { id: 'spread', label: '价差阈值', kind: 'absolute', unit: '元/克', max: 5, step: 0.05, initial: 0, description: '按价差较上一观察期的绝对变动值筛选，单位为元/克，不使用百分比。', indicators: [
    { id: 'gold_domestic_spread', label: '国内外黄金价差', category: 'price', page: 'domestic', section: 'gold-price' },
    { id: 'gold_futures_spread', label: '黄金期货价差（最近偶数月合约）', metric: 'spread', rank: 0, category: 'price', page: 'domestic', section: 'domestic-futures' },
    { id: 'gold_futures_secondary_spread', label: '黄金期货价差（第二近偶数月合约）', metric: 'spread', rank: 1, category: 'price', page: 'domestic', section: 'domestic-futures' },
  ] },
  { id: 'position', label: '持仓量阈值', max: 1, step: 0.01, initial: 0.2, description: '同时覆盖COMEX黄金注册、已质押、合格及总库存；各项独立筛选，已质押库存不重复计入总库存。', indicators: [
    { id: 'au_td_open_interest', label: 'Au(T+D) 持仓量', category: 'au-td', page: 'domestic', section: 'au-td' },
    { id: 'futures_open_interest', label: '上期所黄金期货总持仓量', category: 'futures', page: 'domestic', section: 'futures' },
    { id: 'cftc_long', label: 'CFTC 非商业多头持仓', category: 'cftc', page: 'foreign', section: 'positions' },
    { id: 'cftc_short', label: 'CFTC 非商业空头持仓', category: 'cftc', page: 'foreign', section: 'positions' },
    { id: 'cftc_net_long', label: 'CFTC 非商业净多头持仓', category: 'cftc', page: 'foreign', section: 'positions' },
    ...['registered', 'pledged', 'eligible', 'total'].map((kind, index) => ({ id: `comex_gold_${kind}`, label: 'COMEX黄金' + ['注册库存', '已质押库存', '合格库存', '总库存'][index], category: 'inventory', page: 'foreign', section: 'comex' })),
  ] },
  { id: 'shares', label: '份额阈值', max: 1, step: 0.01, initial: 0.2, description: '包含国内7只黄金ETF合计份额，不含单只基金份额。', indicators: [
    { id: 'domestic_etf_total_shares', label: '国内7只黄金ETF合计份额', category: 'etf', page: 'domestic', section: 'domestic-etf' },
    { id: 'spdr_gold_holdings', label: 'SPDR黄金份额', category: 'etf', page: 'foreign', section: 'spdr' },
  ] },
].sort((a, b) => thresholdOrder.indexOf(a.id) - thresholdOrder.indexOf(b.id))
export function beijingDate(value = new Date()) {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = type => parts.find(p => p.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function briefPoint(item, reportDate, exactDate) {
  const history = (item?.history || []).filter(p => p.observation_date <= reportDate).toSorted((a, b) => a.observation_date.localeCompare(b.observation_date))
  const current = exactDate ? history.find(p => p.observation_date === exactDate) : history.at(-1)
  const date = exactDate || current?.observation_date || null
  const previous = history.findLast(p => p.observation_date < date)
  // 最新期为空、前一期为空、前值为0均不能跨期寻找另一个有效基准。
  const change = isNumber(current?.value) && isNumber(previous?.value) ? current.value - previous.value : null
  const percent = change != null && previous.value !== 0 ? change / Math.abs(previous.value) * 100 : null
  return { value: current?.value ?? null, date, previousValue: previous?.value ?? null, previousDate: previous?.observation_date || null, change, percent,
    unit: item?.metadata.unit || '', frequency: item?.metadata.frequency || '未提供', releaseDate: current?.release_date || null }
}

export function briefRow(item, reportDate, label, { exactDate, kind = 'quantity', unit, reason, digits = item?.metadata.display_digits ?? 2 } = {}) {
  const p = briefPoint(item, reportDate, exactDate)
  const actualUnit = unit ?? p.unit
  const suffix = kind === 'pp' ? '个百分点' : actualUnit
  const change = isNumber(p.change) ? `${signedText(p.change, digits)} ${suffix}` + (kind === 'percent' ? `（${isNumber(p.percent) ? signedText(p.percent) + '%' : '涨跌幅暂不可计算'}）` : '') : '变化暂不可计算'
  return { ...p, label, source: sourceLabel(item?.metadata), unit: actualUnit, valueText: isNumber(p.value) ? numberText(p.value, digits) : typeof p.value === 'string' && p.value.trim() ? p.value : '数据暂缺',
    changeText: typeof p.value === 'string' ? '变化不适用' : change,
    comparisonText: isNumber(p.change) ? `较 ${p.previousDate}` : '无有效比较基准', reason: p.value == null ? reason || '最新观察期缺失，不以前期值替代。' : '' }
}

function dailyFuturesData(items, reportDate) {
  const byId = Object.fromEntries(items.map(item => [item.metadata.indicator_id, item]))
  const row = (id, label, options) => briefRow(byId[id], reportDate, label, options)
  const spreadRows = [
    ['gold_futures_spread', '主力'], ['gold_futures_secondary_spread', '次主力'],
  ].map(([id, rank]) => {
    const metric = row(id, '', { unit: '元/克' })
    const details = metric.date ? briefPoint(byId.gold_futures_spread_details, reportDate, metric.date).value : null
    const contract = typeof details === 'string' ? details.match(new RegExp(`(?:^|；)${rank}：\\s*(au\\d{4})`, 'i'))?.[1] : null
    return { ...metric, label: contract ? contract.replace(/^au/i, 'Au') + '合约价差' : '合约名称暂缺' }
  })
  const internationalCards = ['comex', 'sgx_usdcnh'].map(product => {
      const candidates = items.filter(item => item.metadata.futures_product === product)
      const date = candidates.map(item => briefPoint(item, reportDate).date).filter(Boolean).sort().at(-1)
      const contracts = candidates.filter(item => item.metadata.contract_expiry >= date?.slice(0, 7) && Number(item.metadata.contract_expiry?.slice(-2)) % 2 === 0 && briefPoint(item, reportDate).date === date)
        .toSorted((a, b) => a.metadata.contract_expiry.localeCompare(b.metadata.contract_expiry)).slice(0, 2)
      return { id: product === 'comex' ? 'international-futures' : 'fx-futures', title: product === 'comex' ? '国际黄金期货' : '美元兑离岸人民币期货', category: 'price', page: 'foreign', section: 'overseas-futures',
        rows: [0, 1].map(index => briefRow(contracts[index], reportDate, (contracts[index] ? '期货' + contracts[index].metadata.contract_expiry.slice(2).replace('-', '') : `期货到期月份暂缺（${index + 1}）`) + ' · 北京时间15:00', { kind: 'percent', exactDate: date, digits: product === 'comex' ? 2 : 4 })),
        note: '按最近、第二近未过期偶数月合约展示；报价为北京时间15:00，原表关联标识不作为境外官方合约代码。' }
    })
  const quotePoint = briefPoint(byId.gold_futures_daily_quotes, reportDate)
  let quotes = {}
  try { quotes = JSON.parse(quotePoint.value) || {} } catch { /* 没有结构化合约数据时保留缺失。 */ }
  const main = quotes.quotes?.find(quote => quote.contract === quotes.main_contract)
  const domestic = briefRow(byId.gold_futures_daily_quotes && { ...byId.gold_futures_daily_quotes, history: [
    ...(main?.previous_date ? [{ observation_date: main.previous_date, value: main.previous_close }] : []),
    ...(quotePoint.date ? [{ observation_date: quotePoint.date, value: main?.close ?? null }] : []),
  ] }, reportDate, main ? main.contract.replace(/^au/i, 'Au') : '合约名称暂缺', { unit: '元/克', kind: 'percent' })
  domestic.contractQuotes = { date: quotePoint.date, quotes: quotes.quotes || [] }
  const spot = quotePoint.date ? briefPoint(byId.gold_price_anchor, reportDate, quotePoint.date) : { value: null }
  const basisRates = (quotes.quotes || []).map(quote => {
    const previousSpot = quote.previous_date ? briefPoint(byId.gold_price_anchor, reportDate, quote.previous_date).value : null
    return annualizedBasisChange(quote, spot.value, quotePoint.date, previousSpot)
  })
  const mainBasis = basisRates.find(quote => quote.contract === quotes.main_contract)
  const premium = { label: '升贴水率', date: quotePoint.date, value: mainBasis?.value ?? null, unit: '%',
    valueText: numberText(mainBasis?.value), source: [domestic.source, sourceLabel(byId.gold_price_anchor?.metadata)].filter(Boolean).join('；'),
    previousValue: mainBasis?.previousValue ?? null, previousDate: mainBasis?.previousDate || null, change: mainBasis?.change ?? null,
    changeText: isNumber(mainBasis?.change) ? `${signedText(mainBasis.change)} 个百分点` : '变化暂不可计算',
    comparisonText: isNumber(mainBasis?.change) ? `较 ${mainBasis.previousDate}` : '无有效比较基准',
    basisRates: { date: quotePoint.date, spot: spot.value, quotes: basisRates },
    detailText: mainBasis ? `${mainBasis.contract.replace(/^au/i, 'Au')} · 最后交易日 ${mainBasis.expiry_date || '未确认'}${mainBasis.days != null ? ' · 剩余' + mainBasis.days + '天' : ''}` : '',
    reason: mainBasis?.reason || (!mainBasis ? '主力合约数据暂缺' : '') }
  return { spreadRows, internationalCards, domestic, premium }
}

export function buildDailyTermStructure(items, reportDate, futuresData = dailyFuturesData(items, reportDate)) {
  const byId = Object.fromEntries(items.map(item => [item.metadata.indicator_id, item]))
  const spot = briefPoint(byId.gold_domestic_spread, reportDate)
  const ids = ['gold_futures_spread', 'gold_futures_secondary_spread']
  const histories = ids.map(id => (byId[id]?.history || []).filter(point => point.observation_date <= reportDate)
    .toSorted((a, b) => a.observation_date.localeCompare(b.observation_date)))
  const historicalPoint = (history, offset, rank) => {
    const point = history.at(-1 - offset)
    const date = point?.observation_date || null
    const details = date ? briefPoint(byId.gold_futures_spread_details, reportDate, date).value : null
    const contract = typeof details === 'string' ? details.match(new RegExp(`(?:^|；)${rank}：\\s*(au\\d{4})`, 'i'))?.[1] : null
    return { value: isNumber(point?.value) ? point.value : null, date,
      contract: contract ? contract.replace(/^au/i, 'Au') : null }
  }
  return {
    categories: ['黄金现价价差', ...futuresData.spreadRows.map(row => row.label)],
    curves: [0, 5, 10].map(offset => ({ offset, name: offset ? `T-${offset}` : '最新', points: [
      offset ? { value: null, date: null, contract: null } : { value: isNumber(spot.value) ? spot.value : null, date: spot.date, contract: null },
      ...histories.map((history, index) => historicalPoint(history, offset, index === 0 ? '主力' : '次主力')),
    ] })),
  }
}

export function buildDailyMovements(items, reportDate, futuresData = dailyFuturesData(items, reportDate)) {
  const byId = Object.fromEntries(items.map(item => [item.metadata.indicator_id, item]))
  const movements = dailyThresholdGroups.flatMap(group => group.indicators.flatMap(indicator => {
    const card = futuresData.internationalCards.find(card => indicator.metric === 'comex' ? card.id === 'international-futures' : indicator.metric === 'sgx_usdcnh' && card.id === 'fx-futures')
    const point = indicator.metric === 'domestic' ? futuresData.domestic
      : indicator.metric === 'spread' ? futuresData.spreadRows[indicator.rank]
      : card ? card.rows[indicator.rank] : briefPoint(byId[indicator.id], reportDate)
    const label = indicator.metric === 'domestic' ? '国内黄金期货 · ' + point.label
      : card ? card.title + ' · ' + point.label : indicator.metric === 'spread' ? point.label : indicator.label
    if (!isNumber(point.change) || !isNumber(point.previousValue)) return []
    // 百分比以前值绝对值作分母；价差直接使用变动值，前值为0也可比较。
    const percent = point.previousValue !== 0 ? point.change / Math.abs(point.previousValue) * 100 : null
    const thresholdValue = group.kind === 'absolute' ? point.change : percent
    if (!isNumber(thresholdValue)) return []
    return [{ ...indicator, ...point, label, digits: indicator.digits ?? byId[indicator.id]?.metadata.display_digits ?? 2, group: group.id, groupLabel: group.label.replace('阈值', ''), percent,
      thresholdValue, changeText: group.kind === 'absolute' ? `${signedText(point.change)} ${group.unit}` : `${signedText(percent)}%`,
      detail: group.id === 'volatility' ? `${signedText(point.change)} 个百分点` : '',
      trend: point.change > 0 ? 'up' : point.change < 0 ? 'down' : 'flat' }]
  }))
  const direction = briefPoint(byId.au_td_delivery_direction, reportDate)
  const knownDirections = ['多支付给空', '空支付给多', '交收平衡（无支付方向）']
  const comparableDirection = knownDirections.includes(direction.value) && knownDirections.includes(direction.previousValue)
  movements.push({ ...direction, id: 'au_td_delivery_direction', label: 'Au(T+D) 延期费支付方向',
    value: typeof direction.value === 'string' && direction.value.trim() ? direction.value : '数据暂缺',
    category: 'au-td', page: 'domestic', section: 'au-td', group: 'direction', groupLabel: '固定展示',
    changeText: comparableDirection ? direction.value === direction.previousValue ? '方向未变' : `${direction.previousValue} → ${direction.value}` : '无有效比较基准',
    trend: comparableDirection && direction.value === direction.previousValue ? 'flat' : 'direction' })
  return movements
}

export function filterDailyMovements(movements, thresholds) {
  return movements.filter(row => row.group === 'direction' ||
    (isNumber(thresholds[row.group]) && Math.abs(row.thresholdValue) - thresholds[row.group] > 1e-10))
}

export function buildDailyBrief(items, reportDate) {
  const byId = Object.fromEntries(items.map(i => [i.metadata.indicator_id, i]))
  const row = (id, name, options) => briefRow(byId[id], reportDate, name, options)
  const price = row('gold_price_anchor', '上金所Au99.99收盘价', { kind: 'percent', unit: '元/克' })
  const international = row('london_gold_spot', '伦敦金现 · 北京时间15:30', { kind: 'percent', unit: '美元/盎司' })
  const vol = row('gold_hv20', '20日年化历史波动率', { kind: 'pp', unit: '%' })
  const spread = row('gold_domestic_spread', 'Au99.99 − 海外金价人民币折算值', { unit: '元/克' })
  const shares = row('domestic_etf_total_shares', '7只ETF合计份额', { kind: 'percent', unit: '万份' })
  const spdr = row('spdr_gold_holdings', 'SPDR黄金份额', { unit: '吨' })
  const futures = row('futures_open_interest', '上期所黄金期货合计持仓', { kind: 'percent', unit: '吨' })
  const inventory = row('comex_gold_total', 'COMEX黄金总库存', { unit: '吨' })
  const directionHistory = (byId.au_td_delivery_direction?.history || []).filter(p => p.observation_date <= reportDate)
    .toSorted((a, b) => a.observation_date.localeCompare(b.observation_date))
  const fee = summarizeAutdFees({ history: directionHistory })[0]
  const previousFee = summarizeAutdFees({ history: directionHistory.slice(0, -1) })[0]
  const feeRow = { label: '近7个交易观测日多空统计', date: fee.end, feeWindow: fee, stats: [
    ['long', '多方支付'], ['short', '空方支付'],
  ].map(([key, label]) => {
    const value = fee.count && fee.valid ? fee[key] : null
    const change = isNumber(value) && !fee.incomplete && !previousFee.incomplete ? value - previousFee[key] : null
    return { label, value, valueText: isNumber(value) ? String(value) : '数据暂缺', unit: '天', change,
      changeText: isNumber(change) ? `${signedText(change)} 天` : '变化暂不可计算',
      comparisonText: isNumber(change) ? `较 ${previousFee.end} 的7观测日窗口` : '无有效比较基准' }
  }), value: fee.valid ? fee.valid : null, comparisonText: `统计区间：${fee.start || '未提供'} — ${fee.end || '未提供'}`,
  reason: `实际${fee.count}条${fee.incomplete ? '，不足7个交易观测日' : ''}；变化对比截至${previousFee.end || '未提供'}的前一个7观测日滚动窗口。` }
  const releaseGroups = [
    { name: '央行购金', ids: ['central_bank_reserves', 'global_central_bank_net_purchases'] },
    { name: '库存', ids: ['comex_gold_total', 'london_gold'] },
    { name: 'CFTC', ids: ['cftc_net_long'] },
  ]
  const releases = releaseGroups.map(group => {
    const sources = group.ids.map(id => byId[id]).filter(Boolean)
    const today = sources.filter(i => (i.history || []).some(p => p.observation_date <= reportDate && p.value != null && p.release_date &&
      (p.release_date?.length === 10 ? p.release_date : beijingDate(p.release_date)) === reportDate))
    const known = sources.length === group.ids.length && sources.every(i => briefPoint(i, reportDate).releaseDate)
    return { name: group.name, today: today.map(i => i.metadata.indicator_name), status: today.length ? '今日有发布记录' : known ? '暂无今日发布记录' : '发布日期未提供，无法确认今日新发布',
      observations: sources.map(i => `${i.metadata.indicator_name}：${briefPoint(i, reportDate).date || '数据暂缺'}`).join('；') || '数据暂缺' }
  })
  const futuresData = dailyFuturesData(items, reportDate)
  const cards = [
    { id: 'futures-spread', title: '黄金期货价差', category: 'price', page: 'domestic', section: 'domestic-futures', rows: [
      ...futuresData.spreadRows,
    ], note: '国内期货原价减同月COMEX及汇率期货折算值；沿用差额后复权价差。' },
    { id: 'usdcnh', title: '美元兑离岸人民币', category: 'price', page: 'foreign', section: 'overseas-price', rows: [row('usdcnh', '即期汇率 · 北京时间15:30', { kind: 'percent', digits: 4 })], note: '沿用北京时间15:30收盘报价。' },
    ...futuresData.internationalCards,
    { id: 'gvz', title: '黄金ETF波动率指数（GVZ）', category: 'price', page: 'foreign', section: 'gold-etf-volatility', rows: [row('gold_etf_volatility_index', 'GVZ', { kind: 'pp' })], note: '沿用黄金ETF波动率指数源序列。' },
    ...['weekly', 'monthly'].map(period => ({ id: 'global-etf-' + period, title: '全球ETF' + (period === 'weekly' ? '周度' : '月度'), category: 'etf', page: 'foreign', section: 'global-etf',
      rows: [row(`global_etf_${period}_total_tonnes`, '黄金净流量')],
      note: '源数据为全球黄金ETF净流量合计。' })),
    { id: 'futures-volume', title: '国内黄金期货交易', category: 'futures', page: 'domestic', section: 'futures', rows: [row('futures_volume', '上期所黄金期货合计成交量', { kind: 'percent' })], note: '同日全部黄金期货合约成交吨数合计。' },
    { id: 'cftc', title: 'CFTC非商业持仓', category: 'cftc', page: 'foreign', section: 'positions', layout: 'wide', rows: [
      row('cftc_long', '非商业多头', { kind: 'percent' }), row('cftc_short', '非商业空头', { kind: 'percent' }), row('cftc_net_long', '非商业净多头', { kind: 'percent' }),
      (() => {
        const item = byId.cftc_net_long_ratio
        return briefRow(item && { ...item, history: item.history.map(point => ({ ...point, value: isNumber(point.value) ? point.value * 100 : null })) }, reportDate, '非商业净多头占比', { kind: 'pp', unit: '%' })
      })(),
    ], note: '占比沿用净多头占比源序列，比例换算为百分比展示；持仓以吨计。' },
    { id: 'central-bank', title: '央行黄金储备', category: 'central-bank', page: 'domestic', section: 'central-bank', rows: [row('central_bank_reserves', '黄金储备 · 月度')], note: '月频数据，观察月份见数据日期。' },
    { id: 'london-inventory', title: '伦敦黄金库存', category: 'inventory', page: 'foreign', section: 'london', rows: [row('london_gold', '黄金库存 · 月度')], note: '月频数据，观察月份见数据日期。' },
  ]
  cards.push({ id: 'domestic-futures', title: '国内黄金期货', category: 'price', page: 'domestic', section: 'domestic-futures', rows: [futuresData.domestic, futuresData.premium], note: '升贴水率＝(期货−Au99.99现货)/现货×365/剩余自然日；期现价格与剩余天数均取同一观察日，按上期所最后交易日计算。' })
  const result = {
    movements: buildDailyMovements(items, reportDate, futuresData), termStructure: buildDailyTermStructure(items, reportDate, futuresData), releases,
    cards: [
      { id: 'domestic-price', title: '国内黄金价格', category: 'price', page: 'domestic', section: 'gold-price', rows: [price], note: '上金所Au99.99交易日收盘价；变化基准为上一条交易观测记录。' },
      { id: 'international-price', title: '国际黄金价格', category: 'price', page: 'foreign', section: 'overseas-price', rows: [international], note: 'Barchart精确结束于北京时间15:30的半小时K线close；不是LBMA定盘价。' },
      { id: 'volatility', title: '黄金历史波动率', category: 'price', page: 'domestic', section: 'gold-volatility', rows: [vol], note: '20个交易观测收益率、样本标准差、252日年化；只读上游结果，不代表未来涨跌方向。' },
      { id: 'spread', title: '国内外黄金价差', category: 'price', page: 'domestic', section: 'gold-price', rows: [spread], note: '同日期、北京时间15:30海外金价及汇率折算；美元/金衡盎司 × USDCNH ÷ 31.1034768，价差单位为元/克。' },
      { id: 'autd', layout: 'autd', title: 'Au(T+D)', category: 'au-td', page: 'domestic', section: 'au-td', rows: [
        row('au_td_volume', '成交量', { kind: 'percent', unit: '吨' }),
        row('au_td_open_interest', '持仓量', { kind: 'percent', unit: '吨' }),
        row('au_td_delivery_direction', '延期费支付方向', { unit: '' }),
        feeRow,
      ], note: '多空分项持仓数据暂缺；延期费支付方向不代表多空仓位，不推断多空强弱。' },
      { id: 'domestic-etf', layout: 'etf', title: '国内黄金ETF份额', category: 'etf', page: 'domestic', section: 'domestic-etf', rows: [shares], note: '固定7只基金、同一观察日；任一基金缺失则合计缺失。份额变化不等同资金净流入。' },
      { id: 'spdr', layout: 'last', title: 'SPDR黄金份额', category: 'etf', page: 'foreign', section: 'spdr', rows: [spdr], note: '采用黄金持仓吨数；不以ETF价格、份额替代黄金持仓。' },
      { id: 'futures', layout: 'last', title: '国内黄金期货持仓', category: 'futures', page: 'domestic', section: 'futures', rows: [futures], note: '上期所表内同日全部黄金期货合约持仓吨数合计，沿用上游单边口径；缺项或重复合约则合计为空。' },
      { id: 'comex', layout: 'last', title: 'COMEX黄金库存', category: 'inventory', page: 'foreign', section: 'comex', rows: [inventory], note: '黄金总库存＝注册库存＋合格库存；已质押库存不重复计入。' },
      { id: 'treasury-10y', layout: 'rate', title: '10年美债收益率', category: 'price', page: 'foreign', section: 'treasury-yields', rows: [row('ust_10y_yield', '10年美债收益率', { kind: 'percent' })], note: 'FRED DGS10 原始日度序列；观察日期以数据标注为准。' },
      { id: 'treasury-2y', layout: 'rate', title: '2年美债收益率', category: 'price', page: 'foreign', section: 'treasury-yields', rows: [row('ust_2y_yield', '2年美债收益率', { kind: 'percent' })], note: 'FRED DGS2 原始日度序列；观察日期以数据标注为准。' },
      { id: 'treasury-spread', layout: 'rate', title: '10年－2年期限利差', category: 'price', page: 'foreign', section: 'treasury-yields', rows: [row('ust_10y_2y_spread', '10年－2年期限利差', { kind: 'percent' })], note: '沿用FRED T10Y2Y原始序列，不由10年和2年收益率重算。' },
      { id: 'treasury-bei', layout: 'rate', title: '10年盈亏平衡通胀率（BEI）', category: 'price', page: 'foreign', section: 'treasury-yields', rows: [row('ust_10y_breakeven_inflation', '10年盈亏平衡通胀率（BEI）', { kind: 'percent' })], note: 'FRED T10YIE 原始日度序列；指标不是对实际通胀的直接预测。' },
    ],
  }
  const original = result.cards
  original.find(card => card.id === 'volatility').rows.push(row('gold_hv60', '60日年化历史波动率', { kind: 'pp', unit: '%' }))
  original.find(card => card.id === 'volatility').note = '20日、60日年化历史波动率；变化以百分点展示。'
  const comex = original.find(card => card.id === 'comex')
  const inventoryIds = ['comex_gold_registered', 'comex_gold_pledged', 'comex_gold_eligible', 'comex_gold_total']
  const inventoryDate = inventoryIds.map(id => briefPoint(byId[id], reportDate).date).filter(Boolean).sort().at(-1)
  comex.rows = inventoryIds.map((id, index) => row(id, ['注册库存', '已质押库存', '合格库存', '总库存'][index], { exactDate: inventoryDate }))
  comex.layout = 'wide'
  const allCards = Object.fromEntries([...original, ...cards].map(card => [card.id, card]))
  const groups = dailyIndicatorGroups.map(group => ({ ...group, cards: group.cards.map(id => allCards[id]) }))
  return { ...result, groups, cards: groups.flatMap(group => group.cards) }
}
