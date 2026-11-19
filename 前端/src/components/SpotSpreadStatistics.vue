<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { useChartVisibility } from '../chart-visibility.js'
import { escapeHtml } from '../data.js'
import { buildSpreadStatistics } from '../spot-spread-statistics.js'

const props = defineProps({ data: Object })
const model = computed(() => buildSpreadStatistics(props.data?.points || []))
const element = ref(null)
let chart
const visibility = useChartVisibility(element, draw, () => chart?.resize())
const num = (value, digits = 2, signed = false) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const extremum = point => point ? `${num(point[1], 2, true)} 元/克，${point[0]}` : '—'
const summaryRows = computed(() => {
  const s = model.value.summary
  return [
    ['平均价差', s.n ? `${num(s.mean, 2, true)} 元/克` : '—'],
    ['中位数', s.n ? `${num(s.median, 2, true)} 元/克` : '—'],
    ['价差标准差', s.std == null ? '—' : `${num(s.std)} 元/克`],
    ['正价差占比', s.n ? `${num(s.positive)}%` : '—'],
    ['中间 90% 观测范围', s.n ? `${num(s.low, 2, true)} 至 ${num(s.high, 2, true)} 元/克` : '—'],
    ['最低价差', extremum(s.min)], ['最高价差', extremum(s.max)],
  ]
})
function draw() {
  if (!visibility.canDraw()) return
  if (!chart) chart = echarts.init(element.value)
  const points = props.data?.points || [], dates = points.map(point => point[0]), m = model.value
  if (!points.length) { chart.clear(); return }
  const previousZoom = chart.getOption()?.dataZoom?.[0]
  chart.setOption({ animation: false, textStyle: { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
    grid: { left: 72, right: 30, top: 56, bottom: 95 },
    legend: { bottom: 45, data: ['日度观测', '60 个观察日滚动均值'], textStyle: { color: '#667579', fontSize: 11 } },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter(params) {
      const i = params[0]?.dataIndex
      if (i == null) return ''
      return `<strong>${escapeHtml(dates[i])}</strong><div>日度价差：${num(points[i][1], 2, true)} 元/克</div><div>60 个观察日滚动均值：${num(m.rolling[i], 2, true)} 元/克</div>`
    } },
    xAxis: { type: 'category', data: dates, boundaryGap: false, axisLabel, axisTick: { show: false }, axisLine: { lineStyle: { color: '#cdd5dc' } } },
    yAxis: { type: 'value', name: '价差（元/克）', nameTextStyle: { color: '#728486', fontSize: 11 }, scale: true, axisLabel, splitLine: { lineStyle: { color: '#fff' } } },
    dataZoom: [{ type: 'slider', xAxisIndex: 0, bottom: 8, height: 18, showDetail: false, brushSelect: false,
      start: previousZoom?.start ?? 0, end: previousZoom?.end ?? 100, filterMode: 'none', borderColor: '#dce4e1' }],
    series: [
      { name: '日度观测', type: 'line', data: points.map(point => point[1]), showSymbol: false, smooth: false, connectNulls: false, latestValueLabel: false,
        lineStyle: { color: '#a7afb9', width: 1 }, itemStyle: { color: '#a7afb9' }, z: 2,
        markArea: { silent: true, label: { position: 'insideTop', color: '#536474', fontSize: 11 }, data: m.phases.filter(p => p.observedStart).map(p => [
          { name: p.label, xAxis: p.observedStart, itemStyle: { color: p.color } }, { xAxis: p.observedEnd }]) },
        markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#687480', width: 1, type: 'solid' }, data: [{ yAxis: 0 }] },
        markPoint: { symbol: 'circle', symbolSize: 7, data: [m.summary.min, m.summary.max].filter(Boolean).map((p, i) => ({
          coord: [p[0], p[1]], value: p[1], itemStyle: { color: i ? '#b34f49' : '#397b61' },
          label: { show: true, position: i ? 'top' : 'bottom', color: i ? '#b34f49' : '#397b61', fontSize: 11,
            formatter: `${p[0]}  ${num(p[1], 2, true)}`, backgroundColor: '#ffffffd9', padding: [3, 5] } })) } },
      { name: '60 个观察日滚动均值', type: 'line', data: m.rolling, showSymbol: false, smooth: false, connectNulls: false,
        latestValueLabel: false, lineStyle: { color: '#294969', width: 2.5 }, itemStyle: { color: '#294969' }, z: 3 },
    ],
  }, true)
  chart.resize()
}
watch(model, visibility.requestDraw)
onBeforeUnmount(() => chart?.dispose())
</script>

