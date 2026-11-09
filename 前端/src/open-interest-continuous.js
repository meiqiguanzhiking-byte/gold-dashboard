const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)

function dailyRows(item) {
  return (item?.history || []).map(point => {
    let quotes = []
    try { quotes = JSON.parse(point.value)?.quotes || [] } catch { /* 无效日明细不参与选约。 */ }
    const candidates = quotes.filter(quote => isFiniteNumber(quote.open_interest) && quote.open_interest >= 0)
      .sort((a, b) => b.open_interest - a.open_interest || a.expiry.localeCompare(b.expiry) || a.contract.localeCompare(b.contract))
    const quote = candidates[0] || null
    return { observation_date: point.observation_date, quotes, quote,
      contract: quote?.contract || null, raw: isFiniteNumber(quote?.close) ? quote.close : null }
  })
}

function applyBackAdjustment(rows) {
  const events = new Map()
  let prior = null
  rows.forEach((row, index) => {
    if (!row.contract) return
    if (prior && row.contract !== prior.contract) {
      const oldQuote = row.quotes.find(quote => quote.contract === prior.contract)
      const newQuote = row.quotes.find(quote => quote.contract === row.contract)
      const gap = isFiniteNumber(oldQuote?.close) && isFiniteNumber(newQuote?.close) ? newQuote.close - oldQuote.close : null
      events.set(index, { from: prior.contract, to: row.contract, oldPrice: oldQuote?.close ?? null,
        newPrice: newQuote?.close ?? null, gap })
    }
    prior = { contract: row.contract }
  })

  let cumulative = 0, valid = true
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    row.adjustment = valid && row.raw != null ? cumulative : null
    row.adjusted = row.adjustment == null ? null : row.raw + cumulative
    if (events.has(index)) {
      const event = events.get(index)
      row.rollover = event
      if (event.gap == null) valid = false
      else cumulative += event.gap
    }
  }
  return rows
}

export function openInterestMainSeries(item, mode = 'adjusted') {
  const rows = applyBackAdjustment(dailyRows(item))
  const latestDate = item?.metadata.coverage_end || rows.at(-1)?.observation_date || null
  const isAdjusted = mode === 'adjusted'
  const history = rows.map(row => ({ observation_date: row.observation_date, release_date: null,
    value: isAdjusted ? row.adjusted : row.raw, contract: row.contract,
    open_interest: row.quote?.open_interest ?? null, adjustment: isAdjusted ? row.adjustment : 0,
    rollover: row.rollover || null }))
  const validCount = history.filter(point => isFiniteNumber(point.value)).length
  const metadata = { ...(item?.metadata || {}),
    indicator_name: isAdjusted ? '黄金期货主力连续价格（最大持仓量，回溯复权）' : '黄金期货主力连续价格（最大持仓量，实际价格）',
    unit: '元/克', frequency: '日度', coverage_start: history[0]?.observation_date || null,
    coverage_end: latestDate, record_count: history.length, valid_count: validCount, missing_count: history.length - validCount }
  const result = { item: { metadata, history, warnings: item?.warnings || [] }, name: '黄金期货', color: '#287985',
    tooltipDetails(date) {
      const point = history.find(row => row.observation_date === date)
      if (!point) return ''
      const parts = [`合约：${point.contract || '数据暂缺'}`]
      if (point.open_interest != null) parts.push(`持仓量：${point.open_interest} 吨`)
      if (isAdjusted) parts.push(`累计回溯调整：${point.adjustment == null ? '无法计算' : point.adjustment.toFixed(2)} 元/克`)
      if (point.rollover) parts.push(`本日换月：${point.rollover.from} → ${point.rollover.to}`,
        `换月价差（新−旧）：${point.rollover.gap == null ? '无法计算' : point.rollover.gap.toFixed(2) + ' 元/克'}`)
      return parts.join(' · ')
    } }
  return [result]
}
