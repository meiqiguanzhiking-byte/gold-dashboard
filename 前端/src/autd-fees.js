// 按真实交易观测日计数；缺方向的观测日仍占窗口，不向前补足有效值。
export function summarizeAutdFees(item) {
  const byDate = new Map()
  for (const point of item?.history || []) {
    const date = point.observation_date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))) continue
    byDate.set(date, byDate.has(date) ? null : point.value)
  }
  const points = [...byDate].sort(([a], [b]) => a.localeCompare(b))
  return [7, 30].map(size => {
    const sample = points.slice(-size)
    const counts = { short: 0, long: 0, balanced: 0, unknown: 0 }
    for (const [, value] of sample) {
      const direction = typeof value === 'string' ? value.trim() : ''
      if (direction === '空支付给多') counts.short++
      else if (direction === '多支付给空') counts.long++
      else if (direction === '交收平衡（无支付方向）') counts.balanced++
      else counts.unknown++
    }
    return { size, count: sample.length, start: sample[0]?.[0], end: sample.at(-1)?.[0],
      ...counts, valid: sample.length - counts.unknown, incomplete: sample.length < size }
  })
}
