import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { openInterestMainSeries } from '../src/open-interest-continuous.js'
import { mainContractBasisHistory } from '../src/futures-basis-history.js'

const point = (date, quotes) => ({ observation_date: date, value: JSON.stringify({ quotes }) })
const quote = (contract, close, open_interest) => ({ contract, expiry: '20' + contract.slice(2, 4) + '-' + contract.slice(4), close, open_interest })
const fixture = { metadata: { coverage_end: '2026-01-06' }, history: [
  point('2026-01-01', [quote('au2602', 100, 20), quote('au2604', 110, 10), quote('au2603', 120, 5)]),
  point('2026-01-02', [quote('au2602', 102, 10), quote('au2604', 112, 30), quote('au2603', 122, 5)]),
  point('2026-01-03', [quote('au2604', 114, 20), quote('au2606', 124, 40)]),
  point('2026-01-04', [quote('au2604', 116, 10), quote('au2606', 126, 50)]),
  point('2026-01-05', [quote('au2606', 128, 60)]),
  point('2026-01-06', [quote('au2606', 130, 70)]),
] }
const actualFixture = openInterestMainSeries(fixture, 'actual')[0].item.history
const adjustedFixture = openInterestMainSeries(fixture, 'adjusted')[0].item.history
assert.deepEqual(actualFixture.map(p => p.contract), ['au2602', 'au2604', 'au2606', 'au2606', 'au2606', 'au2606'])
assert.deepEqual(actualFixture.map(p => p.value), [100, 112, 124, 126, 128, 130])
// 1月2日换月价差=112-102=10；1月3日再次换月价差=124-114=10。
assert.deepEqual(adjustedFixture.map(p => p.adjustment), [20, 10, 0, 0, 0, 0])
assert.deepEqual(adjustedFixture.map(p => p.value), [120, 122, 124, 126, 128, 130])
assert.equal(adjustedFixture[0].rollover, null)
assert.equal(adjustedFixture[1].rollover.gap, 10)
assert.equal(adjustedFixture[2].rollover.gap, 10)

const missingAnchor = { metadata: fixture.metadata, history: [
  point('2026-01-01', [quote('au2602', 100, 20), quote('au2604', 110, 10)]),
  point('2026-01-02', [quote('au2602', null, 10), quote('au2604', 112, 30)]),
  point('2026-01-03', [quote('au2604', 114, 40)]),
] }
assert.deepEqual(openInterestMainSeries(missingAnchor, 'adjusted')[0].item.history.map(p => p.value), [null, 112, 114])

const tie = { metadata: fixture.metadata, history: [point('2026-01-01', [quote('au2604', 110, 10), quote('au2602', 100, 10)])] }
assert.equal(openInterestMainSeries(tie, 'actual')[0].item.history[0].contract, 'au2602', '持仓并列时选更近交割月')

