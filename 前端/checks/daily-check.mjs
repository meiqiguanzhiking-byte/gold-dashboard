import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'
import { beijingDate, briefPoint, buildDailyBrief, numberText } from '../src/daily-brief.js'

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const staticData = expandSnapshot(snapshot)
const categories = ['price', 'etf', 'au-td', 'futures', 'inventory', 'central-bank', 'cftc']
const dynamic = (await Promise.all(categories.map(async c => (await (await fetch(new URL('api/' + c, live))).json()).indicators))).flat()
const staticItems = categories.flatMap(c => staticData[c].indicators)
const today = beijingDate()
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const results = []
async function chartState(page, setZoom = false) {
  return page.evaluate(async setZoom => {
    let init
    if (document.querySelector('script[src*="/@vite/client"]')) init = (await import('/src/charts.js')).echarts.init
    else {
      const core = [...document.querySelectorAll('link[rel="modulepreload"]')].find(link => /chart-core-.*\.js/.test(link.href))?.href || performance.getEntriesByType('resource').find(r => /chart-core-.*\.js/.test(r.name))?.name
      init = Object.values(await import(core)).find(f => typeof f === 'function' && f.toString().includes('afterinit'))
    }
    const c = init(document.querySelector('[data-chart-title="上金所Au99.99收盘价（元/克）"]'))
    if (setZoom) c.dispatchAction({ type: 'dataZoom', start: 40, end: 90 })
    return { id: c.id, zoom: c.getOption().dataZoom[0].start }
  }, setZoom)
}
try {
  for (const [mode, url, items] of [['dynamic', live, dynamic], ['static', preview, staticItems]]) {
    const index = Object.fromEntries(items.map(i => [i.metadata.indicator_id, i]))
    const model = buildDailyBrief(items, today)
    assert.equal(model.cards.length, 9)
    assert.deepEqual(model.cards.map(c => c.id), ['domestic-price', 'international-price', 'volatility', 'spread', 'autd', 'domestic-etf', 'spdr', 'futures', 'comex'])
    assert.equal(model.summary.length, 3)
    const price = index.gold_price_anchor
    const oldCutoff = price.history.at(-6).observation_date
    assert.equal(briefPoint(price, oldCutoff).date, oldCutoff, '不得提前展示未来观测')
    const blank = { ...price, history: price.history.map((p, n, h) => n === h.length - 1 ? { ...p, value: null } : p) }
    assert.equal(briefPoint(blank, today).value, null, '最新期缺失不得倒退填值')
    assert.equal(briefPoint(blank, today).change, null)
    const blankPrevious = { ...price, history: price.history.map((p, n, h) => n === h.length - 2 ? { ...p, value: null } : p) }
    assert.equal(briefPoint(blankPrevious, today).change, null, '比较基准缺失不得跨期寻找')
    const noRelease = items.map(i => ({ ...i, history: i.history.map(({ release_date, ...p }) => p) }))
    assert.equal(buildDailyBrief(noRelease, today).summary[2], '无最新发布记录', '无可确认发布记录时使用简短提示')
    const mismatchedShares = items.map(i => i.metadata.indicator_id === 'domestic_etf_total_shares' ? { ...i, history: i.history.slice(0, -1) } : i)
    assert.equal(buildDailyBrief(mismatchedShares, today).cards.find(c => c.id === 'domestic-etf').rows[0].value, null, '份额与规模不能错配观察日')
    const vol = model.cards[2].rows[0]
    const hv = index.gold_hv20.history
    const expectedVolChange = hv.at(-1).value - hv.at(-2).value
    assert.ok(Math.abs(vol.change - expectedVolChange) < 1e-12)
    assert.ok(vol.changeText.includes(numberText(Math.abs(expectedVolChange))))
    assert.ok(vol.changeText.includes('个百分点') && !vol.changeText.includes('%'), '波动率变化仅用百分点')
    const autd = model.cards.find(c => c.id === 'autd')
    assert.deepEqual(autd.rows.slice(0, 3).map(r => r.label), ['成交量', '持仓量', '延期费支付方向'])
    assert.ok(autd.note.includes('不代表多空仓位'))
    const fee = autd.rows[3]
    const feeHistory = index.au_td_delivery_direction.history.filter(p => p.observation_date <= today).slice(-7)
    assert.deepEqual(fee.stats.map(s => s.label), ['多方支付', '空方支付'])
    for (const [n, value] of ['多支付给空', '空支付给多'].entries()) {
      assert.equal(fee.stats[n].value, feeHistory.filter(p => p.value === value).length)
    }
    const etf = model.cards.find(c => c.id === 'domestic-etf')
    assert.equal(etf.fundRows.length, 7)
    assert.ok(Math.abs(etf.fundRows.reduce((sum, r) => sum + r.value, 0) - etf.rows[0].value) < 1e-6)
    assert.ok(etf.fundRows.every(r => r.date === etf.rows[0].date))
    assert.equal(model.cards[1].rows[0].unit, '美元/盎司')
    const spreadDate = model.cards[3].rows[0].date
    const onDate = id => index[id].history.find(p => p.observation_date === spreadDate)?.value
    assert.ok(Math.abs(model.cards[3].rows[0].value - (onDate('gold_price_anchor') - onDate('london_gold_spot') * onDate('usdcnh') / 31.1034768)) < 1e-6)
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], requests = []
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    p.on('request', r => requests.push(r.url()))
    await p.goto(url)
    await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    assert.deepEqual(await p.locator('.page-tabs button').allTextContents(), ['每日速递', '国内', '国外', '数据健康度'])
    assert.equal(await p.locator('.page-tabs [aria-selected="true"]').textContent(), '每日速递')
    assert.equal(await p.locator('.page-panel:visible').count(), 1)
    for (const card of model.cards) {
      const element = p.locator(`[data-daily-card="${card.id}"]`)
      assert.equal(await element.count(), 1)
      const text = await element.textContent()
      for (const row of card.rows) {
        if (!row.stats) assert.ok(text.includes(row.valueText), card.id + '数值应与真实源一致')
        assert.ok(text.includes(row.date || '未提供'))
        if (!row.stats && typeof row.value !== 'string') assert.ok(text.includes(row.changeText))
      }
    }
    for (let n = 0; n < 3; n++) assert.equal(await p.locator('.daily-summary p span').nth(n).textContent(), model.summary[n])
    assert.ok((await p.locator('.daily-dates').textContent()).includes(today))
    // 用浏览器时钟推进一天验证旧快照提示，不修改任何数据或快照。
    if (mode === 'static') {
      const later = new Date(Date.parse(snapshot.generated_at) + 86400000)
      await p.clock.setFixedTime(later)
      await p.reload()
      await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
      assert.ok((await p.locator('.daily-asof-note').textContent()).includes('早于报告日期'))
      assert.ok((await p.locator('.daily-dates').textContent()).includes(beijingDate(later)))
      await p.clock.setFixedTime(new Date())
      await p.reload()
      await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    }
    for (const width of [1280, 1440, 1024, 768, 390]) {
      await p.setViewportSize({ width, height: 1000 })
      await p.waitForTimeout(150)
      const layout = await p.locator('#daily-brief').evaluate(el => ({ width: document.documentElement.scrollWidth,
        outside: [...el.querySelectorAll('.daily-card,.daily-dates,.daily-summary')].some(n => n.getBoundingClientRect().right > innerWidth + 1),
        clipped: [...el.querySelectorAll('h3,dt,strong,.change,.comparison')].some(n => n.scrollWidth > n.clientWidth + 2),
        thinChange: [...el.querySelectorAll('.daily-fund-metrics .change-group')].some(n => n.clientWidth < 90),
        rows: [...el.querySelectorAll('.daily-card')].map(n => Math.round(n.getBoundingClientRect().top)) }))
      assert.equal(layout.width, width)
      assert.equal(layout.outside, false)
      assert.equal(layout.clipped, false)
      assert.equal(layout.thinChange, false, 'ETF变化信息应有足够宽度')
      if (width >= 1280) {
        assert.equal(new Set(layout.rows.slice(0, 4)).size, 1)
        assert.equal(new Set(layout.rows.slice(6)).size, 1)
        assert.ok(layout.rows[4] > layout.rows[3] && layout.rows[5] > layout.rows[4] && layout.rows[6] > layout.rows[5])
      }
    }
    await p.setViewportSize({ width: 1440, height: 1000 })
    for (const card of model.cards) {
      await p.getByRole('tab', { name: '每日速递', exact: true }).click()
      await p.getByRole('button', { name: card.title + '查看详情', exact: true }).click()
      await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
      await p.waitForTimeout(150)
      assert.equal(await p.locator('.page-panel:visible').getAttribute('id'), 'page-panel-' + card.page)
      assert.equal(await p.locator('#' + card.section).isVisible(), true)
      assert.equal(await p.evaluate(() => document.activeElement.id), card.section)
    }
    await p.getByRole('tab', { name: '国内', exact: true }).click()
    await p.getByLabel('上金所Au99.99收盘价（元/克）时间区间').selectOption('3M')
    await p.waitForTimeout(200)
    const before = await chartState(p, true)
    await p.locator('#page-panel-domestic .section-picker').getByLabel('黄金价格与波动率', { exact: true }).uncheck()
    await p.getByRole('tab', { name: '每日速递', exact: true }).click()
    await p.getByRole('button', { name: '国内黄金价格查看详情', exact: true }).click()
    assert.equal(await p.locator('#gold-price').isVisible(), true, '跳转应恢复隐藏版块')
    assert.equal(await p.getByLabel('上金所Au99.99收盘价（元/克）时间区间').inputValue(), '3M')
    assert.deepEqual(await chartState(p), before, '速递跳转不重建图表或清除缩放')
    await p.getByRole('tab', { name: '每日速递', exact: true }).click()
    await p.getByRole('button', { name: mode === 'static' ? '重新加载展示数据' : '刷新真实数据' }).click()
    await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    assert.equal(await p.locator('.daily-card').count(), 9)
    assert.equal(await p.locator('.daily-summary p').count(), 3)
    assert.deepEqual(errors, [])
    if (mode === 'static') assert.ok(requests.every(u => new URL(u).pathname.startsWith(new URL(preview).pathname) && !/\/api(?:\/|$)/.test(new URL(u).pathname)))
    results.push({ mode, reportDate: today, cards: 9, layouts: [1280, 1440, 1024, 768, 390], autdFourMetrics: true, publicationUnknown: true, errors })
    await p.close()
  }
  console.log(JSON.stringify({ passed: true, results }))
} finally { await browser.close() }
