import { briefPoint, dailyThresholdGroups, filterDailyMovements, isNumber, numberText } from './daily-brief.js'

const n = value => numberText(value)
const signed = value => (value > 0 ? '+' : '') + n(value)
const history = (item, date) => (item?.history || []).filter(p => p.observation_date <= date).toSorted((a, b) => a.observation_date.localeCompare(b.observation_date))
const parse = value => { try { return JSON.parse(value) || {} } catch { return {} } }
const contractAt = (byId, date, rank) => {
  const text = briefPoint(byId.gold_futures_spread_details, date, date).value
  return typeof text === 'string' ? text.match(new RegExp(`(?:^|；)${rank}：\\s*(au\\d{4})`, 'i'))?.[1]?.toLowerCase() : null
}

// 只对固定的最近20条观察记录作评价；空值中断连续涨跌，不跳过缺失。
export function priceStatistic(item, date, name) {
  const points = history(item, date).slice(-20)
  if (points.length < 20 || points.some(p => !isNumber(p.value))) return ''
  const values = points.map(p => p.value), current = values.at(-1)
  const direction = Math.sign(current - values.at(-2))
  let count = 0
  for (let i = values.length - 1; i > 0 && direction && Math.sign(values[i] - values[i - 1]) === direction; i--) count++
  if (count >= 3) return `${name}近20个交易观察日内连续${count}期${direction > 0 ? '上涨' : '下跌'}`
  if (current < Math.min(...values.slice(0, -1))) return `${name}为近20个交易观察日最低`
  if (current > Math.max(...values.slice(0, -1))) return `${name}为近20个交易观察日最高`
  return ''
}

