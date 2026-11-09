import { annualizedBasis } from './futures-basis.js'

// 价格严格同日匹配；到期依据由后端逐合约提供，与每日速递共用计算函数。
export function basisHistory(quotesItem, spotItem) {
  const spot = new Map((spotItem?.history || []).map(point => [point.observation_date, point.value]))
  const expiries = quotesItem?.metadata.contract_expiries || {}
  return (quotesItem?.history || []).map(point => {
    let quotes = []
    try { quotes = JSON.parse(point.value)?.quotes || [] } catch { /* 无效明细不猜值。 */ }
    const date = point.observation_date
    return { observation_date: date, quotes: quotes.map(quote => {
      const expiry = expiries[quote.contract] || {}
      const rate = annualizedBasis({ ...expiry, ...quote }, spot.get(date), date)
      return rate
    }) }
  })
}

export function mainContractBasisHistory(mainContractsItem, quotesItem, spotItem) {
  if (!mainContractsItem || !quotesItem || !spotItem) return []
  const allRates = new Map(basisHistory(quotesItem, spotItem).map(day => [day.observation_date, day.quotes]))
  return (mainContractsItem.history || []).map(point => {
    const contract = typeof point.value === 'string' ? point.value.trim().toLowerCase() : ''
    const quote = (allRates.get(point.observation_date) || []).find(row => row.contract?.toLowerCase() === contract)
    const value = quote?.value ?? null
    const detail = quote ? [
      `主力合约：${contract || '未提供'}`,
      `期货收盘价：${quote.close ?? '缺失'} 元/克`,
      `Au(T+D)：${quote.spot ?? '缺失'} 元/克`,
      `基差：${quote.basis ?? '缺失'} 元/克`,
      `剩余自然日：${quote.days ?? '未知'}`,
      quote.expiry_date ? `最后交易日：${quote.expiry_date}` : '最后交易日未确认',
    ].join(' · ') : `主力合约：${contract || '未提供'} · 当日缺少同合约期货报价或Au(T+D)现货价`
    return { observation_date: point.observation_date, value, contract, detail }
  })
}

export function mainContractBasisSeries(mainContractsItem, quotesItem, spotItem) {
  const history = mainContractBasisHistory(mainContractsItem, quotesItem, spotItem)
  if (!history.length) return []
  const valid = history.filter(point => typeof point.value === 'number' && Number.isFinite(point.value))
  return [{
    item: {
      metadata: {
        indicator_id: 'daily_domestic_main_futures_premium',
        indicator_name: '国内黄金期货主力合约升贴水率',
        unit: '%', frequency: '日度', source: '黄金期货主力合约.csv',
        status: valid.length ? '正常' : '数据缺失', statuses: valid.length ? ['正常'] : ['数据缺失'],
        coverage_start: history[0].observation_date, coverage_end: history.at(-1).observation_date,
        display_digits: 2,
      },
      history, warnings: [],
    },
    name: '主力合约升贴水率', color: '#ad945b', connectNulls: true, pointDetails: true,
  }]
}
