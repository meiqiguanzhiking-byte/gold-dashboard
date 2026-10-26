import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/gold-dashboard/'
const api = await (await fetch(new URL('api/price', live))).json()
const ids = ['gold_price_anchor', 'gold_hv20', 'gold_hv60']
const items = ids.map(id => api.indicators.find(item => item.metadata.indicator_id === id))
assert.ok(items.every(Boolean))
// 只在内存中验证适配一致性；未获准公开的源数值绝不写入静态文件。
const expanded = expandSnapshot({ schema_version: 1, generated_at: api.loaded_at, files: [], groups: {
  price: items.map(item => ({ metadata: item.metadata, notes: item.warnings, points: item.history.map(p => [p.observation_date, p.value]) })),
} })
for (let index = 0; index < items.length; index++) {
  assert.deepEqual(expanded.price.indicators[index].history, items[index].history)
  assert.equal(expanded.price.indicators[index].latest.value, items[index].latest.value)
  assert.equal(expanded.price.indicators[index].latest.change, items[index].latest.change)
  assert.equal(expanded.price.indicators[index].latest.change_pct, items[index].latest.change_pct)
}
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const policy = JSON.parse(await readFile(new URL('../../展示版/公开范围.json', import.meta.url), 'utf8'))
const published = expandSnapshot(snapshot).price.indicators
for (const item of snapshot.groups.price) {
  if (item.metadata.publication_withheld) {
    assert.equal(item.points.length, 0)
    assert.equal(item.metadata.valid_count, 0)
  } else {
    assert.ok((item.metadata.input_sources || [item.metadata.source]).every(source => policy.source_permissions[source] === 'approved' && !policy.withheld_sources.includes(source)))
  }
}
const expectedCharts = [['gold_price_anchor'], ['gold_hv20', 'gold_hv60'], ['gold_domestic_spread']].filter(group => group.some(id => published.find(i => i.metadata.indicator_id === id)?.history.filter(p => p.value != null).length > 1)).length
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const errors = [], layouts = [], blocked = []
async function ready(page) {
  await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled && document.querySelectorAll('#comex canvas').length === 2)
}
async function layout(page, mode) {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(180)
    const status = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
      clipped: [...document.querySelectorAll('#overview h3,#gold-price h3,.volatility-value,.metric-change')].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.textContent),
      outside: [...document.querySelectorAll('#overview .metric-card,#gold-price .chart-panel,.section-nav')].filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 }).map(el => el.className),
    }))
    assert.equal(status.width, width)
    assert.deepEqual(status.clipped, [])
    assert.deepEqual(status.outside, [])
    layouts.push({ mode, width })
  }
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(live)
  await ready(page)
  const priceCard = page.locator('#overview .metric-card').filter({ has: page.getByRole('heading', { name: '上金所Au99.99收盘价', exact: true }) })
  assert.ok((await priceCard.locator('.metric-number').textContent()).includes(items[0].latest.value.toLocaleString('zh-CN')))
  const changeText = await priceCard.locator('.metric-change').textContent()
  assert.ok(changeText.includes('元/克') && changeText.includes('%'))
  for (let i = 0; i < 2; i++) {
    const row = page.locator('.volatility-row').nth(i)
    assert.ok((await row.locator('strong').textContent()).includes(items[i + 1].latest.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '%'))
    assert.ok((await row.locator('.metric-change').textContent()).includes('个百分点'))
    assert.ok(!(await row.locator('.metric-change').textContent()).includes('%'))
  }
  assert.equal(await page.locator('#gold-price canvas').count(), 3)
  assert.ok((await page.locator('#gold-price').textContent()).includes('样本标准差（ddof=1）'))
  const sectionOrder = await page.locator('main section.section').evaluateAll(sections => sections.map(el => el.id))
  assert.ok(sectionOrder.indexOf('gold-price') < sectionOrder.indexOf('central-bank'))
  const title = '20日与60日年化历史波动率（%）'
  const readChart = () => page.evaluate(async title => {
    const { echarts } = await import('/src/charts.js')
    const chart = echarts.getInstanceByDom(document.querySelector(`[data-chart-title="${title}"]`)), o = chart.getOption()
    return { dates: o.xAxis[0].data, unit: o.yAxis[0].name, series: o.series.map(s => ({ name: s.name, data: s.data, smooth: s.smooth, connectNulls: s.connectNulls })) }
  }, title)
  for (const range of ['1M', '3M', '1Y', '5Y', 'ALL']) {
    await page.getByLabel(title + '时间区间').selectOption(range)
    await page.waitForTimeout(100)
    const chart = await readChart()
    assert.equal(chart.unit, '%')
    for (let i = 0; i < 2; i++) {
      assert.equal(chart.series[i].smooth, false)
      assert.equal(chart.series[i].connectNulls, false)
      const points = new Map(items[i + 1].history.map(p => [p.observation_date, p.value]))
      chart.dates.forEach((date, index) => assert.equal(chart.series[i].data[index], points.get(date)))
    }
    if (range === 'ALL') assert.ok(chart.series.every(s => s.data.slice(0, 20).every(v => v === null)))
  }
  const interaction = await page.evaluate(async title => {
    const { echarts } = await import('/src/charts.js')
    const chart = echarts.getInstanceByDom(document.querySelector(`[data-chart-title="${title}"]`)), o = chart.getOption()
    const last = o.xAxis[0].data.at(-1)
    const tooltip = o.tooltip[0].formatter(o.series.map((s, seriesIndex) => ({ seriesIndex, axisValue: last, color: s.itemStyle.color })))
    chart.dispatchAction({ type: 'legendUnSelect', name: o.series[1].name })
    const hidden = chart.getOption().legend[0].selected[o.series[1].name] === false
    chart.dispatchAction({ type: 'legendSelect', name: o.series[1].name })
    return { tooltip, hidden }
  }, title)
  assert.ok(interaction.hidden && interaction.tooltip.includes('%') && interaction.tooltip.includes(items[0].latest.observation_date))
  await page.getByRole('tab', { name: '数据健康度' }).click()
  await page.getByLabel('搜索数据健康度').fill('黄金现货价格.xlsx')
  assert.equal(await page.locator('.health-table tbody tr:has(td strong)').count(), 3)
  await layout(page, 'dynamic')
  await page.getByRole('button', { name: '刷新真实数据' }).click()
  await ready(page)
  assert.equal(await page.locator('#gold-price canvas').count(), 3)
  for (const id of ['central-bank', 'au-td', 'futures', 'domestic-etf', 'positions', 'spdr', 'comex']) assert.ok(await page.locator('#' + id + ' canvas').count() > 0)
  const staticPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  staticPage.on('pageerror', error => errors.push(error.message))
  staticPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const target = new URL(preview)
  await staticPage.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== target.origin || !url.pathname.startsWith(target.pathname) || /\/api(?:\/|$)/.test(url.pathname)) { blocked.push(url.href); return route.abort() }
    return route.continue()
  })
  await staticPage.goto(preview)
  await ready(staticPage)
  assert.equal(await staticPage.locator('#gold-price canvas').count(), expectedCharts)
  assert.equal(await staticPage.locator('#gold-price .empty-state').count(), 3 - expectedCharts)
  if (expectedCharts === 0) {
    assert.ok((await staticPage.locator('#gold-price').textContent()).includes('公开使用尚未确认'))
    assert.ok((await staticPage.locator('.volatility-card').textContent()).includes('数据暂缺'))
  } else {
    const price = published.find(i => i.metadata.indicator_id === 'gold_price_anchor')
    assert.ok((await staticPage.locator('#overview .metric-card').first().textContent()).includes(price.latest.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })))
  }
  assert.ok((await staticPage.locator('.data-summary').textContent()).includes('快照生成'))
  await layout(staticPage, 'static')
  await staticPage.getByRole('button', { name: '重新加载展示数据' }).click()
  await ready(staticPage)
  assert.equal(await staticPage.locator('#gold-price canvas').count(), expectedCharts)
  assert.deepEqual(blocked, [])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, latest: items[0].latest.observation_date, observations: items[0].history.length, layouts,
    verified: ['source-units-and-period-changes', 'upstream-values-unchanged-for-five-ranges', 'legend-and-tooltip', 'health-and-refresh', 'dynamic-and-static-adapter-parity-in-memory', 'unapproved-values-not-exported', 'subpath-without-api', 'no-browser-errors'] }))
} finally { await browser.close() }
