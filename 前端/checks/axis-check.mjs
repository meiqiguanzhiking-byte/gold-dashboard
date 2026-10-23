import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { datumNumber, paddedExtent, visibleExtents, axisTick } from '../src/adaptive-axis.js'

// 数值均来自现有真实快照；边界检查仅删减观测或添加无效占位，不创造行情。
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const find = id => Object.values(snapshot.groups).flat().find(item => item.metadata.indicator_id === id)
const constant = find('comex_gold_registered').points.at(-1)[1]
for (const [low, high, zero] of [[constant, constant, false], [0, 0, false], [0, 0, true]]) {
  const r = paddedExtent(low, high, zero)
  assert.ok(Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min)
  assert.ok(r.min <= low && r.max >= high && r.interval > 0)
}
for (const invalid of [null, undefined, NaN, Infinity, '', '0', { value: null }]) assert.equal(datumNumber(invalid), null)
const negative = find('global_etf_weekly_total_tonnes').points.find(p => p[1] < 0)[1]
const edge = visibleExtents([{ name: '真实值与缺失断点', type: 'line', data: [null, 0, negative, NaN, Infinity, constant] }], [[0, 4]])[0]
assert.equal(edge.count, 2)
assert.equal(edge.dataMin, negative)
assert.equal(edge.dataMax, 0)
assert.ok(edge.min < negative && edge.max > 0)
assert.equal(visibleExtents([{ name: '空', type: 'line', data: [null, NaN] }], [[0, 1]])[0].empty, true)
assert.ok(!axisTick(constant, .01).includes('e'))

