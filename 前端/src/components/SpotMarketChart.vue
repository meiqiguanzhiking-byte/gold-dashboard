<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { useChartVisibility } from '../chart-visibility.js'
import { adaptiveYAxis } from '../adaptive-axis.js'
import { escapeHtml, format } from '../data.js'
import { isStatic, request } from '@live-source'
const emit = defineEmits(['loaded'])

const indicators = [
  { id: 'spread', name: '境内外现价价差', unit: '元/克', color: '#8c6ca0', digits: 2 },
  { id: 'gold', name: '黄金现价', unit: '元/克', color: '#287985', digits: 2 },
  { id: 'london', name: '伦敦金现', unit: '美元/金衡盎司', color: '#ad945b', digits: 2 },
  { id: 'fx', name: '美元兑在岸人民币', unit: 'CNY/美元', color: '#6d83ab', digits: 4 },
]
const selected = ref(indicators.map(item => item.id))
const data = ref(null), loading = ref(false), error = ref(''), element = ref(null)
const startDate = ref(''), endDate = ref('')
const dateError = computed(() => startDate.value && endDate.value && startDate.value > endDate.value ? '开始日期不能晚于结束日期。' : '')
const filteredPoints = computed(() => dateError.value ? [] : (data.value?.points || []).filter(point =>
  (!startDate.value || point[0] >= startDate.value) && (!endDate.value || point[0] <= endDate.value)))
const visible = computed(() => indicators.filter(item => selected.value.includes(item.id)))
const minWidth = computed(() => visible.value.length > 2 ? 720 : 440)
const visibility = useChartVisibility(element, draw, () => chart?.resize())
let chart, axes, zoom = { start: 0, end: 100 }
const controller = new AbortController()

function showAllHistory() {
  startDate.value = data.value?.start || ''
  endDate.value = data.value?.end || ''
  zoom = { start: 0, end: 100 }
  visibility.requestDraw()
}

async function load() {
  if (isStatic) { error.value = '此图使用本地研究数据，展示版暂未接入。'; return }
  loading.value = true
  error.value = ''
  try {
    const initial = !data.value
    data.value = await request('spot-research/market', { signal: controller.signal })
    emit('loaded', data.value)
    if (initial) showAllHistory()
  }
  catch (e) { if (!controller.signal.aborted) error.value = e.message }
  finally { loading.value = false }
}

function draw() {
  if (!visibility.canDraw()) return
  if (!chart) {
    chart = echarts.init(element.value)
    axes = adaptiveYAxis(chart)
    chart.on('datazoom', () => {
      const value = chart.getOption().dataZoom?.[0]
      if (value) zoom = { start: value.start, end: value.end }
    })
  }
  const items = visible.value, points = filteredPoints.value, dates = points.map(row => row[0])
  chart.resize()
  if (!items.length || !points.length) { axes.reset(null); chart.clear(); return }
  const series = items.map((item, i) => ({ id: item.id, name: item.name, type: 'line', xAxisIndex: 0, yAxisIndex: i,
    data: points.map(point => point[indicators.findIndex(indicator => indicator.id === item.id) + 1]),
    connectNulls: false, smooth: false, showSymbol: false, latestValueLabel: false,
    lineStyle: { color: item.color, width: 1.6 }, itemStyle: { color: item.color },
    ...(item.id === 'spread' ? { markLine: { silent: true, symbol: 'none', label: { show: false },
      lineStyle: { color: '#b4bcbc', type: 'dashed' }, data: [{ yAxis: 0 }] } } : {}),
  }))
  chart.setOption({
    animation: false,
    textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    grid: { left: items.length > 2 ? 168 : 88, right: items.length > 3 ? 168 : items.length > 1 ? 88 : 28, top: 28, bottom: 80 },
    tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'line', snap: true }, formatter(params) {
      const point = points[params[0]?.dataIndex]
      if (!point) return ''
      return `<strong>${escapeHtml(point[0])}</strong>` + items.map(item => {
        const value = point[indicators.findIndex(indicator => indicator.id === item.id) + 1]
        return `<div>${escapeHtml(item.name)}：${value == null ? '缺失' : escapeHtml(format(value, item.digits)) + ' ' + escapeHtml(item.unit)}</div>`
      }).join('')
    } },
    xAxis: { type: 'category', data: dates, boundaryGap: false,
      axisTick: { show: false }, axisLabel,
      axisLine: { lineStyle: { color: '#d8e0e0' } } },
    yAxis: items.map((item, i) => ({ type: 'value', gridIndex: 0, scale: true,
      position: i % 2 ? 'right' : 'left', offset: Math.floor(i / 2) * 80,
      name: `${item.name}（${item.unit}）`, nameLocation: 'middle', nameGap: 54, nameRotate: i % 2 ? -90 : 90,
      nameTextStyle: { color: item.color, fontSize: 11 }, axisLabel: { ...axisLabel, color: item.color },
      axisLine: { show: true, lineStyle: { color: item.color, opacity: .65 } },
      splitLine: { show: i === 0, lineStyle: { color: '#edf1f0' } } })),
    dataZoom: [{ type: 'slider', xAxisIndex: 0, ...zoom, bottom: 12, height: 20,
      filterMode: 'none', brushSelect: false, showDetail: false, borderColor: '#dce4e1' }],
    series,
  }, true)
  axes.reset({ dates, series, axisCount: items.length })
}

