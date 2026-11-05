import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { beijingDate, buildDailyBrief, dailyThresholdGroups, filterDailyMovements } from '../src/daily-brief.js'
import { buildDailyReport, priceStatistic } from '../src/daily-report.js'
import { expandSnapshot } from '../src/static-source.js'
import { buildPagesData } from '../pages-data.mjs'

const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const flatten = data => Object.entries(data).filter(([key]) => key !== 'meta').flatMap(([, group]) => group.indicators)
const items = flatten(expandSnapshot(snapshot))
const date = beijingDate()
const thresholds = Object.fromEntries(dailyThresholdGroups.map(g => [g.id, g.initial]))
const none = Object.fromEntries(dailyThresholdGroups.map(g => [g.id, Number.MAX_VALUE]))
function report(data = items, limits = thresholds, override, unavailable = []) {
  const brief = buildDailyBrief(data, date)
  return buildDailyReport(data, date, brief, override ?? filterDailyMovements(brief.movements, limits), limits, unavailable)
}
const actual = report()
assert.equal(actual.paragraphs.length, 3)
assert.ok(actual.paragraphs.join('').length >= 1000 && actual.paragraphs.join('').length <= 1500)
assert.ok(actual.selectedIds.length <= 10)
assert.deepEqual(report(flatten(expandSnapshot(buildPagesData(snapshot).bootstrap.snapshot))), actual, '完整历史和静态首屏生成完全相同的日报')
assert.ok(report(items, none).paragraphs[2].includes('按当前阈值，暂无明显变动指标'))
assert.ok(!actual.paragraphs.join('').includes('今日变化'))

const edit = (id, transform) => items.map(i => i.metadata.indicator_id === id ? { ...i, history: transform(i.history) } : i)
const missing = report(edit('gold_price_anchor', h => h.map((p, i) => i === h.length - 1 ? { ...p, value: null } : p)))
assert.match(missing.paragraphs[1], /国内现货（[^）]+）数据缺失/)
assert.ok(!missing.paragraphs[1].includes('国内现货为近20'))
assert.match(report(edit('gold_hv20', h => h.map((p, i) => i === h.length - 1 ? { ...p, value: null } : p))).paragraphs[2], /波动率（[^）]+）数据缺失/)
const mixed = report(edit('gold_futures_secondary_spread', h => h.map((p, i) => i === h.length - 1 ? { ...p, value: -5 } : p)))
assert.ok(mixed.paragraphs[0].startsWith('国内外升贴水因期限而异'))
assert.ok(mixed.paragraphs[0].includes('国内贴水5.00'))
const roll = report(edit('gold_futures_spread_details', h => h.map((p, i) => i === h.length - 2 ? { ...p, value: '主力：au2610；次主力：au2612' } : p)))
assert.ok(roll.paragraphs[0].includes('换约或合约信息缺失，不比较上期'))
const roll5 = report(edit('gold_futures_spread_details', h => h.map((p, i) => i === h.length - 6 ? { ...p, value: '主力：au2610；次主力：au2612' } : p)))
assert.ok(roll5.paragraphs[0].includes('前5个交易观察日涉及换约或合约不明，暂无可比变化'))
const failed = report(items, thresholds, undefined, ['price'])
assert.ok(!failed.paragraphs[1].includes('863.79'))
assert.ok(failed.paragraphs[2].includes('最新数据暂不可得'))

const series = { history: Array.from({ length: 20 }, (_, i) => ({ observation_date: `2026-10-${String(i + 1).padStart(2, '0')}`, value: 100 + i })) }
assert.match(priceStatistic(series, date, '现货'), /连续19期上涨/)
assert.equal(priceStatistic({ history: series.history.slice(-19) }, date, '现货'), '')
assert.equal(priceStatistic({ history: series.history.map((p, i) => i === 17 ? { ...p, value: null } : p) }, date, '现货'), '')
assert.match(priceStatistic({ history: series.history.map((p, i) => ({ ...p, value: i === 19 ? 50 : p.value })) }, date, '现货'), /近20个交易观察日最低/)
const only = row => report(items, none, [row]).paragraphs[2]
const row = { id: 'ust_10y_real_yield', group: 'rates', category: 'price', label: '10年实际利率', change: 0.02, previousValue: 2, date, previousDate: '2026-11-02', thresholdValue: 1 }
assert.ok(only(row).includes('+2.00基点'))
assert.ok(only(row).includes('通常增加持有黄金的机会成本'))
assert.ok(only({ ...row, id: 'spdr_gold_holdings', group: 'shares', unit: '吨' }).includes('不等同现金净流入'))
assert.ok(only({ ...row, id: 'futures_open_interest', group: 'position', unit: '吨' }).includes('无法判断加多、加空或平仓'))
const cftc = items.find(i => i.metadata.indicator_id === 'cftc_net_long')
const cftcReport = only({ ...row, id: 'cftc_net_long', group: 'position', category: 'cftc', unit: '吨' })
assert.ok(cftcReport.includes('CFTC周度') && cftcReport.includes('多头') && cftcReport.includes('空头'))
assert.ok(cftcReport.includes(cftc.history.at(-1).observation_date.slice(5)))

if (process.env.REPORT_MODEL_ONLY !== '1') {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
  try {
    for (const url of ['http://127.0.0.1:5173/', 'http://127.0.0.1:4173/pages-preview/']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      // 动态版复用已有快照作为API响应，避免触发上游文件重载；静态版读取真实构建产物。
      if (url.includes('5173')) {
        const data = expandSnapshot(snapshot)
        await page.route('**/api/**', route => {
          const key = new URL(route.request().url()).pathname.split('/').at(-1)
          return route.fulfill({ json: data[key] || data.meta || {} })
        })
      }
      await page.goto(url)
      await page.locator('#daily-text-report .report-content').waitFor()
      assert.deepEqual(await page.locator('#daily-text-report .report-content p').allTextContents(), actual.paragraphs.map((p, i) => actual.titles[i] + '：' + p))
      assert.ok(await page.evaluate(() => document.getElementById('daily-term-structure').compareDocumentPosition(document.getElementById('daily-text-report')) & Node.DOCUMENT_POSITION_FOLLOWING))
      assert.ok(await page.evaluate(() => document.getElementById('daily-text-report').compareDocumentPosition(document.getElementById('daily-movement-panel')) & Node.DOCUMENT_POSITION_FOLLOWING))
      const toggle = page.locator('#page-panel-daily .section-picker').getByLabel('文字日报', { exact: true })
      await toggle.uncheck(); assert.equal(await page.locator('#daily-text-report').isVisible(), false)
      await toggle.check()
      await page.locator('#daily-threshold-volatility').fill('0')
      await page.locator('#daily-threshold-volume').fill('10')
      const custom = { ...thresholds, volatility: 0, volume: 10 }
      assert.deepEqual(await page.locator('#daily-text-report .report-content p').allTextContents(), report(items, custom).paragraphs.map((p, i) => actual.titles[i] + '：' + p))
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      }
      await page.locator('.refresh-button').click()
      await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
      await page.locator('#daily-text-report .report-content').waitFor()
      assert.deepEqual(await page.locator('#daily-text-report .report-content p').allTextContents(), report(items, custom).paragraphs.map((p, i) => actual.titles[i] + '：' + p))
      assert.deepEqual(errors, [])
      console.log(url + ' 日报位置、模板、阈值、显示勾选、刷新及响应式检查通过')
      await page.close()
    }
  } finally { await browser.close() }
}
console.log('固定模板日报：日期、缺失、换约、统计、单位与解释检查通过；正文' + actual.paragraphs.join('').length + '字')