const base = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = [], consoleErrors = [], layouts = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
async function state(title) {
  return page.evaluate(async title => {
    const { echarts } = await import('/src/charts.js')
    const chart = echarts.getInstanceByDom(document.querySelector(`[data-chart-title="${title}"]`))
    const option = chart.getOption(), zoom = option.dataZoom[0]
    const start = Math.ceil(zoom.startValue), end = Math.floor(zoom.endValue)
    const selected = option.legend[0].selected
    const values = option.series.filter(s => selected[s.name] !== false).flatMap(s => s.data.slice(start, end + 1).map(d => typeof d === 'number' ? d : typeof d?.value === 'number' ? d.value : null)).filter(v => typeof v === 'number' && Number.isFinite(v))
    const modelAxis = chart.getModel().getComponent('yAxis', 0).axis
    return { title, start, end, dates: [option.xAxis[0].data[start], option.xAxis[0].data[end]],
      min: option.yAxis[0].min, max: option.yAxis[0].max, interval: option.yAxis[0].interval,
      actual: modelAxis.scale.getExtent(), dataMin: Math.min(...values), dataMax: Math.max(...values),
      label: option.yAxis[0].axisLabel, labels: modelAxis.getViewLabels().map(l => ({ text: l.formattedLabel, pixel: modelAxis.dataToCoord(l.tickValue ?? l.tick?.value) })),
      selected, types: option.series.map(s => s.type), animation: option.animationDurationUpdate,
    }
  }, title)
}
async function action(title, payload) {
  await page.evaluate(async ({ title, payload }) => {
    const { echarts } = await import('/src/charts.js')
    echarts.getInstanceByDom(document.querySelector(`[data-chart-title="${title}"]`)).dispatchAction(payload)
  }, { title, payload })
  await page.waitForTimeout(250)
  return state(title)
}
function assertAdaptive(s) {
  assert.deepEqual(s.actual, [s.min, s.max], '实际 ECharts 坐标范围必须等于重算范围')
  assert.ok(s.min < s.max && s.min <= s.dataMin && s.max >= s.dataMax)
  const span = s.dataMax - s.dataMin
  if (span > 0) {
    assert.ok(s.dataMin - s.min >= span * .099, '下方应有约10%留白')
    assert.ok(s.max - s.dataMax >= span * .099, '上方应有约10%留白')
    assert.ok(s.max - s.min <= span * 1.5, '范围不得被缩放区间外极值撑大')
  }
  assert.ok(s.label.show && s.label.hideOverlap === false)
  assert.ok(s.labels.length >= 3 && s.labels.length <= 8)
  assert.ok(new Set(s.labels.map(l => l.text)).size === s.labels.length, '刻度不能因过早取整变成重复数字')
  for (let i = 1; i < s.labels.length; i++) assert.ok(s.labels[i].pixel - s.labels[i - 1].pixel > 14, '纵轴标签不能挤在一起')
}
const spdr = 'SPDR 黄金持仓趋势（吨）', funds = '境内黄金 ETF 分基金资产规模（亿元）'
try {
  await page.goto(base)
  await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled && document.querySelectorAll('#comex canvas').length === 2)
  const initial = await state(spdr)
  assertAdaptive(initial)
  assert.ok(initial.min > 0)
  const narrow = await action(spdr, { type: 'dataZoom', start: 80, end: 100 })
  assertAdaptive(narrow)
  assert.ok(narrow.max - narrow.min < initial.max - initial.min)
  assert.ok(narrow.max < initial.dataMax, '窗口外极值必须被排除')
  const byDate = await action(spdr, { type: 'dataZoom', startValue: narrow.dates[0], endValue: narrow.dates[1] })
  assert.deepEqual([byDate.min, byDate.max], [narrow.min, narrow.max])
  const reset = await action(spdr, { type: 'dataZoom', start: 0, end: 100 })
  assert.deepEqual([reset.min, reset.max], [initial.min, initial.max])

  // 实际拖动滑块右手柄，确保鼠标事件和 dispatchAction 的行为一致。
  const chartEl = page.locator(`[data-chart-title="${spdr}"]`)
  await chartEl.scrollIntoViewIfNeeded()
  const geometry = await chartEl.boundingBox()
  const slider = await page.evaluate(async title => {
    const { echarts } = await import('/src/charts.js')
    const c = echarts.getInstanceByDom(document.querySelector(`[data-chart-title="${title}"]`))
    const z = c.getModel().getComponent('dataZoom', 1), v = c.getViewOfComponentModel(z)
    const handle = v._displayables.handles[1], r = handle.getBoundingRect().clone();r.applyTransform(handle.transform)
    return { x: v._location.x, y: v._location.y, width: v._size[0], height: v._size[1], handleX: r.x + r.width / 2, handleY: r.y + r.height / 2 }
  }, spdr)
  await page.mouse.move(geometry.x + slider.handleX, geometry.y + slider.handleY)
  await page.mouse.down()
  await page.mouse.move(geometry.x + slider.x + slider.width * .55, geometry.y + slider.y + slider.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(350)
  const dragged = await state(spdr)
  assert.ok(dragged.end < initial.end)
  assertAdaptive(dragged)
  await page.getByLabel(spdr + '重置缩放').click()
  await page.waitForTimeout(250)
  assert.deepEqual([(await state(spdr)).min, (await state(spdr)).max], [initial.min, initial.max])
  await page.mouse.move(geometry.x + geometry.width * .5, geometry.y + 125)
  await page.mouse.wheel(0, -450)
  await page.waitForTimeout(350)
  const wheeled = await state(spdr)
  assert.ok(wheeled.end - wheeled.start < initial.end - initial.start)
  assertAdaptive(wheeled)
  await page.getByLabel(spdr + '时间区间').selectOption('ALL')
  const all = await state(spdr)
  assertAdaptive(all)
  assert.ok(all.max - all.min > initial.max - initial.min)
  await page.getByLabel(spdr + '时间区间').selectOption('1M')
  const month = await state(spdr)
  assertAdaptive(month)
  assert.ok(month.max - month.min < all.max - all.min)
  await page.getByLabel(spdr + '时间区间').selectOption('1Y')

  const fullFund = await state(funds)
  const names = await page.evaluate(async title => {
    const { echarts } = await import('/src/charts.js')
    const c = echarts.getInstanceByDom(document.querySelector(`[data-chart-title="${title}"]`))
    return c.getOption().series.map(s => ({ name: s.name, max: Math.max(...s.data.filter(v => typeof v === 'number')) })).sort((a, b) => a.max - b.max).map(s => s.name)
  }, funds)
  for (const name of names.slice(1)) await action(funds, { type: 'legendUnSelect', name })
  const oneFund = await state(funds)
  assertAdaptive(oneFund)
  assert.ok(oneFund.max < fullFund.max / 2)
  const enabled = await action(funds, { type: 'legendToggleSelect', name: names.at(-1) })
  assertAdaptive(enabled)
  assert.ok(enabled.max > oneFund.max)
  for (const name of names) await action(funds, { type: 'legendSelect', name })
  assert.deepEqual([(await state(funds)).min, (await state(funds)).max], [fullFund.min, fullFund.max])

  for (const title of ['央行黄金储备（吨，机构未确认）', '境内黄金 ETF 总资产规模（亿元）', 'CFTC 非商业净多头持仓（吨）', '伦敦黄金库存趋势（吨）', '伦敦白银库存趋势（吨）']) {
    assertAdaptive(await state(title))
    assertAdaptive(await action(title, { type: 'dataZoom', start: 50, end: 100 }))
    await action(title, { type: 'dataZoom', start: 0, end: 100 })
  }
  const combined = '黄金期货成交量与持仓量（吨）'
  assert.equal((await state(combined)).min, 0)
  assert.equal((await action(combined, { type: 'dataZoom', start: 85, end: 100 })).min, 0)
  assert.equal((await action(combined, { type: 'legendUnSelect', name: '成交量（吨）' })).min, 0)
  await action(combined, { type: 'legendSelect', name: '成交量（吨）' })
  await action(combined, { type: 'dataZoom', start: 0, end: 100 })
  const structure = 'COMEX 库存结构', index = 'COMEX 库存相对变化'
  const indexBefore = await state(index)
  assertAdaptive(indexBefore)
  assert.equal((await state(structure)).min, 0)
  await action(structure, { type: 'legendUnSelect', name: '合格库存' })
  await action(structure, { type: 'legendUnSelect', name: '总库存（原表）' })
  assert.equal((await state(structure)).min, 0, '堆叠面积轴隐藏其他序列后仍保留零基线')
  await action(structure, { type: 'dataZoom', start: 60, end: 100 })
  assert.equal((await state(structure)).min, 0)
  const linkedIndex = await state(index)
  assertAdaptive(linkedIndex)
  assert.equal(linkedIndex.start, (await state(structure)).start)
  assert.equal(linkedIndex.end, (await state(structure)).end)
  await page.getByLabel('COMEX 重置缩放').click()
  await page.waitForTimeout(250)
  await action(structure, { type: 'legendSelect', name: '合格库存' })
  await action(structure, { type: 'legendSelect', name: '总库存（原表）' })
  await page.getByLabel('COMEX 金属', { exact: true }).selectOption('silver')
  assert.equal((await state(structure)).min, 0)
  assert.equal((await action(structure, { type: 'dataZoom', start: 60, end: 100 })).min, 0)
  await page.getByLabel('COMEX 金属', { exact: true }).selectOption('gold')

  // 内存中用真实 SPDR 吨数和 ETF 亿元序列验证两个独立轴；不写数据或截图。
  const dual = await page.evaluate(async () => {
    const { echarts } = await import('/src/charts.js')
    const { adaptiveYAxis, timeZoom } = await import('/src/adaptive-axis.js')
    const { indicators } = await (await fetch('/api/etf')).json()
    const raw = ['spdr_gold_holdings', 'domestic_etf_total_assets'].map(id => indicators.find(i => i.metadata.indicator_id === id))
    const dates = raw[0].history.slice(-100).map(p => p.observation_date)
    const series = raw.map((item, yAxisIndex) => ({ name: item.metadata.indicator_name, yAxisIndex, type: 'line', data: dates.map(date => item.history.find(p => p.observation_date === date)?.value ?? null) }))
    const el = document.createElement('div'); el.style.cssText = 'width:800px;height:350px';document.body.appendChild(el)
    const c = echarts.init(el); c.setOption({ animation: false, xAxis: { type: 'category', data: dates }, yAxis: [{ type: 'value', name: '吨' }, { type: 'value', name: '亿元' }], legend: {}, dataZoom: timeZoom(), series })
    const controller = adaptiveYAxis(c);controller.reset({ dates, series, axisCount: 2 })
    c.dispatchAction({ type: 'dataZoom', start: 70, end: 100 });await new Promise(r => setTimeout(r,200))
    const result = c.getOption().yAxis.map((axis, i) => ({ min: axis.min, max: axis.max, raw: series[i].data.slice(69).filter(v => typeof v === 'number') }))
    controller.dispose();c.dispose();el.remove();return result
  })
  for (const axis of dual) assert.ok(axis.min <= Math.min(...axis.raw) && axis.max >= Math.max(...axis.raw))
  assert.ok(dual[0].max < dual[1].min, '不同单位的双轴不得混用极值')
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });await page.waitForTimeout(150)
    const bounds = await page.evaluate(async () => {
      const { echarts } = await import('/src/charts.js')
      const labels = [...document.querySelectorAll('.echart')].flatMap(el => {
        const c = echarts.getInstanceByDom(el);if(!c?.getOption().series.some(s => s.type === 'line'))return []
        return c.getZr().storage.getDisplayList().filter(d => d.type === 'tspan' && d.style?.fill === '#849092').map(d => {
          const r = d.getBoundingRect().clone();r.applyTransform(d.transform);return { text: d.style.text, clipped: r.x < -1 || r.x+r.width > c.getWidth()+1 || r.y < -1 || r.y+r.height > c.getHeight()+1 }
        })
      })
      return { overflow: document.documentElement.scrollWidth > innerWidth, clipped: labels.filter(l => l.clipped) }
    })
    assert.equal(bounds.overflow, false)
    assert.deepEqual(bounds.clipped, [])
    layouts.push(width)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(consoleErrors, [])
  console.log(JSON.stringify({ passed: true, actualRanges: { initial: [initial.min, initial.max], zoomed: [narrow.min, narrow.max], hiddenFunds: [oneFund.min, oneFund.max] }, layouts,
    verified: ['visible-data-padding', 'real-slider-drag', 'real-wheel-zoom', 'date-value-zoom', 'period-switch-and-reset', 'legend-union-and-restore', 'dual-axis-unit-isolation', 'bar-zero-baseline', 'stacked-inventory-zero-baseline', 'comex-linked-zoom', 'missing-zero-negative-and-constant', 'labels-not-clipped', 'no-browser-errors'] }))
} finally { await browser.close() }
