<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { crossGroups, crossItems, intersectHistories } from '../cross-display.js'
import { dateNumber, escapeHtml, numeric, palette, ranges } from '../data.js'
import { echarts, axisLabel, tooltipRow, tooltipStyle } from '../charts.js'
import { axisTick, paddedExtent, timeZoom } from '../adaptive-axis.js'
import { sourceLabel } from '../source-labels.js'

const props = defineProps({ items: { type: Array, default: () => [] }, blocks: Object })
const activePage = inject('dashboardActivePage')
const storageKey = 'gold-dashboard:cross:v1'
const selected = ref([]), range = ref('1Y'), search = ref(''), el = ref(null)
try {
  const saved = JSON.parse(localStorage.getItem(storageKey))
  if (Array.isArray(saved?.ids) && saved.ids.length <= 2 && saved.ids.every(id => typeof id === 'string')) selected.value = [...new Set(saved.ids)]
  if (ranges.some(r => r.value === saved?.range)) range.value = saved.range
} catch { /* 存储不可用时使用空选择。 */ }
const candidates = computed(() => crossItems(props.items))
const groups = computed(() => crossGroups(candidates.value).map(group => ({ ...group,
  items: group.items.filter(item => (item.metadata.indicator_name + item.metadata.indicator_id).toLowerCase().includes(search.value.toLowerCase())),
})))
const byId = computed(() => new Map(candidates.value.map(item => [item.metadata.indicator_id, item])))
watch([byId, () => Object.values(props.blocks || {}).some(b => b.loading)], ([index, pending]) => {
  if (!props.items.length || pending) return
  selected.value = selected.value.filter(id => index.has(id))
}, { immediate: true })
const chosen = computed(() => selected.value.map(id => byId.value.get(id)))
const label = item => item?.metadata.indicator_name || '指标读取中'
const sources = item => item ? (item.crossSources || [item.metadata]).map(sourceLabel).join('；') : '未提供'
const loading = computed(() => activePage.value === 'cross' && Object.values(props.blocks || {}).some(b => b.loading))
const errors = computed(() => Object.entries(props.blocks || {}).filter(([, b]) => b.error))
const histories = computed(() => intersectHistories(chosen.value, range.value))
const commonDates = computed(() => histories.value[0].map(p => p.observation_date))
const empty = computed(() => selected.value.length < 2 ? `请按顺序勾选两个指标（已选 ${selected.value.length}/2）` : loading.value ? '正在读取完整历史数据…' : !commonDates.value.length ? '两项指标在当前区间没有共同有效观察日期，请调整选择。' : '')
function toggle(id) {
  if (selected.value.includes(id)) selected.value = selected.value.filter(value => value !== id)
  else if (selected.value.length < 2) selected.value = [...selected.value, id]
}
watch([selected, range], () => {
  try { localStorage.setItem(storageKey, JSON.stringify({ ids: selected.value, range: range.value })) } catch { /* 保留会话内选择。 */ }
}, { deep: true })

