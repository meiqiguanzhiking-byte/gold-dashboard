// 使用现有真实服务，验证首屏懒加载、状态保留及隐藏资讯停止轮询；不写文件。
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.GOLD_DASHBOARD_URL || 'http://127.0.0.1:5173/'
const staticMode = process.env.GOLD_STATIC_CHECK === '1'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const requests = [], errors = []
page.on('request', request => requests.push(request.url()))
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  window.__longTasks = []
  new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(entry => entry.duration)))
    .observe({ type: 'longtask', buffered: true })
})
const ready = () => page.waitForFunction(() => document.querySelectorAll('.daily-card').length === 25
  && !document.querySelector('.refresh-button')?.disabled)
const chartState = () => page.evaluate(async () => {
  const element = document.querySelector('#gold-price .echart')
  const chart = element?.__performanceChart
  return { id: element?.getAttribute('_echarts_instance_'),
    zoom: chart?.getOption().dataZoom[0].start, legend: chart?.getOption().legend[0].selected }
})
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await ready()
  await page.waitForTimeout(400)
  const initial = await page.evaluate(() => ({ charts: document.querySelectorAll('[_echarts_instance_]').length,
    dom: document.querySelectorAll('*').length, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    maxTaskMs: Math.round(Math.max(0, ...window.__longTasks)) }))
  assert.ok(initial.charts <= 1, '首屏只能初始化可见的期限结构图')
  assert.equal(await page.locator('#page-panel-domestic .chart-panel').count(), 0)
  assert.ok(!requests.some(url => /\/api\/(price|etf|futures|au-td|cftc|inventory|central-bank)$/.test(url)))
  if (staticMode) assert.ok(!requests.some(url => url.includes('/data/')), '静态首屏复用嵌入索引')
  else {
    const response = page.waitForResponse(result => result.url().endsWith('/api/daily-news'))
    await page.locator('.daily-options button').filter({ hasText: '每日资讯' }).click()
    await response
    await page.locator('#page-tab-weekly').click()
    const count = requests.filter(url => url.endsWith('/api/daily-news')).length
    await page.waitForTimeout(16000)
    assert.equal(requests.filter(url => url.endsWith('/api/daily-news')).length, count, '隐藏资讯停止轮询')
  }
  await page.locator('#page-tab-domestic').click()
  await ready()
  await page.locator('#gold-price canvas').first().waitFor()
  const panel = page.locator('#gold-price .chart-panel').first()
  await panel.locator('select').selectOption('3M')
  await page.waitForTimeout(300)
  // 开发版核验图例与缩放；生产静态版核验实例及区间保持。
  if (!staticMode) await page.evaluate(() => {
    const element = document.querySelector('#gold-price .echart')
    const setup = element.closest('.chart-panel').__vueParentComponent.setupState
    const chart = setup.echarts.getInstanceByDom(element)
    element.__performanceChart = chart
    chart.dispatchAction({ type: 'dataZoom', start: 35, end: 85 })
    chart.dispatchAction({ type: 'legendUnSelect', name: chart.getOption().series[0].name })
  })
  const before = await chartState()
  await page.locator('#page-tab-weekly').click()
  await page.locator('#page-tab-domestic').click()
  await page.waitForTimeout(300)
  assert.deepEqual(await chartState(), before)
  assert.equal(await panel.locator('select').inputValue(), '3M')
  if (staticMode) assert.ok(!requests.some(url => url.includes('/api/')))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, staticMode, initial, statePreserved: true, errors }))
} finally { await browser.close() }
