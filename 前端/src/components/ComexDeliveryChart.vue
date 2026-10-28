<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echarts, tooltipStyle } from '../charts.js'
import { escapeHtml, localTime } from '../data.js'
import { deliveryColor, deliveryIssuedNumber, deliveryNumber, deliverySideColor, deliveryView } from '../deliveries.js'
import { deliveryInstitution } from '../delivery-institutions.js'
import StatusBadge from './StatusBadge.vue'

const props = defineProps({ symbol: String, product: Object, loading: Boolean, error: String })
const title = computed(() => props.symbol === 'GC' ? '标准黄金期货 GC' : '微型黄金期货 MGC')
const isGc = computed(() => props.symbol === 'GC'), hideNoData = ref(false)
const chineseNames = ref(false)
const months = ref([]), legend = ref({}), el = ref(null), viewport = ref(null)
const labelInset = ref(174)
let initialized = false, chart, observer, generation = 0
watch(() => props.product?.available_months, available => {
  if (!available?.length) return
  if (!initialized) { months.value = available.slice(-3); initialized = true }
  else months.value = months.value.filter(month => available.includes(month))
}, { immediate: true })
const view = computed(() => deliveryView(props.product, months.value, legend.value, { hideNoData: isGc.value && hideNoData.value, distinguishSides: true, minimumHeight: 520, ...(!isGc.value ? { fixedHeight: 520 } : {}) }))
const empty = computed(() => props.loading ? '正在读取真实交割数据…' : props.error ? '接口请求失败：' + props.error : !props.product?.accounts?.length || !props.product?.available_months?.length ? '该合约来源数据暂缺' : !months.value.length ? '请选择至少一个月份' : !view.value.accounts.length ? '所选月份没有已报告数值的机构' : '')
function tooltip(params) {
  const account = view.value.accounts[(Array.isArray(params) ? params[0] : params)?.dataIndex]
  if (!account) return ''
  const name = deliveryInstitution(account.institution, chineseNames.value)
  return '<strong>' + escapeHtml(name.label) + '</strong>' + (chineseNames.value ? '<div>原表名称：' + escapeHtml(name.original) + (name.clearingName ? '<br>核对名称：' + escapeHtml(name.clearingName) : '') + '<br>' + escapeHtml(name.account) + '</div>' : '') + view.value.months.filter(month => legend.value[month] !== false).map(month => {
    const index = props.product.months.indexOf(month)
    const marker = '<span style="display:inline-block;width:8px;height:8px;margin-right:5px;background:' + deliveryColor(month) + '"></span>'
    return '<div style="margin-top:6px">' + marker + escapeHtml(month) + '<br>交付 I：' + deliveryIssuedNumber(account.issued[index], 6) + ' 吨<br>接收 S：' + deliveryNumber(account.stopped[index], 6) + ' 吨</div>'
  }).join('') + '<div style="margin-top:6px">月份为观察期，发布日期未提供。</div>'
}
async function draw() {
  const current = ++generation
  await nextTick()
  if (current !== generation || !el.value) return
  if (empty.value) { chart?.dispose(); chart = null; return }
  chart ||= echarts.init(el.value)
  const width = el.value.clientWidth
  const labelWidth = width < 440 ? 124 : width < 580 ? 165 : 215
  labelInset.value = labelWidth + 9
  const firstVisible = view.value.series.findIndex(series => legend.value[series.name] !== false)
  chart.setOption({ animation: false,
    grid: { left: labelWidth + 9, right: 43, top: 34, bottom: 30 },
    tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: tooltip },
    legend: { show: false, selected: legend.value, data: view.value.months },
    xAxis: { type: 'value', position: 'top', min: view.value.min, max: view.value.max, splitNumber: 4,
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 9, color: '#849092', hideOverlap: true, formatter: value => value < 0 ? deliveryIssuedNumber(value) : deliveryNumber(value, 4) },
      splitLine: { lineStyle: { color: '#edf1f0' } } },
    yAxis: { type: 'category', inverse: true, position: 'left', data: view.value.accounts.map(account => account.institution),
      axisLine: { show: false, onZero: false }, axisTick: { show: false },
      axisLabel: { interval: 0, margin: 9, width: labelWidth, overflow: 'break', lineHeight: 13, fontSize: 10, color: '#53696e', formatter: value => deliveryInstitution(value, chineseNames.value).label },
      splitLine: { show: true, lineStyle: { color: '#edf1f0', type: 'dashed' } } },
    series: view.value.series.map((series, index) => index !== firstVisible ? series : { ...series,
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#718784', width: 1, type: 'solid' }, data: [{ xAxis: 0 }] } }),
  }, true)
  chart.resize()
}
function toggle(month) { legend.value = { ...legend.value, [month]: legend.value[month] === false } }
function resize() { nextTick(draw) }
watch([() => props.product, () => props.loading, () => props.error, months, legend, hideNoData, chineseNames], draw, { deep: true })
onMounted(() => {
  draw()
  window.addEventListener('dashboard-page-visible', resize)
  observer = new ResizeObserver(() => { if (el.value?.clientWidth) draw() })
  observer.observe(viewport.value)
})
onBeforeUnmount(() => { ++generation; window.removeEventListener('dashboard-page-visible', resize); observer?.disconnect(); chart?.dispose() })
</script>

