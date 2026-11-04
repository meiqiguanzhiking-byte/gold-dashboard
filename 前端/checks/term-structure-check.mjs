import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { beijingDate, buildDailyBrief, buildDailyTermStructure } from '../src/daily-brief.js'
import { expandSnapshot } from '../src/static-source.js'
import { buildPagesData } from '../pages-data.mjs'

const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const flatten = data => Object.entries(data).filter(([key]) => key !== 'meta').flatMap(([, group]) => group.indicators)
const items = flatten(expandSnapshot(snapshot))
const date = beijingDate()
const model = buildDailyTermStructure(items, date)
const brief = buildDailyBrief(items, date)
assert.deepEqual(model.categories.slice(1), brief.cards.find(card => card.id === 'futures-spread').rows.map(row => row.label))
for (const [rank, id] of ['gold_futures_spread', 'gold_futures_secondary_spread'].entries()) {
  const history = items.find(item => item.metadata.indicator_id === id).history.filter(point => point.observation_date <= date)
  for (const [index, offset] of [0, 5, 10].entries()) {
    assert.equal(model.curves[index].points[rank + 1].value, history.at(-1 - offset).value)
    assert.equal(model.curves[index].points[rank + 1].date, history.at(-1 - offset).observation_date)
  }
}
assert.equal(model.curves[0].points[0].value, brief.cards.find(card => card.id === 'spread').rows[0].value)
assert.equal(model.curves[1].points[0].value, null)
assert.equal(model.curves[2].points[0].value, null)
assert.deepEqual(buildDailyTermStructure(flatten(expandSnapshot(buildPagesData(snapshot).bootstrap.snapshot)), date), model, '静态首屏保留T-10的全部日期、数值和合约')

const main = items.find(item => item.metadata.indicator_id === 'gold_futures_spread')
const missing = items.map(item => item === main ? { ...item, history: item.history.map((point, index, history) => index === history.length - 6 ? { ...point, value: null } : point) } : item)
const missingPoint = buildDailyTermStructure(missing, date).curves[1].points[1]
assert.equal(missingPoint.value, null, '第5个交易日为空时不得跨期取值')
assert.equal(missingPoint.date, main.history.at(-6).observation_date)
const short = items.map(item => ({ ...item, history: item.history.slice(-5) }))
assert.equal(buildDailyTermStructure(short, date).curves[1].points[1].date, null, '历史不足时不把自然日或其他记录当成T-5')
const cutoff = main.history.at(-15).observation_date
assert.equal(buildDailyTermStructure(items, cutoff).curves[2].points[1].date, main.history.at(-25).observation_date, '报告日之后的记录不进入回看')

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
try {
  for (const url of [process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/', process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    const option = await page.evaluate(async () => {
      let init
      if (document.querySelector('script[src*="/@vite/client"]')) init = (await import('/src/charts.js')).echarts.init
      else {
        const path = [...document.querySelectorAll('link[rel="modulepreload"]')].find(link => /chart-core-.*\.js/.test(link.href))?.href || performance.getEntriesByType('resource').find(resource => /chart-core-.*\.js/.test(resource.name))?.name
        init = Object.values(await import(path)).find(value => typeof value === 'function' && value.toString().includes('afterinit'))
      }
      const chart = init(document.querySelector('[data-chart-title="价差期限结构"]'))
      const option = chart.getOption()
      chart.dispatchAction({ type: 'showTip', seriesIndex: 1, dataIndex: 1 })
      return { categories: option.xAxis[0].data, unit: option.yAxis[0].name,
        series: option.series.map(series => ({ values: series.data, type: series.lineStyle.type, connectNulls: series.connectNulls })) }
    })
    assert.deepEqual(option.categories, model.categories)
    assert.equal(option.unit, '价格（元/克）')
    assert.deepEqual(option.series.map(series => series.values), model.curves.map(curve => curve.points.map(point => point.value)))
    assert.deepEqual(option.series.map(series => series.type), ['solid', 'dashed', [7, 4, 1, 4]])
    assert.ok(option.series.every(series => series.connectNulls === false))
    await page.locator('#daily-term-structure .tooltip-item').first().waitFor({ state: 'visible' })
    const tooltip = await page.locator('#daily-term-structure .tooltip-item').allTextContents()
    assert.ok(tooltip.some(text => text.includes(model.curves[1].points[1].date)), '悬浮显示T-5真实观察日')
    assert.ok(tooltip.some(text => text.includes(model.curves[2].points[1].date)), '悬浮显示T-10真实观察日')
    assert.ok(await page.locator('#daily-term-structure').evaluate(node => node.getBoundingClientRect().top < document.getElementById('daily-movement-panel').getBoundingClientRect().top))
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.locator('#daily-term-structure').evaluate(node => node.getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth === innerWidth))
    }
    const toggle = page.locator('#page-panel-daily .section-picker').getByLabel('价差期限结构', { exact: true })
    await toggle.uncheck()
    assert.equal(await page.locator('#daily-term-structure').isVisible(), false)
    await toggle.check()
    await page.reload()
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    assert.equal(await toggle.isChecked(), true)
    assert.ok(await page.locator('[data-chart-title="价差期限结构"] canvas').count() > 0)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ url, curves: 3, tradingDayOffsets: [5, 10], lineStyles: true, toggle: true, responsive: true, passed: true }))
    await page.close()
  }
} finally { await browser.close() }
