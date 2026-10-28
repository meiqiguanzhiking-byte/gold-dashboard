<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipRow, tooltipStyle } from '../charts.js'
import { escapeHtml, format } from '../data.js'
import StatusBadge from './StatusBadge.vue'
const props = defineProps({ title: String, rows: { type: Array, default: () => [] }, period: String, unit: String, error: String, loading: Boolean, note: String, negative: Boolean, nameFormatter: Function })
const expanded = ref(false), el = ref(null)
const visible = computed(() => expanded.value ? props.rows : props.rows.slice(0, 5))
const displayName = name => props.nameFormatter ? props.nameFormatter(name) : name
const longNames = computed(() => props.rows.some(row => displayName(row.name).length > 25))
function tooltip(point) {
  const row = visible.value[point.dataIndex], translated = displayName(row.name)
  if (translated === row.name) return tooltipRow(row.item, row.point, point.color)
  const original = row.item.metadata.indicator_name
  const indicatorName = original.startsWith(row.name) ? translated + original.slice(row.name.length) : translated + ' · ' + original
  return tooltipRow({ ...row.item, metadata: { ...row.item.metadata, indicator_name: indicatorName } }, row.point, point.color) + '<div>原表名称：' + escapeHtml(row.name) + '</div>'
}
let chart, observer
async function draw() {
  await nextTick()
  if (props.loading || props.error || !visible.value.length) { chart?.dispose(); chart = null; return }
  chart ||= echarts.init(el.value)
  chart.setOption({ animation: false,
    grid: { left: longNames.value ? 195 : 124, right: 66, top: 16, bottom: 32 },
    tooltip: { ...tooltipStyle, trigger: 'item', formatter: tooltip },
    xAxis: { type: 'value', name: props.unit, nameLocation: 'middle', nameGap: 22, nameTextStyle: { fontSize: 10 }, axisLabel, splitLine: { lineStyle: { color: '#edf1f0' } } },
    yAxis: { type: 'category', inverse: true, data: visible.value.map(r => r.name), axisLabel: { ...axisLabel, color: '#55676d', width: longNames.value ? 180 : 110, overflow: 'truncate', formatter: displayName }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: 'bar', barMaxWidth: 18, itemStyle: { color: props.negative ? '#c27e65' : '#278b94' }, label: { show: true, position: props.negative ? 'left' : 'right', formatter: p => format(p.value), fontSize: 10, color: '#647578' }, data: visible.value.map(r => r.point.value) }],
  }, true)
  chart.resize()
}
watch([() => props.rows, () => props.loading, () => props.error, () => props.nameFormatter, expanded], draw, { deep: true })
function refreshPageChart() { nextTick(() => chart?.resize()) }
onMounted(() => { draw(); window.addEventListener('dashboard-page-visible', refreshPageChart); observer = new ResizeObserver(() => chart?.resize()); observer.observe(el.value) })
onBeforeUnmount(() => { window.removeEventListener('dashboard-page-visible', refreshPageChart); observer?.disconnect(); chart?.dispose() })
</script>
<template>
  <article class="chart-panel ranking-panel"><header class="panel-header"><div><h3>{{ title }}</h3><p>统计期间：{{ period || '未提供' }} · {{ unit || '单位未提供' }}</p></div><StatusBadge :status="loading ? '加载中' : error ? '接口失败' : rows.length ? unit === '未提供' ? '未确认' : '正常' : '数据缺失'" /></header>
    <div class="chart-stage" :style="{ height: expanded ? Math.max(230, visible.length * 29 + 50) + 'px' : '230px' }"><div ref="el" class="echart" :data-chart-title="title" /><div v-if="loading || error || !rows.length" class="empty-state"><strong>{{ loading ? '正在读取真实数据…' : error ? '接口请求失败：' + error : '该观察期没有可用排名数据' }}</strong><span>{{ note }}</span></div></div>
    <button v-if="rows.length > 5" class="text-button" @click="expanded = !expanded">{{ expanded ? '收起至前 5 名' : '展开全部 ' + rows.length + ' 项' }}</button>
    <div class="chart-caption">{{ note || '仅比较同一观察期的已披露数据' }}</div><div class="chart-source">{{ rows[0]?.item.metadata.frequency || '频率未提供' }} · 最新观察期 {{ rows[0]?.item.metadata.coverage_end || '未提供' }} · 来源：{{ rows[0]?.item.metadata.source || '未提供' }}</div>
  </article>
</template>
