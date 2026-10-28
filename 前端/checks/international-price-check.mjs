import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/gold-dashboard/'
const api = await (await fetch(new URL('api/price', live))).json()
const items = Object.fromEntries(api.indicators.map(i => [i.metadata.indicator_id, i]))
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const published = Object.fromEntries(expandSnapshot(snapshot).price.indicators.map(i => [i.metadata.indicator_id, i]))
const titles = {
  london_gold_spot: '伦敦金现（美元/金衡盎司）',
  usdcnh: '美元兑离岸人民币（CNH/美元）',
  gold_domestic_spread: '国内外价差（元/克）',
}
const expanded = expandSnapshot({ schema_version: 1, generated_at: api.loaded_at, files: [], groups: {
  price: Object.keys(titles).map(id => ({ metadata: items[id].metadata, notes: items[id].warnings, points: items[id].history.map(p => [p.observation_date, p.value]) })),
} })
for (const i of expanded.price.indicators) {
  const original = items[i.metadata.indicator_id]
  assert.deepEqual(i.history, original.history)
  assert.equal(i.latest.value, original.latest.value)
  assert.equal(i.latest.change, original.latest.change)
  assert.equal(i.latest.change_pct, original.latest.change_pct ?? null)
}
const meta = await (await fetch(new URL('api/meta', live))).json()
assert.ok(Object.keys(titles).every(id => meta.indicators.some(m => m.indicator_id === id)))
assert.ok(Object.keys(titles).every(id => items[id].metadata.loaded_at === api.loaded_at))
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const results = []
async function read(page, title, actions = []) {
  return page.evaluate(async ({ title, actions }) => {
    let init
    if (document.querySelector('script[src*="/@vite/client"]')) init = (await import('/src/charts.js')).echarts.init
    else {
      const core = performance.getEntriesByType('resource').find(r => /chart-core-.*\.js/.test(r.name)).name
      init = Object.values(await import(core)).find(f => typeof f === 'function' && f.toString().includes('afterinit'))
    }
    const c = init(document.querySelector(`[data-chart-title="${title}"]`))
    for (const action of actions) c.dispatchAction(action)
    const o = c.getOption()
    const date = o.xAxis[0].data.at(-1)
    return { dates: o.xAxis[0].data, unit: o.yAxis[0].name, min: o.yAxis[0].min, max: o.yAxis[0].max,
      smooth: o.series[0].smooth, connectNulls: o.series[0].connectNulls, values: o.series[0].data,
      tooltip: o.tooltip[0].formatter([{ seriesIndex: 0, axisValue: date, color: o.series[0].itemStyle.color }]),
    }
  }, { title, actions })
}
async function layout(page) {
  for (const width of [1280, 1440]) for (const tab of ['国内', '国外']) {
    await page.setViewportSize({ width, height: 1000 })
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await page.waitForTimeout(180)
    const actual = await page.locator('.page-panel:visible').evaluate(panel => ({
      width: document.documentElement.scrollWidth,
      clipped: [...panel.querySelectorAll('#foreign-overview h3,#foreign-overview .metric-number,#overseas-price h3,#gold-price h3')].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.textContent),
      outside: [...panel.querySelectorAll('.chart-panel,.metric-card,.section-picker')].filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 }).length,
    }))
    assert.equal(actual.width, width)
    assert.equal(actual.outside, 0)
    assert.deepEqual(actual.clipped, [])
  }
}
try {
  for (const [mode, url] of [['dynamic', live], ['static', preview]]) {
    const sourceItems = mode === 'dynamic' ? items : published
    const showPrices = Object.keys(titles).every(id => sourceItems[id].history.some(p => p.value != null))
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], requests = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('request', r => requests.push(r.url()))
    await page.goto(url)
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    await page.waitForTimeout(200)
    const domesticRects = await page.locator('#gold-price .chart-panel').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }))
    assert.ok(domesticRects[2].top > domesticRects[0].bottom && domesticRects[2].top > domesticRects[1].bottom)
    assert.equal(domesticRects[2].left, domesticRects[0].left)
    assert.equal(domesticRects[2].right, domesticRects[1].right)
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    assert.equal(await page.locator('#foreign-overview .metric-card h3').first().textContent(), '伦敦金现')
    const ids = await page.locator('#page-panel-foreign > section').evaluateAll(nodes => nodes.map(n => n.id))
    assert.equal(ids[1], 'overseas-price')
    const rects = await page.locator('#overseas-price .chart-panel').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right } }))
    assert.equal(rects[0].top, rects[1].top)
    assert.ok(rects[0].right < rects[1].left)
    if (showPrices) {
      assert.equal(await page.locator('#overseas-price canvas').count(), 2)
      const card = await page.locator('#foreign-overview .metric-card').first().textContent()
      assert.ok(card.includes(sourceItems.london_gold_spot.latest.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })))
      assert.ok(card.includes('%') && card.includes('美元/金衡盎司'))
      for (const [id, title] of Object.entries(titles)) {
        await page.getByRole('tab', { name: id === 'gold_domestic_spread' ? '国内' : '国外', exact: true }).click()
        for (const range of ['1M', '3M', '1Y', '5Y', 'ALL']) {
          await page.getByLabel(title + '时间区间').selectOption(range)
          await page.waitForTimeout(100)
          const c = await read(page, title)
          const values = new Map(sourceItems[id].history.map(p => [p.observation_date, p.value]))
          c.dates.forEach((d, index) => assert.equal(c.values[index], values.get(d)))
          assert.equal(c.unit, sourceItems[id].metadata.unit)
          assert.equal(c.smooth, false); assert.equal(c.connectNulls, false)
          if (id === 'gold_domestic_spread') assert.equal(sourceItems[id].metadata.observation_time, '15:30')
          assert.ok(c.tooltip.includes(c.dates.at(-1)))
        }
        const before = await read(page, title)
        await read(page, title, [{ type: 'dataZoom', start: 95, end: 100 }])
        await page.waitForTimeout(180)
        const zoomed = await read(page, title)
        assert.ok(zoomed.max - zoomed.min < before.max - before.min, id + '纵轴应随可见日期收紧')
      }
      assert.equal(await page.locator('#gold-price canvas').count(), 3)
      assert.ok((await page.locator('#gold-price').textContent()).includes(sourceItems.gold_domestic_spread.metadata.latest_valid_date))
    } else {
      assert.equal(await page.locator('#overseas-price canvas,#gold-price canvas').count(), 0)
      assert.equal(await page.locator('#overseas-price .empty-state').count(), 2)
      assert.equal(await page.locator('#gold-price .empty-state').count(), 3)
      assert.ok((await page.locator('#overseas-price').textContent()).includes('公开使用尚未确认'))
    }
    if (mode === 'static') assert.ok(requests.every(u => new URL(u).pathname.startsWith(new URL(preview).pathname) && !/\/api(?:\/|$)/.test(new URL(u).pathname)))
    await layout(page)
    await page.getByRole('tab', { name: '数据健康度', exact: true }).click()
    await page.getByLabel('搜索数据健康度').fill('伦敦金现与汇率_北京时间1530收盘价.xlsx')
    assert.equal(await page.locator('.health-table tbody tr:has(td strong)').count(), 3)
    await page.getByRole('button', { name: mode === 'dynamic' ? '刷新真实数据' : '重新加载展示数据' }).click()
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    assert.equal(await page.locator('#overseas-price canvas').count(), showPrices ? 2 : 0)
    assert.deepEqual(errors, [])
    results.push({ mode, layouts: [1280, 1440], errors })
    await page.close()
  }
  console.log(JSON.stringify({ passed: true, comparison: items.gold_domestic_spread.metadata.comparison_basis, latestSpread: items.gold_domestic_spread.latest_available.observation_date, results }))
} finally { await browser.close() }
