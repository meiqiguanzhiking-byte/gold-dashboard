// 对原始数据按可见日期和图例选择计算，不依赖 ECharts 的全历史自动极值。
export function datumNumber(datum) {
  const value = datum != null && typeof datum === 'object' && !Array.isArray(datum) ? datum.value : datum
  const number = Array.isArray(value) ? value[1] : value
  return typeof number === 'number' && Number.isFinite(number) ? number : null
}

export function paddedExtent(minimum, maximum, zeroBaseline = false) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return { min: 0, max: 1, interval: .2, empty: true }
  if (zeroBaseline) { minimum = Math.min(0, minimum); maximum = Math.max(0, maximum) }
  const span = maximum - minimum
  const pad = span > 0 ? span * .1 : Math.abs(minimum) * .005 || .5
  const low = zeroBaseline && minimum === 0 ? 0 : minimum - pad
  const high = zeroBaseline && maximum === 0 && minimum !== 0 ? 0 : maximum + pad
  const rawStep = (high - low) / 5
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const interval = [1, 2, 2.5, 5, 10].find(step => step >= normalized) * magnitude
  // 边界以刻度的 1/5 向外取整，留白接近 10%，避免多加一个大刻度的空白。
  const edge = interval / 5
  const clean = value => Number(value.toPrecision(13))
  return { min: clean(Math.floor(low / edge + 1e-9) * edge), max: clean(Math.ceil(high / edge - 1e-9) * edge), interval: clean(interval), empty: false }
}

export function axisTick(value, interval) {
  if (!Number.isFinite(value)) return ''
  if ((Math.abs(value) > 0 && Math.abs(value) < 1e-6) || Math.abs(value) >= 1e11) return value.toExponential(2)
  const decimals = Math.min(8, Math.max(0, Math.ceil(-Math.log10(interval)) + 1))
  return (Object.is(value, -0) ? 0 : value).toLocaleString('zh-CN', { maximumFractionDigits: decimals })
}

function readableTicks({ min, max, interval }) {
  const ticks = [min]
  // 显示上下限；避免最后一个整刻度与上限挤在一起，而不是隐藏纵轴标签。
  for (let n = 1; n < 20; n++) {
    const value = Number((min + n * interval).toPrecision(13))
    if (value >= max - interval * .65) break
    ticks.push(value)
  }
  ticks.push(max)
  return ticks
}

export function visibleExtents(series, windows, selected = {}, axisCount = 1) {
  return Array.from({ length: axisCount }, (_, axisIndex) => {
    const bound = series.filter(s => (s.yAxisIndex || 0) === axisIndex)
    // 只要该轴承载柱或堆叠面积，即使图例暂时隐藏它也保留零基线。
    const zeroBaseline = bound.some(s => s.type === 'bar' || (s.stack && s.areaStyle != null))
    let minimum = Infinity, maximum = -Infinity, count = 0
    const stacks = new Map()
    const include = value => { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value) }
    for (const s of bound) {
      if (selected[s.name] === false) continue
      const [start, end] = windows[s.xAxisIndex || 0] || [0, s.data.length - 1]
      for (let index = start; index <= end; index++) {
        const value = datumNumber(s.data[index])
        if (value == null) continue
        count++
        if (s.stack) {
          const key = `${s.xAxisIndex || 0}:${s.stack}:${index}:${value >= 0 ? '+' : '-'}`
          const total = (stacks.get(key) || 0) + value
          stacks.set(key, total)
          include(total)
        } else include(value)
      }
    }
    return { ...paddedExtent(minimum, maximum, zeroBaseline), zeroBaseline, count, dataMin: count ? minimum : null, dataMax: count ? maximum : null }
  })
}

export function timeZoom() {
  return [
    { id: 'time-inside', type: 'inside', xAxisIndex: 0, start: 0, end: 100, filterMode: 'none', throttle: 60 },
    { id: 'time-slider', type: 'slider', xAxisIndex: 0, start: 0, end: 100, filterMode: 'none', throttle: 60, bottom: 3, height: 17, borderColor: '#e2e8e6', showDetail: false, brushSelect: false },
  ]
}

export const axisTransition = { animation: true, animationDuration: 0, animationDurationUpdate: 140, animationEasingUpdate: 'cubicOut' }

export function adaptiveYAxis(chart) {
  let config, timer, previous = ''
  function update() {
    timer = null
    if (!config || chart.isDisposed()) return
    const option = chart.getOption()
    const dateAxes = config.dateAxes || [config.dates]
    const windows = dateAxes.map((dates, axisIndex) => {
      const zoom = (option.dataZoom || []).find(z => (Array.isArray(z.xAxisIndex) ? z.xAxisIndex : [z.xAxisIndex ?? 0]).includes(axisIndex))
      const index = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && dates.includes(value) ? dates.indexOf(value) : fallback
      const first = zoom ? index(zoom.startValue, (dates.length - 1) * (zoom.start ?? 0) / 100) : 0
      const last = zoom ? index(zoom.endValue, (dates.length - 1) * (zoom.end ?? 100) / 100) : dates.length - 1
      return [Math.max(0, Math.ceil(first)), Math.min(dates.length - 1, Math.floor(last))]
    })
    const selected = Object.assign({}, ...(option.legend || []).map(legend => legend.selected))
    const extents = visibleExtents(config.series, windows, selected, config.axisCount || 1)
    const signature = JSON.stringify(extents.map(({ min, max, interval }) => [min, max, interval]))
    if (signature !== previous) {
      previous = signature
      chart.setOption({ yAxis: extents.map(extent => {
        const ticks = readableTicks(extent)
        return { min: extent.min, max: extent.max, interval: extent.interval,
          axisTick: { customValues: ticks },
          axisLabel: { show: true, hideOverlap: false, customValues: ticks, formatter: value => axisTick(value, extent.interval) } }
      }) }, { silent: true })
    }
    config.onChange?.({ extents, windows })
  }
  function schedule() {
    if (!timer) timer = setTimeout(update, 60)
  }
  chart.on('datazoom', schedule)
  chart.on('legendselectchanged', schedule)
  // 程序化图例恢复与全选同样需要重新计算。
  chart.on('legendselected', schedule)
  chart.on('legendunselected', schedule)
  chart.on('legendselectall', schedule)
  chart.on('legendinverseselect', schedule)
  return {
    reset(next) { clearTimeout(timer); timer = null; previous = ''; config = next; update() },
    dispose() {
      clearTimeout(timer)
      for (const event of ['datazoom', 'legendselectchanged', 'legendselected', 'legendunselected', 'legendselectall', 'legendinverseselect']) chart.off(event, schedule)
      config = null
    },
  }
}
