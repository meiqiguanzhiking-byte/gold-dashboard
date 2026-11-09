import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { annualizedBasis, annualizedBasisChange } from '../src/futures-basis.js'
import { buildDailyBrief, beijingDate, numberText } from '../src/daily-brief.js'
import { expandSnapshot } from '../src/static-source.js'
import { buildPagesData } from '../pages-data.mjs'

const simple = { contract: 'au2612', close: 102, expiry_date: '2026-12-15' }
assert.equal(annualizedBasis(simple, 100, '2025-12-15').value, 2)
assert.equal(annualizedBasis({ ...simple, close: 98 }, 100, '2025-12-15').value, -2)
assert.equal(annualizedBasis({ ...simple, close: 100 }, 100, '2025-12-15').value, 0)
assert.equal(annualizedBasis({ ...simple, expiry_date: '2024-03-01' }, 100, '2024-02-28').days, 2, '剩余自然日包含闰日')
for (const [quote, spot, date] of [
  [simple, 100, '2026-12-15'], [simple, 100, '2026-12-16'], [simple, 0, '2026-11-03'],
  [simple, null, '2026-11-03'], [{ ...simple, close: null }, 100, '2026-11-03'],
  [{ ...simple, expiry_date: null }, 100, '2026-11-03'], [{ ...simple, expiry_date: '2026-02-30' }, 100, '2026-01-01'],
]) assert.equal(annualizedBasis(quote, spot, date).value, null)
const comparison = { ...simple, previous_close: 101, previous_date: '2026-11-02' }
const compared = annualizedBasisChange(comparison, 100, '2026-11-03', 100)
assert.ok(Math.abs(compared.change - (2 * 365 / 42 - 365 / 43)) < 1e-12, '两期分别按各自观察日计算剩余天数')
assert.equal(annualizedBasisChange({ ...comparison, previous_close: null }, 100, '2026-11-03', 100).change, null)
assert.equal(annualizedBasisChange(comparison, 100, '2026-11-03', null).change, null)
assert.equal(annualizedBasisChange({ ...comparison, previous_close: 100 }, 100, '2026-11-03', 100).change, compared.value, '前一期升贴水率为0仍可比较百分点变化')

const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const flatten = data => Object.entries(data).filter(([key]) => key !== 'meta').flatMap(([, group]) => group.indicators)
const items = flatten(expandSnapshot(snapshot))
const date = beijingDate()
const model = buildDailyBrief(items, date)
const card = model.cards.find(card => card.id === 'domestic-futures')
assert.equal(card.rows.length, 2)
const rate = card.rows[1]
const quotes = JSON.parse(items.find(item => item.metadata.indicator_id === 'gold_futures_daily_quotes').history.at(-1).value)
const main = quotes.quotes.find(quote => quote.contract === quotes.main_contract)
const spot = items.find(item => item.metadata.indicator_id === 'au_td_close').history.find(point => point.observation_date === card.rows[0].date)
const expected = (main.close - spot.value) / spot.value * (365 / ((Date.parse(main.expiry_date) - Date.parse(card.rows[0].date)) / 86400000)) * 100
assert.ok(Math.abs(rate.value - expected) < 1e-12)
assert.equal(rate.date, spot.observation_date)
const previousSpot = items.find(item => item.metadata.indicator_id === 'au_td_close').history.find(point => point.observation_date === main.previous_date)
const previousExpected = (main.previous_close - previousSpot.value) / previousSpot.value * 365 / ((Date.parse(main.expiry_date) - Date.parse(main.previous_date)) / 86400000) * 100
assert.ok(Math.abs(rate.change - (expected - previousExpected)) < 1e-12)
assert.equal(rate.previousDate, main.previous_date)
assert.equal(rate.previousValue, previousExpected)
assert.ok(rate.changeText.includes('个百分点'))
assert.equal(rate.basisRates.quotes.length, quotes.quotes.length)
assert.ok(rate.detailText.includes(main.contract.replace(/^au/i, 'Au')))
assert.deepEqual(buildDailyBrief(flatten(expandSnapshot(buildPagesData(snapshot).bootstrap.snapshot)), date), model)
const missingSpot = items.map(item => item.metadata.indicator_id === 'au_td_close' ? { ...item, history: item.history.filter(point => point.observation_date !== rate.date) } : item)
assert.equal(buildDailyBrief(missingSpot, date).cards.find(card => card.id === 'domestic-futures').rows[1].value, null, '现货不同日时不取其他日期替代')
const missingPreviousSpot = items.map(item => item.metadata.indicator_id === 'au_td_close' ? { ...item, history: item.history.filter(point => point.observation_date !== main.previous_date) } : item)
const noBaseline = buildDailyBrief(missingPreviousSpot, date).cards.find(card => card.id === 'domestic-futures').rows[1]
assert.equal(noBaseline.value, rate.value)
assert.equal(noBaseline.change, null, '上一交易观察日现货缺失时不跨期找基准')

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
try {
  for (const url of [process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/', process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    const element = page.locator('[data-daily-card="domestic-futures"]')
    assert.ok((await element.textContent()).includes(rate.valueText))
    const rateMetric = element.locator('.daily-metric').nth(1)
    assert.ok((await rateMetric.textContent()).includes(rate.changeText))
    assert.ok((await rateMetric.textContent()).includes('较 ' + rate.previousDate))
    const headings = await element.locator('dt').allTextContents()
    assert.ok(headings[0].includes(card.rows[0].label))
    assert.equal(headings[1], '升贴水率 ⓘ')
    const trigger = element.getByRole('button', { name: '升贴水率 ⓘ' })
    await trigger.hover()
    const popup = element.locator('.basis-popup')
    await popup.waitFor({ state: 'visible' })
    assert.equal(await popup.locator('.basis-quote').count(), quotes.quotes.length)
    for (const quote of rate.basisRates.quotes) {
      const row = popup.locator('.basis-quote').filter({ hasText: quote.contract.replace(/^au/i, 'Au') })
      assert.ok((await row.textContent()).includes(numberText(quote.value)))
      assert.ok((await row.textContent()).includes(quote.expiry_date))
      if (quote.change != null) {
        assert.ok((await row.textContent()).includes(numberText(quote.change) + ' 个百分点'))
        assert.ok((await row.textContent()).includes('较 ' + quote.previousDate))
      }
    }
    await page.mouse.move(0, 0)
    await trigger.focus()
    await popup.waitFor({ state: 'visible' })
    await trigger.press('Escape')
    await popup.waitFor({ state: 'hidden' })
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await trigger.hover()
      const box = await popup.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth))
      await page.mouse.move(0, 0)
    }
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ url, main: main.contract, annualizedRate: rate.valueText + '%', observationDate: rate.date, expiry: main.expiry_date, allContracts: quotes.quotes.length, passed: true }))
    await page.close()
  }
} finally { await browser.close() }