let chart, observer, timer, signature = ''
const axisInfo = ref('')
// 时间轴使用实际日期间距；只绘制两条序列均有效的共同观察日期。
function updateAxes() {
  if (!chart) return
  const option = chart.getOption(), zoom = option.dataZoom?.[0]
  const times = histories.value.flatMap(h => h.map(p => dateNumber(p.observation_date))).filter(Number.isFinite)
  if (!times.length) return
  const first = Math.min(...times), last = Math.max(...times)
  const start = zoom?.startValue ?? first + (last - first) * (zoom?.start ?? 0) / 100
  const end = zoom?.endValue ?? first + (last - first) * (zoom?.end ?? 100) / 100
  const enabled = option.legend?.[0]?.selected || {}
  const extents = histories.value.map((history, index) => {
    const values = enabled[seriesName(index)] === false ? [] : history.filter(p => numeric(p) && dateNumber(p.observation_date) >= start && dateNumber(p.observation_date) <= end).map(p => p.value)
    return paddedExtent(Math.min(...values), Math.max(...values))
  })
  chart.setOption({ yAxis: extents.map(e => ({ min: e.min, max: e.max, interval: e.interval,
    axisLabel: { ...axisLabel, formatter: value => axisTick(value, e.interval) } })) }, { silent: true })
  axisInfo.value = extents.every(e => e.empty) ? '可见区间内无已启用的有效数据' : '左右纵轴分别按当前可见且启用的数据自适应，请结合各轴刻度判断幅度。'
}
function seriesName(index) { return `${index ? '右轴' : '左轴'} · ${label(chosen.value[index])}` }
function scheduleAxes() { clearTimeout(timer); timer = setTimeout(updateAxes, 60) }
async function draw() {
  await nextTick()
  if (activePage.value !== 'cross' || !el.value?.clientWidth) return
  if (empty.value) { chart?.dispose(); chart = null; signature = ''; axisInfo.value = ''; return }
  if (!chart) {
    chart = echarts.init(el.value)
    for (const event of ['datazoom', 'legendselectchanged', 'legendunselected', 'legendselected']) chart.on(event, scheduleAxes)
  }
  const nextSignature = selected.value.join('|') + range.value
  const prior = signature === nextSignature ? chart.getOption() : null
  const zoom = timeZoom().map((z, index) => prior?.dataZoom?.[index] ? { ...z, start: prior.dataZoom[index].start, end: prior.dataZoom[index].end } : z)
  chart.setOption({ animation: false, useUTC: true,
    grid: { left: 12, right: 12, top: 62, bottom: 58, containLabel: true },
    legend: { type: 'scroll', top: 0, selected: prior?.legend?.[0]?.selected || {}, textStyle: { color: '#667579', fontSize: 11 } },
    xAxis: { type: 'time', axisLabel, axisLine: { lineStyle: { color: '#d8e0e0' } }, splitLine: { show: false } },
    yAxis: chosen.value.map((item, index) => ({ type: 'value', position: index ? 'right' : 'left',
      name: `${index ? '右轴' : '左轴'} · ${item?.metadata.unit || '单位未提供'}`, nameTextStyle: { color: palette[index], align: index ? 'right' : 'left', fontSize: 11 },
      axisLabel, axisLine: { show: true, lineStyle: { color: palette[index] } }, splitLine: { show: index === 0, lineStyle: { color: '#edf1f0' } } })),
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter(params) {
      return params.map(p => {
        const item = chosen.value[p.seriesIndex], point = histories.value[p.seriesIndex][p.dataIndex]
        return tooltipRow(item, point, p.color) + `<div>频率：${escapeHtml(item.metadata.frequency)}；发布日期：${escapeHtml(point?.release_date || '未提供')}</div>`
      }).join('')
    } }, dataZoom: zoom,
    series: chosen.value.map((item, index) => ({ name: seriesName(index), type: 'line', yAxisIndex: index,
      showSymbol: true, symbolSize: 3, connectNulls: false, smooth: false, lineStyle: { width: 2 }, itemStyle: { color: palette[index] },
      data: histories.value[index].map(p => [dateNumber(p.observation_date), numeric(p) ? p.value : null]),
    })),
  }, true)
  signature = nextSignature
  updateAxes()
}
function resize() { if (activePage.value === 'cross') { if (chart) chart.resize(); else draw() } }
watch([selected, range, () => props.items, loading, activePage], draw)
onMounted(() => { observer = new ResizeObserver(resize); observer.observe(el.value); window.addEventListener('dashboard-page-visible', resize); draw() })
onBeforeUnmount(() => { clearTimeout(timer); observer?.disconnect(); window.removeEventListener('dashboard-page-visible', resize); chart?.dispose() })
</script>

