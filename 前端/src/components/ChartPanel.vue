<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { echarts, axisLabel, tooltipRow, tooltipStyle } from '../charts.js'
import { filteredHistory, numeric, ranges, palette, escapeHtml } from '../data.js'
import { adaptiveYAxis, axisTransition, timeZoom } from '../adaptive-axis.js'

const props = defineProps({ title: String, description: String, series: { type: Array, default: () => [] }, loading: Boolean, error: String, reason: String, note: String, tooltipDetails: Function, range: { type: String, default: '1Y' }, fixedRange: Boolean })
const localRange = ref(props.range), el = ref(null)
let chart, resizeObserver, adaptive
const axisInfo = ref('')
const hasLines = computed(() => available.value.some(s => !s.type || s.type === 'line'))
const available = computed(() => props.series.filter(s => s.item))
const frequency = computed(() => [...new Set(available.value.map(s => s.item.metadata.frequency))])
const unit = computed(() => [...new Set(available.value.map(s => s.item.metadata.unit))].join(' / ') || '单位未提供')
const latestDate = computed(() => available.value.map(s => s.item.metadata.coverage_end).filter(Boolean).sort().at(-1))
const sources = computed(() => [...new Set(available.value.map(s => s.item.metadata.source))].join('；'))
const histories = computed(() => available.value.map(s => filteredHistory(s.item, localRange.value, latestDate.value)))
const dates = computed(() => [...new Set(histories.value.flatMap(h => h.map(p => p.observation_date)))].sort())
const validCount = computed(() => histories.value.reduce((sum, h) => sum + h.filter(numeric).length, 0))
const statusTags = computed(() => {
  if (props.loading) return ['加载中']
  if (props.error) return ['接口失败']
  const flags = [...new Set(available.value.flatMap(s => s.item.metadata.statuses || [s.item.metadata.status]))]
  if (flags.length > 1) return flags.filter(x => x !== '正常')
  return flags.length ? flags : ['数据缺失']
})
const emptyReason = computed(() => props.loading ? '正在读取真实数据…' : props.error ? '接口请求失败：' + props.error : props.reason || (frequency.value.length > 1 ? '频率不同，不能共用同一时间轴，请分别查看。' : !validCount.value ? '该区间无有效记录，数据暂缺。' : dates.value.length < 2 ? '当前区间仅一个观察点，无法形成趋势，请扩大时间区间。' : ''))
const coverage = computed(() => dates.value.length ? dates.value[0] + ' — ' + dates.value.at(-1) + ' · ' + dates.value.length + ' 个观察期' : '无可用观察期')

