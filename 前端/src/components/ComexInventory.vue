<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { escapeHtml } from '../data.js'
import { comexView, comexColors as colors, stockNumber, validNumber, validStock, changeNumber, percentNumber } from '../comex.js'

const props = defineProps({ items: { type: Array, default: () => [] }, summary: Object, loading: Boolean, error: String })
const metal = ref('gold'), range = ref('30'), structureEl = ref(null), indexEl = ref(null)
const view = computed(() => comexView(props.items, props.summary, metal.value, range.value))
const label = computed(() => metal.value === 'gold' ? '黄金' : '白银')
const primaryName = computed(() => label.value + (view.value.confirmed ? '未质押注册库存' : '注册库存'))
const structureTitle = computed(() => metal.value === 'silver' ? '白银库存结构（吨）' : view.value.confirmed ? '黄金注册库存内部结构（吨）' : '黄金注册库存与已质押库存（吨）')
const state = computed(() => props.loading ? '加载中' : props.error ? '接口失败' : !view.value.latest ? '数据缺失' : view.value.missingFields.length || props.summary?.metals?.[metal.value]?.total_check_status === '不一致' ? '数据异常' : view.value.historyStatus)
const empty = computed(() => props.loading ? '正在读取 COMEX 真实数据…' : props.error ? 'COMEX 接口请求失败：' + props.error : !view.value.visible.length ? '该区间无 COMEX 记录，数据暂缺' : '')
const indexEmpty = computed(() => empty.value || (!view.value.commonBase ? '缺少注册与合格库存的共同有效观察日，暂不可计算' : !view.value.indexed.some(row => validNumber(row.registeredIndex) || validNumber(row.eligibleIndex)) ? '共同基准库存为零，指数暂不可计算' : ''))
const arrow = computed(() => view.value.delta == null ? '—' : view.value.delta > 0 ? '↑' : view.value.delta < 0 ? '↓' : '→')
const names = { registered: '注册库存', pledged: '已质押库存', unpledged: '未质押注册库存', eligible: '合格库存', total: '总库存' }
const missingNames = computed(() => view.value.missingFields.map(key => names[key]).join('、'))
const invalidValueCount = computed(() => Object.entries(props.summary?.quality || {}).filter(([key]) => key.startsWith('comex_' + metal.value + '_')).reduce((sum, [, quality]) => sum + quality.invalid_value_count + quality.negative_value_count, 0))
const fact = computed(() => {
  if (!view.value.commonBase) return '共同基期数据暂缺。'
  const describe = (name, value) => value == null ? `${name}暂不可计算` : Math.abs(value) < .005 ? `${name}较基期持平` : `${name}较基期${value > 0 ? '增加' : '下降'} ${stockNumber(Math.abs(value))}%`
  return [describe('注册库存', view.value.endChange.registered), describe('合格库存', view.value.endChange.eligible)].join('，') + '。'
})
let structureChart, indexChart, observer
const marker = color => `<span style="display:inline-block;width:12px;height:5px;margin-right:6px;background:${color}"></span>`
const rowLine = (name, value, color, unit = '吨') => `<div>${marker(color)}${escapeHtml(name)}：${validNumber(value) ? stockNumber(value) + ' ' + unit : '数据暂缺'}</div>`
const footer = () => `<div style="color:#849092;margin-top:6px">单位：吨<br>来源：${escapeHtml(props.summary?.source || 'COMEX金银库存.xlsx')} / ${escapeHtml(props.summary?.sheet || 'COMEX金银库存')}</div>`
const commonXAxis = (dates, boundaryGap) => ({ type: 'category', data: dates, boundaryGap, axisTick: { show: false }, axisLine: { lineStyle: { color: '#d8e0e0' } }, axisLabel: { ...axisLabel, hideOverlap: true }, axisPointer: { show: true, snap: true } })
function structureTooltip(params) {
  const date = (Array.isArray(params) ? params[0] : params)?.axisValue
  const row = view.value.visible.find(row => row.date === date)
  if (!row) return ''
  let html = `<strong>观察日期：${escapeHtml(row.date)}</strong>` + rowLine('注册库存', row.registered, colors.registered)
  if (metal.value === 'gold') {
    html += rowLine('已质押库存', row.pledged, colors.pledged)
    html += view.value.confirmed ? rowLine('未质押注册库存', row.unpledged, colors.registered) + `<div>已质押占比：${percentNumber(row.pledgedRatio)}</div>` : '<div>未质押注册库存、已质押占比：扣减口径待核实</div>'
  }
  html += rowLine('合格库存', row.eligible, colors.eligible) + rowLine('总库存（原表）', row.total, colors.boundary)
  return html + footer()
}
function indexTooltip(params) {
  const date = (Array.isArray(params) ? params[0] : params)?.axisValue
  const row = view.value.indexed.find(row => row.date === date)
  if (!row) return ''
  let html = `<strong>观察日期：${escapeHtml(row.date)}</strong><div>共同基准日期：${escapeHtml(view.value.commonBase?.date || '未提供')}</div>`
  for (const kind of ['registered', 'eligible']) {
    const index = row[kind + 'Index']
    html += `<div style="margin-top:5px">${rowLine(names[kind], row[kind], colors[kind])}指数：${stockNumber(index)} · 较基期：${validNumber(index) ? changeNumber(index - 100) + '%' : '暂不可计算'}</div>`
  }
  return html + footer()
}
function inventorySeries(name, key, color, stack, bar) {
  return { name, type: bar ? 'bar' : 'line', stack, barMaxWidth: 44, smooth: false, showSymbol: true, symbolSize: view.value.visible.length < 16 ? 5 : 3, connectNulls: false,
    itemStyle: { color }, lineStyle: { width: 2 }, ...(stack && !bar ? { areaStyle: { color, opacity: .4 } } : {}),
    data: view.value.visible.map(row => row[key] ?? null) }
}
async function draw() {
  await nextTick()
  if (!structureEl.value || !indexEl.value) return
  if (empty.value) { structureChart?.dispose(); indexChart?.dispose(); structureChart = indexChart = null; return }
  structureChart ||= echarts.init(structureEl.value)
  const v = view.value, few = v.visible.length <= 12, dates = v.visible.map(row => row.date)
  let series
  if (metal.value === 'gold') {
    series = v.pledgeComplete ? [inventorySeries('未质押注册库存', 'unpledged', colors.registered, 'registered', few), inventorySeries('已质押注册库存', 'pledged', colors.pledged, 'registered', few)] : [inventorySeries('注册库存', 'registered', colors.registered, undefined, false), inventorySeries('已质押库存（独立序列）', 'pledged', colors.pledged, undefined, false)]
    if (v.pledgeComplete) series.push(inventorySeries('注册库存总量', 'registered', colors.boundary, undefined, false))
  } else {
    series = [inventorySeries('注册库存', 'registered', colors.registered, v.totalsAgree ? 'inventory' : undefined, few), inventorySeries('合格库存', 'eligible', colors.eligible, v.totalsAgree ? 'inventory' : undefined, few)]
    series.push(inventorySeries('总库存（原表）', 'total', colors.boundary, undefined, false))
  }
  structureChart.setOption({ animation: false, grid: { left: 80, right: 36, top: 52, bottom: 38 },
    legend: { type: 'scroll', top: 4, left: 0, right: 0, itemWidth: 12, itemHeight: 5, icon: 'roundRect', textStyle: { fontSize: 10, color: '#667579' } },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter: structureTooltip },
    xAxis: commonXAxis(dates, series.some(s => s.type === 'bar')),
    yAxis: { type: 'value', min: 0, name: '吨', axisLabel: { ...axisLabel, formatter: value => stockNumber(value) }, splitLine: { lineStyle: { color: '#edf1f0' } } },
    series,
  }, true)
  if (indexEmpty.value) { indexChart?.dispose(); indexChart = null; structureChart.group = null; return }
  indexChart ||= echarts.init(indexEl.value)
  const indexedSeries = ['registered', 'eligible'].map((kind, index) => {
    const last = v.indexed.findLastIndex(row => validNumber(row[kind + 'Index']))
    return { name: names[kind] + '指数', type: 'line', smooth: false, connectNulls: false, showSymbol: true, symbolSize: few ? 5 : 3,
      itemStyle: { color: colors[kind] }, lineStyle: { width: 2 },
      label: { show: true, position: 'right', fontSize: 10, color: colors[kind], formatter: p => p.dataIndex === last ? changeNumber(p.value - 100) + '%' : '' },
      data: v.indexed.map(row => row[kind + 'Index']),
      ...(index === 0 ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: '#9aa5a5', type: 'dashed' }, label: { formatter: '基期 100', color: '#849092', fontSize: 9, position: 'insideStartTop' }, data: [{ yAxis: 100 }] } } : {}),
    }
  })
  indexChart.setOption({ animation: false, grid: { left: 80, right: 100, top: 43, bottom: 38 },
    legend: { top: 1, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 5, textStyle: { fontSize: 10, color: '#667579' } },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter: indexTooltip },
    xAxis: commonXAxis(dates, series.some(s => s.type === 'bar')),
    yAxis: { type: 'value', min: v.indexMin, max: v.indexMax, name: '基期＝100', axisLabel: { ...axisLabel, formatter: value => stockNumber(value) }, splitLine: { lineStyle: { color: '#edf1f0' } } },
    series: indexedSeries,
  }, true)
  // 两张图只共享真实观察日的悬停定位，不共享或混淆比较基准。
  const group = 'comex-inventory-linked'
  structureChart.group = group; indexChart.group = group; echarts.connect(group)
}
watch([view, () => props.loading, () => props.error], draw, { deep: true })
onMounted(() => { draw(); observer = new ResizeObserver(() => { structureChart?.resize(); indexChart?.resize() }); observer.observe(structureEl.value); observer.observe(indexEl.value) })
onBeforeUnmount(() => { observer?.disconnect(); echarts.disconnect('comex-inventory-linked'); structureChart?.dispose(); indexChart?.dispose() })
</script>

