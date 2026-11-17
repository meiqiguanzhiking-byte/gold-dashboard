const OUNCE = 31.1034768
const valid = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => valid(value) && value > 0 ? value : null
const historyMap = item => new Map((item?.history || []).map(point => [point.observation_date, point.value]))

// 以国内原始观察日为基准截取7条，缺项留在原日期，不向更早日期寻找替代值。
export function buildWeeklyCurves(items, end = '9999-12-31') {
  const index = Object.fromEntries(items.map(item => [item.metadata.indicator_id, item]))
  const values = id => historyMap(index[id])
  const domestic = values('au_td_close'), overseas = values('london_gold_spot'), fx = values('usdcny')
  const spotSpread = values('gold_domestic_spread')
  const quotes = values('gold_futures_weekly_quotes')
  const dates = map => [...map.keys()].filter(date => date <= end).sort().slice(-7)
  const point = (date, local, foreign, rate, spread, contract = null) => ({ date, domestic: positive(local), overseas: positive(foreign), fx: positive(rate),
    converted: positive(foreign) != null && positive(rate) != null ? foreign * rate / OUNCE : null,
    spread: valid(spread) ? spread : null, contract })
  const spot = { id: 'spot', title: '现价', localLabel: '沪金 Au(T+D)', foreignLabel: '伦敦金折算', fxLabel: 'USDCNY',
    sourceIds: ['au_td_close', 'london_gold_spot', 'usdcny', 'gold_domestic_spread'],
    points: dates(domestic).map(date => point(date, domestic.get(date), overseas.get(date), fx.get(date), spotSpread.get(date))),
    note: '伦敦金 × USDCNY ÷ 31.1034768 折算为元/克；价差沿用上游 Au(T+D) − 伦敦金人民币折算值。同日期收盘比较；海外目标时点为北京时间15:30，在岸汇率可能采用同日较早K线或日线备用，并非严格同步报价。' }
  const futures = ['main', 'secondary'].map((rank, i) => {
    const spreadId = i ? 'gold_futures_secondary_spread' : 'gold_futures_spread'
    const spreads = values(spreadId)
    return { id: rank, title: i ? '远端主力' : '近端主力', localLabel: '沪金期货', foreignLabel: 'COMEX折算', fxLabel: 'USDCNH期货',
      sourceIds: ['gold_futures_weekly_quotes', spreadId],
      points: dates(quotes).map(date => {
        let quote
        try { quote = JSON.parse(quotes.get(date))?.[rank] } catch { /* 不解析展示文本，不推定缺失报价。 */ }
        return point(date, quote?.domestic, quote?.overseas, quote?.fx, spreads.get(date), quote?.contract || null)
      }),
      note: '采用黄金期货主力合约.csv指定的当日合约及三类原价，不另选约、不复权。COMEX × 对应USDCNH期货 ÷ 31.1034768；价差沿用上游计算结果，包含CNH/CNY口径及各市场收盘时点差异。' }
  })
  return [spot, ...futures].map(model => ({ ...model,
    sources: model.sourceIds.map(id => index[id]?.metadata).filter(Boolean),
    withheld: model.sourceIds.some(id => index[id]?.metadata?.publication_withheld),
  }))
}

// 在两条曲线交叉处切开多边形，使正负价差颜色不跨越交点。
export function spreadPolygons(a, b, c, d, x) {
  if (![a, b, c, d].every(valid)) return []
  const first = a - b, last = c - d
  if (first * last < 0) {
    const fraction = first / (first - last), crossX = x + fraction, crossY = a + (c - a) * fraction
    return [
      { positive: first > 0, points: [[x, a], [crossX, crossY], [x, b]] },
      { positive: last > 0, points: [[crossX, crossY], [x + 1, c], [x + 1, d]] },
    ]
  }
  return [{ positive: (first || last) >= 0, points: [[x, a], [x + 1, c], [x + 1, d], [x, b]] }]
}
