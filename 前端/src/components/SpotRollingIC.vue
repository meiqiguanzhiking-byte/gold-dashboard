<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { useChartVisibility } from '../chart-visibility.js'
import { escapeHtml } from '../data.js'
import { buildRollingIC, isDailyFactor, IC_WINDOW, IC_MIN_PAIRS } from '../rolling-ic.js'

const props = defineProps({ data: Object })
const targetId = ref('spread'), factorId = ref('')
const pairing = ref('next-change')
const pairingOptions = [
  { id: 'same-level', label: '同期水平', formula: 'Xₜ 与 Sₜ' },
  { id: 'next-level', label: '下一日水平', formula: 'Xₜ 与 Sₜ₊₁' },
  { id: 'next-change', label: '下一日变化', formula: 'Xₜ 与 Sₜ₊₁−Sₜ' },
]
const pairingLabel = computed(() => pairingOptions.find(option => option.id === pairing.value).label)
const threshold = computed(() => pairing.value === 'next-change' ? .1 : .3)
const targetDescription = computed(() => pairing.value === 'same-level' ? '同期原值' : pairing.value === 'next-level' ? '下一观察日原值' : targetId.value === 'spread' ? '下一观察日价差变动（元/克）' : '下一观察日收益率')
const targets = computed(() => (props.data?.columns || []).filter(column => column.group === '研究对象'))
const factors = computed(() => (props.data?.columns || []).filter(isDailyFactor))
const factorGroups = computed(() => [...new Set(factors.value.map(column => column.group))].map(name => ({ name, columns: factors.value.filter(column => column.group === name) })))
watch(factors, columns => { if (!columns.some(column => column.id === factorId.value)) factorId.value = columns[0]?.id || '' }, { immediate: true })
const target = computed(() => targets.value.find(column => column.id === targetId.value))
const factor = computed(() => factors.value.find(column => column.id === factorId.value))
const model = computed(() => buildRollingIC(props.data, targetId.value, factorId.value, pairing.value))
const element = ref(null)
let chart
const visibility = useChartVisibility(element, draw, () => chart?.resize())
const number = value => value == null ? '—' : value.toFixed(4)
function draw() {
  if (!visibility.canDraw()) return
  if (!chart) chart = echarts.init(element.value)
  if (!props.data || !factor.value) { chart.clear(); return }
  const curve = model.value.curve
  chart.setOption({ animation: false,
    grid: { left: 64, right: 24, top: 32, bottom: 76 },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter(params) {
      const point = curve[params[0]?.dataIndex]
      return point ? `<strong>${escapeHtml(point.date)}</strong><div>${escapeHtml(pairingLabel.value)} · 252日滚动 Rank IC：${number(point.ic)}</div><div>有效配对：${point.ready ? point.pairs + ' / 252' : '窗口未满'}</div>` : ''
    } },
    xAxis: { type: 'category', data: curve.map(point => point.date), boundaryGap: false, axisLabel, axisTick: { show: false }, axisLine: { lineStyle: { color: '#dce4e1' } } },
    yAxis: { type: 'value', min: -1, max: 1, name: 'Rank IC', nameTextStyle: { color: '#728486', fontSize: 11 }, axisLabel,
      splitLine: { lineStyle: { color: '#edf1f0' } } },
    dataZoom: [{ type: 'slider', xAxisIndex: 0, bottom: 10, height: 20, showDetail: false, brushSelect: false, filterMode: 'none', borderColor: '#dce4e1' }],
    series: [{ name: '252日滚动 Rank IC', type: 'line', data: curve.map(point => point.ic), showSymbol: false, connectNulls: false, smooth: false,
      latestValueLabel: false, lineStyle: { color: '#287985', width: 1.8 }, itemStyle: { color: '#287985' },
      markArea: { silent: true, itemStyle: { color: 'rgba(40,121,133,0.09)' }, label: { show: false },
        data: [[{ yAxis: -threshold.value }, { yAxis: threshold.value }]] },
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#9ba8a9', type: 'dashed' },
        data: [{ yAxis: 0 }, ...[-threshold.value, threshold.value].map(value => ({ yAxis: value,
          lineStyle: { color: '#7caaaF', type: 'dashed', opacity: .7 },
          label: { show: true, position: 'insideEndTop', color: '#728486', fontSize: 10, formatter: `${value > 0 ? '+' : ''}${value.toFixed(1)}` } }))] } }],
  }, true)
  chart.resize()
}
watch(model, visibility.requestDraw)
onBeforeUnmount(() => chart?.dispose())
</script>

