// 用户确认的六段历史概括：参考月度中位数状态，人工合并相邻月份。
const phaseTemplates = [
  { start: '2012-10-01', end: '2020-02-29', label: '常态溢价与低溢价', description: '零附近、温和溢价为主', color: '#e9eef4' },
  { start: '2020-03-01', end: '2020-12-31', label: '持续折价', description: '持续折价', color: '#e0eee7' },
  { start: '2021-01-01', end: '2022-08-31', label: '溢价恢复', description: '零附近与温和溢价交替', color: '#e9eef4' },
  { start: '2022-09-01', end: '2023-07-31', label: '溢价抬升', description: '较高溢价增多，期间有回落', color: '#f6eddb' },
  { start: '2023-08-01', end: '2024-07-31', label: '高溢价及回落', description: '高溢价后逐步回落', color: '#f4e1e1' },
  { start: '2024-08-01', end: null, label: '零附近双向波动', description: '折价、零附近与正溢价交替', color: '#e7edf4' },
]
const valid = value => typeof value === 'number' && Number.isFinite(value)
export function buildSpreadPhases(points = []) {
  if (!points.length) return []
  return phaseTemplates.filter(phase => points.some(point => point[0] >= phase.start && (!phase.end || point[0] <= phase.end))).map(phase => ({ ...phase }))
}
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
    phases: buildSpreadPhases(points).map(phase => {
      const rows = points.filter(point => point[0] >= phase.start && (!phase.end || point[0] <= phase.end))
      return { ...phase, observedStart: rows[0]?.[0], observedEnd: rows.at(-1)?.[0], ...summarizeSpread(rows) }
    }) }
}