watch([startDate, endDate], () => { zoom = { start: 0, end: 100 } }, { flush: 'sync' })
watch([visible, filteredPoints, loading, error], visibility.requestDraw, { flush: 'post' })
onMounted(load)
onBeforeUnmount(() => { controller.abort(); axes?.dispose(); chart?.dispose() })
</script>

<template>
  <article class="spot-market" :aria-busy="loading">
    <header><h3>行情走势</h3><span v-if="data?.points.length">{{ data.start }} — {{ data.end }} · {{ data.points.length.toLocaleString() }} 个观察日</span></header>
    <fieldset><legend>展示指标</legend>
      <label v-for="item in indicators" :key="item.id" :style="{ '--series-color': item.color }">
        <input v-model="selected" type="checkbox" :value="item.id" /><i aria-hidden="true" />{{ item.name }}
      </label>
    </fieldset>
    <div class="date-filter" role="group" aria-label="行情走势日期筛选">
      <label>开始日期<input v-model="startDate" type="date" :min="data?.start" :max="data?.end" :disabled="!data" :aria-invalid="!!dateError" /></label>
      <span aria-hidden="true">至</span>
      <label>结束日期<input v-model="endDate" type="date" :min="data?.start" :max="data?.end" :disabled="!data" :aria-invalid="!!dateError" /></label>
      <button :disabled="!data" @click="showAllHistory">全部历史</button>
    </div>
    <p v-if="dateError" class="date-error" role="alert">{{ dateError }}</p>
    <p v-else-if="data" class="date-summary" aria-live="polite">所选窗口（含起止日）：{{ startDate || '不限' }} — {{ endDate || '不限' }} · {{ filteredPoints.length.toLocaleString() }} 个观察日<span v-if="filteredPoints.length">，实际观察日期 {{ filteredPoints[0][0] }} — {{ filteredPoints.at(-1)[0] }}</span></p>
    <p class="axis-note">四项指标叠加在同一绘图区，按曲线颜色读取左右纵轴；各轴独立缩放，保留原始单位。拖动底部滑块缩放时间，窄屏可左右滑动图表。</p>
    <div class="spot-market-scroll">
    <div class="spot-market-stage" :style="{ minWidth: minWidth + 'px' }">
      <div ref="element" class="spot-market-canvas" data-chart-title="行情走势" role="img" :aria-label="'行情走势叠加折线图：' + visible.map(item => item.name).join('、')" />
      <div v-if="loading || error || dateError || !visible.length || !filteredPoints.length" class="spot-market-status" role="status">
        <span v-if="loading">正在读取行情数据…</span>
        <span v-else-if="error">{{ error }} <button v-if="!isStatic" @click="load">重试</button></span>
        <span v-else-if="dateError">请调整起止日期。</span>
        <span v-else-if="!visible.length">请勾选需要展示的指标。</span>
        <span v-else>所选时间窗口内没有观察数据，请调整日期。</span>
      </div>
    </div>
    </div>
    <p v-if="data" class="source-note">来源：{{ data.source }}。按文件观察日展示，缺失保留断点，不补零、不前值填充。
      <span v-for="column in data.columns.filter(item => item.missing)" :key="column.id">{{ column.name }}缺失 {{ column.missing }} 个观察日。 </span>
    </p>
  </article>
</template>

<style scoped>
.spot-market{border:1px solid #dce4e1;border-radius:6px;background:#fff;padding:20px 22px 14px;min-width:0}
header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}h3{font-size:17px;font-weight:600;color:#263c40;margin:0;border-left:3px solid #b29a61;padding-left:10px}header span{font-size:11px;color:#728486}
fieldset{border:0;padding:0;margin:20px 0 12px;display:flex;flex-wrap:wrap;gap:12px 22px}legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}label{display:flex;align-items:center;gap:7px;font-size:12px;color:#344e54;cursor:pointer}input{accent-color:var(--series-color);margin:0;width:14px;height:14px}i{display:inline-block;width:18px;height:2px;background:var(--series-color)}
.date-filter{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:18px 0 8px;color:#728486;font-size:12px}.date-filter label{flex-wrap:wrap}.date-filter input{width:145px;height:32px;border:1px solid #dce4e1;border-radius:4px;padding:5px 8px;background:#fff;color:#344e54;font:inherit}.date-filter button{border:1px solid #aa965e;background:#f5f3eb;color:#786b43;border-radius:4px;padding:7px 12px;font-size:12px}.date-summary,.date-error{font-size:11px;line-height:1.8;margin:8px 0}.date-summary{color:#728486}.date-error{color:#ac5147}
.axis-note,.source-note{font-size:11px;line-height:1.8;color:#728486;margin:8px 0}.spot-market-scroll{overflow-x:auto}.spot-market-stage{position:relative}.spot-market-canvas{height:460px;width:100%}.spot-market-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#ffffffed;color:#728486;font-size:13px;padding:20px;text-align:center}.spot-market-status button{font:inherit;border:1px solid #dce4e1;border-radius:4px;padding:4px 10px;background:#fff;color:#287985;cursor:pointer}input:focus-visible,button:focus-visible{outline:2px solid #287985;outline-offset:3px}
@media(max-width:600px){.spot-market{padding:16px 8px 12px}header,fieldset,.axis-note,.source-note{margin-left:8px;margin-right:8px}fieldset{gap:12px 16px}}
</style>