const mainBasis = mainContractBasisHistory(
  { history: [{ observation_date: '2026-11-06', value: 'AU2612' }, { observation_date: '2026-11-07', value: 'au2702' }] },
  { metadata: { contract_expiries: { au2612: { expiry_date: '2026-12-15' }, au2702: { expiry_date: '2027-02-15' } } }, history: [
    point('2026-11-06', [{ contract: 'au2612', close: 869.86 }, { contract: 'au2702', close: 872.22 }]),
    point('2026-11-07', [{ contract: 'au2612', close: 870 }, { contract: 'au2702', close: 873 }]),
  ] },
  { history: [{ observation_date: '2026-11-06', value: 868.08 }] },
)
assert.equal(mainBasis[0].contract, 'au2612')
assert.ok(Math.abs(mainBasis[0].value - ((869.86 - 868.08) / 868.08 * 365 / 39 * 100)) < 1e-12)
assert.equal(mainBasis[1].value, null, '缺少同日Au(T+D)现货价时保持断点')

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const dynamic = await (await fetch(new URL('api/price?indicator_id=gold_futures_daily_quotes', live))).json()
const quotesItem = dynamic.indicators[0]
assert.ok(quotesItem)
const expected = openInterestMainSeries(quotesItem, 'adjusted')[0].item.history
const rawDates = quotesItem.history.map(p => p.observation_date)
assert.equal(expected.length, rawDates.length)
assert.ok(expected.filter(p => p.value != null).length > 1000)

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
try {
  for (const [mode, url] of [['dynamic', live], ['static', preview]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(120000)
    const errors = [], blocked = []
    page.on('pageerror', error => errors.push(error.message))
    if (mode === 'static') await page.route('**/*', route => {
      const target = new URL(route.request().url()), base = new URL(url)
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || /\/api(?:\/|$)/.test(target.pathname)) {
        blocked.push(target.href)
        return route.abort()
      }
      return route.continue()
    })
    await page.goto(url)
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    const title = '黄金期货（元/克）'
    const panel = page.locator('#domestic-futures .chart-panel').filter({ has: page.locator('[data-chart-title="' + title + '"]') })
    const selector = page.getByLabel('黄金期货价格口径', { exact: true })
    assert.equal(await selector.inputValue(), 'adjusted', '默认长期复权')
    await page.getByLabel(title + '时间区间', { exact: true }).selectOption('ALL')
    await page.waitForFunction(() => document.querySelector('#domestic-futures [data-chart-title="黄金期货（元/克）"]')?.clientWidth > 0)
    if (mode === 'dynamic') await page.waitForFunction(async title => {
        const panel = document.querySelector('[data-chart-title="' + title + '"]')?.closest('.chart-panel')
        if (!panel || panel.querySelector('.empty-state')) return false
        const { echarts } = await import('/src/charts.js')
        const chart = echarts.getInstanceByDom(document.querySelector('[data-chart-title="' + title + '"]'))
        return Boolean(chart?.getOption().series?.length)
      }, title)
    const readChart = async expected => {
      await page.waitForFunction(async ({ title, expected }) => {
        const { echarts } = await import('/src/charts.js')
        const chart = echarts.getInstanceByDom(document.querySelector('[data-chart-title="' + title + '"]'))
        return chart && JSON.stringify(chart.getOption().series?.[0]?.data) === JSON.stringify(expected)
      }, { title, expected })
      return page.evaluate(async title => {
      const { echarts } = await import('/src/charts.js')
      const option = echarts.getInstanceByDom(document.querySelector('[data-chart-title="' + title + '"]')).getOption()
      return option.series[0].data
      }, title)
    }
    if (mode === 'dynamic') assert.deepEqual(await readChart(expected.map(p => p.value)), expected.map(p => p.value))
    assert.ok((await panel.textContent()).includes('回溯复权'))
    await selector.selectOption('actual')
    const actual = openInterestMainSeries(quotesItem, 'actual')[0].item.history
    if (mode === 'dynamic') assert.deepEqual(await readChart(actual.map(p => p.value)), actual.map(p => p.value))
    assert.ok((await panel.textContent()).includes('保留换月跳空'))
    await selector.selectOption('adjusted')
    if (mode === 'dynamic') {
      await readChart(expected.map(p => p.value))
      const tooltip = await page.evaluate(async title => {
        const { echarts } = await import('/src/charts.js')
        const chart = echarts.getInstanceByDom(document.querySelector('[data-chart-title="' + title + '"]'))
        const option = chart.getOption(), date = '2026-11-06', series = option.series[0]
        const index = option.xAxis[0].data.indexOf(date)
        chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: index })
        return option.tooltip[0].formatter([{ seriesIndex: 0, axisValue: date, dataIndex: index, value: series.data[index], color: series.itemStyle.color }])
      }, title)
      assert.ok(tooltip.includes('持仓量') && tooltip.includes('累计回溯调整'))
    }
    assert.deepEqual(errors, [])
    if (mode === 'static') assert.deepEqual(blocked, [])
    await page.close()
    console.log(JSON.stringify({ passed: true, mode, observations: expected.length,
      valid: expected.filter(p => p.value != null).length, actualAndAdjusted: true }))
  }
} finally { await browser.close() }