<template>
  <section id="comex" class="section comex-section">
    <div class="section-heading comex-heading"><div><span class="section-number">08</span><h2>COMEX 金银库存与结构</h2></div>
      <div class="comex-controls"><label>金属<select v-model="metal" aria-label="COMEX 金属"><option value="gold">黄金</option><option value="silver">白银</option></select></label><label>区间<select v-model="range" aria-label="COMEX 时间范围"><option value="30">近30日</option><option value="90">近90日</option><option value="ALL">全部</option></select></label><span>最新观察 {{ view.lastDate || '未提供' }}</span><StatusBadge :status="state" /></div>
    </div>
    <div class="comex-coverage">吨数口径 · {{ summary?.metals?.[metal]?.coverage_start || '—' }} — {{ summary?.metals?.[metal]?.coverage_end || '—' }} · {{ summary?.metals?.[metal]?.record_count ?? 0 }} 个观察期 / {{ summary?.metals?.[metal]?.valid_record_count ?? 0 }} 个完整有效记录 · 所选区间 {{ view.visible.length }} 期 / {{ view.validCount }} 期完整 · 历史{{ view.historyStatus === '短历史' ? '覆盖较短' : view.historyStatus }}</div>
    <div v-if="loading || error" class="comex-message" role="status">{{ empty }}</div>
    <div v-if="metal === 'gold' && !view.confirmed" class="comex-definition">已质押扣减口径待核实；当前以黄金注册库存为主指标，注册与已质押独立展示，不相加、不扣减，已质押占比暂不计算。</div>
    <div v-if="missingNames && !loading" class="comex-message">字段缺失或区间内无有效值：{{ missingNames }}；其余字段照常展示。</div>
    <div v-if="summary?.metals?.[metal]?.total_check_status === '不一致'" class="comex-message">注册＋合格与原表总库存不一致；保留原值，结构图暂停堆叠，请核对来源。</div>
    <div v-if="summary?.duplicate_date_count || summary?.invalid_date_count" class="comex-message">重复日期 {{ summary.duplicate_date_count }} 个、无效日期 {{ summary.invalid_date_count }} 条；冲突日期值留空，无效日期不进入图表。</div>
    <div v-if="invalidValueCount" class="comex-message">{{ invalidValueCount }} 个非数值、非有限或负库存已留空，图表保留缺失断点。</div>
    <div v-if="metal === 'gold' && summary?.metals?.gold?.pledged_exceeds_registered_dates?.length" class="comex-message">部分日期已质押值大于注册值，请核对字段与统计范围：{{ summary.metals.gold.pledged_exceeds_registered_dates.join('、') }}。不计算对应未质押余额或比例。</div>

    <article class="comex-banner" aria-label="COMEX 当前余额">
      <div class="comex-primary"><h3>{{ primaryName }}（吨）</h3><div class="comex-value">{{ loading ? '读取中…' : error ? '接口请求失败' : stockNumber(view.latest?.[view.primary]) }}<small v-if="!loading && !error && view.latest">吨</small></div><p>最新有效观察日期：{{ view.latest?.date || '未提供' }}<span v-if="view.latest?.date && view.latest.date !== view.lastDate">（最新观察期该字段缺失）</span></p></div>
      <div class="comex-comparison"><span>{{ view.comparisonLabel }}</span><div class="comex-delta">{{ arrow }} {{ changeNumber(view.delta) }}<small v-if="view.delta != null"> 吨</small><span>（{{ view.change == null ? '暂不可计算' : changeNumber(view.change) + '%' }}）</span></div><p>实际比较：{{ view.base?.date || '无有效基准' }} → {{ view.latest?.date || '未提供' }}</p><p>目标基准日期：{{ view.target || '未提供' }}（向前 {{ view.days }} 个自然日）</p><p v-if="view.delta == null">有效观察不足两期，变化暂不可计算。</p><p>箭头仅表示库存数量增减。</p></div>
      <dl class="comex-secondary" v-if="metal === 'gold'"><div><dt>黄金注册库存</dt><dd>{{ stockNumber(view.latest?.registered) }} 吨</dd></div><div><dt>黄金已质押库存</dt><dd>{{ stockNumber(view.latest?.pledged) }} 吨</dd></div><div><dt>已质押占注册比例</dt><dd>{{ view.confirmed ? percentNumber(view.latest?.pledgedRatio) : '口径待核实' }}</dd></div><div><dt>黄金合格 / 总库存</dt><dd>{{ stockNumber(view.latest?.eligible) }} / {{ stockNumber(view.latest?.total) }} 吨</dd></div></dl>
      <dl class="comex-secondary" v-else><div><dt>白银合格库存</dt><dd>{{ stockNumber(view.latest?.eligible) }} 吨</dd></div><div><dt>白银总库存</dt><dd>{{ stockNumber(view.latest?.total) }} 吨</dd></div><div><dt>注册库存占总比例</dt><dd>{{ percentNumber(view.latest?.registeredRatio) }}</dd></div><div><dt>辅助值观察日期</dt><dd>{{ view.latest?.date || '未提供' }}</dd></div></dl>
    </article>

    <article class="chart-panel comex-structure"><header class="panel-header"><div><h3>{{ structureTitle }}</h3><p>{{ metal === 'gold' && !view.confirmed ? '口径未确认，独立折线显示真实观测点；不做内部堆叠' : view.visible.length <= 12 ? '有效点数较少，采用堆叠柱状图并保留真实观测点' : '堆叠面积图与总量边界；不插值、不平滑' }} · 纵轴从零开始</p></div></header><div class="comex-chart-stage structure-stage"><div ref="structureEl" class="echart" data-chart-title="COMEX 库存结构" /><div v-if="empty" class="empty-state"><strong>{{ empty }}</strong></div></div><div class="chart-caption"><span>{{ view.visible[0]?.date || '—' }} — {{ view.visible.at(-1)?.date || '—' }} · {{ view.visible.length }} 个真实观察期</span><span>原表总库存＝注册＋合格 · 核验{{ summary?.metals?.[metal]?.total_check_status || '数据不足' }}</span></div></article>

    <article class="chart-panel comex-relative"><header class="panel-header"><div><h3>注册库存与合格库存相对变化（基期＝100）</h3><p>指数共同基准日期：{{ view.commonBase?.date || '无共同有效日期' }} · 所选区间首个共同有效观察日，与顶部变化比较基准分别计算</p><p v-if="view.commonBase && (!view.commonBase.registered || !view.commonBase.eligible)">部分基准库存为零，对应指数暂不可计算。</p></div></header><div class="comex-chart-stage relative-stage"><div ref="indexEl" class="echart" data-chart-title="COMEX 库存相对变化" /><div v-if="indexEmpty" class="empty-state"><strong>{{ indexEmpty }}</strong></div></div><div class="chart-caption"><span>{{ fact }}</span><span>末端标签为该序列最后有效日较基期变化；空值保留断点</span></div></article>

    <div class="comex-notes"><p>库存变化可能涉及出入库及库存类别转换，未质押余额不代表持有人即时交割意愿。</p><p>来源：{{ summary?.source || 'COMEX金银库存.xlsx' }} / {{ summary?.sheet || 'COMEX金银库存' }} · 单位：吨。盎司表仅作另一单位口径，不合并；发布日期与采集自动化状态未提供。</p><details v-if="metal === 'gold' && !view.confirmed"><summary>已质押扣减待确认事项</summary><ul><li v-for="note in summary?.definition?.pending || ['原始报告字段映射、子集关系、同日及同范围口径待确认']" :key="note">{{ note }}</li></ul><p>{{ summary?.definition?.exchange_definition }}</p><a v-if="summary?.definition?.reference" :href="summary.definition.reference" target="_blank" rel="noopener noreferrer">CME 官方仓单 FAQ（定义参考）</a></details></div>
  </section>