<template>
  <article class="spread-statistics">
    <header><h3>价差描述性统计</h3><span v-if="data">{{ data.start }} — {{ data.end }} · 有效 {{ model.summary.n.toLocaleString() }} 个观察日 · 缺失 {{ model.summary.missing }} 个</span></header>
    <p class="stats-note">全历史样本，独立于上方行情走势日期筛选。背景阶段沿用参考图的人工划分。</p>
    <div class="spread-chart-scroll"><div ref="element" class="spread-stage-chart" data-chart-title="价差阶段性划分" role="img" aria-label="价差阶段性划分：日度价差、60个观察日滚动均值、六个阶段背景及全样本极值" /></div>
    <p v-if="!data" class="stats-note" role="status">等待行情数据；请先确认上方行情数据已成功读取。</p>
    <div class="stats-tables">
      <section class="summary-table"><h4>全样本指标</h4>
        <table><caption class="sr-only">价差全样本描述性统计</caption><tbody><tr v-for="[label, value] in summaryRows" :key="label"><th scope="row">{{ label }}</th><td>{{ value }}</td></tr></tbody></table>
      </section>
      <section class="phase-table"><h4>分阶段指标</h4><div class="phase-table-scroll">
        <table><caption class="sr-only">价差分阶段描述性统计</caption><thead><tr><th scope="col">阶段</th><th scope="col">数据表现</th><th scope="col">平均价差（元/克）</th><th scope="col">标准差（元/克）</th><th scope="col">正价差占比</th><th scope="col">平均相对溢价</th></tr></thead>
          <tbody><tr v-for="phase in model.phases" :key="phase.start"><th scope="row">{{ phase.start.slice(0, 7) }}—{{ phase.end ? phase.end.slice(0, 7) : (data?.end || '至今') }}<small>有效 {{ phase.n }} · 缺失 {{ phase.missing }}</small></th><td>{{ phase.description }}</td><td>{{ num(phase.mean, 2, true) }}</td><td>{{ num(phase.std) }}</td><td>{{ num(phase.positive, 1) }}<template v-if="phase.n">%</template></td><td :title="'相对溢价有效样本：' + phase.relativeN">{{ num(phase.relative, 3, true) }}<template v-if="phase.relative != null">%</template></td></tr></tbody>
        </table></div>
      </section>
    </div>
    <details class="stats-method"><summary>统计口径与数据来源</summary><p>来源：{{ data?.source || '境内外现价价差_全历史.csv' }}。价差大于 0 计为正价差，占比分母为有效价差样本；缺失不补零、不前填。标准差使用样本标准差（n−1），中间 90% 为第 5 与第 95 百分位数（线性插值）。极值相同时显示最早日期。</p><p>相对溢价＝价差 ÷（黄金现价−价差）×100%，分母为海外金价折合人民币价格；仅纳入价差和黄金现价有效且分母大于 0 的日期，再计算每日相对溢价的算术平均。60 个观察日滚动均值仅在窗口内 60 项价差全部有效时显示，最初 59 项及缺失窗口留空。</p><p>阶段边界按参考图固定，不代表模型识别或对未来的判断；阶段名称为参考描述，数值随当前文件重算。末阶段截止到文件最新观察日。</p></details>
  </article>
</template>

<style scoped>
.spread-statistics{margin-top:24px;background:#fff;border:1px solid #dce4e1;border-radius:6px;padding:20px 22px;color:#344e54;min-width:0}.spread-statistics>header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}.spread-statistics h3{font-size:17px;font-weight:600;color:#263c40;margin:0;border-left:3px solid #b29a61;padding-left:10px}.spread-statistics header span,.stats-note,.stats-method{font-size:11px;color:#728486;line-height:1.8}.stats-note{margin:12px 0}.spread-chart-scroll{overflow-x:auto}.spread-stage-chart{height:420px;min-width:900px;width:100%}.stats-tables{display:grid;grid-template-columns:minmax(320px,.85fr) minmax(0,1.5fr);gap:28px;margin-top:24px}.stats-tables section{min-width:0}.stats-tables h4{font-size:14px;margin:0 0 10px;color:#263c40;font-weight:600}.stats-tables table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.7}.stats-tables th,.stats-tables td{padding:14px 8px;border-bottom:1px solid #edf1f0;text-align:right;font-weight:400;font-variant-numeric:tabular-nums}.stats-tables th:first-child,.stats-tables td:nth-child(2){text-align:left}.summary-table th{width:42%;text-align:left}.summary-table td{white-space:normal;text-align:right}.phase-table table{min-width:650px}.phase-table-scroll{overflow-x:auto}.phase-table thead th{font-weight:600;color:#263c40;white-space:nowrap}.phase-table tbody th{min-width:140px}.phase-table td{white-space:nowrap}.phase-table small{display:block;font-size:10px;color:#849092}.stats-method{margin-top:20px;border-top:1px solid #edf1f0;padding-top:12px}.stats-method summary{cursor:pointer}.stats-method p{margin:8px 0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:1100px){.stats-tables{grid-template-columns:1fr;gap:24px}}@media(max-width:600px){.spread-statistics{padding:16px 12px}.stats-tables th,.stats-tables td{padding:12px 5px}}
.stats-tables section{display:grid;grid-template-rows:auto 1fr}
.summary-table table{height:100%}
.summary-table th,.summary-table td{vertical-align:middle}
.phase-table table{min-width:780px}
.phase-table th,.phase-table td{padding:16px 10px;text-align:left;vertical-align:middle;line-height:1.8}
.phase-table thead th{padding-top:12px;padding-bottom:12px}
.phase-table small{margin-top:3px}
@media(max-width:1100px){.summary-table table{height:auto}}
</style>

