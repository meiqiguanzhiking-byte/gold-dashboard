<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { echarts, axisLabel, tooltipStyle } from '../charts.js'
import { isStatic, request } from '@live-source'

const activePage = inject('dashboardActivePage')
const emit = defineEmits(['loaded'])
const result = ref(null), loading = ref(false), error = ref('')
const bullEl = ref(null), bearEl = ref(null), signalsEl = ref(null)
const lowPathEl = ref(null), highPathEl = ref(null), lowBoxEl = ref(null), highBoxEl = ref(null)
const charts = new Map()
let observer
const percent = (v, digits = 2) => v == null ? '—' : (v * 100).toFixed(digits) + '%'
const number = (v, digits = 2) => v == null ? '—' : v.toFixed(digits)
const pp = v => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(2)
const stateName = computed(() => Object.fromEntries((result.value?.state_counts || []).map(s => [s.state, s.name])))
const events = computed(() => result.value?.divergence.flatMap(g => g.events.map(e => ({ ...e, name: g.name }))).sort((a, b) => b.start.localeCompare(a.start)) || [])
async function load() {
  if (isStatic || loading.value) return
  loading.value = true; error.value = ''
  try { result.value = await request('research/dual-anchor'); emit('loaded', result.value); await nextTick(); draw() }
  catch (e) { error.value = e.message }
  finally { loading.value = false }
}
function setChart(el, option) {
  if (!el) return
  if (!charts.has(el)) { charts.set(el, echarts.init(el)); observer.observe(el) }
  const chart = charts.get(el)
  chart.setOption(option); chart.resize()
}
function draw() {
  if (!result.value || activePage.value !== 'research' || !bullEl.value) return
  observer ||= new ResizeObserver(() => { for (const chart of charts.values()) chart.resize() })
  const r = result.value
  const base = {
    animation: false, color: ['#287985', '#b28d54', '#c27e65'],
    tooltip: { ...tooltipStyle, trigger: 'axis' },
    legend: { top: 0, textStyle: { color: '#728486', fontSize: 11 } },
    grid: { left: 58, right: 18, top: 44, bottom: 50 },
    xAxis: { type: 'category', axisLabel },
    yAxis: { type: 'value', axisLabel, splitLine: { lineStyle: { color: '#edf1f0' } } },
  }
  for (const [i, el] of [[0, bullEl.value], [1, bearEl.value]]) {
    const g = r.resonance[i]
    setChart(el, { ...base,
      tooltip: { ...tooltipStyle, trigger: 'axis', formatter: params => {
        const b = g.histogram[params[0].dataIndex]
        const all = r.baseline.histogram[params[0].dataIndex]
        return `${percent(b.lower)} 至 ${percent(b.upper)}<br/>${g.name}：${percent(b.share, 1)}（${b.count}个月）<br/>全样本：${percent(all.share, 1)}`
      } },
      xAxis: { ...base.xAxis, data: g.histogram.map(b => percent((b.lower + b.upper) / 2, 1)), axisLabel: { ...axisLabel, rotate: 35 } },
      yAxis: { ...base.yAxis, min: 0, axisLabel: { ...axisLabel, formatter: '{value}%' } },
      series: [
        { name: g.name, type: 'bar', data: g.histogram.map(b => b.share == null ? null : b.share * 100), barCategoryGap: '8%', itemStyle: { color: i ? '#c27e65' : '#287985' } },
        { name: '全样本', type: 'line', showSymbol: false, data: r.baseline.histogram.map(b => b.share * 100), lineStyle: { color: '#b28d54', width: 1.5, type: 'dashed' }, itemStyle: { color: '#b28d54' } },
      ],
    })
  }
  const signalMap = new Map(r.signals.map(p => [p.month, p]))
  setChart(signalsEl.value, { ...base,
    grid: { ...base.grid, bottom: 65 },
    tooltip: { ...tooltipStyle, trigger: 'axis', formatter: params => {
      const p = signalMap.get(params[0]?.axisValue)
      return p ? `${p.month} · ${stateName.value[p.state]}<br/>月均价：${number(p.price)}<br/>偏离率：${percent(p.deviation)}<br/>ETF预测次月收益：${percent(p.predicted)}<br/>实际次月收益：${percent(p.actual)}` : ''
    } },
    xAxis: { ...base.xAxis, boundaryGap: false, data: r.signals.map(p => p.month) },
    yAxis: { ...base.yAxis, name: 'ln(月均价)', nameTextStyle: { color: '#829294', fontSize: 10 }, scale: true },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 5 }],
    series: [
      { name: '黄金对数价格', type: 'line', showSymbol: false, data: r.signals.map(p => p.log_price), lineStyle: { color: '#829294', width: 1.5 }, itemStyle: { color: '#829294' } },
      ...[['bull', '看涨共振', '#287985', 'triangle'], ['bear', '看跌共振', '#c27e65', 'diamond']].map(([state, name, color, symbol]) => ({
        name, type: 'scatter', symbol, symbolSize: 9, itemStyle: { color }, z: 3,
        data: r.signals.filter(p => p.state === state).map(p => [p.month, p.log_price]),
      })),
    ],
  })
  for (const [i, pathEl, boxEl] of [[0, lowPathEl.value, lowBoxEl.value], [1, highPathEl.value, highBoxEl.value]]) {
    const g = r.divergence[i]
    setChart(pathEl, { ...base,
      tooltip: { ...tooltipStyle, trigger: 'axis', formatter: params => {
        const p = g.path[params[0].dataIndex]
        return `未来${p.horizon}个月 · n=${p.count}<br/>平均变化：${pp(p.mean)}个百分点<br/>中位数：${pp(p.median)}个百分点`
      } },
      xAxis: { ...base.xAxis, boundaryGap: false, data: g.path.map(p => p.horizon + '月') },
      yAxis: { ...base.yAxis, name: '偏离变化（百分点）', nameTextStyle: { color: '#829294', fontSize: 10 } },
      grid: { ...base.grid, top: 60 },
      series: [['平均值', 'mean', false], ['中位数', 'median', true]].map(([name, key, dashed]) => ({
        name, type: 'line', showSymbol: false, connectNulls: false, data: g.path.map(p => p[key] == null ? null : p[key] * 100),
        lineStyle: { width: 2, type: dashed ? 'dashed' : 'solid' },
        ...(key === 'mean' ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#b9c3c2' }, data: [{ yAxis: 0 }] } } : {}),
      })),
    })
    const periods = r.horizons.map(h => g.path[h])
    setChart(boxEl, { ...base,
      legend: { show: false },
      tooltip: { ...tooltipStyle, trigger: 'item', formatter: params => {
        if (params.seriesType === 'scatter') return `${params.value[0]}个月<br/>离群值：${number(params.value[1])}个百分点`
        const p = periods[params.dataIndex]
        return p?.box ? `未来${p.horizon}个月 · n=${p.count}<br/>下须：${pp(p.box[0])}<br/>P25：${pp(p.box[1])}<br/>中位数：${pp(p.box[2])}<br/>P75：${pp(p.box[3])}<br/>上须：${pp(p.box[4])}<br/>单位：百分点` : ''
      } },
      xAxis: { ...base.xAxis, data: r.horizons.map(String) },
      yAxis: { ...base.yAxis, name: '偏离变化（百分点）', nameTextStyle: { color: '#829294', fontSize: 10 } },
      series: [
        { name: '偏离变化分布', type: 'boxplot', data: periods.map(p => p.box ? p.box.map(v => v * 100) : '-'),
          itemStyle: { color: '#e5efeb', borderColor: '#287985' },
          markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#b9c3c2' }, data: [{ yAxis: 0 }] },
        },
        { name: '离群值', type: 'scatter', symbolSize: 5, itemStyle: { color: '#b28d54' }, data: periods.flatMap(p => p.outliers.map(v => [String(p.horizon), v * 100])) },
      ],
    })
  }
}
watch(activePage, async page => {
  if (page !== 'research') return
  if (!result.value) await load()
  await nextTick(); draw()
}, { immediate: true })
onBeforeUnmount(() => { observer?.disconnect(); for (const chart of charts.values()) chart.dispose(); charts.clear() })
</script>