</template>

<style scoped>
.comex-heading{align-items:flex-start;flex-wrap:wrap}.comex-heading>div{flex-wrap:wrap}.comex-controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;color:#879695;font-size:10px}.comex-controls label{display:flex;align-items:center;gap:6px}.comex-controls select{font-size:10px;padding:5px 22px 5px 8px}.comex-coverage{color:#8b9b99;font-size:10px;line-height:1.8;margin:-3px 0 12px}.comex-definition{padding:10px 12px;border-left:2px solid #b69b64;background:#f7f4eb;color:#927a49;font-size:10px;line-height:1.8;margin-bottom:12px}.comex-message{color:#ac7963;font-size:11px;line-height:1.8;padding:8px 0}.comex-banner{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:22px;background:white;border:1px solid #e5eae6;border-radius:5px;padding:19px 20px;margin-bottom:14px;align-items:start}.comex-primary h3{font-size:12px;color:#4b6670;font-weight:500;margin:0 0 10px}.comex-value{font-size:31px;color:#2e4852;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.4;overflow-wrap:anywhere}.comex-value small{font-size:11px;font-weight:400;color:#91a09e;margin-left:7px}.comex-primary p,.comex-comparison p{font-size:10px;color:#8a9998;line-height:1.8;margin:5px 0 0;overflow-wrap:anywhere}.comex-comparison>span{font-size:11px;color:#728785}.comex-delta{font-size:19px;font-weight:500;color:#3d6871;line-height:1.7;margin-top:6px;font-variant-numeric:tabular-nums}.comex-delta small{font-size:10px}.comex-delta>span{font-size:12px;color:#6e8589;display:inline-block}.comex-secondary{margin:0;display:grid;gap:9px;font-size:10px;color:#829491}.comex-secondary>div{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.comex-secondary dt{font-weight:400}.comex-secondary dd{margin:0;color:#566e73;font-variant-numeric:tabular-nums}.comex-structure,.comex-relative{margin-top:14px}.comex-chart-stage{position:relative}.structure-stage{height:340px}.relative-stage{height:245px}.comex-notes{font-size:10px;line-height:1.8;color:#8b9a96;margin-top:12px}.comex-notes p{margin:5px 0}.comex-notes summary{cursor:pointer;color:#8f7a50;width:fit-content}.comex-notes ul{padding-left:20px;margin:7px 0}.comex-notes a{color:#698894}.comex-controls>span{white-space:nowrap}@media(max-width:1000px){.comex-banner{grid-template-columns:1fr 1fr}.comex-secondary{grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px}}@media(max-width:760px){.comex-controls{justify-content:flex-start;flex-wrap:wrap}.comex-banner{grid-template-columns:1fr;gap:15px;padding:16px}.comex-secondary{grid-template-columns:1fr}.comex-heading{gap:12px}.structure-stage{height:320px}.relative-stage{height:260px}.comex-value{font-size:27px}}
</style>
