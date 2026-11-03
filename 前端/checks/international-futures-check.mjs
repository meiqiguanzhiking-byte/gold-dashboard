import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'
import { futuresContinuousSeries } from '../src/international-futures.js'
import { filteredHistory, numeric } from '../src/data.js'

function fixture(expiry, rows) {
  return { metadata: { futures_product: 'comex', contract_expiry: expiry, source_contract: expiry,
    coverage_end: rows.at(-1)?.[0] }, history: rows.map(([observation_date, value]) => ({ observation_date, value })) }
}
// 中途缺报价保留空值；旧约结束后才换约，不能因无候选而永远停止搜索。
const fixtureItems = [
  fixture('2026-01', [['2026-01-01', 10], ['2026-01-03', 12]]),
  fixture('2026-02', [['2026-01-02', 20], ['2026-01-05', 23], ['2026-03-01', 24]]),
  fixture('2026-04', [['2026-01-04', null], ['2026-03-01', 30]]),
]
const fixtureHistory = futuresContinuousSeries(fixtureItems, 'comex', 'ALL')[0].item.history
assert.deepEqual(fixtureHistory.map(p => p.value), [10, null, 12, null, 23, 30])
assert.deepEqual(fixtureHistory.map(p => p.rollover_from), [null, null, null, null, '2026-01', '2026-02'])
assert.equal(fixtureHistory[1].contract_expiry, '2026-01')
assert.equal(fixtureHistory[3].contract_expiry, null)
assert.deepEqual(futuresContinuousSeries([], 'comex'), [])
assert.deepEqual(futuresContinuousSeries([fixture('2026-01', [['2026-02-01', 10]])], 'comex'), [])

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const dynamic = (await (await fetch(new URL('api/price', live))).json()).indicators.filter(item => item.metadata.futures_product)
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const published = expandSnapshot(snapshot).price.indicators.filter(item => item.metadata.futures_product)
assert.ok(dynamic.length > 0)
assert.deepEqual(published.map(item => item.history), dynamic.map(item => item.history))
assert.deepEqual(published.map(item => item.metadata.contract_expiry), dynamic.map(item => item.metadata.contract_expiry))
// 每日最多使用一个合约，所有价格必须来自真实原表报价；换约只能向后。
for (const product of ['comex', 'sgx_usdcnh']) {
  const series = futuresContinuousSeries(dynamic, product, 'ALL')
  assert.equal(series.length, 1)
  const contracts = dynamic.filter(item => item.metadata.futures_product === product)
  const dates = [...new Set(contracts.flatMap(item => item.history.map(p => p.observation_date)))].sort()
  const history = series[0].item.history
  assert.deepEqual(history.map(p => p.observation_date), dates)
  assert.equal(dates.length, 1140)
  let previous = null, rollovers = 0
  for (const point of history) {
    if (!point.contract_expiry) { assert.equal(point.value, null); continue }
    const source = contracts.find(item => item.metadata.contract_expiry === point.contract_expiry && item.metadata.source_contract === point.source_contract)
    assert.ok(source)
    assert.equal(point.value, source.history.find(p => p.observation_date === point.observation_date)?.value ?? null)
    assert.ok(point.observation_date.slice(0, 7) <= point.contract_expiry)
    if (previous && point.contract_expiry !== previous.metadata.contract_expiry) {
      rollovers++
      assert.ok(point.contract_expiry > previous.metadata.contract_expiry)
      const lastDate = previous.history.filter(p => numeric(p) && p.observation_date.slice(0, 7) <= previous.metadata.contract_expiry).at(-1).observation_date
      assert.ok(point.observation_date > lastDate)
      assert.equal(point.rollover_from, previous.metadata.contract_expiry)
    }
    previous = source
  }
  assert.ok(rollovers > 0)
  for (const range of ['1M', '1Y', '5Y']) assert.deepEqual(futuresContinuousSeries(dynamic, product, range)[0].item.history, filteredHistory(series[0].item, range))
  assert.deepEqual(futuresContinuousSeries(published, product, 'ALL')[0].item.history, history)
  console.log(JSON.stringify({ product, dates: dates.length, rollovers, latest: history.at(-1) }))
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const [mode, url, items] of [['dynamic', live, dynamic], ['static', preview, published]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(url)
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    const section = page.locator('#overseas-futures')
    await section.locator('canvas').first().waitFor()
    assert.equal(await section.locator('canvas').count(), 2)
    assert.equal(await section.locator('.section-number').textContent(), '远期')
    const order = await page.locator('#page-panel-foreign > section').evaluateAll(nodes => nodes.map(node => node.id))
    assert.equal(order[order.indexOf('overseas-price') + 1], 'overseas-futures')
    assert.equal(await page.locator('#page-panel-foreign .section-picker').getByLabel('COMEX期货与汇率期货', { exact: true }).isChecked(), true)
    for (const range of ['1Y', 'ALL', '1M']) {
      await page.getByLabel('境外期货时间区间', { exact: true }).selectOption(range)
      await page.waitForTimeout(200)
      for (const [product, title] of [['comex', 'COMEX黄金期货（美元/金衡盎司）'], ['sgx_usdcnh', '美元兑离岸人民币期货（CNH/美元）']]) {
        const expected = futuresContinuousSeries(items, product, range)
        const actual = await page.evaluate(async title => {
          let init
          if (document.querySelector('script[src*="/@vite/client"]')) init = (await import('/src/charts.js')).echarts.init
          else {
            const core = performance.getEntriesByType('resource').find(resource => /chart-core-.*\.js/.test(resource.name)).name
            init = Object.values(await import(core)).find(value => typeof value === 'function' && value.toString().includes('afterinit'))
          }
          const chart = init(document.querySelector(`[data-chart-title="${title}"]`))
          const option = chart.getOption()
          const tooltip = option.tooltip[0].formatter([{ seriesIndex: 0, axisValue: option.xAxis[0].data.at(-1), color: '#ad945b' }])
          return { tooltip, dates: option.xAxis[0].data, series: option.series.map(series => ({ name: series.name, data: series.data, connectNulls: series.connectNulls, markLine: series.markLine?.data })), min: option.yAxis[0].min, max: option.yAxis[0].max }
        }, title)
        assert.equal(actual.series.length, expected.length)
        for (let n = 0; n < expected.length; n++) {
          const points = new Map(expected[n].item.history.map(point => [point.observation_date, point.value]))
          assert.equal(actual.series[n].name, expected[n].name)
          assert.equal(actual.series[n].connectNulls, true)
          assert.deepEqual(actual.series[n].data, actual.dates.map(date => points.get(date) ?? null))
          assert.equal(actual.series[n].markLine, undefined)
          assert.ok(actual.tooltip.includes('到期月份：' + expected[n].item.history.at(-1).contract_expiry))
          assert.ok(actual.tooltip.includes('原表标识：' + expected[n].item.history.at(-1).source_contract))
        }
        const values = actual.series.flatMap(series => series.data).filter(value => value != null)
        assert.ok(actual.min <= Math.min(...values) && actual.max >= Math.max(...values))
      }
    }
    const source = await section.locator('.chart-source').allTextContents()
    assert.deepEqual(source, ['来源：Barchart 官网 → CME 芝商所', '来源：Barchart 官网 → SGX 新加坡交易所'])
    await page.getByLabel('境外期货时间区间', { exact: true }).selectOption('1Y')
    await section.scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
    await section.screenshot({ path: join(tmpdir(), `international-futures-${mode}.png`) })
    await page.getByRole('tab', { name: '数据健康度', exact: true }).click()
    assert.equal(await page.locator('#page-panel-health .section-picker').getByLabel('COMEX期货与汇率期货', { exact: true }).isChecked(), true)
    await page.getByLabel('搜索数据健康度').fill('COMEX黄金与汇率期货.csv')
    assert.equal(await page.locator('.health-table tbody tr:has(td strong)').count(), 1)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ mode, contracts: dynamic.length / 2, passed: true }))
    await page.close()
  }
} finally { await browser.close() }
