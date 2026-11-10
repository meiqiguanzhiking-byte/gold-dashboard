<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'

const props = defineProps({ analysis: { type: Object, required: true }, points: { type: Array, required: true } })
const activePage = inject('dashboardActivePage')
const distributionEl = ref(null), acfEl = ref(null), highEl = ref(null), lowEl = ref(null)
const quantileEl = ref(null)
const charts = new Map()
let observer
const percent = (v, digits = 2) => v == null ? '—' : (v * 100).toFixed(digits) + '%'
const number = (v, digits = 3) => v == null ? '—' : v.toFixed(digits)
const pvalue = v => v == null ? '—' : v < .0001 ? '<0.0001' : v.toFixed(4)
const percentagePoints = v => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(2)
const d = computed(() => props.analysis.distribution)
const distributionRows = computed(() => [
  ['均值', d.value.mean, '约1.2%'], ['中位数', d.value.median, '约−2.3%'],
  ['P10', d.value.quantiles['10'], '约−16.5%'], ['P90', d.value.quantiles['90'], '约23.0%'],
  ['最低值', d.value.min, '约−26.6%'], ['最高值', d.value.max, '约58.1%'],
])
function optionFor(el, option) {
  if (!el) return
  if (!charts.has(el)) { charts.set(el, echarts.init(el)); observer.observe(el) }
  const chart = charts.get(el)
  chart.setOption(option); chart.resize()
}
function draw() {
  if (activePage.value !== 'research' || !distributionEl.value) return
  observer ||= new ResizeObserver(() => { for (const chart of charts.values()) chart.resize() })
  const a = props.analysis
  const base = {
    animation: false, color: ['#287985', '#b28d54', '#729d98', '#c27e65'],
    grid: { left: 58, right: 18, top: 42, bottom: 48 },
    tooltip: { ...tooltipStyle, trigger: 'axis' },
    xAxis: { type: 'category', axisLabel },
    yAxis: { type: 'value', axisLabel, splitLine: { lineStyle: { color: '#edf1f0' } } },
  }
  optionFor(distributionEl.value, { ...base,
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter: params => {
      const b = a.distribution.bins[params[0].dataIndex]
      return `${percent(b.lower)} 至 ${percent(b.upper)}<br/>月份数：${b.count}`
    } },
    xAxis: { ...base.xAxis, data: a.distribution.bins.map(b => percent((b.lower + b.upper) / 2, 1)), axisLabel: { ...axisLabel, rotate: 35 } },
    series: [{ name: '月份数', type: 'bar', barCategoryGap: '5%', data: a.distribution.bins.map(b => b.count) }],
  })
  optionFor(acfEl.value, { ...base,
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter: params => {
      const p = a.autocorrelation[params[0].dataIndex]
      return `滞后${p.lag}个月<br/>相关系数：${number(p.value)}<br/>有效配对：${p.count}组`
    } },
    xAxis: { ...base.xAxis, data: a.autocorrelation.map(p => p.lag + '月') },
    yAxis: { ...base.yAxis, min: 0, max: 1, interval: .2 },
    series: [{ name: '偏离率自相关', type: 'bar', barMaxWidth: 24, data: a.autocorrelation.map(p => p.value) }],
  })
  for (const [side, el] of [['high', highEl.value], ['low', lowEl.value]]) {
    const groups = a.groups.filter(g => g.side === side)
    optionFor(el, { ...base,
      legend: { top: 0, textStyle: { color: '#728486', fontSize: 11 } },
      xAxis: { ...base.xAxis, boundaryGap: false, data: groups[0].path.map(p => p.horizon + '月') },
      yAxis: { ...base.yAxis, name: '偏离变化（百分点）', nameTextStyle: { color: '#829294', fontSize: 10 } },
      grid: { ...base.grid, top: 65 },
      tooltip: { ...tooltipStyle, trigger: 'axis', formatter: params => {
        const h = params[0].dataIndex
        return `未来${h}个月` + groups.map((g, i) => {
          const p = g.path[h]
          return `<br/>${params[i]?.marker || ''}${g.name}：${percentagePoints(p.mean)}个百分点<br/>中位数：${percentagePoints(p.median)}；n=${p.count}`
        }).join('')
      } },
      series: groups.map(g => ({ name: g.name, type: 'line', showSymbol: false, connectNulls: false,
        data: g.path.map(p => p.mean == null ? null : p.mean * 100), lineStyle: { width: 2 },
      })),
    })
  }
  const points = props.points.slice(0, props.points.findLastIndex(p => p.deviation != null) + 1)
  const levels = [[30, 70, '#6485c5'], [20, 80, '#dd9856'], [10, 90, '#5eaa77'], [5, 95, '#c46463']]
  optionFor(quantileEl.value, { ...base,
    color: ['#b44836', ...levels.map(level => level[2])],
    grid: { left: 58, right: 110, top: 25, bottom: 90 },
    legend: { bottom: 36, data: levels.map(([low, high]) => `P${low}/P${high}`), textStyle: { color: '#728486', fontSize: 11 } },
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: v => v == null ? '—' : number(v, 2) + '%' },
    xAxis: { ...base.xAxis, boundaryGap: false, data: points.map(p => p.month) },
    yAxis: { ...base.yAxis, axisLabel: { ...axisLabel, formatter: '{value}%' } },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 4 }],
    series: [
      { name: '价格偏离率', type: 'line', showSymbol: false, connectNulls: false,
        data: points.map(p => p.deviation == null ? null : p.deviation * 100),
        lineStyle: { width: 2 }, areaStyle: { opacity: .06 },
      },
      ...levels.map(([low, high, color]) => ({
        name: `P${low}/P${high}`, type: 'line', data: [], showSymbol: false,
        itemStyle: { color }, lineStyle: { color, type: 'dashed' },
        markLine: { silent: true, symbol: 'none', lineStyle: { color, width: 1 },
          label: { show: true, position: 'end', color, fontSize: 10, formatter: p => `${p.name}  ${number(p.value, 1)}%` },
          data: [low, high].map(q => ({ name: `P${q}`, yAxis: a.distribution.quantiles[String(q)] * 100,
            lineStyle: { type: q < 50 ? 'dotted' : 'dashed' },
          })),
        },
      })),
    ],
  })
}
watch([activePage, () => props.analysis, () => props.points], async () => { await nextTick(); draw() }, { immediate: true })
onBeforeUnmount(() => { observer?.disconnect(); for (const chart of charts.values()) chart.dispose(); charts.clear() })
</script>

