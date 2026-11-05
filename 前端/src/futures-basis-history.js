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