<template>
  <article class="chart-panel delivery-panel" :class="{ 'delivery-gc': isGc }">
    <header class="panel-header"><div><h3>{{ title }}</h3><p>最新有效月份：{{ product?.coverage_end || '未提供' }} · 单位：吨</p></div><StatusBadge :status="loading ? '加载中' : error ? '接口失败' : product?.accounts?.length ? '月度' : '数据缺失'" /></header>
    <div class="delivery-months" :aria-label="symbol + '交割月份'"><span>比较月份</span><label v-for="month in product?.available_months || []" :key="month"><input v-model="months" type="checkbox" :value="month" :aria-label="symbol + '交割月份 ' + month">{{ month }}</label></div>
    <div class="delivery-options"><label v-if="isGc"><input v-model="hideNoData" type="checkbox" aria-label="GC隐藏无数据机构">隐藏所选月份无数据的机构</label><span v-if="isGc">真实0保留</span><label><input v-model="chineseNames" type="checkbox" :aria-label="symbol + '机构名称翻译中文'">机构名称翻译中文</label></div>
    <div class="delivery-legend" :aria-label="symbol + '月份图例'"><button v-for="month in view.months" :key="month" :aria-pressed="legend[month] !== false" :class="{ muted: legend[month] === false }" @click="toggle(month)"><i :style="{ background: 'linear-gradient(to right, ' + deliverySideColor(month, 'issued') + ' 50%, ' + deliverySideColor(month, 'stopped') + ' 50%)' }"></i>{{ month }}</button></div>
    <div class="delivery-directions" :style="{ paddingLeft: labelInset + 'px', paddingRight: '58px' }"><span>交付 I</span><span>0</span><span>接收 S</span></div>
    <div ref="viewport" class="delivery-viewport" :aria-label="symbol + '交割机构图表滚动区'" tabindex="0">
      <div v-show="!empty" ref="el" class="delivery-chart" :style="{ height: view.height + 'px' }" :data-chart-title="title + '实物交割（吨）'" />
      <div v-if="empty" class="delivery-empty" role="status">{{ empty }}</div>
    </div>
    <footer class="delivery-footer"><div class="chart-caption">默认最近3个有数据月份；可勾选月份、点击图例，{{ isGc ? '向下滚动查看当前显示的 ' : '显示全部 ' }}{{ view.accounts.length }} 个机构账户<span v-if="isGc">（共 {{ view.totalAccounts }} 个<span v-if="hideNoData">，已隐藏 {{ view.totalAccounts - view.accounts.length }} 个无数据账户</span>）</span>。所选月份 {{ view.missing }} 项 I/S 缺失，空白不补零；悬停可区分真实0与未报告。</div>
    <div v-for="warning in product?.warnings || []" :key="warning" class="delivery-warning">{{ warning }}</div>
    <div v-if="chineseNames" class="delivery-name-note">中文为名称释义；未核实的专名保留英文。会员编号与C/H不变，悬停可查原表名称。</div>
    <div class="chart-source">来源：黄金交割.xlsx · {{ symbol }} 表 · 文件更新 {{ localTime(product?.updated_at) }} · 发布日期未提供</div></footer>
  </article>
</template>

<style scoped>
.delivery-panel{min-width:0}.delivery-months{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:12px 0;font-size:10px;color:#6f817d}.delivery-months label{display:flex;align-items:center;gap:3px;white-space:nowrap}.delivery-months input{accent-color:#287985;margin:0}.delivery-legend{display:flex;flex-wrap:wrap;gap:6px 12px;min-height:24px;margin:8px 0}.delivery-legend button{display:flex;align-items:center;gap:5px;border:0;padding:3px 0;background:none;color:#617671;font-size:10px;cursor:pointer}.delivery-legend i{width:13px;height:7px;display:inline-block}.delivery-legend .muted{opacity:.35}.delivery-directions{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#617671;padding:8px 3px;border-top:1px solid #e8ede9}.delivery-viewport{max-height:680px;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;overscroll-behavior:contain;border-top:1px solid #edf1ef;border-bottom:1px solid #edf1ef}.delivery-chart{width:100%;min-height:300px}.delivery-empty{min-height:300px;display:grid;place-items:center;color:#889992;font-size:12px}.delivery-warning{color:#9c7952;font-size:10px;margin:7px 0;line-height:1.7}.delivery-panel .chart-source{overflow-wrap:anywhere}.delivery-panel .panel-header{gap:8px}@media(max-width:760px){.delivery-viewport{max-height:560px}}
.delivery-panel{display:grid;grid-template-rows:subgrid;grid-row:span 7;row-gap:0}
.delivery-viewport{height:520px;min-height:0;max-height:520px}
.delivery-options{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;font-size:10px;color:#6f817d;margin:10px 0}
.delivery-options label{display:flex;align-items:center;gap:5px;cursor:pointer}
.delivery-options input{accent-color:#287985;margin:0}
.delivery-options>span{font-size:10px;color:#8a9993;line-height:1.6}
.delivery-name-note{color:#8a9993;font-size:9px;line-height:1.7;margin-top:6px}
.delivery-footer{display:flex;flex-direction:column;min-width:0}
.delivery-footer .chart-source{margin-top:auto}
</style>