<template>
  <div class="dual-anchor">
    <p v-if="isStatic" class="dual-note">此复现暂仅在本地展示。</p>
    <p v-else-if="loading">正在匹配ETF与宏观锚信号…</p>
    <p v-else-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
    <template v-if="result">
      <p class="dual-note">信号样本 {{ result.sample.start }}—{{ result.sample.end }}，共{{ result.sample.count }}个月；次月收益可检验至{{ result.sample.return_end }}，偏离率至{{ result.sample.deviation_end }}。</p>
      <div class="dual-rules">ETF预测收益＞0看涨、＜0看跌；宏观偏离＜P30看涨、＞0看跌，其余中性。方向相同为共振，相反为背离。</div>
      <div class="dual-counts"><span v-for="s in result.state_counts" :key="s.state">{{ s.name }} <strong>{{ s.count }}</strong>个月</span></div>
      <h4>共振：次月黄金收益</h4>
      <div class="dual-table-wrap"><table><thead><tr><th>状态</th><th>月份数</th><th>平均收益</th><th>中位数</th><th>方向命中率</th><th>标准差</th><th>P10</th><th>P90</th></tr></thead>
        <tbody>
          <tr><td>全样本</td><td>{{ result.baseline.stats.count }}</td><td>{{ percent(result.baseline.stats.mean) }}</td><td>{{ percent(result.baseline.stats.median) }}</td><td>{{ percent(result.baseline.stats.hit_rate, 1) }}（上涨）</td><td>{{ percent(result.baseline.stats.std) }}</td><td>{{ percent(result.baseline.stats.p10) }}</td><td>{{ percent(result.baseline.stats.p90) }}</td></tr>
          <tr v-for="g in result.resonance" :key="g.state"><td>{{ g.name }}</td><td>{{ g.stats.count }}</td><td>{{ percent(g.stats.mean) }}</td><td>{{ percent(g.stats.median) }}</td><td>{{ percent(g.stats.hit_rate, 1) }}</td><td>{{ percent(g.stats.std) }}</td><td>{{ percent(g.stats.p10) }}</td><td>{{ percent(g.stats.p90) }}</td></tr>
        </tbody>
      </table></div>
      <p class="dual-note">研报对照：看涨共振69个月，平均+0.84%，命中率56.5%；看跌共振10个月，平均−2.20%，命中率70.0%。看跌命中指次月收益＜0。</p>
      <div class="dual-charts">
        <article><h5>图20：看涨共振后次月收益分布</h5><p>柱形为共振样本频率，虚线为全样本频率。</p><div ref="bullEl" class="dual-chart" data-chart-title="看涨共振次月收益分布" /></article>
        <article><h5>图21：看跌共振后次月收益分布</h5><p>两图采用相同收益区间；横轴为区间中点。</p><div ref="bearEl" class="dual-chart" data-chart-title="看跌共振次月收益分布" /></article>
      </div>
      <article><h5>图22：长短锚共振点标记</h5><p class="dual-note">标记位于信号月份；收益检验使用下一月月均价。</p><div ref="signalsEl" class="dual-chart dual-wide-chart" data-chart-title="长短锚共振点标记" /></article>
      <h4>背离：长期价格位置的后续修复</h4>
      <p class="dual-note">连续同类背离合并为一段，以首月为起点；观察Δd＝dₜ₊ₕ−dₜ，单位为百分点。</p>
      <div class="dual-charts">
        <article><h5>图23：长期看涨、ETF看跌</h5><p>{{ result.divergence[0].month_count }}个月，合并为{{ result.divergence[0].event_count }}段；正变化表示沿长期方向修复。</p><div ref="lowPathEl" class="dual-chart" data-chart-title="长期看涨ETF看跌偏离路径" /></article>
        <article><h5>图24：长期看跌、ETF看涨</h5><p>{{ result.divergence[1].month_count }}个月，合并为{{ result.divergence[1].event_count }}段；负变化表示沿长期方向修复。</p><div ref="highPathEl" class="dual-chart" data-chart-title="长期看跌ETF看涨偏离路径" /></article>
        <article><h5>长期看涨、ETF看跌：多期限分布</h5><div ref="lowBoxEl" class="dual-chart" data-chart-title="长期看涨ETF看跌偏离箱线图" /></article>
        <article><h5>长期看跌、ETF看涨：多期限分布</h5><div ref="highBoxEl" class="dual-chart" data-chart-title="长期看跌ETF看涨偏离箱线图" /></article>
      </div>
      <div class="dual-table-wrap"><table><thead><tr><th>背离状态</th><th>未来期限</th><th>有效段数</th><th>平均变化（百分点）</th><th>中位数（百分点）</th><th>沿长期修复方向</th><th>沿ETF方向</th><th>无变化</th></tr></thead>
        <tbody><template v-for="g in result.divergence" :key="g.state"><tr v-for="h in result.horizons" :key="g.state + h"><td>{{ g.name }}</td><td>{{ h }}个月</td><td>{{ g.path[h].count }}</td><td>{{ pp(g.path[h].mean) }}</td><td>{{ pp(g.path[h].median) }}</td><td>{{ percent(g.path[h].repair_rate, 1) }}</td><td>{{ percent(g.path[h].etf_rate, 1) }}</td><td>{{ percent(g.path[h].unchanged_rate, 1) }}</td></tr></template></tbody>
      </table></div>
      <p class="dual-note">各期限剔除终点缺失的事件；箱体为P25—P75，须线按1.5倍四分位距，圆点为离群值。分段可减少重复计数，但后续窗口仍可能重叠。</p>
      <details class="dual-details"><summary>查看背离事件明细（{{ events.length }}段）</summary>
        <div class="dual-table-wrap"><table><thead><tr><th>状态</th><th>起点</th><th>末月</th><th>持续月数</th><th>起点偏离</th><th v-for="h in result.horizons" :key="h">{{ h }}个月变化（百分点）</th></tr></thead>
          <tbody><tr v-for="e in events" :key="e.state + e.start"><td>{{ e.name }}</td><td>{{ e.start }}</td><td>{{ e.end }}</td><td>{{ e.duration }}</td><td>{{ percent(e.deviation) }}</td><td v-for="h in result.horizons" :key="h">{{ pp(e.changes[String(h)]) }}</td></tr></tbody>
        </table></div>
      </details>
      <p class="dual-note">沿用Wind月均收盘价与原央行口径；模型参数和P30基于全样本。结果为历史条件统计，非可交易策略回测；偏离变化不等于金价收益。</p>
    </template>
  </div>
