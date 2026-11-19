import { spreadPhases } from './spot-spread-statistics.js'

const finite = value => typeof value === 'number' && Number.isFinite(value)
export const IC_WINDOW = 252
export const IC_MIN_PAIRS = 202 // 至少80%的窗口有完整配对，向上取整。
export function isDailyFactor(column) {
  return column.group !== '研究对象' && !['外汇供求', '消费需求'].includes(column.group)
    && !/CFTC|非商业净多头/.test(column.name)
}

// 相同取值采用平均秩；不随机打散并列值。
function ranks(values) {
  const sorted = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value)
  const output = Array(values.length)
  for (let i = 0; i < sorted.length;) {
    let end = i + 1
    while (end < sorted.length && sorted[end].value === sorted[i].value) end++
    for (let j = i; j < end; j++) output[sorted[j].i] = (i + end - 1) / 2 + 1
    i = end
  }
  return output
}

export function spearman(pairs) {
  if (pairs.length < 2) return null
  const x = ranks(pairs.map(pair => pair[0])), y = ranks(pairs.map(pair => pair[1]))
  const center = (pairs.length + 1) / 2
  let xy = 0, xx = 0, yy = 0
  for (let i = 0; i < pairs.length; i++) {
    const a = x[i] - center, b = y[i] - center
    xy += a * b; xx += a * a; yy += b * b
  }
  return xx && yy ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null
}

export function buildRollingIC(data, targetId, factorId, pairing = 'next-change') {
  if (!['same-level', 'next-level', 'next-change'].includes(pairing)) throw new Error('不支持的 IC 配对方式')
  const points = data?.points || [], columns = data?.columns || []
  const targetIndex = columns.findIndex(column => column.id === targetId) + 1
  const factorIndex = columns.findIndex(column => column.id === factorId) + 1
  const pairs = points.map((point, i) => {
    const next = points[i + 1], x = point[factorIndex], base = point[targetIndex], future = next?.[targetIndex]
    if (!targetIndex || !factorIndex || !finite(x)) return null
    if (pairing === 'same-level') return finite(base) ? [x, base] : null
    if (pairing === 'next-level') return finite(future) ? [x, future] : null
    if (!finite(base) || !finite(future)) return null
    if (targetId !== 'spread' && base <= 0) return null
    const y = targetId === 'spread' ? future - base : future / base - 1
    return finite(y) ? [x, y] : null
  })
  // 同期包含当日；下一日配对仅使用截至当日已知的上一观察日因子。
  const curve = points.map((point, i) => {
    const end = pairing === 'same-level' ? i + 1 : i
    if (end < IC_WINDOW) return { date: point[0], ic: null, pairs: 0, ready: false }
    const window = pairs.slice(end - IC_WINDOW, end).filter(Boolean)
    return { date: point[0], ic: window.length >= IC_MIN_PAIRS ? spearman(window) : null, pairs: window.length, ready: true }
  })
  const summarize = (rows, label, start, end) => {
    const values = rows.filter(point => finite(point.ic))
    return { label, start, end, mean: values.length ? values.reduce((sum, point) => sum + point.ic, 0) / values.length : null,
      count: values.length, excluded: rows.length - values.length }
  }
  return { curve, summary: [summarize(curve, '全样本', points[0]?.[0], points.at(-1)?.[0]),
    ...spreadPhases.map(phase => summarize(curve.filter(point => point.date >= phase.start && (!phase.end || point.date <= phase.end)),
      phase.label, phase.start < (points[0]?.[0] || '') ? points[0][0] : phase.start, phase.end || points.at(-1)?.[0]))] }
}
