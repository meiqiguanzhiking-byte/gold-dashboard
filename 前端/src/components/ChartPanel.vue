<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { echarts, axisLabel, tooltipRow, tooltipStyle } from '../charts.js'
import { filteredHistory, format, numeric, ranges, palette } from '../data.js'

const props = defineProps({ title: String, description: String, series: { type: Array, default: () => [] }, loading: Boolean, error: String, reason: String, note: String, range: { type: String, default: '1Y' }, fixedRange: Boolean })
const localRange = ref(props.range), el = ref(null)
let chart, resizeObserver
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
  if (emptyReason.value || !el.value) { chart?.dispose(); chart = null; return }
  chart ||= echarts.init(el.value)
  const pointMaps = histories.value.map(h => new Map(h.map(p => [p.observation_date, p])))
  chart.setOption({
    animation: false,
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    grid: { left: 72, right: 22, top: 54, bottom: dates.value.length > 90 ? 65 : 38 },
    legend: { type: 'scroll', top: 2, left: 0, right: 0, textStyle: { color: '#667579', fontSize: 10 }, icon: 'roundRect', itemWidth: 12, itemHeight: 5 },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter(params) { return params.map(p => tooltipRow(available.value[p.seriesIndex].item, pointMaps[p.seriesIndex].get(p.axisValue) || { observation_date: p.axisValue, value: null }, p.color)).join('') } },
    xAxis: { type: 'category', data: dates.value, boundaryGap: available.value.some(s => s.type === 'bar'), axisTick: { show: false }, axisLine: { lineStyle: { color: '#d8e0e0' } }, axisLabel },
    yAxis: { type: 'value', name: unit.value, nameTextStyle: { color: '#718082', fontSize: 10, align: 'left' }, nameLocation: 'end', axisLabel: { ...axisLabel, formatter: value => format(value, 0) }, splitLine: { lineStyle: { color: '#edf1f0' } }, axisLine: { show: true, onZero: true, lineStyle: { color: '#adbdbd' } } },
    dataZoom: dates.value.length > 90 ? [{ type: 'inside', start: 0, end: 100, filterMode: 'none' }, { type: 'slider', start: 0, end: 100, bottom: 3, height: 17, borderColor: '#e2e8e6', showDetail: false, brushSelect: false }] : [],
    series: available.value.map((s, index) => ({
      name: s.name || s.item.metadata.indicator_name, type: s.type || 'line', stack: s.stack, showSymbol: dates.value.length < 20, symbolSize: 4, connectNulls: false,
      lineStyle: { width: 2 }, itemStyle: { color: s.color || palette[index % palette.length] }, barMaxWidth: 22,
      emphasis: { focus: 'series' },
      data: dates.value.map(date => { const point = pointMaps[index].get(date); return s.signed && point?.value != null ? { value: point.value, itemStyle: { color: point.value >= 0 ? '#278b94' : '#c27e65' } } : point?.value ?? null }),
    })),
  }, true)
}
watch([() => props.series, () => props.loading, () => props.error, () => props.reason, localRange], draw, { deep: true })
onMounted(() => { draw(); resizeObserver = new ResizeObserver(() => chart?.resize()); if (el.value) resizeObserver.observe(el.value) })
onBeforeUnmount(() => { resizeObserver?.disconnect(); chart?.dispose() })
</script>
<template>
  <article class="chart-panel">
    <header class="panel-header"><div><h3>{{ title }}</h3><p>{{ description || '保留原始观察日期，不插值、不前值填充' }}</p></div><div class="status-group"><StatusBadge v-for="s in statusTags" :key="s" :status="s" /></div></header>
    <div class="chart-toolbar"><span>{{ frequency.join(' / ') || '频率未提供' }} · {{ unit }} · 最新 {{ latestDate || '未提供' }}</span><select v-if="!fixedRange" v-model="localRange" :aria-label="title + '时间区间'"><option v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</option></select></div>
    <div class="chart-stage"><div ref="el" class="echart" :data-chart-title="title" /><div v-if="emptyReason" class="empty-state"><span class="empty-symbol">—</span><strong>{{ emptyReason }}</strong><span>{{ available[0]?.item.warnings[0] || '请检查数据来源或调整筛选条件' }}</span></div></div>
    <div class="chart-caption"><span>{{ coverage }}</span><span>{{ note || '图例可开关；空值不按 0 处理' }}</span></div>
    <div class="chart-source">来源：{{ sources || '未提供' }}</div>
  </article>
</template>
