<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { isStatic, request } from '@live-source'
import ResearchMacroResiduals from './ResearchMacroResiduals.vue'

const activePage = inject('dashboardActivePage')
const result = ref(null), loading = ref(false), error = ref('')
const priceEl = ref(null), deviationEl = ref(null)
let priceChart, deviationChart, observer
function updateDeviationShade() {
  if (!deviationChart) return
  const height = deviationChart.getHeight()
  const zeroY = deviationChart.convertToPixel({ yAxisIndex: 0 }, 0)
  if (!height || !Number.isFinite(zeroY)) return
  const offset = Math.max(0, Math.min(1, zeroY / height))
  deviationChart.setOption({ series: [{
    areaStyle: { origin: 0, opacity: 1, color: new echarts.graphic.LinearGradient(0, 0, 0, height, [
      { offset: 0, color: 'rgba(170, 207, 175, 0.30)' },
      { offset, color: 'rgba(170, 207, 175, 0.30)' },
      { offset, color: 'rgba(235, 211, 143, 0.30)' },
      { offset: 1, color: 'rgba(235, 211, 143, 0.30)' },
    ], true) },
  }] })
}
const number = (v, digits = 2) => v == null ? '—' : v.toFixed(digits)
const percent = (v, digits = 2) => v == null ? '—' : (v * 100).toFixed(digits) + '%'
const pvalue = v => v == null ? '—' : v < .0001 ? '<0.0001' : v.toFixed(4)
const formula = computed(() => {
  if (!result.value) return ''
  return result.value.coefficients.map((c, i) => {
    const variable = ['', 'ln(DXY)', 'ln(VIX)', 'CB', 'T'][i]
    const value = number(Math.abs(c.value), i === 3 || i === 4 ? 6 : 4)
    return (i ? c.value < 0 ? ' − ' : ' ＋ ' : c.value < 0 ? '−' : '') + value + (variable ? ' × ' + variable : '')
  }).join('')
})
async function load() {
  if (isStatic || loading.value) return
  loading.value = true; error.value = ''
  try { result.value = await request('research/macro-monthly'); await nextTick(); draw() }
  catch (e) { error.value = e.message }
  finally { loading.value = false }
}
function draw() {
  if (!result.value || activePage.value !== 'research' || !priceEl.value) return
  priceChart ||= echarts.init(priceEl.value)
  if (!deviationChart) {
    deviationChart = echarts.init(deviationEl.value)
    deviationChart.on('datazoom', updateDeviationShade)
  }
  const points = result.value.points
  const base = {
    animation: false, color: ['#287985', '#b28d54'],
    legend: { top: 0, textStyle: { color: '#728486', fontSize: 11 } },
    grid: { left: 58, right: 18, top: 40, bottom: 65 },
    xAxis: { type: 'category', data: points.map(p => p.month), axisLabel, boundaryGap: false },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
  }
  priceChart.setOption({ ...base,
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: v => number(v) },
    yAxis: { type: 'value', axisLabel, splitLine: { lineStyle: { color: '#edf1f0' } } },
    series: [['实际月均价', 'actual'], ['长期理论价', 'theory']].map(([name, key]) => ({
      name, type: 'line', showSymbol: false, connectNulls: false,
      data: points.map(p => p[key]), lineStyle: { width: 2 },
    })),
  })
  deviationChart.setOption({ ...base,
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: v => v == null ? '—' : number(v) + '%' },
    yAxis: { type: 'value', axisLabel: { ...axisLabel, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#edf1f0' } } },
    series: [{ name: '价格偏离率', type: 'line', showSymbol: false, connectNulls: false,
      data: points.map(p => p.deviation == null ? null : p.deviation * 100), lineStyle: { width: 2 },
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#aa965e', type: 'dashed' }, data: [{ yAxis: 0 }] },
    }],
  })
  priceChart.resize(); deviationChart.resize()
  updateDeviationShade()
  if (!observer) {
    observer = new ResizeObserver(() => { priceChart?.resize(); deviationChart?.resize(); updateDeviationShade() })
    observer.observe(priceEl.value); observer.observe(deviationEl.value)
  }
}
watch(activePage, async page => {
  if (page !== 'research') return
  if (!result.value) await load()
  await nextTick(); draw()
}, { immediate: true })
onBeforeUnmount(() => { observer?.disconnect(); priceChart?.dispose(); deviationChart?.dispose() })
</script>

