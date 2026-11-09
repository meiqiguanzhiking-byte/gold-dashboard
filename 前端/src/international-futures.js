import { filteredHistory, numeric } from './data.js'

// 复权先按完整历史计算，区间筛选不改变调整量。
export function futuresContinuousSeries(items, product, range = '1Y', mode = 'adjusted') {
  const base = items.find(item => item.metadata.indicator_id === `intl_futures_main_${product}`)
  if (!base) return []
  const adjusted = mode === 'adjusted'
  const history = base.history.map(point => {
    let row = {}
    try { row = JSON.parse(point.value) || {} } catch { /* 无效明细保持缺失。 */ }
    const contract = row.contract || null
    return { observation_date: point.observation_date, release_date: null,
      value: (adjusted ? row.adjusted_value : row.raw_value) ?? null,
      raw_value: row.raw_value ?? null, adjustment: adjusted ? row.adjustment ?? null : 0,
      contract_expiry: /^au\d{4}$/.test(contract) ? `20${contract.slice(2, 4)}-${contract.slice(4)}` : null,
      source_contract: contract, rollover_from: row.rollover?.from || null, rollover: row.rollover || null }
  })
  if (!history.length) return []
  const name = product === 'comex' ? 'COMEX黄金期货主力连续' : '美元兑离岸人民币期货主力连续'
  const valid = history.filter(numeric)
  const status = !numeric(history.at(-1)) ? '数据缺失' : base.metadata.status
  const metadata = { ...base.metadata, futures_product: product, indicator_name: name,
    price_mode: mode, valid_count: valid.length, missing_count: history.length - valid.length,
    status, statuses: status === '数据缺失' ? ['数据缺失'] : base.metadata.statuses }
  const item = { ...base, metadata, history, latest: { ...metadata, ...history.at(-1) }, latest_available: valid.at(-1) || null }
  return [{ item: { ...item, history: filteredHistory(item, range, history.at(-1).observation_date) }, name,
    color: product === 'comex' ? '#ad945b' : '#287985', connectNulls: true }]
}
