import { summarizeAutdFees } from './autd-fees.js'
// 每日速递复用源序列；报告日、观察日及快照/缓存时间各自独立。
export const isNumber = value => typeof value === 'number' && Number.isFinite(value)
export const numberText = (value, digits = 2) => isNumber(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '数据暂缺'
const signedText = value => isNumber(value) ? (value > 0 ? '+' : '') + numberText(value) : '暂不可计算'
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
  const percent = change != null && previous.value !== 0 ? change / previous.value * 100 : null
  return { value: current?.value ?? null, date, previousDate: previous?.observation_date || null, change, percent,
    unit: item?.metadata.unit || '', frequency: item?.metadata.frequency || '未提供', releaseDate: current?.release_date || null }
}

export function briefRow(item, reportDate, label, { exactDate, kind = 'quantity', unit, reason } = {}) {
  const p = briefPoint(item, reportDate, exactDate)
  const actualUnit = unit ?? p.unit
  const suffix = kind === 'pp' ? '个百分点' : actualUnit
  const change = isNumber(p.change) ? `${signedText(p.change)} ${suffix}` + (kind === 'percent' ? `（${isNumber(p.percent) ? signedText(p.percent) + '%' : '涨跌幅暂不可计算'}）` : '') : '变化暂不可计算'
  return { ...p, label, unit: actualUnit, valueText: isNumber(p.value) ? numberText(p.value) : typeof p.value === 'string' && p.value.trim() ? p.value : '数据暂缺',
    changeText: typeof p.value === 'string' ? '变化不适用' : change,
    comparisonText: isNumber(p.change) ? `较 ${p.previousDate}` : '无有效比较基准', reason: p.value == null ? reason || '最新观察期缺失，不以前期值替代。' : '' }
}

function movement(row, name) {
  if (!isNumber(row.value)) return `${name}数据暂缺`
  if (!isNumber(row.change)) return `${name}（${row.date}）变化暂不可计算`
  const direction = row.change > 0 ? '上涨' : row.change < 0 ? '下跌' : '持平'
  return `${name}（${row.date}）较${row.previousDate}${direction}${isNumber(row.percent) ? ' ' + numberText(Math.abs(row.percent)) + '%' : '，涨跌幅暂不可计算'}`
}
function quantityMovement(row, name) {
  return !isNumber(row.change) ? `${name}变化暂不可计算` : `${name}（${row.date}）较${row.previousDate}${row.change > 0 ? '增加' : row.change < 0 ? '减少' : '持平'}${row.change === 0 ? '' : ' ' + numberText(Math.abs(row.change)) + row.unit}`
}