<template>
  <div class="macro-replication">
    <p v-if="isStatic" class="macro-note">此复现暂仅在本地展示，尚未发布复现数据。</p>
    <p v-else-if="loading">正在读取合并月表并估计长期价格中枢…</p>
    <p v-else-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
    <template v-if="result">
      <p class="macro-period">最新完整月份 {{ result.latest.month }} · 回归样本 {{ result.sample.start }}—{{ result.sample.end }} · {{ result.sample.count }}个月</p>
      <div class="macro-summary">
        <div><span>实际月均价</span><strong>{{ number(result.latest.actual) }}</strong><small>{{ result.latest.month }}</small></div>
        <div><span>长期理论价</span><strong>{{ number(result.latest.theory) }}</strong><small>同月宏观条件下的模型中枢</small></div>
        <div><span>相对理论价偏离</span><strong>{{ percent(result.latest.deviation) }}</strong><small>{{ result.latest.deviation >= 0 ? '实际价格高于模型中枢' : '实际价格低于模型中枢' }}</small></div>
        <div><span>偏离率历史分位</span><strong>{{ percent(result.latest.percentile, 1) }}</strong><small>全样本偏离率不高于当前值的比例</small></div>
      </div>
      <div class="macro-model">
        <strong>本次估计：ln(P)＝{{ formula }}</strong>
        <p>研报对照：ln(P)＝16.488 − 2.409 × ln(DXY) ＋ 0.108 × ln(VIX) ＋ 0.001326 × CB ＋ 0.007864 × T</p>
        <p>理论价＝exp(拟合对数价格)；偏离率＝实际价格 / 理论价 − 1。各变量均为同月数据。</p>
      </div>
      <div class="macro-charts">
        <article><h4>长期理论金价与实际金价</h4><p>实际价格采用Wind月均收盘价；理论价为全样本拟合值。</p><div ref="priceEl" class="macro-chart" data-chart-title="长期理论金价与实际金价" /></article>
        <article><h4>实际价格相对理论价格的偏离率</h4><p>浅绿表示高于中枢，浅黄表示低于中枢；虚线为零偏离。</p><div ref="deviationEl" class="macro-chart" data-chart-title="长期宏观价格偏离率" /></article>
      </div>
      <p v-for="item in result.sample.excluded" :key="item.month" class="macro-note">{{ item.month }}：{{ item.columns.join('、') }}缺失或不满足模型取值要求，未估算理论价及偏离率。</p>
      <details open class="macro-details">
        <summary>回归统计与研报对照</summary>
        <div class="macro-tables">
          <div class="macro-table-wrap"><table><thead><tr><th>拟合指标</th><th>本次结果</th><th>研报参考</th></tr></thead>
            <tbody>
              <tr><td>对数价格 R²</td><td>{{ percent(result.r2) }}</td><td>约93.1%</td></tr>
              <tr><td>调整 R²</td><td>{{ percent(result.adjusted_r2) }}</td><td>与R²基本一致</td></tr>
              <tr><td>价格 MAE</td><td>{{ number(result.mae) }}</td><td>约214</td></tr>
              <tr><td>价格 MAPE</td><td>{{ percent(result.mape) }}</td><td>约12.7%</td></tr>
            </tbody></table></div>
          <div class="macro-table-wrap"><table><thead><tr><th>参数</th><th>本次估计</th><th>HAC标准误</th><th>HAC z值</th><th>HAC p值</th><th>研报系数</th></tr></thead>
            <tbody><tr v-for="c in result.coefficients" :key="c.name"><td>{{ c.name }}</td><td>{{ number(c.value, 6) }}</td><td>{{ number(c.hac_se, 6) }}</td><td>{{ number(c.hac_z, 3) }}</td><td>{{ pvalue(c.hac_p) }}</td><td>{{ number(c.report, 6) }}</td></tr></tbody>
          </table></div>
        </div>
        <p class="macro-note">OLS估计系数；HAC使用Newey–West/Bartlett核、{{ result.hac_lags }}个月滞后、n/(n−5)有限样本修正，p值采用双侧渐近正态检验。研报未披露HAC滞后阶数，此处为本次复现设定。MAE为价格绝对误差均值；MAPE以实际价格为分母。</p>
      </details>
      <ResearchMacroResiduals v-if="result.residual_analysis" :analysis="result.residual_analysis" :points="result.points" />
      <p class="macro-note">来源：{{ result.source.file }}。金价取Wind月均收盘价，DXY、VIX取月末值，央行净购金沿用原口径。全样本拟合；偏离变化不等于金价涨跌。</p>
      <details class="macro-details">
        <summary>数据口径</summary>
        <p class="macro-note">央行数据为已报告机构月度储备净变化（吨），不再差分；缺失不补值。时间趋势自{{ result.trend_origin }}起为0，按自然月递增。Wind合成价格的单位与调整方式待核实；原文聚合口径、机构覆盖与趋势起点披露不完整。</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.macro-replication{color:#425b5f;font-size:12px}.macro-period{font-size:11px;color:#728486;margin:0 0 12px}.macro-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:8px 0 20px}.macro-summary>div{padding:16px;background:#f5f8f7;border-radius:6px;display:flex;flex-direction:column;gap:8px}.macro-summary span,.macro-summary small{color:#7c8d8e;font-size:11px;line-height:1.6}.macro-summary strong{font-size:24px;font-weight:600;color:#287985}.macro-model{background:#f7f5ef;border-left:3px solid #aa965e;padding:16px;line-height:1.8;overflow-wrap:anywhere}.macro-model p{margin:6px 0 0;color:#728486}.macro-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:24px 0 10px}.macro-charts article{min-width:0}.macro-charts h4{font-size:14px;margin:0 0 8px}.macro-charts p,.macro-note{font-size:11px;color:#829294;line-height:1.8}.macro-charts p{margin:0 0 14px}.macro-chart{height:320px;width:100%;min-width:0}.macro-details{margin-top:20px}.macro-details summary{cursor:pointer;color:#5e7475}.macro-table-wrap{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;white-space:nowrap;font-size:11px}th,td{text-align:right;padding:10px 12px;border-bottom:1px solid #e7eeeb}th{font-weight:500;background:#f5f8f7;color:#6c8183}th:first-child,td:first-child{text-align:left}@media(max-width:850px){.macro-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.macro-charts{grid-template-columns:1fr}.macro-summary strong{font-size:21px}}
</style>
