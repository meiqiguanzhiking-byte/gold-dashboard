<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { adaptiveYAxis } from '../adaptive-axis.js'
import { escapeHtml, format } from '../data.js'
import { sourceLabel } from '../source-labels.js'
import { useChartVisibility } from '../chart-visibility.js'
import { spreadPolygons } from '../weekly-curves.js'

const props = defineProps({ model: { type: Object, required: true }, loading: Boolean, error: String })
const element = ref(null)
let chart, axes, bandEnabled = true
const visibility = useChartVisibility(element, draw, () => chart?.resize())
const period = computed(() => props.model.points.length ? `${props.model.points[0].date} — ${props.model.points.at(-1).date}（${props.model.points.length}个交易观测日）` : '观察日期暂缺')
const sources = computed(() => [...new Set(props.model.sources.map(sourceLabel))].join('；'))
const status = computed(() => props.loading ? '正在读取真实数据…' : props.error ? `数据读取失败：${props.error}` : props.model.withheld ? '相关数据暂未获准公开，保留空图。' : !props.model.points.length ? '该观察范围暂无可用数据。' : '')
const missing = computed(() => props.model.points.filter(p => [p.domestic, p.converted, p.fx, p.spread].some(v => v == null)).length)

async function draw() {
  await nextTick()
  if (!visibility.canDraw()) return
  if (!chart) {
    chart = echarts.init(element.value)
    axes = adaptiveYAxis(chart)
    chart.on('legendselectchanged', event => {
      bandEnabled = event.selected[props.model.localLabel] !== false && event.selected[props.model.foreignLabel] !== false
      // 价格任一条被隐藏时同步隐藏比较阴影。
      chart.setOption({ series: [{ id: 'spread-band', renderItem: renderBand }] })
    })
  }
  const model = props.model, dates = model.points.map(point => point.date)
  const previous = chart.getOption(), selected = previous?.legend?.[0]?.selected || {}
  bandEnabled = selected[model.localLabel] !== false && selected[model.foreignLabel] !== false
  const line = (key, name, color, axis, digits = 2) => ({ id: key, name, type: 'line', xAxisIndex: axis, yAxisIndex: axis,
    data: model.points.map(point => point[key]), connectNulls: false, smooth: false, showSymbol: true, symbolSize: 5,
    latestValueLabel: false, lineStyle: { color, width: 2 }, itemStyle: { color }, z: 3,
    emphasis: { focus: 'series' }, tooltip: { valueFormatter: value => format(value, digits) } })
  const series = [line('domestic', model.localLabel, '#287985', 0), line('converted', model.foreignLabel, '#ad945b', 0),
    line('fx', model.fxLabel, '#6d83ab', 1, 4), line('spread', '价差', '#8c6ca0', 2)]
  chart.setOption({
    animation: false,
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    legend: { top: 10, left: 'center', selected, data: series.map(s => s.name), textStyle: { color: '#667579', fontSize: 11 }, itemGap: 16 },
    grid: [{ top: 82, height: 170 }, { top: 305, height: 85 }, { top: 443, height: 100 }].map(grid => ({ ...grid, left: 84, right: 28 })),
    axisPointer: { link: [{ xAxisIndex: [0, 1, 2] }] },
    tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'line', snap: true }, formatter(params) {
      const p = model.points[params.find(param => param.seriesType === 'line')?.dataIndex]
      if (!p) return ''
      const row = (name, value, unit, digits = 2) => `<div>${escapeHtml(name)}：${escapeHtml(format(value, digits))}${value == null ? '' : ' ' + unit}</div>`
      return `<strong>${escapeHtml(p.date)}</strong>` + (p.contract ? `<div>当日指定合约：${escapeHtml(p.contract)}</div>` : '') +
        row(model.localLabel, p.domestic, '元/克') + row(model.id === 'spot' ? '伦敦金原价' : 'COMEX原价', p.overseas, '美元/金衡盎司') +
        row(model.foreignLabel, p.converted, '元/克') + row(model.fxLabel, p.fx, model.id === 'spot' ? 'CNY/美元' : 'CNH/美元', 4) + row('价差', p.spread, '元/克')
    } },
    xAxis: [0, 1, 2].map(gridIndex => ({ type: 'category', gridIndex, data: dates, boundaryGap: false,
      axisTick: { show: false }, axisLine: { lineStyle: { color: '#d8e0e0' } },
      axisLabel: { ...axisLabel, show: gridIndex === 2, margin: 14, formatter: date => date.slice(5) } })),
    yAxis: ['金价（元/克）', model.fxLabel + (model.id === 'spot' ? '（CNY/美元）' : '（CNH/美元）'), '价差（元/克）'].map((name, gridIndex) => ({
      type: 'value', gridIndex, name, scale: true, nameGap: 17, axisLabel,
      nameTextStyle: { color: '#718082', fontSize: 11, align: 'left' }, splitLine: { lineStyle: { color: '#edf1f0' } },
    })),
    dataZoom: ['slider'].map((type, i) => ({ id: 'weekly-' + type, type, xAxisIndex: [0, 1, 2],
      zoomOnMouseWheel: false, moveOnMouseWheel: false, preventDefaultMouseMove: false,
      start: previous?.dataZoom?.[i]?.start ?? 0, end: previous?.dataZoom?.[i]?.end ?? 100,
      filterMode: 'none', bottom: 12, height: 18, showDetail: false, brushSelect: false, borderColor: '#dce4e1' })),
    series: [...series, { id: 'spread-band', type: 'custom', xAxisIndex: 0, yAxisIndex: 0, silent: true,
      clip: true, z: 1, latestValueLabel: false, tooltip: { show: false },
      data: model.points.slice(0, -1).map((_, i) => [i]), encode: { x: 0 }, renderItem: renderBand }],
  }, true)
  axes.reset({ dates, dateAxes: [dates, dates, dates], series, axisCount: 3 })
  chart.resize()
}