</template>

<style scoped>
.dual-anchor{color:#425b5f;font-size:12px}.dual-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:14px 0 20px}.dual-summary>div{padding:16px;background:#f5f8f7;border-radius:6px;display:flex;flex-direction:column;gap:8px}.dual-summary span,.dual-summary small{color:#7c8d8e;font-size:11px;line-height:1.6}.dual-summary strong{font-size:24px;font-weight:600;color:#287985}.dual-rules{background:#f7f5ef;border-left:3px solid #aa965e;padding:12px 16px;line-height:1.8}.dual-counts{display:flex;flex-wrap:wrap;gap:10px 20px;margin:18px 0 24px;color:#728486;font-size:11px}.dual-counts strong{color:#425b5f}h4{font-size:15px;font-weight:600;margin:26px 0 12px}h5{font-size:13px;margin:16px 0 8px;font-weight:600}.dual-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:4px 0 14px}.dual-charts article{min-width:0}.dual-charts p,.dual-note{font-size:11px;color:#829294;line-height:1.8}.dual-charts p{margin:0 0 12px}.dual-chart{width:100%;height:300px;min-width:0}.dual-wide-chart{height:350px}.dual-table-wrap{overflow-x:auto;margin:16px 0}table{border-collapse:collapse;width:100%;white-space:nowrap;font-size:11px}th,td{text-align:right;padding:10px 12px;border-bottom:1px solid #e7eeeb}th{font-weight:500;background:#f5f8f7;color:#6c8183}th:first-child,td:first-child{text-align:left}.dual-details{margin:20px 0}.dual-details summary{cursor:pointer;color:#5e7475}@media(max-width:850px){.dual-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.dual-summary strong{font-size:21px}.dual-charts{grid-template-columns:1fr}}
</style>
