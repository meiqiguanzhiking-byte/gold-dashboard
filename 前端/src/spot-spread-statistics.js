// 沿用参考图的人工分期，不根据统计结果自动寻找分界。
export const spreadPhases = [
  { start: '2012-09-01', end: '2019-12-31', label: '常态溢价', description: '以正溢价为主', color: '#e9eef4' },
  { start: '2020-01-01', end: '2020-12-31', label: '持续折价', description: '持续深度折价', color: '#e0eee7' },
  { start: '2021-01-01', end: '2022-07-31', label: '溢价恢复', description: '恢复温和溢价', color: '#e9eef4' },
  { start: '2022-08-01', end: '2023-07-31', label: '溢价抬升', description: '溢价中枢抬升', color: '#f6eddb' },
  { start: '2023-08-01', end: '2024-06-30', label: '高溢价', description: '持续高溢价', color: '#f4e1e1' },
  { start: '2024-07-01', end: null, label: '零附近双向波动', description: '零附近双向波动', color: '#e7edf4' },
]
const valid = value => typeof value === 'number' && Number.isFinite(value)
export function quantile(sorted, probability) {
  if (!sorted.length) return null
  const position = (sorted.length - 1) * probability, low = Math.floor(position), high = Math.ceil(position)
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}
export function summarizeSpread(points) {
  const rows = points.filter(point => valid(point[1]))
  const values = rows.map(point => point[1]).sort((a, b) => a - b), n = values.length
  if (!n) return { n: 0, missing: points.length, mean: null, median: null, std: null, positive: null, low: null, high: null, min: null, max: null, relative: null, relativeN: 0 }
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const relatives = rows.filter(point => valid(point[2]) && point[2] - point[1] > 0).map(point => point[1] / (point[2] - point[1]) * 100)
  return { n, missing: points.length - n, mean, median: quantile(values, .5),
    std: n > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) : null,
    positive: values.filter(value => value > 0).length / n * 100, low: quantile(values, .05), high: quantile(values, .95),
    min: rows.reduce((a, b) => a[1] <= b[1] ? a : b), max: rows.reduce((a, b) => a[1] >= b[1] ? a : b),
    relative: relatives.length ? relatives.reduce((sum, value) => sum + value, 0) / relatives.length : null, relativeN: relatives.length }
}
export function buildSpreadStatistics(points = []) {
  const rolling = points.map((_, index) => {
    if (index < 59) return null
    const window = points.slice(index - 59, index + 1).map(point => point[1])
    return window.every(valid) ? window.reduce((sum, value) => sum + value, 0) / 60 : null
  })
  return { summary: summarizeSpread(points), rolling,
    phases: spreadPhases.map(phase => {
      const rows = points.filter(point => point[0] >= phase.start && (!phase.end || point[0] <= phase.end))
      return { ...phase, observedStart: rows[0]?.[0], observedEnd: rows.at(-1)?.[0], ...summarizeSpread(rows) }
    }) }
}
