<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echarts, tooltipStyle, tooltipRow, axisLabel } from '../charts.js'
import { regions, ranges, filteredHistory, format } from '../data.js'
import StatusBadge from './StatusBadge.vue'
const props = defineProps({ items: { type: Array, default: () => [] }, selected: { type: Array, default: () => [] }, loading: Boolean, error: String })
const range = ref('1Y'), el = ref(null)
let chart, observer
const activeRegions = computed(() => regions.filter(r => props.selected.includes(r.id)))
const get = id => props.items.find(item => item.metadata.indicator_id === id)
const latestDate = computed(() => props.items.filter(i => i.metadata.frequency === '月度').map(i => i.metadata.coverage_end).filter(Boolean).sort().at(-1))
const histories = computed(() => activeRegions.value.map(r => filteredHistory(get('global_etf_monthly_' + r.id + '_tonnes'), range.value, latestDate.value)))
const dates = computed(() => [...new Set(histories.value.flatMap(h => h.map(p => p.observation_date)))].sort())
const status = computed(() => props.loading ? '加载中' : props.error ? '接口失败' : !dates.value.length ? '数据缺失' : props.items.some(i => i.metadata.frequency === '月度' && i.metadata.statuses?.includes('滞后')) ? '滞后' : '正常')
async function draw() {
  await nextTick()
  if (props.loading || props.error || !dates.value.length) { chart?.dispose(); chart = null; return }
  chart ||= echarts.init(el.value)
  const values = [], missing = []
  activeRegions.value.forEach((r, y) => {
    const item = get('global_etf_monthly_' + r.id + '_tonnes')
    const map = new Map(histories.value[y].map(p => [p.observation_date, p]))
    dates.value.forEach((date, x) => {
      const point = map.get(date) || { observation_date: date, value: null, release_date: null }
      const datum = { value: point.value == null ? [x, y] : [x, y, point.value], item, point }
      ;(point.value == null ? missing : values).push(datum)
    })
  })
  const maximum = Math.max(1, ...values.map(p => Math.abs(p.point.value)))
  chart.setOption({ animation: false, grid: { left: 50, right: 18, top: 18, bottom: dates.value.length > 18 ? 100 : 76 },
    tooltip: { ...tooltipStyle, formatter(p) { const d = p.data; return tooltipRow(d.item, d.point, d.point.value == null ? '#dfe4e4' : p.color) } },
    xAxis: { type: 'category', data: dates.value, axisLabel: { ...axisLabel, formatter: v => v.slice(0, 7), rotate: dates.value.length < 18 ? 30 : 0 }, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false } },
    yAxis: { type: 'category', data: activeRegions.value.map(r => r.name), axisLabel, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { min: -maximum, max: maximum, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 10, itemHeight: 150, seriesIndex: 1, precision: 1, text: ['净流入（吨）', '净流出（吨）'], textStyle: { fontSize: 10, color: '#7a888b' }, inRange: { color: ['#c17c65', '#f3f4f2', '#25818e'] } },
    dataZoom: dates.value.length > 18 ? [{ type: 'slider', xAxisIndex: 0, start: 0, end: 100, height: 16, bottom: 53, showDetail: false }, { type: 'inside', xAxisIndex: 0, start: 0, end: 100 }] : [],
    series: [
      { type: 'custom', name: '数据缺失', data: missing, encode: { x: 0, y: 1 }, renderItem(params, api) { const center = api.coord([api.value(0), api.value(1)]); const size = api.size([1, 1]); return { type: 'rect', shape: { x: center[0] - size[0] / 2, y: center[1] - size[1] / 2, width: size[0], height: size[1] }, style: { fill: '#dfe4e4', stroke: '#fff', lineWidth: 2 } } } },
      { type: 'heatmap', name: '月度地区净流量', data: values, itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: dates.value.length <= 15, fontSize: 10, color: '#354b50', formatter: p => format(p.data.point.value, 1) }, emphasis: { itemStyle: { borderColor: '#334f55', borderWidth: 1 } } },
    ],
  }, true)
}
watch([() => props.items, () => props.selected, () => props.loading, () => props.error, range], draw, { deep: true })
function refreshPageChart() { nextTick(() => chart?.resize()) }
onMounted(() => { draw(); window.addEventListener('dashboard-page-visible', refreshPageChart); observer = new ResizeObserver(() => chart?.resize()); observer.observe(el.value) })
onBeforeUnmount(() => { window.removeEventListener('dashboard-page-visible', refreshPageChart); observer?.disconnect(); chart?.dispose() })
</script>
<template>
  <article class="chart-panel wide"><header class="panel-header"><div><h3>全球黄金 ETF 月度地区净流量热力图（吨）</h3><p>横向比较月份，纵向比较地区；灰色表示缺失，与真实零值分开</p></div><StatusBadge :status="status" /></header>
    <div class="chart-toolbar"><span>月度 · 吨 · 最新 {{ latestDate || '未提供' }}</span><select v-model="range" aria-label="热力图时间区间"><option v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</option></select></div>
    <div class="chart-stage heat-stage"><div ref="el" class="echart" data-chart-title="月度地区热力图" /><div v-if="loading || error || !dates.length" class="empty-state"><strong>{{ loading ? '正在读取真实数据…' : error ? '接口请求失败：' + error : selected.length ? '该区间无月度数据' : '请选择至少一个地区' }}</strong></div></div>
    <div class="chart-caption"><span>{{ dates[0] || '—' }} — {{ dates.at(-1) || '—' }} · {{ dates.length }} 个月度观察期</span><span>悬停查看名称、吨数与日期</span></div><div class="chart-source">来源：全球黄金ETF流量.xlsx / 月度数据</div>
  </article>
</template>
