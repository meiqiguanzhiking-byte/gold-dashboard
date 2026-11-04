import { filteredHistory, numeric } from './data.js'

// 用户定义主力为当日原表列示的最近未过期偶数月合约；报价为空不改选远月。
// 使用所选合约的原始价格；先构建全部历史再筛选区间，换约不复权。
export function futuresContinuousSeries(items, product, range = '1Y') {
  const contracts = items.filter(item => item.metadata.futures_product === product)
    .filter(item => /^\d{4}-(02|04|06|08|10|12)$/.test(item.metadata.contract_expiry))
    .sort((a, b) => a.metadata.contract_expiry.localeCompare(b.metadata.contract_expiry) || a.metadata.source_contract.localeCompare(b.metadata.source_contract))
  const quotes = contracts.map(item => new Map(item.history.map(point => [point.observation_date, point])))
  const dates = [...new Set(contracts.flatMap(item => item.history.map(point => point.observation_date)))].sort()
  if (!dates.length || !contracts.some(item => item.history.some(numeric))) return []
  let active = -1
  const history = dates.map(date => {
    const next = contracts.findIndex((item, index) => index >= active && date.slice(0, 7) <= item.metadata.contract_expiry && quotes[index].has(date))
    if (next < 0) return { observation_date: date, release_date: null, value: null, raw_value: null, contract_expiry: null, source_contract: null, rollover_from: null }
    const rolloverFrom = active >= 0 && next !== active ? contracts[active].metadata.contract_expiry : null
    active = next
    const metadata = contracts[active].metadata
    const raw = quotes[active].get(date)
    return { observation_date: date, release_date: null, value: numeric(raw) ? raw.value : null,
      raw_value: numeric(raw) ? raw.value : null,
      contract_expiry: metadata.contract_expiry, source_contract: metadata.source_contract, rollover_from: rolloverFrom }
  })
  const name = product === 'comex' ? 'COMEX黄金期货主力连续' : '美元兑离岸人民币期货主力连续'
  const base = contracts.reduce((latest, item) => (item.metadata.coverage_end || '') > (latest.metadata.coverage_end || '') ? item : latest)
  const valid = history.filter(numeric)
  const historyStatus = !valid.length || !numeric(history.at(-1)) ? '数据缺失' : history.length === 1 ? '仅最新值' : history.length < 90 ? '短历史' : '正常'
  const statuses = [historyStatus]
  if (base.metadata.statuses?.includes('滞后')) {
    if (historyStatus === '正常') statuses.pop()
    statuses.push('滞后')
  }
  const metadata = { ...base.metadata, indicator_name: name, contract_expiry: null, source_contract: null,
    coverage_start: dates[0], coverage_end: dates.at(-1), record_count: history.length, valid_count: valid.length,
    missing_count: history.length - valid.length, latest_valid_date: valid.at(-1)?.observation_date,
    observation_time: '15:00', observation_timezone: 'Asia/Shanghai',
    status: statuses[0], statuses, method: '最近偶数月合约；原始收盘价，不复权' }
  const item = { ...base, metadata, history, latest: { ...metadata, ...history.at(-1) }, latest_available: valid.at(-1) || null }
  return [{ item: { ...item, history: filteredHistory(item, range, dates.at(-1)) }, name,
    color: product === 'comex' ? '#ad945b' : '#287985', connectNulls: true }]
}
