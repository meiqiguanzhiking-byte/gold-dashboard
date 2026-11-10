<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { isStatic, request } from '@live-source'

const activePage = inject('dashboardActivePage')
const result = ref(null), loading = ref(false), error = ref(''), selectedMonth = ref('2026-09')
const rollingEl = ref(null), groupEl = ref(null)
let rollingChart, groupChart, observer
const percent = (v, digits = 2) => v == null ? '—' : (v * 100).toFixed(digits) + '%'
const number = (v, digits = 3) => v == null ? '—' : v.toFixed(digits)
const pvalue = v => v < .0001 ? '<0.0001' : v.toFixed(4)
const selected = computed(() => result.value?.pairs.find(p => p.month === selectedMonth.value))
const coef = computed(() => result.value?.coefficients || [])
async function load() {
  if (isStatic || loading.value) return
  loading.value = true; error.value = ''
  try { result.value = await request('research/etf-monthly'); await nextTick(); draw() }
  catch (e) { error.value = e.message }
  finally { loading.value = false }
}
function draw() {
  if (!result.value || activePage.value !== 'research' || !rollingEl.value) return
  rollingChart ||= echarts.init(rollingEl.value)
  groupChart ||= echarts.init(groupEl.value)
  const r = result.value
  const firstRollingIndex = r.rolling.findIndex(p => p.leading != null || p.contemporaneous != null)
  const rolling = firstRollingIndex < 0 ? [] : r.rolling.slice(firstRollingIndex)
  rollingChart.setOption({ animation: false, color: ['#287985', '#b28d54'],
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: v => number(v) },
    legend: { top: 0, textStyle: { color: '#728486', fontSize: 11 } },
    grid: { left: 45, right: 15, top: 40, bottom: 65 },
    xAxis: { type: 'category', data: rolling.map(p => p.month), axisLabel, boundaryGap: false },
    yAxis: { type: 'value', min: -1, max: 1, axisLabel, splitLine: { lineStyle: { color: '#edf1f0' } } },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
    series: [['同期相关', 'contemporaneous'], ['领先1个月IC', 'leading']].map(([name, key]) => ({
      name, type: 'line', showSymbol: false, connectNulls: false, data: rolling.map(p => p[key]), lineStyle: { width: 2 },
    })),
  })
  groupChart.setOption({ animation: false,
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: v => number(v, 2) + '%' },
    grid: { left: 50, right: 15, top: 35, bottom: 40 },
    xAxis: { type: 'category', data: r.groups.map(g => g.name), axisLabel },
    yAxis: { type: 'value', axisLabel: { ...axisLabel, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#edf1f0' } } },
    series: [{ name: '下一月平均对数收益', type: 'bar', barMaxWidth: 48,
      label: { show: true, position: 'top', formatter: p => p.value.toFixed(2) + '%', color: '#647578', fontSize: 11 },
      data: r.groups.map(g => ({ value: g.mean * 100, itemStyle: { color: g.mean < 0 ? '#c27e65' : '#287985' } })),
    }],
  })
  rollingChart.resize(); groupChart.resize()
  if (!observer) { observer = new ResizeObserver(() => { rollingChart?.resize(); groupChart?.resize() }); observer.observe(rollingEl.value); observer.observe(groupEl.value) }
}
watch(activePage, async page => {
  if (page !== 'research') return
  if (!result.value) await load()
  await nextTick(); draw()
}, { immediate: true })
onBeforeUnmount(() => { observer?.disconnect(); rollingChart?.dispose(); groupChart?.dispose() })
</script>