export function buildDailyReport(items, reportDate, brief, movements, thresholds, unavailable = []) {
  // 模板直接标记指标及最新数值，避免将日期、合约月份、历史前值误加粗。
  const annotations = []
  const targets = {}
  const mark = token => { const index = annotations.push(token) - 1; return `\uE000${index}\uE001` }
  const metric = (id, text, data) => {
    targets[id] = { ...targets[id], id, label: text, ...(data || {}) }
    return mark({ type: 'indicator', id, text })
  }
  const current = text => mark({ type: 'value', text })
  const segments = text => text.split(/(\uE000\d+\uE001)/).filter(Boolean).map(part =>
    /^\uE000\d+\uE001$/.test(part) ? annotations[Number(part.slice(1, -1))] : { type: 'text', text: part })
  const plain = text => segments(text).map(token => token.text).join('')
  const categoryOf = new Map(dailyThresholdGroups.flatMap(g => g.indicators.map(i => [i.id, i.category])))
  for (const id of ['gold_futures_daily_quotes', 'gold_futures_spread_details', 'ust_10y_real_yield']) categoryOf.set(id, 'price')
  const byId = Object.fromEntries(items.filter(item => !unavailable.includes(categoryOf.get(item.metadata.indicator_id) || (item.metadata.futures_product ? 'price' : ''))).map(item => [item.metadata.indicator_id, item]))
  const point = id => briefPoint(byId[id], reportDate)
  const d = date => date ? date.startsWith(reportDate.slice(0, 4)) ? date.slice(5) : date : '日期缺失'
  const spreadSentence = (id, label, rank) => {
    const p = point(id), records = history(byId[id], reportDate)
    if (!isNumber(p.value)) return `${metric(id, label + '价差', p)}（${d(p.date)}）数据缺失`
    const contract = rank ? contractAt(byId, p.date, rank) : null
    const comparable = offset => !rank || (contract && records.slice(-offset - 1).length === offset + 1 && records.slice(-offset - 1).every(r => contractAt(byId, r.observation_date, rank) === contract))
    const status = p.value > 0 ? '国内升水' : p.value < 0 ? '国内贴水' : '内外平价'
    let previous = '上期缺失，暂不比较'
    if (isNumber(p.previousValue) && comparable(1)) {
      const crossed = p.value * p.previousValue < 0
      const delta = Math.abs(p.value) - Math.abs(p.previousValue)
      previous = `较${d(p.previousDate)}${crossed ? '由' + (p.previousValue > 0 ? '升水转贴水' : '贴水转升水') + '，价差变化' + current(signed(p.change) + '元/克') : delta === 0 ? '持平' : (delta > 0 ? '扩大' : '收窄') + current(n(Math.abs(delta)) + '元/克')}`
    } else if (rank && !comparable(1)) previous = '换约或合约信息缺失，不比较上期'
    const t5 = records.at(-6)
    const back = !t5 || !isNumber(t5.value) ? '前5个交易观察日数据缺失' : !comparable(5) ? '前5个交易观察日涉及换约或合约不明，暂无可比变化' : `较前5个交易观察日（${d(t5.observation_date)}）${p.value === t5.value ? '持平' : (p.value > t5.value ? '上移' : '下移') + current(n(Math.abs(p.value - t5.value)) + '元/克')}`
    return `${metric(id, contract ? contract.replace(/^au/, 'Au') + '合约价差' : label + '价差', p)}（${d(p.date)}）${status}${current(n(Math.abs(p.value)) + '元/克')}，${previous}，${back}`
  }
  const spreadTexts = [spreadSentence('gold_domestic_spread', '现货', null), spreadSentence('gold_futures_spread', '最近偶数月', '主力'), spreadSentence('gold_futures_secondary_spread', '第二近偶数月', '次主力')]
  // 解释直接来自同日期两地价格的人民币变动，不借背景指标编造因果。
  let decomposition = ''
  const spread = point('gold_domestic_spread')
  if (isNumber(spread.change)) {
    const dates = [spread.date, spread.previousDate]
    const rows = dates.map(date => ['gold_price_anchor', 'london_gold_spot', 'usdcnh'].map(id => briefPoint(byId[id], reportDate, date).value))
    if (rows.flat().every(isNumber)) {
      const localChange = rows[0][0] - rows[1][0]
      const foreignChange = (rows[0][1] * rows[0][2] - rows[1][1] * rows[1][2]) / 31.1034768
      if (Math.abs(localChange - foreignChange - spread.change) < 0.02) decomposition = `现货较${d(spread.previousDate)}，${metric('gold_price_anchor', '国内现货价格')}变化${current(signed(localChange) + '元/克')}，${metric('london_gold_spot', '海外现货')}人民币折算价变化${current(signed(foreignChange) + '元/克')}，两者之差对应${metric('gold_domestic_spread', '现货价差')}变化${current(signed(spread.change) + '元/克')}；${localChange > foreignChange ? '国内价格的数值变化更高，价差上移' : localChange < foreignChange ? '海外折算价格的数值变化更高，价差下移' : '两地变化相同，价差不变'}。`
    }
  }
  const spreadValues = ['gold_domestic_spread', 'gold_futures_spread', 'gold_futures_secondary_spread'].map(id => point(id).value)
  const spreadConclusion = !spreadValues.every(isNumber) ? '部分期限价差缺失，分项看。' : spreadValues.every(v => v > 0) ? '国内现货及两档期货均较海外升水。' : spreadValues.every(v => v < 0) ? '国内现货及两档期货均较海外贴水。' : '国内外升贴水因期限而异。'
  const first = `${spreadConclusion}${spreadTexts.join('。')}。${decomposition}`

  const domesticCard = brief.cards.find(c => c.id === 'domestic-futures')?.rows[0]
  const foreignCard = brief.cards.find(c => c.id === 'international-futures')?.rows[0]
  const quotes = point('gold_futures_daily_quotes')
  const quote = parse(quotes.value).quotes?.find(q => q.contract?.toLowerCase() === domesticCard?.label?.toLowerCase())
  const localRecords = history(byId.gold_futures_daily_quotes, reportDate)
  const previousQuoteDate = localRecords.at(-2)?.observation_date
  const domestic = { value: quote?.close, date: quotes.date,
    previousValue: quote?.previous_date === previousQuoteDate ? quote?.previous_close : null, previousDate: previousQuoteDate }
  const foreignItem = Object.values(byId).find(item => item.metadata.futures_product === 'comex' && foreignCard?.label?.startsWith('期货' + item.metadata.contract_expiry?.slice(2).replace('-', '')))
  const foreignDate = unavailable.includes('price') ? null : foreignCard?.date
  const foreign = foreignDate ? briefPoint(foreignItem, reportDate, foreignDate) : {}
  const local = point('gold_price_anchor'), overseas = point('london_gold_spot')
  const priceLine = (p, label, unit, id) => {
    const name = metric(id, label, { ...p, unit })
    if (!isNumber(p.value)) return `${name}（${d(p.date)}）数据缺失`
    const change = isNumber(p.previousValue) && p.previousValue > 0 ? p.value - p.previousValue : null
    return `${name}（${d(p.date)}）${current(n(p.value) + unit)}，` + (isNumber(change) ? `较${d(p.previousDate)}变化${current(signed(change) + unit)}，涨跌幅${current(signed(change / p.previousValue * 100) + '%')}` : '比较期缺失或前值不适用，涨跌暂不评价')
  }
  const conclusion = isNumber(local.change) && isNumber(overseas.change)
    ? local.change > 0 && overseas.change > 0 ? '两地现货均上涨。' : local.change < 0 && overseas.change < 0 ? '两地现货均下跌。' : '两地现货表现分化或持平。' : '部分价格缺失，暂不判断整体方向。'
  const stats = [priceStatistic(byId.gold_price_anchor, reportDate, metric('gold_price_anchor', '国内现货')), priceStatistic(byId.london_gold_spot, reportDate, metric('london_gold_spot', '海外现货'))].filter(Boolean).slice(0, 2)
  const second = conclusion + [priceLine(local, '国内现货', '元/克', 'gold_price_anchor'), priceLine(overseas, '海外现货', '美元/盎司', 'london_gold_spot'), priceLine(domestic, `国内${domesticCard?.label || '最近偶数月期货'}`, '元/克', 'daily_domestic_futures_close'), priceLine(foreign, `海外${foreignCard?.label?.split(' · ')[0] || '最近偶数月期货'}`, '美元/盎司', 'daily_comex_0')].join('。') + '。' + (stats.length ? stats.join('；') + '。' : '')

  const real = point('ust_10y_real_yield')
  const extra = isNumber(real.change) && real.previousValue !== 0 ? filterDailyMovements([{ ...real, id: 'ust_10y_real_yield', label: '10年实际利率', group: 'rates', category: 'price', thresholdValue: real.change / Math.abs(real.previousValue) * 100 }], thresholds) : []
  const candidates = [...movements, ...extra].filter(r => ['volatility', 'rates', 'shares', 'volume', 'position'].includes(r.group) && !unavailable.includes(r.category))
  // 优先覆盖不同领域，再补充含义不同的指标；相近指标仍合并，最多10项。
  const bucket = r => r.id.startsWith('cftc_') ? 'cftc' : r.id.startsWith('comex_gold_') ? 'inventory'
    : r.group === 'rates' ? ['ust_10y_yield', 'ust_2y_yield'].includes(r.id) ? 'nominal-rates' : r.id
    : r.group === 'volatility' ? r.id === 'gold_etf_volatility_index' ? 'gvz' : 'historical-volatility'
    : r.group === 'shares' ? r.id : r.group
  const chosen = []
  const seen = new Set()
  const ranked = candidates.toSorted((a, b) => (b.id === 'ust_10y_real_yield') - (a.id === 'ust_10y_real_yield') || Math.abs(b.thresholdValue) - Math.abs(a.thresholdValue))
  const covered = new Set()
  for (const r of ranked) if (!covered.has(r.group)) { chosen.push(r); covered.add(r.group); seen.add(bucket(r)) }
  for (const r of ranked) if (!seen.has(bucket(r))) { chosen.push(r); seen.add(bucket(r)) }
  const indicatorLine = r => {
    const up = r.change > 0
    const label = ({ domestic_etf_total_shares: '国内ETF合计份额', spdr_gold_holdings: 'SPDR持金量', futures_volume: '黄金期货成交量', futures_open_interest: '黄金期货总持仓', gold_hv20: '20日波动率', gold_hv60: '60日波动率', gold_etf_volatility_index: 'GVZ' })[r.id] || r.label.replace('CFTC 非商业', 'CFTC')
    let change = signed(r.change) + (r.unit || '')
    let meaning
    if (r.group === 'volatility') {
      change = signed(r.change) + '个百分点'
      meaning = r.id === 'gold_etf_volatility_index'
        ? up ? '黄金ETF期权隐含波动率上升，反映预期价格波动加大，不指向未来涨跌方向' : '黄金ETF期权隐含波动率下降，反映预期价格波动收敛，不指向未来涨跌方向'
        : up ? '黄金价格在对应历史窗口内的实际波动加大，不指向未来涨跌方向' : '黄金价格在对应历史窗口内的实际波动收敛，不指向未来涨跌方向'
    }
    if (r.group === 'rates') {
      change = signed(r.change * 100) + '基点'
      meaning = r.id === 'ust_10y_real_yield' ? up ? '通常增加持有黄金的机会成本，但不能直接认定为当天金价变化的原因' : '通常降低持有黄金的机会成本，但不能直接认定为当天金价变化的原因' : r.id.includes('breakeven') ? up ? '市场通胀补偿上升，反映名义与通胀保值国债之间的定价差扩大' : '市场通胀补偿下降，反映名义与通胀保值国债之间的定价差收窄' : r.id.includes('spread') ? up ? '10年相对2年收益率之差上移，反映长短端利率关系变化' : '10年相对2年收益率之差下移，反映长短端利率关系变化' : '反映美元名义利率环境变化，黄金的持有机会成本还需结合实际利率观察'
    }
    if (r.group === 'shares') meaning = `通过ETF配置黄金的需求${up ? '增强' : '减弱'}，不等同现金净流${up ? '入' : '出'}${!up && local.change > 0 && overseas.change > 0 ? '，与两地现货上涨呈现不同方向' : ''}`
    if (r.group === 'volume') meaning = `对应市场的交易${up ? '更活跃' : '活跃度下降'}，体现成交规模变化，不代表资金净流${up ? '入' : '出'}`
    if (r.group === 'position') meaning = `未平仓合约规模${up ? '增加' : '减少'}，仅凭总量无法判断加多、加空或平仓的具体来源`
    if (r.id.startsWith('cftc_')) {
      const long = point('cftc_long'), short = point('cftc_short'), net = point('cftc_net_long')
      if ([long, short, net].every(p => p.date === net.date && p.previousDate === net.previousDate && isNumber(p.change)) && Math.abs(long.change - short.change - net.change) < 0.02)
        return `${metric('cftc_net_long', 'CFTC周度净多头', net)}（${d(net.date)}较${d(net.previousDate)}）变化${current(signed(net.change) + '吨')}，其中${metric('cftc_long', '多头', long)}变化${current(signed(long.change) + '吨')}、${metric('cftc_short', '空头', short)}变化${current(signed(short.change) + '吨')}，净额由多头变化减空头变化形成，不代表今日交易流量`
      meaning = '仅说明该分项持仓变化，不推断总资金流向'
    }
    if (r.id.startsWith('comex_gold_')) meaning = '反映对应库存变化，不代表投资资金流向'
    const level = isNumber(r.value) ? `由${n(r.previousValue)}${r.unit || ''}变为${current(n(r.value) + (r.unit || ''))}，` : ''
    const relative = !['rates', 'volatility'].includes(r.group) && isNumber(r.percent) ? `（${current(signed(r.percent) + '%')}）` : ''
    const percentile = isNumber(r.yearPercentile) ? `，处于近1年${current(numberText(r.yearPercentile, 1) + '%')}分位` : ''
    return `${metric(r.id, label, r)}（${d(r.date)}较${d(r.previousDate)}）${level}变化${current(change)}${relative}${percentile}，${meaning}`
  }
  const missingIndicators = dailyThresholdGroups.filter(g => ['volatility', 'rates', 'shares', 'volume', 'position'].includes(g.id))
    .flatMap(g => g.indicators).filter(i => byId[i.id] && !isNumber(point(i.id).value))
  const missingText = missingIndicators.length ? missingIndicators.map(i => `${metric(i.id, i.label, point(i.id))}（${d(point(i.id).date)}）数据缺失`).join('；') + '。' : ''
  const errorText = unavailable.length ? '部分指标最新数据暂不可得。' : ''
  const selected = []
  const selectedIds = []
  // 正文目标1000—1500字，保留三段及完整单项说明，不截断句子。
  for (const r of chosen.slice(0, 10)) {
    const sentence = indicatorLine(r)
    if (selected.length && plain(first + second + missingText + errorText + selected.join('。') + sentence).length > 1470) continue
    selected.push(sentence)
    selectedIds.push(r.id)
  }
  const third = (selected.length ? selected.join('。') + '。' : '按当前阈值，暂无明显变动指标。') + missingText + errorText
  const priceDates = [local.date, overseas.date, domestic.date, foreign.date]
  return { reportDate, observationDates: [...new Set(priceDates.filter(Boolean))].join(' / ') || '缺失',
    paragraphs: [first, second, third].map(plain), richParagraphs: [first, second, third].map(segments), targets, selectedIds,
    titles: ['价差现状与走势', '国内外黄金行情', '主要指标变化及含义'] }
}
