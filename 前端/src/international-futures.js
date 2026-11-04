import { filteredHistory, numeric } from './data.js'

// 用户定义主力为当日原表列示的最近未过期偶数月合约；报价为空不改选远月。
// 后复权采用价差法：历史基准不变，换约后累计加上旧约减新约的同日价差。
// 只使用换约日及以前最近共同报价，不使用未来信息；先复权再筛选区间。
export function futuresContinuousSeries(items, product, range = '1Y') {
  const contracts = items.filter(item => item.metadata.futures_product === product)
    .filter(item => /^\d{4}-(02|04|06|08|10|12)$/.test(item.metadata.contract_expiry))
    .sort((a, b) => a.metadata.contract_expiry.localeCompare(b.metadata.contract_expiry) || a.metadata.source_contract.localeCompare(b.metadata.source_contract))
  const quotes = contracts.map(item => new Map(item.history.map(point => [point.observation_date, point])))
  const dates = [...new Set(contracts.flatMap(item => item.history.map(point => point.observation_date)))].sort()
  if (!dates.length || !contracts.some(item => item.history.some(numeric))) return []
  let active = -1, adjustment = 0, started = false, linked = true
  const history = dates.map(date => {
    const next = contracts.findIndex((item, index) => index >= active && date.slice(0, 7) <= item.metadata.contract_expiry && quotes[index].has(date))
    if (next < 0) return { observation_date: date, release_date: null, value: null, raw_value: null, contract_expiry: null, source_contract: null, rollover_from: null }
    let rolloverFrom = null, referenceDate = null, rolloverGap = null
    if (active >= 0 && next !== active) {
      rolloverFrom = contracts[active].metadata.contract_expiry
      if (started) {
        referenceDate = [...quotes[active].keys()].filter(day => day <= date && numeric(quotes[active].get(day)) && numeric(quotes[next].get(day))).sort().at(-1) || null
        if (referenceDate) {
          rolloverGap = quotes[active].get(referenceDate).value - quotes[next].get(referenceDate).value
          adjustment += rolloverGap
        } else linked = false
      }
    }
    active = next
    const metadata = contracts[active].metadata
    const raw = quotes[active].get(date)
    if (numeric(raw)) started = true
    return { observation_date: date, release_date: null, value: numeric(raw) && linked ? raw.value + adjustment : null,
      raw_value: numeric(raw) ? raw.value : null, adjustment: linked ? adjustment : null,
      contract_expiry: metadata.contract_expiry, source_contract: metadata.source_contract, rollover_from: rolloverFrom,
      rollover_reference_date: referenceDate, rollover_gap: rolloverGap, adjustment_missing: !linked }
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
    status: statuses[0], statuses, method: '最近偶数月合约；同日价差累计后复权，保留早期价格基准' }
  const item = { ...base, metadata, history, latest: { ...metadata, ...history.at(-1) }, latest_available: valid.at(-1) || null }
  return [{ item: { ...item, history: filteredHistory(item, range, dates.at(-1)) }, name,
    color: product === 'comex' ? '#ad945b' : '#287985', connectNulls: true }]
}