<template>
  <article class="rolling-ic-panel">
    <header><h3>滚动IC</h3><span>252 个观察日 · Spearman 秩相关</span></header>
    <div class="ic-filters">
      <label>研究对象<select v-model="targetId" :disabled="!data"><option v-for="column in targets" :key="column.id" :value="column.id">{{ column.name }}</option></select></label>
      <label>日频因子<select v-model="factorId" :disabled="!data"><optgroup v-for="group in factorGroups" :key="group.name" :label="group.name"><option v-for="column in group.columns" :key="column.id" :value="column.id">{{ column.name }}（{{ column.unit }}）</option></optgroup></select></label>
      <label>配对方式<select v-model="pairing" :disabled="!data"><option v-for="option in pairingOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
    </div>
    <p class="ic-note">{{ pairingLabel }}：因子当日原值 vs 研究对象{{ targetDescription }}。每个窗口至少 {{ IC_MIN_PAIRS }}/{{ IC_WINDOW }} 对有效数据；不足、窗口未满或序列为常数时留空。曲线日期为结果已知日。</p>
    <p v-if="target && factor" class="ic-comparison">{{ factor.name }} → {{ target.name }} · {{ targetDescription }}</p>
    <p class="ic-note"><span class="ic-threshold-swatch" aria-hidden="true"></span>浅色阈值区间：−{{ threshold.toFixed(1) }} 至 +{{ threshold.toFixed(1) }}</p>
    <div class="ic-chart-scroll"><div ref="element" class="ic-chart" data-chart-title="252日滚动IC" role="img" :aria-label="pairingLabel + '：所选日频因子与研究对象的252日滚动Spearman相关系数'" /></div>
    <p v-if="!data" class="ic-note" role="status">等待上方行情数据加载。</p>
    <p v-else-if="!model.summary[0].count" class="ic-note" role="status">该组合没有满足窗口和有效配对要求的 IC，均值保留空值。</p>
    <h4>滚动 IC 均值 · {{ pairingLabel }}</h4>
    <div class="ic-table-scroll"><table><thead><tr><th scope="col">样本窗口</th><th scope="col">起止日期</th><th scope="col">IC 均值</th><th scope="col">有效 IC 点数</th><th scope="col">未计算点数</th></tr></thead><tbody>
      <tr v-for="row in model.summary" :key="row.label"><th scope="row">{{ row.label }}</th><td>{{ row.start || '—' }} — {{ row.end || '—' }}</td><td>{{ number(row.mean) }}</td><td>{{ row.count.toLocaleString() }}</td><td>{{ row.excluded.toLocaleString() }}</td></tr>
    </tbody></table></div>
    <details class="ic-method"><summary>计算口径</summary><p>本图为单因子时间序列滚动 Rank IC，并列值使用平均秩。“同期水平”为 Xₜ 与 Sₜ；“下一日水平”为 Xₜ 与 Sₜ₊₁；两者均使用研究对象原值。“下一日变化”中价差使用 Sₜ₊₁−Sₜ，金价及汇率沿用 Pₜ₊₁/Pₜ−1 收益率，基期价格必须大于 0。下一日指下一数据观察日。缺失成对剔除，不补零、不前填，不跨过缺失行寻找下一个有效价格。</p><p>每点使用截至该日期已知的最近 252 对观察序列位置，至少 202 对完整配对才计算。同期水平包含当日，最初 251 行窗口未满；两种下一日模式按结果已知日标点，最初 252 行窗口未满。日频因子按原有指标口径筛选，排除 CFTC 周频持仓及含 CFTC 的差值、外汇供求和消费月频因子。因子的个别缺日仍保留缺失。</p><p>表内 IC 均值是各日期滚动 IC 的算术平均，按结果已知日归属全样本及六个阶段。阶段起点的窗口会使用之前阶段的历史；窗口高度重叠，点数不代表独立样本数。水平相关可能受共同趋势影响，不等于对变化的预测力。此处按观察日期对齐，未验证每项因子的实际发布时间，不据此认定可交易或具有样本外预测能力。独立于上方行情日期筛选。</p></details>
  </article>
</template>

<style scoped>
.rolling-ic-panel{margin-top:24px;padding:20px 22px;background:#fff;border:1px solid #dce4e1;border-radius:6px;color:#344e54;min-width:0}.rolling-ic-panel header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.rolling-ic-panel h3{margin:0;border-left:3px solid #b29a61;padding-left:10px;font-size:17px;font-weight:600;color:#263c40}.rolling-ic-panel header span,.ic-note,.ic-method{font-size:11px;color:#728486;line-height:1.8}.ic-filters{display:flex;flex-wrap:wrap;gap:14px 24px;margin:20px 0 12px}.ic-filters label{display:flex;align-items:center;gap:10px;font-size:12px;max-width:100%}.ic-filters select{min-width:180px;max-width:100%;padding:8px 10px;border:1px solid #dce4e1;border-radius:4px;background:#fff;color:#344e54;font:inherit}.ic-comparison{font-size:12px;color:#287985;margin:16px 0 4px}.ic-chart-scroll,.ic-table-scroll{overflow-x:auto}.ic-chart{height:380px;min-width:580px;width:100%}.rolling-ic-panel h4{font-size:14px;margin:20px 0 10px;font-weight:600}.rolling-ic-panel table{width:100%;min-width:650px;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.rolling-ic-panel th,.rolling-ic-panel td{padding:13px 10px;text-align:left;border-bottom:1px solid #edf1f0;font-weight:400}.rolling-ic-panel thead th{font-weight:600}.rolling-ic-panel tbody tr:first-child{background:#f8faf9}.ic-method{margin-top:18px}.ic-method summary{cursor:pointer}.ic-method p{margin:8px 0}.ic-filters select:focus-visible{outline:2px solid #287985;outline-offset:3px}@media(max-width:600px){.rolling-ic-panel{padding:16px 12px}.ic-filters label{display:grid;grid-template-columns:1fr;width:100%}.ic-filters select{width:100%;min-width:0}}
</style>

<style scoped>
.ic-threshold-swatch{display:inline-block;width:20px;height:10px;margin-right:7px;background:rgba(40,121,133,.09);border:1px dashed #7caaaf;vertical-align:middle}
</style>