<template>
  <div class="residual-analysis">
    <h4 class="residual-heading">偏离率分析：分布、持续性与修复</h4>
    <p class="residual-note">沿用上述{{ d.count }}个月的样本内偏离率 dₜ＝Pₜ / 理论价ₜ − 1；分位阈值由本次全样本计算。</p>
    <div class="residual-charts">
      <article><h5>偏离率历史分布</h5><p>20个等宽区间，纵轴为月份数；横轴标注区间中点。</p><div ref="distributionEl" class="residual-chart" data-chart-title="宏观偏离率历史分布" /></article>
      <article><h5>偏离率自相关</h5><p>按自然月匹配，计算dₜ与dₜ₊ₖ的Pearson相关，滞后1—24个月。</p><div ref="acfEl" class="residual-chart" data-chart-title="宏观偏离率自相关" /></article>
    </div>
    <div class="residual-table-wrap"><table><thead><tr><th>分布统计</th><th>本次结果</th><th>研报参考</th></tr></thead>
      <tbody><tr v-for="row in distributionRows" :key="row[0]"><td>{{ row[0] }}</td><td>{{ percent(row[1]) }}</td><td>{{ row[2] }}</td></tr></tbody>
    </table></div>
    <p class="residual-note">标准差 {{ percent(d.std) }}；描述性偏度 {{ number(d.skewness) }}（正值表示右偏）。原文分布统计起点表述为2004年，本次统一沿用模型完整样本，不调整窗口来匹配原文。</p>
    <h5>当前位置对未来偏离变化的解释</h5>
    <div class="residual-formula">dₜ₊ₕ − dₜ＝aₕ ＋ bₕ × dₜ ＋ uₜ₊ₕ</div>
    <p class="residual-note">bₕ为负表示较高的当前偏离对应较低的未来偏离变化；目标是偏离变化，不是黄金收益。</p>
    <div class="residual-table-wrap"><table><thead><tr><th>未来期限</th><th>配对数</th><th>截距a</th><th>系数b</th><th>研报b</th><th>HAC标准误(b)</th><th>HAC p值(b)</th><th>R²</th><th>HAC滞后</th></tr></thead>
      <tbody><tr v-for="r in analysis.regressions" :key="r.horizon"><td>{{ r.horizon }}个月</td><td>{{ r.stats?.count ?? '—' }}</td><td>{{ number(r.stats?.alpha, 5) }}</td><td>{{ number(r.stats?.beta) }}</td><td>{{ number(r.report_beta) }}</td><td>{{ number(r.stats?.hac_se, 4) }}</td><td>{{ pvalue(r.stats?.hac_p) }}</td><td>{{ percent(r.stats?.r2) }}</td><td>{{ r.stats?.hac_lags ?? '—' }}个月</td></tr></tbody>
    </table></div>
    <p class="residual-note">d以小数计，截距乘100为百分点。HAC采用Bartlett核和n/(n−2)修正，双侧渐近正态检验；滞后取max(4, h−1)，覆盖多期目标的重叠，这是本次设定。终点缺失的样本不参与对应期限回归，不用后续月份替代。</p>
    <div class="residual-charts">
      <article><h5>高偏离后的平均修复路径</h5><p>当前偏离≥P70/P80/P90/P95；负变化表示偏离收窄。</p><div ref="highEl" class="residual-chart" data-chart-title="宏观高偏离修复路径" /></article>
      <article><h5>低偏离后的平均修复路径</h5><p>当前偏离≤P30/P20/P10/P5；正变化表示偏离向上修复。</p><div ref="lowEl" class="residual-chart" data-chart-title="宏观低偏离修复路径" /></article>
    </div>
    <div class="residual-table-wrap"><table><thead><tr><th>分位条件</th><th>偏离率阈值</th><th>条件月份数</th><th v-for="h in analysis.horizons" :key="h">{{ h }}个月变化（百分点 / n）</th></tr></thead>
      <tbody><tr v-for="g in analysis.groups" :key="g.side + g.quantile"><td>{{ g.name }}</td><td>{{ percent(g.threshold) }}</td><td>{{ g.count }}</td><td v-for="h in analysis.horizons" :key="h">{{ percentagePoints(g.path[h].mean) }} / {{ g.path[h].count }}</td></tr></tbody>
    </table></div>
    <p class="residual-note">路径为平均偏离变化，悬浮查看中位数与样本数；各期限样本不同，连续月份可能重叠。</p>
    <article class="quantile-panel">
      <h5>图19：价格偏离率及历史分位</h5>
      <p class="residual-note">参考线为全样本历史分位；点击图例可切换各组分位线。</p>
      <div ref="quantileEl" class="residual-chart quantile-chart" data-chart-title="价格偏离率及历史分位" />
    </article>
  </div>
</template>

<style scoped>
.quantile-panel{margin-top:24px}.residual-chart.quantile-chart{height:380px}
.residual-analysis{border-top:1px solid #e1e7e4;margin-top:24px;padding-top:22px;color:#425b5f;font-size:12px}.residual-heading{font-size:15px;margin:0 0 10px;font-weight:600}h5{font-size:13px;margin:20px 0 8px;font-weight:600}.residual-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:4px 0 12px}.residual-charts article{min-width:0}.residual-charts p,.residual-note{font-size:11px;color:#829294;line-height:1.8}.residual-charts p{margin:0 0 12px}.residual-chart{height:300px;width:100%;min-width:0}.residual-formula{background:#f7f5ef;border-left:3px solid #aa965e;padding:12px 16px;line-height:1.8}.residual-table-wrap{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;white-space:nowrap;font-size:11px}th,td{text-align:right;padding:10px 12px;border-bottom:1px solid #e7eeeb}th{font-weight:500;background:#f5f8f7;color:#6c8183}th:first-child,td:first-child{text-align:left}@media(max-width:850px){.residual-charts{grid-template-columns:1fr}}
</style>
