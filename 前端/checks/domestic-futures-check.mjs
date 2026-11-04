import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'
import { filteredHistory } from '../src/data.js'

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const ids = ['gold_futures_close', 'gold_futures_spread', 'gold_futures_secondary_spread', 'gold_futures_contract', 'gold_futures_spread_details']
const titles = ['黄金期货（元/克）', '黄金期货价差（元/克）']
const api = await (await fetch(new URL('api/price', live))).json()
const items = ids.map(id => api.indicators.find(item => item.metadata.indicator_id === id))
assert.ok(items.every(Boolean))
const snapshot = expandSnapshot(JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8')))
items.forEach(item => assert.deepEqual(snapshot.price.indicators.find(i => i.metadata.indicator_id === item.metadata.indicator_id).history, item.history))

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const results = []
try {
  for (const [mode, target] of [['dynamic', live], ['static', preview]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], blocked = []
    page.on('pageerror', error => errors.push(error.message))
    if (mode === 'static') await page.route('**/*', route => {
      const url = new URL(route.request().url()), base = new URL(target)
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || /\/api(?:\/|$)/.test(url.pathname)) {
        blocked.push(url.href)
        return route.abort()
      }
      return route.continue()
    })
    await page.goto(target)
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('#domestic-futures canvas').length === 2)
    const section = page.locator('#domestic-futures')
    assert.deepEqual(await section.locator('h3').allTextContents(), titles)
    assert.equal(await section.locator('.section-number').textContent(), '远期')
    const order = await page.locator('#page-panel-domestic > .section').evaluateAll(nodes => nodes.map(n => n.id))
    assert.equal(order[order.indexOf('gold-price') + 1], 'domestic-futures')
    assert.equal(order[order.indexOf('domestic-futures') + 1], 'gold-volatility')
    for (const range of ['1M', '1Y', 'ALL']) {
      for (const title of titles) await page.getByLabel(title + '时间区间', { exact: true }).selectOption(range)
      if (mode === 'dynamic') {
        await page.waitForFunction(expected => {
          const panel = document.querySelector('#domestic-futures .chart-panel')
          return panel?.textContent.includes(expected)
        }, filteredHistory(items[0], range)[0].observation_date)
        const charts = await page.evaluate(async titles => {
          const { echarts } = await import('/src/charts.js')
          return titles.map(title => {
            const chart = echarts.getInstanceByDom(document.querySelector(`[data-chart-title="${title}"]`)), o = chart.getOption()
            const date = o.xAxis[0].data.at(-1)
            return { dates: o.xAxis[0].data, unit: o.yAxis[0].name,
              series: o.series.map(s => ({ name: s.name, data: s.data, connectNulls: s.connectNulls })),
              tooltip: o.tooltip[0].formatter(o.series.map((s, seriesIndex) => ({ seriesIndex, axisValue: date, color: s.itemStyle.color }))) }
          })
        }, titles)
        for (const [index, chart] of charts.entries()) {
          const expected = filteredHistory(items[index], range)
          assert.deepEqual(chart.dates, expected.map(p => p.observation_date))
          assert.deepEqual(chart.series[0].data, expected.map(p => p.value))
          assert.equal(chart.unit, '元/克')
          const detail = items[index === 0 ? 3 : 4].history.find(point => point.observation_date === chart.dates.at(-1))?.value
          assert.ok(chart.tooltip.includes(detail || '当日无可用偶数月主力合约报价'))
          if (index === 1) {
            assert.deepEqual(chart.series.map(s => s.name), ['主力合约价差', '次主力合约价差'])
            assert.ok(chart.series.every(s => s.connectNulls === true))
            assert.deepEqual(chart.series[1].data, filteredHistory(items[2], range).map(p => p.value))
          }
        }
      }
    }
    const picker = page.getByRole('group', { name: '国内显示版块', exact: true })
    await picker.getByLabel('黄金期货与价差', { exact: true }).uncheck()
    assert.equal(await section.isVisible(), false)
    assert.equal(await page.locator('#gold-price').isVisible(), true)
    await picker.getByLabel('黄金期货与价差', { exact: true }).check()
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    for (const title of titles) assert.equal(await page.getByLabel(title + '时间区间', { exact: true }).inputValue(), 'ALL')
    for (const width of [1440, 1280, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.waitForTimeout(250)
      const geometry = await section.locator('.chart-panel').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, right: r.right }
      }))
      assert.ok(geometry.every(r => r.x >= 0 && r.right <= width))
      if (width > 760) assert.ok(Math.abs(geometry[0].y - geometry[1].y) < 1 && geometry[1].x > geometry[0].x)
      assert.ok(await section.locator('canvas').evaluateAll(nodes => nodes.every(canvas => canvas.width > 0 && canvas.height > 0)))
    }
    await page.getByRole('tab', { name: '数据健康度', exact: true }).click()
    const healthPicker = page.getByRole('group', { name: '数据健康度显示版块', exact: true })
    await healthPicker.getByRole('button', { name: '清空', exact: true }).click()
    await healthPicker.getByLabel('黄金期货与价差', { exact: true }).check()
    assert.equal(await page.locator('.health-table tbody tr strong').count(), 5)
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
    results.push({ mode, ranges: ['1M', '1Y', 'ALL'], widths: [1440, 1280, 390] })
    await page.close()
  }
  console.log(JSON.stringify({ passed: true, observations: items[0].history.length,
    validSpreads: [items[1].metadata.valid_count, items[2].metadata.valid_count], results }))
} finally { await browser.close() }
