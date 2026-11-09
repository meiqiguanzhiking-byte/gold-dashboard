import { dailyIndicatorGroups } from './daily-brief.js'
import { annualizedBasis } from './futures-basis.js'
import { numeric, filteredHistory } from './data.js'

// 白名单严格对应每日速递的“每日指标”；支付方向与滚动天数统计不作为折线因子。
const dailyIds = {
  spread: ['gold_domestic_spread', 'gold_futures_spread', 'gold_futures_secondary_spread'],
  spot: ['au_td_close', 'london_gold_spot', 'usdcnh'],
  forward: ['daily_domestic_futures_close', 'daily_domestic_futures_premium', 'daily_comex_0', 'daily_comex_1', 'daily_sgx_usdcnh_0', 'daily_sgx_usdcnh_1'],
  risk: ['gold_hv20', 'gold_hv60', 'gold_etf_volatility_index'],
  macro: ['ust_10y_yield', 'ust_2y_yield', 'ust_10y_2y_spread', 'ust_10y_breakeven_inflation'],
  etf: ['domestic_etf_total_shares', 'spdr_gold_holdings', 'global_etf_weekly_total_tonnes', 'global_etf_monthly_total_tonnes'],
  trading: ['futures_volume', 'futures_open_interest', 'au_td_volume', 'au_td_open_interest', 'cftc_long', 'cftc_short', 'cftc_net_long', 'cftc_net_long_ratio'],
  inventory: ['central_bank_reserves', 'london_gold', 'comex_gold_registered', 'comex_gold_pledged', 'comex_gold_eligible', 'comex_gold_total'],
}
export const crossGroup = id => Object.keys(dailyIds).find(group => dailyIds[group].includes(id)) || null

function dailySeries(base, id, name, unit, history, note) {
  return { ...base, metadata: { ...base.metadata, indicator_id: id, indicator_name: name, unit,
    coverage_start: history[0]?.observation_date || null, coverage_end: history.at(-1)?.observation_date || null }, history, crossNote: note }
}

// 将每日指标既有的期货展示规则逐观察日应用于原表，连续曲线与每日指标均不复权。
export function crossItems(items) {
  const byId = new Map(items.map(item => [item.metadata.indicator_id, item]))
  const result = items.filter(item => crossGroup(item.metadata.indicator_id))
  const quotes = byId.get('gold_futures_daily_quotes')
  if (quotes) {
    const spot = new Map((byId.get('au_td_close')?.history || []).map(p => [p.observation_date, p.value]))
    const close = [], premium = []
    for (const point of quotes.history) {
      let data = {}
      try { data = JSON.parse(point.value) || {} } catch { /* 缺失不替代。 */ }
      const quote = data.quotes?.find(q => q.contract === data.main_contract)
      close.push({ ...point, value: typeof quote?.close === 'number' ? quote.close : null })
      premium.push({ ...point, value: quote ? annualizedBasis(quote, spot.get(point.observation_date), point.observation_date).value : null })
    }
    result.push(dailySeries(quotes, 'daily_domestic_futures_close', '国内黄金期货（当日最近偶数月合约原价）', '元/克', close, '沿用每日指标的当日最近偶数月合约；换约时不作复权。'))
    const basis = dailySeries(quotes, 'daily_domestic_futures_premium', '国内黄金期货升贴水率', '%', premium, '沿用每日指标公式：(同期货原价−同日Au(T+D))/同日Au(T+D)×365/剩余自然日×100%；到期日取已确认最后交易日，缺项留空。')
    basis.crossSources = [quotes.metadata, byId.get('au_td_close')?.metadata].filter(Boolean)
    result.push(basis)
  }
  for (const product of ['comex', 'sgx_usdcnh']) {
    const contracts = items.filter(item => item.metadata.futures_product === product).toSorted((a, b) => a.metadata.contract_expiry.localeCompare(b.metadata.contract_expiry))
    if (!contracts.length) continue
    const dates = new Map()
    for (const item of contracts) for (const p of item.history) {
      if (!dates.has(p.observation_date)) dates.set(p.observation_date, [])
      if (item.metadata.contract_expiry >= p.observation_date.slice(0, 7) && Number(item.metadata.contract_expiry.slice(-2)) % 2 === 0) dates.get(p.observation_date).push({ item, point: p })
    }
    for (const rank of [0, 1]) {
      const history = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ ...values[rank]?.point, observation_date: date, value: values[rank]?.point.value ?? null }))
      result.push(dailySeries(contracts[0], `daily_${product}_${rank}`, `${product === 'comex' ? '国际黄金期货' : '美元兑离岸人民币期货'}（${rank ? '第二近' : '最近'}偶数月合约）`, contracts[0].metadata.unit, history, '沿用每日指标：每个观察日取未过期的最近/第二近偶数月合约，北京时间15:00原价；换约时不作复权。'))
    }
  }
  // 每日指标将净多头比例乘100，交叉展示保持相同百分比口径。
  return result.map(item => item.metadata.indicator_id === 'cftc_net_long_ratio'
    ? dailySeries(item, item.metadata.indicator_id, item.metadata.indicator_name, '%', item.history.map(p => ({ ...p, value: numeric(p) ? p.value * 100 : null })), '沿用每日指标的百分比口径：源比例×100。') : item)
}
export function crossGroups(items) {
  const byId = new Map(items.map(item => [item.metadata.indicator_id, item]))
  return dailyIndicatorGroups.map(group => ({ ...group, items: dailyIds[group.id].map(id => byId.get(id)).filter(Boolean) }))
}

export function intersectHistories(items, range) {
  if (items.length !== 2 || items.some(item => !item)) return [[], []]
  const validDates = new Set(items[1].history.filter(numeric).map(p => p.observation_date))
  const common = items[0].history.filter(p => numeric(p) && validDates.has(p.observation_date)).map(p => p.observation_date).sort()
  const end = common.at(-1)
  if (!end) return [[], []]
  const dates = new Set(common)
  return items.map(item => filteredHistory(item, range, end).filter(p => dates.has(p.observation_date) && numeric(p)))
}