<template>
  <div class="etf-replication">
    <p v-if="isStatic" class="etf-note">此复现暂仅在本地展示，尚未发布复现数据。</p>
    <p v-else-if="loading">正在读取合并月表并计算…</p>
    <p v-else-if="error" role="alert">{{ error }} <button class="text-button" @click="load">重试</button></p>
    <template v-if="result">
      <div class="etf-summary">
        <div><span>有效配对</span><strong>{{ result.sample.count }} <small>组</small></strong><small>{{ result.sample.start }}—{{ result.sample.end }} 流量</small></div>
        <div><span>领先1个月 IC</span><strong>{{ number(result.ic) }}</strong><small>研报约 0.243</small></div>
        <div><span>回归 R²</span><strong>{{ percent(result.r2) }}</strong><small>研报约 5.9%</small></div>
        <div><span>Q5 − Q1 收益差</span><strong>{{ number(result.spread * 100, 2) }} <small>个百分点</small></strong><small>研报约 2.59 个百分点</small></div>
      </div>
      <div class="etf-model">
        <strong>本次估计：预测下月对数收益＝{{ percent(coef[0].value, 4) }} {{ coef[1].value < 0 ? '−' : '＋' }} {{ percent(Math.abs(coef[1].value), 4) }} × 当月ETF流量（吨）</strong>
        <p>研报对照：0.660% ＋ 0.0164% × 当月ETF流量（吨）</p>
        <p>收益 rₜ₊₁＝ln(Pₜ₊₁/Pₜ)；预测月均价＝Pₜ × exp(预测对数收益)。P为Wind GC.CMX合成序列当月每日收盘价的算术平均值；ETF流量直接使用，不再差分。</p>
        <p>本页收益指相邻月份月均价的对数变动，并非月末持有收益。</p>
      </div>
      <div class="etf-charts">
        <article><h4>ETF流量与黄金收益：60个月滚动相关</h4><p>横轴为流量月份；领先IC包含该月流量对应的下一月收益。</p><div ref="rollingEl" class="etf-chart" data-chart-title="ETF月度滚动相关" /></article>
        <article><h4>ETF流量五分位：下一月平均收益</h4><p>Q1为流量最低组，Q5为最高组；全样本分位分组。</p><div ref="groupEl" class="etf-chart" data-chart-title="ETF流量五分位收益" /></article>
      </div>
      <p class="etf-note">全样本同期相关 {{ number(result.same_ic) }}（{{ result.sample.same_count }}组）。{{ result.same_note }} 领先配对使用截至{{ result.sample.target_end }}的黄金价格；滚动窗口不足60个月留空。</p>
      <details class="etf-details" open>
        <summary>回归统计与研报对照</summary>
        <div class="etf-table-wrap"><table><thead><tr><th>参数</th><th>估计值</th><th>OLS标准误</th><th>OLS t值</th><th>OLS p值</th><th>HAC标准误</th><th>HAC p值</th></tr></thead>
          <tbody><tr v-for="c in coef" :key="c.name"><td>{{ c.name }}</td><td>{{ number(c.value, 7) }}</td><td>{{ number(c.se, 7) }}</td><td>{{ number(c.t) }}</td><td>{{ pvalue(c.p) }}</td><td>{{ number(c.hac_se, 7) }}</td><td>{{ pvalue(c.hac_p) }}</td></tr></tbody></table></div>
        <p class="etf-note">收益以小数计；系数乘100即百分点。OLS p值采用双侧t检验；HAC采用Newey–West/Bartlett核、{{ result.hac_lags }}个月滞后和有限样本修正，p值采用渐近正态分布。这是本次复现设定。</p>
      </details>
      <div class="etf-table-wrap"><table><thead><tr><th>流量分组</th><th>流量区间（吨）</th><th>样本数</th><th>平均收益</th><th>中位数</th><th>上涨比例</th><th>研报平均收益</th></tr></thead>
        <tbody><tr v-for="(g, i) in result.groups" :key="g.name"><td>{{ g.name }}</td><td>{{ i ? '(' : '[' }}{{ number(g.lower, 2) }}, {{ number(g.upper, 2) }}]</td><td>{{ g.count }}</td><td>{{ percent(g.mean) }}</td><td>{{ percent(g.median) }}</td><td>{{ percent(g.up_rate, 1) }}</td><td>{{ ['−0.39%', '0.36%', '1.17%', '1.16%', '2.20%'][i] }}</td></tr></tbody></table></div>
      <div class="etf-forecast">
        <label>查看历史预测 <select v-model="selectedMonth" aria-label="ETF流量月份"><option v-for="p in result.pairs.slice().reverse()" :key="p.month" :value="p.month">{{ p.month }}</option></select></label>
        <div v-if="selected" class="etf-forecast-values">
          <span>流量 <strong>{{ number(selected.flow, 2) }} 吨</strong></span><span>目标月份 <strong>{{ selected.target_month }}</strong></span>
          <span>预测收益 <strong>{{ percent(selected.predicted) }}</strong></span><span>实际收益 <strong>{{ percent(selected.actual) }}</strong></span>
          <span>预测月均价 <strong>{{ number(selected.predicted_price, 2) }}</strong></span><span>实际月均价 <strong>{{ number(selected.next_price, 2) }}</strong></span>
        </div>
        <p class="etf-note">价格取合并表“COMEX黄金（月均收盘价）”列，由Wind“收盘价(元)”按月取算术平均；币种、单位及合成调整方式待核实。此处为全样本参数下的历史拟合，预测值不代表当时已知的信息或样本外表现。输入：合并表第{{ selected?.source_row }}行流量与月均价，以及下一月月均价。</p>
      </div>
      <p class="etf-note">来源：{{ result.source.file }} / {{ result.source.sheet }}。所有计算保留缺失，不插值、不补零。缺少逐期发布日期，尚未检验真实可交易性；本次结果与研报的差异保留展示。</p>
    </template>
  </div>
</template>

<style scoped>
.etf-replication{color:#425b5f;font-size:12px}.etf-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:8px 0 20px}.etf-summary>div{padding:16px;background:#f5f8f7;border-radius:6px;display:flex;flex-direction:column;gap:8px}.etf-summary span,.etf-summary small{color:#7c8d8e;font-size:11px}.etf-summary strong{font-size:24px;font-weight:600;color:#287985}.etf-summary strong small{font-weight:400}.etf-model{background:#f7f5ef;border-left:3px solid #aa965e;padding:16px;line-height:1.8}.etf-model p{margin:6px 0 0;color:#728486}.etf-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:24px 0 10px}.etf-charts article{min-width:0}.etf-charts h4{font-size:14px;margin:0 0 8px}.etf-charts p,.etf-note{font-size:11px;color:#829294;line-height:1.8}.etf-charts p{margin:0 0 14px}.etf-chart{height:300px;width:100%;min-width:0}.etf-table-wrap{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;white-space:nowrap;font-size:11px}th,td{text-align:right;padding:10px 12px;border-bottom:1px solid #e7eeeb}th{font-weight:500;background:#f5f8f7;color:#6c8183}th:first-child,td:first-child{text-align:left}.etf-details{margin-top:20px}.etf-details summary{cursor:pointer;color:#5e7475;font-size:12px}.etf-forecast{border-top:1px solid #e1e7e4;padding-top:20px;margin-top:24px}.etf-forecast label{display:flex;align-items:center;gap:12px}.etf-forecast select{padding:5px 10px;border:1px solid #dce4e1;border-radius:4px;color:#425b5f;background:white}.etf-forecast-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:20px 0}.etf-forecast-values span{color:#829294}.etf-forecast-values strong{display:block;margin-top:7px;color:#425b5f;font-size:16px;font-weight:500}@media(max-width:850px){.etf-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.etf-charts{grid-template-columns:1fr}.etf-forecast-values{grid-template-columns:repeat(2,minmax(0,1fr))}.etf-summary strong{font-size:21px}}
</style>
