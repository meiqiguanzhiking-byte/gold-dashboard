<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { escapeHtml } from '../data.js'
import { isNumber, numberText } from '../daily-brief.js'

const props = defineProps({ model: { type: Object, required: true }, loading: Boolean, error: String })
const element = ref(null)
let chart, observer
const colors = ['#967c3f', '#367c87', '#879c91']
const lineTypes = ['solid', 'dashed', [7, 4, 1, 4]]
const emptyText = computed(() => props.loading ? '正在读取真实数据…' : props.error ? '价差数据读取失败' :
  !props.model.curves.some(curve => curve.points.some(point => isNumber(point.value))) ? '价差数据暂缺' : '')
const latestDates = computed(() => [...new Set(props.model.curves[0].points.map(point => point.date).filter(Boolean))].join(' / ') || '未提供')
const historyDates = computed(() => props.model.curves.slice(1).map(curve => ({ name: curve.name,
  dates: [...new Set(curve.points.map(point => point.date).filter(Boolean))].join(' / ') || '历史不足' })))

async function draw() {
  await nextTick()
  if (!element.value || !element.value.clientWidth) return
  if (!chart) chart = echarts.init(element.value)
  const selected = chart.getOption()?.legend?.[0]?.selected || {}
  chart.setOption({
    animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    grid: { left: 16, right: 25, top: 68, bottom: 20, containLabel: true },
    legend: { top: 8, left: 'center', selected, textStyle: { color: '#667579', fontSize: 11 }, itemWidth: 30, itemGap: 24,
      data: props.model.curves.map(curve => curve.name) },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter(params) {
      const category = params[0]?.dataIndex
      return '<strong>' + escapeHtml(props.model.categories[category] || '') + '</strong>' + params.map(param => {
        const point = props.model.curves[param.seriesIndex].points[category]
        return '<div class="tooltip-item">' + escapeHtml(param.seriesName) + '：' + escapeHtml(numberText(point.value)) +
          (isNumber(point.value) ? ' 元/克' : '') + '<br>观察日期：' + escapeHtml(point.date || '历史不足') +
          (point.contract ? '<br>当期合约：' + escapeHtml(point.contract) : '') + '</div>'
      }).join('')
    } },
    xAxis: { type: 'category', data: props.model.categories, boundaryGap: false,
      axisTick: { show: false }, axisLine: { lineStyle: { color: '#d8e0e0' } },
      axisLabel: { ...axisLabel, interval: 0, margin: 14, formatter: label => label.replace('合约价差', '\n合约价差').replace('黄金现价价差', '黄金现价\n价差') } },
    yAxis: { type: 'value', name: '价格（元/克）', scale: true,
      nameTextStyle: { color: '#718082', fontSize: 10, align: 'left' }, axisLabel,
      splitLine: { lineStyle: { color: '#edf1f0' } } },
    series: props.model.curves.map((curve, index) => ({
      name: curve.name, type: 'line', data: curve.points.map(point => point.value),
      smooth: false, connectNulls: false, showSymbol: true, symbol: ['circle', 'rect', 'diamond'][index], symbolSize: 7,
      lineStyle: { color: colors[index], width: 2, type: lineTypes[index] }, itemStyle: { color: colors[index] },
      emphasis: { focus: 'series' },
    })),
  }, true)
  chart.resize()
}
function resize() { if (element.value?.clientWidth) { chart ? chart.resize() : draw() } }
function visible() { nextTick(draw) }
watch([() => props.model, () => props.loading, () => props.error], draw, { deep: true })
onMounted(() => {
  draw()
  observer = new ResizeObserver(resize)
  observer.observe(element.value)
  window.addEventListener('dashboard-page-visible', visible)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('dashboard-page-visible', visible)
  chart?.dispose()
})
</script>

<template>
  <article class="term-panel" :aria-busy="loading">
    <header><h3 id="daily-term-structure-title">价差期限结构</h3><span>最新观察日期 {{ latestDates }}</span></header>
    <div class="term-chart-stage">
      <div ref="element" class="term-chart" data-chart-title="价差期限结构" role="img" aria-label="价差期限结构：黄金现价及两个期货合约价差，最新以实线连接，T-5以虚线连接，T-10以点虚线连接" />
      <div v-if="emptyText" class="term-empty" role="status">{{ emptyText }}</div>
    </div>
    <div class="term-dates"><span v-for="history in historyDates" :key="history.name">{{ history.name }}：{{ history.dates }}</span></div>
    <p>沿用每日指标卡的黄金现价价差及主力、次主力原始价差（不复权）；T-5、T-10分别回看前5、10个交易观察日，缺失不补值。</p>
  </article>
</template>

<style scoped>
.term-panel{border:1px solid #e0e7df;border-radius:5px;background:#fff;padding:16px 18px}.term-panel header{display:flex;justify-content:space-between;align-items:baseline;gap:8px 18px;flex-wrap:wrap}.term-panel h3{font-size:14px;color:#536a6e;margin:0;font-weight:600}.term-panel header>span,.term-dates,.term-panel p{font-size:10px;color:#8b9997;line-height:1.8}.term-chart-stage{height:290px;position:relative;margin-top:8px}.term-chart{width:100%;height:100%;overflow:hidden}.term-empty{position:absolute;inset:0;display:grid;place-items:center;background:#ffffffed;color:#849491;font-size:12px}.term-dates{display:flex;flex-wrap:wrap;gap:6px 24px}.term-panel p{margin:5px 0 0}@media(max-width:600px){.term-panel{padding:14px 12px}.term-chart-stage{height:270px}}
</style>
