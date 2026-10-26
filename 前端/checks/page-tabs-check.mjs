import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const targets = [
  { mode: 'dynamic', url: process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/' },
  { mode: 'static', url: process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/gold-dashboard/' },
]
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const results = []
async function chart(page, title, actions = []) {
  return page.evaluate(async ({ title, actions }) => {
    // 使用应用已加载的同一个 ECharts 实例注册表，不创建替代图表。
    let init
    if (location.port === '5173') init = (await import('/src/charts.js')).echarts.init
    else {
      const core = performance.getEntriesByType('resource').find(r => /chart-core-.*\.js/.test(r.name)).name
      init = Object.values(await import(core)).find(f => typeof f === 'function' && f.toString().includes('afterinit'))
    }
    const instance = init(document.querySelector(`[data-chart-title="${title}"]`))
    for (const action of actions) instance.dispatchAction(action)
    const option = instance.getOption()
    return { id: instance.id, selected: option.legend?.[0]?.selected || {},
      zoom: option.dataZoom?.map(z => [z.start, z.end, z.startValue, z.endValue]),
      dates: option.xAxis?.[0]?.data, series: option.series.map(s => s.name),
    }
  }, { title, actions })
}
async function select(page, name) {
  await page.getByRole('tab', { name, exact: true }).click()
  await page.waitForTimeout(250)
  assert.equal(await page.locator('.page-panel:visible').count(), 1)
  assert.equal(await page.locator('.page-panel:visible').getAttribute('aria-label'), name)
  assert.equal(await page.locator('.page-tabs [aria-selected="true"]').textContent(), name)
}
async function layout(page, name, width) {
  await page.setViewportSize({ width, height: 1000 })
  await select(page, name)
  const status = await page.locator('.page-panel:visible').evaluate(panel => {
    const charts = [...panel.querySelectorAll('.echart')].filter(el => el.querySelector('canvas'))
    return { scrollWidth: document.documentElement.scrollWidth,
      outside: [...panel.querySelectorAll('.chart-panel,.metric-card,.health-table')].filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 }).length,
      charts: charts.map(el => {
        const canvas = el.querySelector('canvas'), rect = el.getBoundingClientRect()
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let ink = 0
        for (let i = 3; i < pixels.length; i += 16) if (pixels[i]) ink++
        return { width: rect.width, height: rect.height, canvasWidth: parseFloat(canvas.style.width), canvasHeight: parseFloat(canvas.style.height), ink }
      }),
    }
  })
  assert.equal(status.scrollWidth, width)
  assert.equal(status.outside, 0)
  if (name !== '数据健康度') assert.ok(status.charts.length > 0)
  for (const c of status.charts) {
    assert.ok(c.width > 200 && c.height > 150)
    assert.ok(Math.abs(c.width - c.canvasWidth) < 2 && Math.abs(c.height - c.canvasHeight) < 2, '切页后画布尺寸应匹配可见容器')
    assert.ok(c.ink > 15, '切页后图表应有实际绘制内容')
  }
}
try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], requests = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('request', r => requests.push(r.url()))
    await page.goto(target.url)
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled && document.querySelectorAll('#comex canvas').length === 2)
    assert.deepEqual(await page.locator('.page-tabs button').allTextContents(), ['国内', '国外', '数据健康度'])
    assert.equal(await page.locator('.page-tabs [aria-selected="true"]').textContent(), '国内')
    assert.equal(await page.locator('.page-panel:visible').count(), 1)
    assert.equal(await page.locator('#positions:visible,#health:visible').count(), 0)
    const domesticTitle = '境内黄金 ETF 分基金资产规模（亿元）'
    await page.locator('#domestic-etf input[type=checkbox]').first().uncheck()
    await page.getByLabel(domesticTitle + '时间区间').selectOption('3M')
    const domesticNames = (await chart(page, domesticTitle)).series
    await chart(page, domesticTitle, [{ type: 'legendUnSelect', name: domesticNames[0] }, { type: 'dataZoom', start: 40, end: 85 }])
    await page.waitForTimeout(250)
    const domesticBefore = await chart(page, domesticTitle)
    const fundsBefore = await page.locator('#domestic-etf input').evaluateAll(inputs => inputs.map(i => i.checked))
    await select(page, '国外')
    await page.getByLabel('SPDR 黄金持仓趋势（吨）时间区间').selectOption('5Y')
    await chart(page, 'SPDR 黄金持仓趋势（吨）', [{ type: 'dataZoom', start: 60, end: 95 }])
    await page.getByLabel('COMEX 金属', { exact: true }).selectOption('silver')
    await page.getByLabel('COMEX 时间范围').selectOption('90')
    await chart(page, 'COMEX 库存结构', [{ type: 'legendUnSelect', name: '合格库存' }, { type: 'dataZoom', start: 30, end: 100 }])
    await page.getByRole('tab', { name: '全球流量 · 月度' }).click()
    await page.getByLabel('全球ETF流量口径').selectOption('usd')
    await page.locator('#global-etf input[type=checkbox]').last().uncheck()
    await page.getByLabel('热力图时间区间').selectOption('ALL')
    await page.waitForTimeout(250)
    const foreignBefore = await chart(page, 'SPDR 黄金持仓趋势（吨）')
    const comexBefore = await chart(page, 'COMEX 库存结构')
    const heatBefore = await chart(page, '月度地区热力图')
    const regionsBefore = await page.locator('#global-etf input').evaluateAll(inputs => inputs.map(i => i.checked))
    await select(page, '数据健康度')
    await page.getByLabel('搜索数据健康度').fill('ETF')
    await page.getByLabel('健康度频率筛选').selectOption('日度')
    await page.locator('.pagination').getByRole('button', { name: '下一页' }).click()
    const healthBefore = await page.locator('.pagination > span').textContent()
    const requestCount = requests.length
    await select(page, '国内')
    assert.deepEqual(await chart(page, domesticTitle), domesticBefore)
    assert.deepEqual(await page.locator('#domestic-etf input').evaluateAll(inputs => inputs.map(i => i.checked)), fundsBefore)
    assert.equal(await page.getByLabel(domesticTitle + '时间区间').inputValue(), '3M')
    await select(page, '国外')
    assert.deepEqual(await chart(page, 'SPDR 黄金持仓趋势（吨）'), foreignBefore)
    assert.deepEqual(await chart(page, 'COMEX 库存结构'), comexBefore)
    assert.deepEqual(await chart(page, '月度地区热力图'), heatBefore)
    assert.equal(await page.getByLabel('COMEX 金属', { exact: true }).inputValue(), 'silver')
    assert.equal(await page.getByLabel('COMEX 时间范围').inputValue(), '90')
    assert.equal(await page.getByLabel('SPDR 黄金持仓趋势（吨）时间区间').inputValue(), '5Y')
    assert.equal(await page.getByLabel('全球ETF流量口径').inputValue(), 'usd')
    assert.equal(await page.getByLabel('热力图时间区间').inputValue(), 'ALL')
    assert.deepEqual(await page.locator('#global-etf input').evaluateAll(inputs => inputs.map(i => i.checked)), regionsBefore)
    await select(page, '数据健康度')
    assert.equal(await page.getByLabel('搜索数据健康度').inputValue(), 'ETF')
    assert.equal(await page.getByLabel('健康度频率筛选').inputValue(), '日度')
    assert.equal(await page.locator('.pagination > span').textContent(), healthBefore)
    assert.equal(requests.length, requestCount, '页面切换不应重新请求数据')
    for (const width of [1280, 1440]) for (const name of ['国内', '国外', '数据健康度']) await layout(page, name, width)
    assert.deepEqual(errors, [])
    if (target.mode === 'static') assert.ok(requests.every(url => new URL(url).pathname.startsWith('/gold-dashboard/') && !/\/api(?:\/|$)/.test(new URL(url).pathname)))
    results.push({ mode: target.mode, retained: ['time-range', 'legend', 'filters', 'zoom', 'chart-instance', 'health-pagination'], layouts: [1280, 1440], errors })
    await page.close()
  }
  console.log(JSON.stringify({ passed: true, results }))
} finally { await browser.close() }