export function buildDailyBrief(items, reportDate) {
  const byId = Object.fromEntries(items.map(i => [i.metadata.indicator_id, i]))
  const row = (id, name, options) => briefRow(byId[id], reportDate, name, options)
  const price = row('gold_price_anchor', '上金所Au99.99收盘价', { kind: 'percent', unit: '元/克' })
  const international = row('london_gold_spot', '伦敦金现 · 北京时间15:30', { kind: 'percent', unit: '美元/盎司' })
  const vol = row('gold_hv20', '20日年化历史波动率', { kind: 'pp', unit: '%' })
  const spread = row('gold_domestic_spread', 'Au99.99 − 海外金价人民币折算值', { unit: '元/克' })
  const etfDate = ['domestic_etf_total_shares', 'domestic_etf_total_assets'].map(id => briefPoint(byId[id], reportDate).date).filter(Boolean).sort().at(-1)
  const shares = row('domestic_etf_total_shares', '7只ETF合计份额', { kind: 'percent', unit: '万份', exactDate: etfDate })
  const assets = row('domestic_etf_total_assets', '同范围合计资产规模', { kind: 'percent', unit: '亿元', exactDate: etfDate })
  const spdr = row('spdr_gold_holdings', 'SPDR黄金持仓', { unit: '吨' })
  const futures = row('futures_open_interest', '上期所黄金期货合计持仓', { kind: 'percent', unit: '吨' })
  const inventory = row('comex_gold_total', 'COMEX黄金总库存', { unit: '吨' })
  const fundRows = [['518880', '华安'], ['159937', '博时'], ['159934', '易方达'], ['518800', '国泰'], ['518850', '华夏'], ['518660', '工银'], ['159812', '前海开源']]
    .map(([code, name]) => row(`domestic_${code}_shares`, `${name} ${code}`, { exactDate: etfDate, unit: '万份' }))
  const directionHistory = (byId.au_td_delivery_direction?.history || []).filter(p => p.observation_date <= reportDate)
    .toSorted((a, b) => a.observation_date.localeCompare(b.observation_date))
  const fee = summarizeAutdFees({ history: directionHistory })[0]
  const previousFee = summarizeAutdFees({ history: directionHistory.slice(0, -1) })[0]
  const feeRow = { label: '近7个交易观测日多空统计', date: fee.end, stats: [
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
  const publishedToday = releases.flatMap(r => r.today)
  const releaseSummary = publishedToday.length ? `今日有发布记录：${publishedToday.join('、')}。` : '无最新发布记录'
  return {
    summary: [movement(price, 'Au99.99') + '；' + movement(international, '伦敦金现15:30') + '。',
      quantityMovement(shares, '境内7只黄金ETF份额') + '；' + quantityMovement(spdr, 'SPDR持仓') + '；' + quantityMovement(futures, '国内黄金期货持仓') + '。', releaseSummary], releases,
    cards: [
      { id: 'domestic-price', title: '国内黄金价格', category: 'price', page: 'domestic', section: 'gold-price', rows: [price], note: '上金所Au99.99交易日收盘价；变化基准为上一条交易观测记录。' },
      { id: 'international-price', title: '国际黄金价格', category: 'price', page: 'foreign', section: 'overseas-price', rows: [international], note: 'Barchart精确结束于北京时间15:30的半小时K线close；不是LBMA定盘价。' },
      { id: 'volatility', title: '黄金历史波动率', category: 'price', page: 'domestic', section: 'gold-price', rows: [vol], note: '20个交易观测收益率、样本标准差、252日年化；只读上游结果，不代表未来涨跌方向。' },
      { id: 'spread', title: '国内外黄金价差', category: 'price', page: 'domestic', section: 'gold-price', rows: [spread], note: '同日期、北京时间15:30海外金价及汇率折算；美元/金衡盎司 × USDCNH ÷ 31.1034768，价差单位为元/克。' },
      { id: 'autd', layout: 'autd', title: 'Au(T+D)', category: 'au-td', page: 'domestic', section: 'au-td', rows: [
        row('au_td_volume', '成交量', { kind: 'percent', unit: '吨' }),
        row('au_td_open_interest', '持仓量', { kind: 'percent', unit: '吨' }),
        row('au_td_delivery_direction', '延期费支付方向', { unit: '' }),
        feeRow,
      ], note: '多空分项持仓数据暂缺；延期费支付方向不代表多空仓位，不推断多空强弱。' },
      { id: 'domestic-etf', layout: 'etf', title: '国内黄金ETF份额', category: 'etf', page: 'domestic', section: 'domestic-etf', rows: [shares, assets], fundRows, note: '固定7只基金、同一观察日；任一基金缺失则合计缺失。份额或规模变化不等同资金净流入。' },
      { id: 'spdr', layout: 'last', title: 'SPDR黄金持仓', category: 'etf', page: 'foreign', section: 'spdr', rows: [spdr], note: '采用黄金持仓吨数；不以ETF价格、份额替代黄金持仓。' },
      { id: 'futures', layout: 'last', title: '国内黄金期货持仓', category: 'futures', page: 'domestic', section: 'futures', rows: [futures], note: '上期所表内同日全部黄金期货合约持仓吨数合计，沿用上游单边口径；缺项或重复合约则合计为空。' },
      { id: 'comex', layout: 'last', title: 'COMEX黄金库存', category: 'inventory', page: 'foreign', section: 'comex', rows: [inventory], note: '黄金总库存＝注册库存＋合格库存；已质押库存不重复计入。' },
    ],
  }
}