async function draw() {
  await nextTick()
  if (emptyReason.value || !el.value) { adaptive?.dispose(); adaptive = null; chart?.dispose(); chart = null; axisInfo.value = ''; return }
  if (!chart) { chart = echarts.init(el.value); adaptive = adaptiveYAxis(chart) }
  const pointMaps = histories.value.map(h => new Map(h.map(p => [p.observation_date, p])))
  const axisCount = Math.max(...available.value.map(s => s.yAxisIndex || 0)) + 1
  const series = available.value.map((s, index) => ({
    name: s.name || s.item.metadata.indicator_name, type: s.type || 'line', stack: s.stack, yAxisIndex: s.yAxisIndex || 0, areaStyle: s.areaStyle,
    showSymbol: dates.value.length < 20, symbolSize: 4, connectNulls: false, smooth: false,
    lineStyle: { width: 2 }, itemStyle: { color: s.color || palette[index % palette.length] }, barMaxWidth: 22,
    emphasis: { focus: 'series' },
    data: dates.value.map(date => { const point = pointMaps[index].get(date); return s.signed && point?.value != null ? { value: point.value, itemStyle: { color: point.value >= 0 ? '#278b94' : '#c27e65' } } : point?.value ?? null }),
  }))
  chart.setOption({
    ...axisTransition,
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    grid: { left: 18, right: axisCount > 1 ? 30 : 22, top: 54, bottom: 58, containLabel: true },
    legend: { type: 'scroll', top: 2, left: 0, right: 0, selected: chart.getOption()?.legend?.[0]?.selected || {}, textStyle: { color: '#667579', fontSize: 10 }, icon: 'roundRect', itemWidth: 12, itemHeight: 5 },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter(params) {
      const rows = params.map(p => tooltipRow(available.value[p.seriesIndex].item, pointMaps[p.seriesIndex].get(p.axisValue) || { observation_date: p.axisValue, value: null }, p.color)).join('')
      const details = props.tooltipDetails?.(params[0]?.axisValue)
      return rows + (details ? '<div class="tooltip-item">' + escapeHtml(details) + '</div>' : '')
    } },
    xAxis: { type: 'category', data: dates.value, boundaryGap: available.value.some(s => s.type === 'bar'), axisTick: { show: false }, axisLine: { lineStyle: { color: '#d8e0e0' } }, axisLabel },
    yAxis: Array.from({ length: axisCount }, (_, index) => ({ type: 'value', name: [...new Set(available.value.filter(s => (s.yAxisIndex || 0) === index).map(s => s.item.metadata.unit))].join(' / '), position: index ? 'right' : 'left', nameTextStyle: { color: '#718082', fontSize: 10, align: index ? 'right' : 'left' }, nameLocation: 'end', axisLabel: { ...axisLabel, show: true, hideOverlap: false }, splitLine: { show: index === 0, lineStyle: { color: '#edf1f0' } }, axisLine: { show: true, onZero: true, lineStyle: { color: '#adbdbd' } } })),
    dataZoom: timeZoom(),
    series,
  }, true)
  adaptive.reset({ dates: dates.value, series, axisCount, onChange({ windows, extents }) {
    const [start, end] = windows[0]
    axisInfo.value = !extents.some(e => !e.empty) ? '可见区间内无已启用的有效数据' : `可见 ${dates.value[start]} — ${dates.value[end]} · ${extents.every(e => e.zeroBaseline) ? '柱状/堆叠轴保留零基线' : '折线纵轴按可见数据自适应，请结合刻度判断幅度'}`
  } })
}
function resetZoom() { chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 }) }
function refreshPageChart() { nextTick(() => chart?.resize()) }
watch([() => props.series, () => props.loading, () => props.error, () => props.reason, localRange], draw, { deep: true })
onMounted(() => { draw(); window.addEventListener('dashboard-page-visible', refreshPageChart); resizeObserver = new ResizeObserver(() => chart?.resize()); if (el.value) resizeObserver.observe(el.value) })
onBeforeUnmount(() => { window.removeEventListener('dashboard-page-visible', refreshPageChart); resizeObserver?.disconnect(); adaptive?.dispose(); chart?.dispose() })
</script>
<template>
  <article class="chart-panel">
    <header class="panel-header"><div><h3>{{ title }}</h3><p>{{ description || '保留原始观察日期，不插值、不前值填充' }}</p></div><div class="status-group"><StatusBadge v-for="s in statusTags" :key="s" :status="s" /></div></header>
    <div class="chart-toolbar"><span>{{ frequency.join(' / ') || '频率未提供' }} · {{ unit }} · 最新 {{ latestDate || '未提供' }}</span><div class="time-controls"><button v-if="hasLines && !emptyReason" class="text-button" :aria-label="title + '重置缩放'" @click="resetZoom">重置缩放</button><select v-if="!fixedRange" v-model="localRange" :aria-label="title + '时间区间'"><option v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</option></select></div></div>
    <div class="chart-stage"><div ref="el" class="echart" :data-chart-title="title" /><div v-if="emptyReason" class="empty-state"><span class="empty-symbol">—</span><strong>{{ emptyReason }}</strong><span>{{ available[0]?.item.warnings[0] || '请检查数据来源或调整筛选条件' }}</span></div></div>
    <div class="chart-caption"><span>{{ coverage }}</span><span>{{ note || '图例可开关；空值不按 0 处理' }}</span></div>
    <div v-if="axisInfo" class="axis-note">{{ axisInfo }}</div>
    <div class="chart-source">来源：{{ sources || '未提供' }}</div>
  </article>
</template>

<style scoped>
.echart{overflow:hidden}
.time-controls{display:flex;align-items:center;gap:10px;flex-shrink:0}.time-controls .text-button{font-size:9px}.axis-note{font-size:9px;color:#849491;line-height:1.7;margin-top:4px;overflow-wrap:anywhere}
</style>
