import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const ids = ['ust_10y_yield', 'ust_2y_yield', 'ust_10y_2y_spread', 'ust_10y_real_yield', 'ust_10y_breakeven_inflation']
const names = {
  ust_10y_yield: '10年美债收益率',
  ust_2y_yield: '2年美债收益率',
  ust_10y_2y_spread: '10年－2年期限利差',
  ust_10y_real_yield: '10年实际利率',
  ust_10y_breakeven_inflation: '10年盈亏平衡通胀率（BEI）',
}
const dynamic = await (await fetch(new URL('api/price', live))).json()
const dynamicItems = Object.fromEntries(dynamic.indicators.map(item => [item.metadata.indicator_id, item]))
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const publishedItems = Object.fromEntries(expandSnapshot(snapshot).price.indicators.map(item => [item.metadata.indicator_id, item]))
assert.ok(ids.every(id => dynamicItems[id] && publishedItems[id]))
for (const id of ids) {
  assert.equal(dynamicItems[id].metadata.source, '美债收益率.xlsx')
  assert.equal(dynamicItems[id].metadata.frequency, '日度')
  assert.equal(dynamicItems[id].metadata.source_reference, `https://fred.stlouisfed.org/series/${dynamicItems[id].metadata.series_id}`)
  assert.deepEqual(publishedItems[id].history, dynamicItems[id].history)
}
assert.equal(dynamicItems.ust_10y_yield.latest.observation_date, '2026-10-29')
assert.equal(dynamicItems.ust_10y_yield.latest.value, 4.98)
assert.equal(dynamicItems.ust_10y_2y_spread.latest.value, 0.37)

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
try {
  for (const [mode, url, sourceItems] of [['dynamic', live, dynamicItems], ['static', preview, publishedItems]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], requests = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', request => requests.push(request.url()))
    await page.addInitScript(() => localStorage.setItem('gold-dashboard:health-modules:v1', JSON.stringify(['overview'])))
    await page.goto(url)
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    const section = page.locator('#treasury-yields')
    await section.locator('canvas').first().waitFor()
    const sectionIds = await page.locator('#page-panel-foreign > section').evaluateAll(nodes => nodes.map(node => node.id))
    assert.equal(sectionIds[3], 'treasury-yields')
    assert.equal(await section.locator('.section-number').textContent(), '06')
    assert.equal(await page.locator('#positions .section-number').textContent(), '07')
    assert.equal(await page.locator('#global-etf .section-number').textContent(), '11')
    assert.equal(await page.locator('#global-central-bank .section-number').textContent(), '12')
    assert.equal(await page.locator('#comex-delivery .section-number').textContent(), '13')
    assert.deepEqual(await section.locator('.chart-panel').evaluateAll(nodes => nodes.map(node => node.querySelector('h3').textContent)), [
      '美债收益率与期限利差（%）', '10年美债收益率、实际利率与盈亏平衡通胀率（%）',
    ])
    assert.ok((await section.textContent()).includes('来源：FRED 美联储经济数据网站'))
    const picker = page.locator('#page-panel-foreign .section-picker')
    assert.equal(await picker.getByLabel('美债收益率', { exact: true }).isChecked(), true)

    for (const chartTitle of ['美债收益率与期限利差（%）', '10年美债收益率、实际利率与盈亏平衡通胀率（%）']) {
      const chart = page.locator(`[data-chart-title="${chartTitle}"]`)
      await chart.locator('canvas').waitFor()
      await page.getByLabel(chartTitle + '时间区间').selectOption('ALL')
      await page.waitForTimeout(150)
      const result = await page.evaluate(async chartTitle => {
        let init
        if (document.querySelector('script[src*="/@vite/client"]')) init = (await import('/src/charts.js')).echarts.init
        else {
          const core = performance.getEntriesByType('resource').find(resource => /chart-core-.*\.js/.test(resource.name)).name
          init = Object.values(await import(core)).find(value => typeof value === 'function' && value.toString().includes('afterinit'))
        }
        const option = init(document.querySelector(`[data-chart-title="${chartTitle}"]`)).getOption()
        return { dates: option.xAxis[0].data, series: option.series.map(series => ({ name: series.name, data: series.data, connectNulls: series.connectNulls })) }
      }, chartTitle)
      const expectedIds = chartTitle.startsWith('美债收益率与') ? ids.slice(0, 3) : [ids[0], ids[3], ids[4]]
      assert.equal(result.series.length, 3)
      assert.ok(result.series.every(series => series.connectNulls))
      assert.equal(result.dates.length, sourceItems[expectedIds[0]].history.length)
      assert.deepEqual(result.series.map(series => series.name), expectedIds.map(id => names[id]))
      for (let index = 0; index < expectedIds.length; index++) {
        const expected = new Map(sourceItems[expectedIds[index]].history.map(point => [point.observation_date, point.value]))
        result.dates.forEach((date, pointIndex) => assert.equal(result.series[index].data[pointIndex], expected.get(date)))
      }
      await page.getByLabel(chartTitle + '时间区间').selectOption('1Y')
    }
    await page.getByRole('tab', { name: '数据健康度', exact: true }).click()
    assert.equal(await page.locator('#page-panel-health .section-picker').getByLabel('美债收益率', { exact: true }).isChecked(), true)
    await page.getByLabel('搜索数据健康度').fill('美债收益率.xlsx')
    assert.equal(await page.locator('.health-table tbody tr:has(td strong)').count(), 5)
    assert.deepEqual(errors, [])
    if (mode === 'static') assert.ok(requests.every(request => new URL(request).pathname.startsWith(new URL(preview).pathname) && !/\/api(?:\/|$)/.test(new URL(request).pathname)))
    console.log(JSON.stringify({ mode, history: dynamicItems.ust_10y_yield.history.length, latest: dynamicItems.ust_10y_yield.latest, passed: true }))
    await page.close()
  }
} finally { await browser.close() }
