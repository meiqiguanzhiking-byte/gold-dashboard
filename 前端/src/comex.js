import { dateNumber } from './data.js'

export const comexColors = { registered: '#278b94', pledged: '#c27e65', eligible: '#ad945b', boundary: '#53646b' }
export const validStock = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
export const stockNumber = value => validNumber(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '数据暂缺'
export const validNumber = value => typeof value === 'number' && Number.isFinite(value)
export const changeNumber = value => validNumber(value) ? (value > 0 ? '+' : '') + stockNumber(value) : '暂不可计算'
export const percentNumber = value => validNumber(value) ? stockNumber(value) + '%' : '暂不可计算'
const before = (date, days) => new Date(dateNumber(date) - days * 86400000).toISOString().slice(0, 10)
const ratioChange = (current, base) => validStock(current) && validStock(base) && base !== 0 ? (current / base - 1) * 100 : null

export function comexView(items, summary, metal = 'gold', range = '30') {
  const kinds = metal === 'gold' ? ['registered', 'pledged', 'eligible', 'total'] : ['registered', 'eligible', 'total']
  const selected = kinds.map(kind => items.find(item => item.metadata.indicator_id === `comex_${metal}_${kind}` && item.metadata.unit === '吨'))
  const dates = [...new Set(selected.flatMap(item => (item?.history || []).map(point => point.observation_date)))].sort()
  const maps = Object.fromEntries(kinds.map((kind, index) => [kind, new Map((selected[index]?.history || []).map(point => [point.observation_date, validStock(point.value) ? point.value : null]))]))
  // 本地字段映射与统计范围未经确认时，一律禁止扣减或计算质押占比。
  const confirmed = metal === 'gold' && summary?.definition?.confirmed === true
  const rows = dates.map(date => {
    const row = { date, ...Object.fromEntries(kinds.map(kind => [kind, maps[kind].get(date) ?? null])) }
    const canSubtract = confirmed && validStock(row.registered) && validStock(row.pledged) && row.pledged <= row.registered
    row.unpledged = canSubtract ? row.registered - row.pledged : null
    row.pledgedRatio = canSubtract && row.registered > 0 ? row.pledged / row.registered * 100 : null
    row.registeredRatio = validStock(row.registered) && validStock(row.total) && row.total > 0 ? row.registered / row.total * 100 : null
    return row
  })
  const lastDate = dates.at(-1)
  const start = lastDate && range !== 'ALL' ? before(lastDate, Number(range)) : dates[0]
  const visible = rows.filter(row => row.date >= start)
  const primary = confirmed ? 'unpledged' : 'registered'
  const latest = visible.findLast(row => validStock(row[primary]))
  const days = range === '90' ? 90 : 30
  const target = latest ? before(latest.date, days) : null
  const targetBase = latest ? rows.findLast(row => row.date <= target && validStock(row[primary])) : null
  const firstBase = visible.find(row => validStock(row[primary]))
  const base = targetBase || firstBase
  const comparable = latest && base && base.date < latest.date
  const delta = comparable ? latest[primary] - base[primary] : null
  const change = comparable ? ratioChange(latest[primary], base[primary]) : null
  const commonBase = visible.find(row => validStock(row.registered) && validStock(row.eligible))
  const indexed = visible.map(row => ({ ...row,
    registeredIndex: commonBase && row.date >= commonBase.date && commonBase.registered > 0 && validStock(row.registered) ? row.registered / commonBase.registered * 100 : null,
    eligibleIndex: commonBase && row.date >= commonBase.date && commonBase.eligible > 0 && validStock(row.eligible) ? row.eligible / commonBase.eligible * 100 : null,
  }))
  const totalsAgree = visible.length > 0 && visible.every(row => validStock(row.registered) && validStock(row.eligible) && validStock(row.total) && Math.abs(row.registered + row.eligible - row.total) <= Math.max(1e-6, row.total * 1e-9))
  const pledgeComplete = confirmed && visible.every(row => validStock(row.unpledged) && validStock(row.pledged))
  const missingFields = kinds.filter((kind, index) => !selected[index] || !visible.some(row => validStock(row[kind])))
  const registeredEnd = indexed.findLast(row => validNumber(row.registeredIndex))
  const eligibleEnd = indexed.findLast(row => validNumber(row.eligibleIndex))
  const endChange = { registered: registeredEnd ? registeredEnd.registeredIndex - 100 : null, eligible: eligibleEnd ? eligibleEnd.eligibleIndex - 100 : null }
  return { metal, confirmed, kinds, rows, visible, indexed, lastDate, latest, primary, start, days, target, base,
    comparisonLabel: targetBase ? `较近${days}日基准变化` : '较样本起点变化', delta, change,
    commonBase, totalsAgree, pledgeComplete, missingFields, endChange,
    validCount: visible.filter(row => kinds.every(kind => validStock(row[kind]))).length,
    historyStatus: dates.length === 0 ? '数据缺失' : dates.length === 1 ? '仅最新值' : dates.length < 90 ? '短历史' : '正常',
  }
}
