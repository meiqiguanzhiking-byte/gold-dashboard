const finite = value => typeof value === 'number' && Number.isFinite(value)
const rawValue = datum => datum && typeof datum === 'object' && !Array.isArray(datum) ? datum.value : datum
const number = datum => {
  const value = rawValue(datum)
  return Array.isArray(value) ? value[1] : value
}

export function latestValueLabels(option) {
  const axes = Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis || {}]
  for (const series of Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) {
    const config = series.latestValueLabel
    // 保留配置，避免热更新或重复处理时丢失ETF的禁用标识。
    if (config === false || !['line', 'bar', 'heatmap'].includes(series.type) || !Array.isArray(series.data)) continue
    const digits = config?.digits ?? 2
    const format = value => value.toLocaleString('zh-CN', {
      minimumFractionDigits: config?.fixedDigits ?? 0, maximumFractionDigits: config?.fixedDigits ?? digits,
    })
    if (series.type === 'heatmap') {
      const last = Math.max(...series.data.map(d => rawValue(d)?.[0] ?? -1))
      if (!series.label?.show) series.label = { show: true, fontSize: 10,
        formatter: p => rawValue(p.data)?.[0] === last ? format(rawValue(p.data)[2]) : '' }
      continue
    }
    const last = series.data.findLastIndex(d => finite(number(d)))
    if (last < 0) continue
    const axis = axes[series.xAxisIndex || 0] || {}
    const value = config?.rawValues?.[last] ?? number(series.data[last])
    const date = axis.data?.[last] ?? (Array.isArray(rawValue(series.data[last])) ? rawValue(series.data[last])[0] : null)
    const text = format(value) + (last < series.data.length - 1 && date != null
      ? `\n${typeof date === 'number' ? new Date(date).toISOString().slice(0, 10) : date}` : '')
    // 已有逐项标注的排名、分组柱图保留原标注。
    if (series.type === 'bar' || series.stack) {
      if (!series.label?.show) {
        series.label = { ...series.label, show: false }
        const datum = series.data[last]
        series.data[last] = {
          ...(datum && typeof datum === 'object' && !Array.isArray(datum) ? datum : { value: datum }),
          label: { show: true, position: 'inside', fontSize: 10,
            color: '#35575e', backgroundColor: 'rgba(255,255,255,0.75)', padding: [2, 3], borderRadius: 2,
            ...(config?.position ? { position: config.position } : {}), offset: config?.offset,
            formatter: text },
        }
      }
      continue
    }
    const datum = rawValue(series.data[last])
    const coord = Array.isArray(datum) ? datum : [last, number(datum)]
    const label = { name: '最新值', coord, value, symbol: 'circle', symbolSize: 5,
      label: { show: true, formatter: text, position: config?.position || 'left', offset: config?.offset, distance: 7, fontSize: 10,
        color: series.itemStyle?.color || series.lineStyle?.color || '#35575e',
        backgroundColor: 'rgba(255,255,255,0.75)', padding: [2, 4], borderRadius: 2 } }
    series.markPoint = { ...series.markPoint, silent: true,
      data: [...(series.markPoint?.data || []).filter(point => point.name !== '最新值'), label] }
    option.markPoint ||= {}
    series.labelLayout = { moveOverlap: 'shiftY', hideOverlap: true, ...series.labelLayout }
  }
}
