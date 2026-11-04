// 期现同日原价、ACT/365；到期日只取已确认的交易所最后交易日。
const numeric = value => typeof value === 'number' && Number.isFinite(value)
function dayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null
  const milliseconds = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? milliseconds / 86400000 : null
}

export function annualizedBasis(quote, spot, observationDate) {
  const start = dayNumber(observationDate), end = dayNumber(quote.expiry_date)
  const days = start != null && end != null ? end - start : null
  const basis = numeric(quote.close) && numeric(spot) && spot > 0 && quote.close > 0 ? quote.close - spot : null
  const basisRatio = basis != null ? basis / spot : null
  const value = basisRatio != null && days > 0 ? basisRatio * 365 / days * 100 : null
  const reason = !quote.expiry_date ? '合约最后交易日尚未确认'
    : days == null ? '日期无效' : days <= 0 ? '已到最后交易日或已到期'
      : basis == null ? '同日期货或现货价格暂缺' : ''
  return { ...quote, spot, date: observationDate, days, basis, basisRatio, value: numeric(value) ? value : null, reason }
}

export function annualizedBasisChange(quote, spot, observationDate, previousSpot) {
  const current = annualizedBasis(quote, spot, observationDate)
  const previous = annualizedBasis({ ...quote, close: quote.previous_close }, previousSpot, quote.previous_date)
  const change = numeric(current.value) && numeric(previous.value) ? current.value - previous.value : null
  return { ...current, previousValue: previous.value, previousDate: quote.previous_date || null, change }
}