function renderBand(params, api) {
  if (!bandEnabled) return
  const i = api.value(0), a = props.model.points[i], b = props.model.points[i + 1]
  if (!a || !b) return
  // 类目轴会把小数序号取整；在像素坐标中插值交点，保持阴影贴合两条直线。
  const coord = ([x, y]) => {
    const left = api.coord([i, y]), right = api.coord([i + 1, y])
    return [left[0] + (right[0] - left[0]) * (x - i), left[1]]
  }
  return { type: 'group', children: spreadPolygons(a.domestic, a.converted, b.domestic, b.converted, i).map(polygon => ({
    type: 'polygon', shape: { points: polygon.points.map(coord) },
    style: { fill: polygon.positive ? 'rgba(40,121,133,0.15)' : 'rgba(173,148,91,0.18)' },
  })) }
}

watch([() => props.model, () => props.loading, () => props.error], visibility.requestDraw)
onBeforeUnmount(() => { axes?.dispose(); chart?.dispose() })
</script>

<template>
  <article class="weekly-curve-panel" :aria-busy="loading">
    <header><h3>{{ model.title }}</h3><span>{{ period }}</span></header>
    <div class="shade-legend"><span>国内高于海外折算</span><span>国内低于海外折算</span></div>
    <div class="weekly-curve-stage">
      <div ref="element" class="weekly-curve-chart" :data-chart-title="'周度曲线-' + model.title" role="img" :aria-label="model.title + '近7个交易观测日金价、汇率与价差三层联动图'" />
      <div v-if="status" class="curve-status" role="status">{{ status }}</div>
    </div>
    <p v-if="!status && missing" class="missing-note">{{ missing }} 个观察日存在缺项，对应序列保留断点。</p>
    <p>{{ model.note }}</p><p>来源：{{ sources || '真实来源待确认' }}。缺失不补值，横轴为数据观察日期。</p>
  </article>
</template>

<style scoped>
.weekly-curve-panel{margin:0 0 24px;border:1px solid #dce4e1;border-radius:6px;background:#fff;padding:20px 22px 14px;min-width:0}.weekly-curve-panel header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}.weekly-curve-panel h3{font-size:17px;font-weight:600;color:#263c40;margin:0;border-left:3px solid #b29a61;padding-left:10px}.weekly-curve-panel header>span{font-size:11px;color:#728486}.shade-legend{display:flex;flex-wrap:wrap;gap:18px;font-size:10px;color:#728486;margin:14px 0 0}.shade-legend span:before{content:'';display:inline-block;width:16px;height:8px;margin-right:6px;background:rgba(40,121,133,.15)}.shade-legend span+span:before{background:rgba(173,148,91,.18)}.weekly-curve-stage{position:relative;overflow:hidden;min-width:0}.weekly-curve-chart{height:620px;width:100%}.curve-status{position:absolute;inset:50px 0 60px;display:flex;align-items:center;justify-content:center;color:#728486;background:#ffffffd9;font-size:13px;padding:20px;text-align:center}.weekly-curve-panel p{font-size:11px;line-height:1.8;color:#728486;margin:7px 0}.weekly-curve-panel .missing-note{color:#927d43}@media(max-width:600px){.weekly-curve-panel{padding:16px 6px 12px}.weekly-curve-panel header,.shade-legend{margin-left:9px;margin-right:9px}.weekly-curve-panel p{padding:0 9px}}
</style>
