import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'
import { beijingDate, briefPoint, buildDailyBrief, dailyThresholdGroups, filterDailyMovements, numberText } from '../src/daily-brief.js'

const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const staticData = expandSnapshot(snapshot)
const categories = ['price', 'etf', 'au-td', 'futures', 'inventory', 'central-bank', 'cftc']
const dynamic = (await Promise.all(categories.map(async c => (await (await fetch(new URL('api/' + c, live))).json()).indicators))).flat()
const staticItems = categories.flatMap(c => staticData[c].indicators)
const today = beijingDate()
const thresholds = Object.fromEntries(dailyThresholdGroups.map(group => [group.id, group.initial]))
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
    assert.equal(model.cards.length, 25)
    assert.deepEqual(model.groups.map(group => group.title), ['价差', '现期', '远期', '风险波动', '宏观', 'ETF份额', '交易与持仓', '库存与交割'])
    assert.equal(dailyThresholdGroups.length, 7)
    assert.deepEqual(dailyThresholdGroups.map(group => group.id), ['spread', 'price', 'volatility', 'rates', 'shares', 'volume', 'position'])
    assert.deepEqual(dailyThresholdGroups.find(group => group.id === 'rates').indicators.map(row => row.id), ['ust_10y_yield', 'ust_2y_yield', 'ust_10y_2y_spread', 'ust_10y_breakeven_inflation'])
    assert.equal(dailyThresholdGroups.find(group => group.id === 'rates').initial, 1)
    assert.ok(!dailyThresholdGroups.find(group => group.id === 'price').indicators.some(row => row.id === 'gold_domestic_spread'), '价差不再使用价格阈值')
    assert.deepEqual(dailyThresholdGroups.find(group => group.id === 'spread').indicators.map(row => row.id), ['gold_domestic_spread', 'gold_futures_spread', 'gold_futures_secondary_spread'])
    assert.ok(model.movements.every(row => !/^domestic_\d+_shares$/.test(row.id)), '国内单只ETF份额不参与阈值筛选')
    assert.ok(dailyThresholdGroups.find(group => group.id === 'shares').indicators.some(row => row.id === 'domestic_etf_total_shares'), '国内ETF合计份额参与阈值筛选')
    const expectedMovements = filterDailyMovements(model.movements, thresholds)
    const orderedGroups = [...dailyThresholdGroups.map(group => group.id), 'direction']
    assert.deepEqual(model.movements.map(row => orderedGroups.indexOf(row.group)), model.movements.map(row => orderedGroups.indexOf(row.group)).toSorted((a, b) => a - b))
    const newSeries = ['gold_futures_spread', 'gold_futures_secondary_spread', 'gold_etf_volatility_index', 'comex_gold_registered', 'comex_gold_pledged', 'comex_gold_eligible', 'comex_gold_total']
    for (const id of newSeries) {
      const movement = model.movements.find(row => row.id === id)
      const point = briefPoint(index[id], today)
      assert.equal(movement.value, point.value, id)
      assert.equal(movement.change, point.change, id)
    }
    for (const [id, cardId, rank] of [
      ['daily_domestic_futures_close', 'domestic-futures', 0],
      ['daily_comex_0', 'international-futures', 0], ['daily_comex_1', 'international-futures', 1],
      ['daily_sgx_usdcnh_0', 'fx-futures', 0], ['daily_sgx_usdcnh_1', 'fx-futures', 1],
    ]) {
      const movement = model.movements.find(row => row.id === id)
      const cardRow = model.cards.find(card => card.id === cardId).rows[rank]
      assert.equal(movement.value, cardRow.value, id)
      assert.equal(movement.change, cardRow.change, '期货变动比较当前合约自身的上一观察期')
      assert.equal(movement.previousDate, cardRow.previousDate)
      assert.ok(movement.label.includes(cardRow.label))
    }
    const missingContractBaseline = items.map(item => item.metadata.indicator_id === 'gold_futures_daily_quotes' ? {
      ...item, history: item.history.map((point, index, history) => index === history.length - 1 ? {
        ...point, value: JSON.stringify({ ...JSON.parse(point.value), quotes: JSON.parse(point.value).quotes.map(quote => ({ ...quote, previous_close: null })) }),
      } : point),
    } : item)
    assert.ok(!buildDailyBrief(missingContractBaseline, today).movements.some(row => row.id === 'daily_domestic_futures_close'), '当前合约缺少比较价时不能改用连续复权价或其他合约')
    for (const row of model.movements.filter(row => row.group !== 'direction')) {
      assert.equal(row.percent, row.previousValue !== 0 ? row.change / Math.abs(row.previousValue) * 100 : null)
      assert.equal(row.thresholdValue, row.group === 'spread' ? row.change : row.percent)
      assert.equal(filterDailyMovements([row], { [row.group]: Math.abs(row.thresholdValue) }).length, 0, '等于阈值不命中')
    }
    const price = index.gold_price_anchor
    const oldCutoff = price.history.at(-6).observation_date
    assert.equal(briefPoint(price, oldCutoff).date, oldCutoff, '不得提前展示未来观测')
    const blank = { ...price, history: price.history.map((p, n, h) => n === h.length - 1 ? { ...p, value: null } : p) }
    assert.equal(briefPoint(blank, today).value, null, '最新期缺失不得倒退填值')
    assert.equal(briefPoint(blank, today).change, null)
    const blankPrevious = { ...price, history: price.history.map((p, n, h) => n === h.length - 2 ? { ...p, value: null } : p) }
    assert.equal(briefPoint(blankPrevious, today).change, null, '比较基准缺失不得跨期寻找')
    const noRelease = items.map(i => ({ ...i, history: i.history.map(({ release_date, ...p }) => p) }))
    assert.ok(buildDailyBrief(noRelease, today).releases.every(group => !group.today.length), '无可确认发布日期时不得标为今日发布')
    const vol = model.cards.find(card => card.id === 'volatility').rows[0]
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
    assert.equal(etf.fundRows, undefined)
    assert.deepEqual(etf.rows.map(row => row.label), ['7只ETF合计份额'])
    assert.equal(model.cards.find(card => card.id === 'international-price').rows[0].unit, '美元/盎司')
    const spreadDate = model.cards.find(card => card.id === 'spread').rows[0].date
    const onDate = id => index[id].history.find(p => p.observation_date === spreadDate)?.value
    assert.ok(Math.abs(model.cards.find(card => card.id === 'spread').rows[0].value - (onDate('gold_price_anchor') - onDate('london_gold_spot') * onDate('usdcnh') / 31.1034768)) < 1e-6)
    const raw = model.cards.find(card => card.id === 'domestic-futures').rows[0]
    const rawSource = JSON.parse(index.gold_futures_daily_quotes.history.at(-1).value)
    const selected = rawSource.quotes.find(quote => quote.contract === rawSource.main_contract)
    assert.equal(raw.value, selected.close)
    assert.equal(raw.change, selected.close - selected.previous_close)
    assert.deepEqual(raw.contractQuotes.quotes, rawSource.quotes)
    assert.equal(model.cards.find(card => card.id === 'cftc').rows.length, 4)
    const inventoryRows = model.cards.find(card => card.id === 'comex').rows
    assert.equal(new Set(inventoryRows.map(row => row.date)).size, 1)
    assert.ok(Math.abs(inventoryRows[3].value - inventoryRows[0].value - inventoryRows[2].value) < 1e-8)
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
    await p.locator('.contract-trigger').hover()
    const quotePopup = p.locator('.contract-popup')
    await quotePopup.waitFor({ state: 'visible' })
    assert.equal(await quotePopup.locator('.contract-quote').count(), rawSource.quotes.length)
    for (const quote of rawSource.quotes) assert.ok((await quotePopup.textContent()).includes(quote.contract))
    await p.mouse.move(0, 0)
    assert.equal(await p.getByRole('slider').count(), 7)
    assert.deepEqual(await p.locator('[data-threshold]').evaluateAll(nodes => nodes.map(node => node.dataset.threshold)), dailyThresholdGroups.map(group => group.id))
    assert.equal(await p.locator('#daily-movement-panel .daily-threshold-grid input').count(), 7)
    assert.deepEqual(await p.locator('[data-daily-movement]').evaluateAll(rows => rows.map(row => row.dataset.dailyMovement)), expectedMovements.map(row => row.id))
    for (const group of dailyThresholdGroups) {
      const slider = p.getByRole('slider', { name: group.label, exact: true })
      assert.equal(Number(await slider.inputValue()), group.initial)
      await slider.focus()
      await slider.press('End')
    }
    const maxThresholds = Object.fromEntries(dailyThresholdGroups.map(group => [group.id, group.max]))
    assert.deepEqual(await p.locator('[data-daily-movement]').evaluateAll(rows => rows.map(row => row.dataset.dailyMovement)), filterDailyMovements(model.movements, maxThresholds).map(row => row.id))
    await p.reload()
    await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    for (const group of dailyThresholdGroups) {
      const slider = p.getByRole('slider', { name: group.label, exact: true })
      assert.equal(Number(await slider.inputValue()), group.max, '刷新保留阈值')
      await slider.evaluate((input, value) => {
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, String(group.initial))
    }
    assert.ok((await p.locator('.daily-dates').textContent()).includes(today))
    // 推进浏览器时钟验证报告日与快照时间分别显示，不修改数据或快照。
    if (mode === 'static') {
      const later = new Date(Date.parse(snapshot.generated_at) + 86400000)
      await p.clock.setFixedTime(later)
      await p.reload()
      await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
      assert.ok((await p.locator('.daily-dates').textContent()).includes(beijingDate(later)))
      assert.ok((await p.locator('.daily-dates').textContent()).includes('快照生成时间'))
      await p.clock.setFixedTime(new Date())
      await p.reload()
      await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    }
    for (const width of [1280, 1440, 1024, 768, 390]) {
      await p.setViewportSize({ width, height: 1000 })
      await p.waitForTimeout(150)
      const layout = await p.locator('#daily-brief').evaluate(el => ({ width: document.documentElement.scrollWidth,
        outside: [...el.querySelectorAll('.daily-card,.daily-dates,.daily-thresholds,.daily-movements')].some(n => n.getBoundingClientRect().right > innerWidth + 1),
        clipped: [...el.querySelectorAll('h3,dt,strong,.change,.comparison')].some(n => n.scrollWidth > n.clientWidth + 2),
        rows: [...el.querySelectorAll('.daily-card')].map(n => Math.round(n.getBoundingClientRect().top)) }))
      assert.equal(layout.width, width)
      assert.equal(layout.outside, false)
      assert.equal(layout.clipped, false)
      if (width >= 1280) {
        const macro = await p.locator('[data-daily-group="macro"] .daily-card').evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().top)))
        assert.equal(new Set(macro).size, 1, '四项宏观指标同排显示')
        assert.equal(await p.locator('[data-daily-group]').count(), 8)
      }
    }
    await p.setViewportSize({ width: 1440, height: 1000 })
    for (const card of model.cards) {
      await p.getByRole('tab', { name: '每日速递', exact: true }).click()
      await p.locator(`[data-daily-card="${card.id}"]`).getByRole('button', { name: card.title + '查看详情', exact: true }).click()
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
    await p.locator('#page-panel-domestic .section-picker').getByLabel('黄金价格与价差', { exact: true }).uncheck()
    await p.getByRole('tab', { name: '每日速递', exact: true }).click()
    await p.getByRole('button', { name: '国内黄金价格查看详情', exact: true }).click()
    assert.equal(await p.locator('#gold-price').isVisible(), true, '跳转应恢复隐藏版块')
    assert.equal(await p.getByLabel('上金所Au99.99收盘价（元/克）时间区间').inputValue(), '3M')
    assert.deepEqual(await chartState(p), before, '速递跳转不重建图表或清除缩放')
    await p.getByRole('tab', { name: '每日速递', exact: true }).click()
    await p.getByRole('button', { name: mode === 'static' ? '重新加载展示数据' : '刷新真实数据' }).click()
    await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled, undefined, { timeout: 60000 })
    assert.equal(await p.locator('.daily-card').count(), 25)
    assert.equal(await p.getByRole('slider').count(), 7)
    assert.deepEqual(errors, [])
    if (mode === 'static') assert.ok(requests.every(u => new URL(u).pathname.startsWith(new URL(preview).pathname) && !/\/api(?:\/|$)/.test(new URL(u).pathname)))
    results.push({ mode, reportDate: today, cards: 25, layouts: [1280, 1440, 1024, 768, 390], autdFourMetrics: true, treasuryCards: 4, publicationUnknown: true, errors })
    await p.close()
  }
  console.log(JSON.stringify({ passed: true, results }))
} finally { await browser.close() }
