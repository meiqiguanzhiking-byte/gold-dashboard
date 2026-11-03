import { filteredHistory, numeric } from './data.js'

// 原表没有成交量、持仓量和确切到期日。按到期顺序持有单一合约，
// 以到期月内最后有效报价作为换期边界；中途缺报价不触发换约。
// 必须先构建完整历史再筛选日期，避免切换时间范围改变所选合约。
export function futuresContinuousSeries(items, product, range = '1Y') {
  const contracts = items.filter(item => item.metadata.futures_product === product)
    .sort((a, b) => a.metadata.contract_expiry.localeCompare(b.metadata.contract_expiry) || a.metadata.source_contract.localeCompare(b.metadata.source_contract))
  const quotes = contracts.map(item => new Map(item.history.map(point => [point.observation_date, point])))
  const ends = contracts.map(item => item.history.filter(point => numeric(point) && point.observation_date.slice(0, 7) <= item.metadata.contract_expiry)
    .map(point => point.observation_date).sort().at(-1))
  const dates = [...new Set(contracts.flatMap(item => item.history.map(point => point.observation_date)))].sort()
  if (!dates.length || !ends.some(Boolean)) return []
  let active = -1
  const history = dates.map(date => {
    let rolloverFrom = null
    if (active < 0 || date > ends[active]) {
      const next = contracts.findIndex((item, index) => index > active && date.slice(0, 7) <= item.metadata.contract_expiry && numeric(quotes[index].get(date)))
      if (next < 0) return { observation_date: date, release_date: null, value: null, contract_expiry: null, source_contract: null, rollover_from: null }
      rolloverFrom = active < 0 ? null : contracts[active].metadata.contract_expiry
      active = next
    }
    const metadata = contracts[active].metadata
    return { observation_date: date, release_date: null, value: quotes[active].get(date)?.value ?? null,
      contract_expiry: metadata.contract_expiry, source_contract: metadata.source_contract, rollover_from: rolloverFrom }
  })
  const name = product === 'comex' ? 'COMEX黄金期货连续价格' : '美元兑离岸人民币期货连续价格'
  const base = contracts.reduce((latest, item) => (item.metadata.coverage_end || '') > (latest.metadata.coverage_end || '') ? item : latest)
  const valid = history.filter(numeric)
  const item = { ...base, metadata: { ...base.metadata, indicator_name: name, contract_expiry: null, source_contract: null,
    coverage_start: dates[0], coverage_end: dates.at(-1), record_count: history.length, valid_count: valid.length,
    missing_count: history.length - valid.length, latest_valid_date: valid.at(-1)?.observation_date }, history }
  return [{ item: { ...item, history: filteredHistory(item, range, dates.at(-1)) }, name,
    color: product === 'comex' ? '#ad945b' : '#287985', connectNulls: true }]
}