<template>
  <section class="section cross-display" aria-labelledby="cross-title">
    <header class="section-heading"><div><h2 id="cross-title">交叉展示</h2></div><span>两个因子 · 双轴对照</span></header>
    <div class="cross-picker">
      <div class="cross-tools"><strong>选择指标 · {{ selected.length }}/2</strong><input v-model="search" type="search" aria-label="搜索交叉展示指标" placeholder="搜索指标"><button class="text-button" @click="selected = []">清空选择</button></div>
      <p class="cross-help">仅提供每日速递“每日指标”中的数值因子。先选左轴，再选右轴；选满后取消一项即可更换。取消后，剩余指标顺次成为左轴。</p>
      <div class="cross-groups"><details v-for="group in groups" :key="group.id" open><summary>{{ group.title }} <small>{{ group.items.length }}</small></summary><div class="cross-options">
        <label v-for="item in group.items" :key="item.metadata.indicator_id" :class="{ checked: selected.includes(item.metadata.indicator_id) }">
          <input type="checkbox" :value="item.metadata.indicator_id" :checked="selected.includes(item.metadata.indicator_id)" :disabled="!selected.includes(item.metadata.indicator_id) && selected.length === 2" @change="toggle(item.metadata.indicator_id)">
          <span>{{ label(item) }}<small>{{ item.metadata.frequency }} · {{ item.metadata.unit || '单位未提供' }}{{ item.metadata.publication_withheld ? ' · 静态版未公开' : '' }}</small></span><b v-if="selected.includes(item.metadata.indicator_id)">{{ selected.indexOf(item.metadata.indicator_id) ? '右轴' : '左轴' }}</b>
        </label><p v-if="!group.items.length" class="cross-help">暂无匹配指标</p>
      </div></details></div>
    </div>
    <div class="cross-selected"><div v-for="index in [0, 1]" :key="index" :style="{ borderColor: palette[index] }"><strong>{{ index ? '右轴' : '左轴' }}</strong><span>{{ selected[index] ? label(chosen[index]) : '待选择' }}</span><small v-if="chosen[index]">{{ chosen[index].metadata.unit }} · {{ chosen[index].metadata.frequency }}</small></div><button class="text-button" :disabled="selected.length !== 2" @click="selected = [...selected].reverse()">交换左右轴</button></div>
    <p v-if="errors.length" class="alert error">部分数据读取失败，相关指标可能不完整，请使用顶部刷新按钮重试。</p>
    <article class="chart-panel">
      <header class="panel-header"><div><h3>双因子交叉折线图</h3><p>横轴取两项指标均有有效数值的观察日期交集；共同日期之间连线，不补值、不插值，不将月频或周频扩展为日频。</p></div></header>
      <div class="chart-toolbar"><span>同一日期不代表同一报价时点；海外现货与汇率为北京时间15:30，海外期货为15:00。</span><div class="cross-controls"><button class="text-button" @click="chart?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })">重置缩放</button><select v-model="range" aria-label="交叉展示时间区间"><option v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</option></select></div></div>
      <div class="chart-stage cross-stage"><div ref="el" class="echart" data-chart-title="双因子交叉折线图" /><div v-if="empty" class="empty-state"><span class="empty-symbol">—</span><strong>{{ empty }}</strong></div></div>
      <p class="cross-help">{{ axisInfo }} 时间区间以最新共同有效观察日期为终点；当前 {{ commonDates.length }} 个共同观察日{{ commonDates.length ? ' · ' + commonDates[0] + ' — ' + commonDates.at(-1) : '' }}。</p>
      <p v-for="item in chosen.filter(item => item?.crossNote)" :key="item.metadata.indicator_id" class="cross-help">{{ label(item) }}：{{ item.crossNote }}</p>
      <div v-for="(item, index) in chosen" :key="selected[index]" class="chart-source">{{ index ? '右轴' : '左轴' }}：{{ label(item) }} · 来源：{{ sources(item) }} · 观察范围：{{ item?.metadata.coverage_start || '未提供' }} — {{ item?.metadata.coverage_end || '未提供' }}<span v-if="!histories[index]?.some(numeric)"> · 当前区间数据暂缺</span><span v-if="item?.metadata.publication_withheld"> · 来源公开使用尚未确认</span></div>
    </article>
  </section>
</template>

<style scoped>
.cross-picker{background:#fff;border:1px solid #e5eae6;border-radius:5px;padding:16px;margin-bottom:14px}.cross-tools{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.cross-tools strong{font-size:12px;color:#536970}.cross-tools input{margin-left:auto;width:220px}.cross-help{font-size:10px;color:#8c9a9a;line-height:1.8}.cross-groups{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.cross-groups details{min-width:0;border:1px solid #e5eae6;border-radius:4px}.cross-groups summary{padding:10px;color:#786b43;cursor:pointer;font-size:11px}.cross-groups summary small{color:#96a09e;margin-left:5px}.cross-options{max-height:185px;overflow:auto;padding:0 8px 8px}.cross-options label{display:flex;align-items:flex-start;gap:6px;padding:7px 3px;font-size:10px;line-height:1.6;color:#61777c}.cross-options input{margin:3px 0 0;accent-color:#718b86;flex-shrink:0}.cross-options label span{min-width:0;overflow-wrap:anywhere}.cross-options small{display:block;color:#96a09e;font-size:9px}.cross-options b{font-size:9px;color:#887543;white-space:nowrap;margin-left:auto}.cross-options .checked{background:#f6f4ed;border-radius:3px}.cross-options label:has(input:disabled){opacity:.5}.cross-selected{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.cross-selected>div{flex:1;min-width:200px;display:flex;gap:9px;align-items:center;flex-wrap:wrap;background:#fff;border-left:3px solid;padding:12px;font-size:11px}.cross-selected strong{color:#536970}.cross-selected small{color:#96a09e}.cross-controls{display:flex;align-items:center;gap:12px}.cross-stage{height:430px}@media(max-width:1050px){.cross-groups{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.cross-tools{gap:10px}.cross-tools input{margin:0;width:100%}.cross-groups{grid-template-columns:1fr}.cross-options{max-height:140px}.cross-stage{height:340px}}
</style>
