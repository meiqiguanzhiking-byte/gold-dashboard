import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { deliveryIssuedNumber, deliverySideColor, deliveryView } from '../src/deliveries.js'
import { deliveryInstitution } from '../src/delivery-institutions.js'
import { expandSnapshot } from '../src/static-source.js'

const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const expected = snapshot.deliveries
assert.deepEqual(expandSnapshot(snapshot).inventory.deliveries, expected)
for (const product of Object.values(expected.contracts)) {
  const view = deliveryView(product, product.available_months)
  for (const account of product.accounts) {
    const translated = deliveryInstitution(account.institution, true)
    assert.equal(translated.translated, true, '来源中的机构须有逐项核对的名称映射')
    assert.ok(/[\u4e00-\u9fff]/.test(translated.label))
    assert.equal(translated.label.slice(0, 4), account.institution.slice(0, 4))
    assert.equal(translated.label.slice(-3), account.institution.slice(-3))
  }
  assert.equal(view.min, -view.max)
  view.series.forEach((series, n) => series.data.forEach((value, i) => {
    const index = product.months.indexOf(series.name)
    const raw = product.accounts[i][n % 2 ? 'stopped' : 'issued'][index]
    assert.equal(value, raw == null ? null : n % 2 ? raw : -raw)
  }))
  const hidden = Object.fromEntries(view.months.map(month => [month, false]))
  assert.ok(deliveryView(product, view.months, hidden).min < 0)
  for (const month of product.available_months) {
    const i = product.months.indexOf(month)
    const filtered = deliveryView(product, [month], {}, { hideNoData: true, distinguishSides: true })
    assert.deepEqual(filtered.accounts, product.accounts.filter(account => ['issued', 'stopped'].some(side => typeof account[side][i] === 'number')))
  }
}
assert.equal(deliveryIssuedNumber(0), '0')
assert.equal(deliveryIssuedNumber(null), '未报告')
assert.equal(deliveryIssuedNumber(1.2345), '-1.2345')
assert.equal(deliveryInstitution('999 UNRECOGNIZED NAME [C]', true).label, '999 UNRECOGNIZED NAME [C]', '未知机构保持原名，不按同名/品牌猜测')
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const results = []
async function state(page, symbol) {
  return page.evaluate(async symbol => {
    const el = document.querySelector(`[data-chart-title="${symbol === 'GC' ? '标准' : '微型'}黄金期货 ${symbol}实物交割（吨）"]`)
    let init
    if (document.querySelector('script[src*="/@vite/client"]')) init = (await import('/src/charts.js')).echarts.init
    else {
      const url = performance.getEntriesByType('resource').find(r => /chart-core-.*\.js/.test(r.name)).name
      init = Object.values(await import(url)).find(f => typeof f === 'function' && f.toString().includes('afterinit'))
    }
    const chart = init(el), o = chart.getOption()
    const labels = chart.getZr().storage.getDisplayList().filter(node => node.type === 'tspan' && node.style?.text === o.yAxis[0].data[0])
      .map(node => { const r = node.getBoundingRect().clone(); if (node.transform) r.applyTransform(node.transform); return { x: r.x, right: r.x + r.width } })
    return { labels, accounts: o.yAxis[0].data, series: o.series.map(s => ({ name: s.name, data: s.data, stack: s.stack, type: s.type, color: s.itemStyle.color,
      sampleLabel: s.label.formatter({ value: s.data.find(value => value != null && value !== 0) ?? 0 }) })),
      min: o.xAxis[0].min, max: o.xAxis[0].max, left: o.grid[0].left,
      zeroPixel: chart.convertToPixel({ xAxisIndex: 0 }, 0),
      negativePixel: chart.convertToPixel({ xAxisIndex: 0 }, -o.xAxis[0].max),
      positivePixel: chart.convertToPixel({ xAxisIndex: 0 }, o.xAxis[0].max),
      tooltip: o.tooltip[0].formatter([{ dataIndex: 0 }]), negativeTick: o.xAxis[0].axisLabel.formatter(-1),
      displayNames: o.yAxis[0].data.map(name => o.yAxis[0].axisLabel.formatter(name)), height: chart.getHeight(),
      width: chart.getWidth(), scroll: el.parentElement.scrollTop }
  }, symbol)
}
try {
  const liveUrl = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
  const live = await (await fetch(new URL('api/inventory', liveUrl))).json()
  assert.deepEqual(live.deliveries, expected)
  for (const [mode, url] of [['dynamic', liveUrl], ['static', process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], requests = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('request', r => requests.push(r.url()))
    await page.goto(url)
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    const section = page.locator('#comex-delivery')
    await section.locator('canvas').first().waitFor()
    assert.equal(await section.evaluate(el => el.previousElementSibling.id), 'global-central-bank')
    for (const symbol of ['GC', 'MGC']) {
      const actual = await state(page, symbol), product = expected.contracts[symbol]
      assert.deepEqual(actual.accounts, product.accounts.map(a => a.institution))
      assert.equal(new Set(actual.accounts).size, actual.accounts.length)
      assert.equal(actual.min, -actual.max)
      assert.ok(actual.negativePixel < actual.zeroPixel && actual.zeroPixel < actual.positivePixel)
      assert.equal(actual.labels.length, 1, '机构标签在左侧仅出现一次')
      assert.ok(actual.labels[0].x >= -1 && actual.labels[0].right <= actual.left + 1)
      assert.ok(actual.tooltip.includes('交付 I：') && actual.tooltip.includes('接收 S：'))
      const reference = deliveryView(product, product.available_months.slice(-3))
      assert.deepEqual(actual.series.map(s => s.data), reference.series.map(s => s.data))
      assert.deepEqual(actual.series.map(s => s.name), reference.series.map(s => s.name))
      actual.series.forEach((series, i) => {
        assert.equal(series.color, deliverySideColor(series.name, i % 2 ? 'stopped' : 'issued'))
        if (series.sampleLabel && series.sampleLabel !== '未报告') assert.equal(series.sampleLabel.startsWith('-'), i % 2 === 0)
      })
      assert.equal(actual.negativeTick, '-1')
    }
    // 月份与图例各自独立，翻页后保留；左图滚动可到最后一个机构。
    const gc = section.locator('.delivery-panel').first()
    const mgc = section.locator('.delivery-panel').nth(1)
    const compact = await section.evaluate(el => [...el.querySelectorAll('.delivery-panel')].map(panel => ({
      viewport: panel.querySelector('.delivery-viewport').getBoundingClientRect().height,
      bottomGap: panel.getBoundingClientRect().bottom - panel.querySelector('.chart-source').getBoundingClientRect().bottom,
    })))
    assert.ok(compact[0].viewport <= 522, '左图可视区缩短至520px')
    assert.ok(compact[1].bottomGap < 40, '右侧卡片不再等高拉伸出大块底部留白')
    assert.equal(await mgc.getByLabel('MGC机构名称翻译中文').count(), 1)
    assert.equal(await section.locator('.delivery-shade-note').count(), 0)
    const aligned = async () => {
      const boxes = await section.evaluate(el => [...el.querySelectorAll('.delivery-panel')].map(panel => {
        const box = panel.getBoundingClientRect(), plot = panel.querySelector('.delivery-viewport').getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, height: box.height, plotTop: plot.top, plotBottom: plot.bottom, plotHeight: plot.height }
      }))
      for (const key of ['top', 'bottom', 'height', 'plotTop', 'plotBottom', 'plotHeight']) assert.ok(Math.abs(boxes[0][key] - boxes[1][key]) < 1, '两边卡片及绘图区须对齐：' + JSON.stringify(boxes))
      assert.equal((await state(page, 'MGC')).height, 520)
      return boxes[1].height
    }
    const mgcHeight = await aligned()
    for (const count of [1, 5, 0, 3]) {
      const chosen = expected.contracts.MGC.available_months.slice(-count || expected.contracts.MGC.available_months.length)
      for (const month of expected.contracts.MGC.available_months) await mgc.getByLabel('MGC交割月份 ' + month, { exact: true }).setChecked(count !== 0 && chosen.includes(month))
      await page.waitForTimeout(120)
      const boxes = await section.evaluate(el => [...el.querySelectorAll('.delivery-panel')].map(n => ({ top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom, height: n.getBoundingClientRect().height })))
      assert.ok(Math.abs(boxes[0].bottom - boxes[1].bottom) < 1)
      assert.ok(Math.abs(boxes[1].height - mgcHeight) < 1, '右图不随所选月份数量改变高度')
      if (count) await aligned()
    }
    for (const [symbol, panel] of [['GC', gc], ['MGC', mgc]]) {
      const before = await state(page, symbol)
      await panel.getByLabel(symbol + '机构名称翻译中文').check()
      await page.waitForTimeout(120)
      const after = await state(page, symbol)
      assert.deepEqual(after.accounts, before.accounts)
      assert.deepEqual(after.series, before.series)
      assert.deepEqual(after.displayNames, before.accounts.map(name => deliveryInstitution(name, true).label))
      assert.ok(after.tooltip.includes('原表名称：' + before.accounts[0]))
      assert.ok(after.tooltip.includes('[C]') || after.tooltip.includes('[H]'))
      await aligned()
    }
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    assert.equal(await gc.getByLabel('GC机构名称翻译中文').isChecked(), true)
    assert.equal(await mgc.getByLabel('MGC机构名称翻译中文').isChecked(), true)
    for (const [symbol, panel] of [['GC', gc], ['MGC', mgc]]) await panel.getByLabel(symbol + '机构名称翻译中文').uncheck()
    for (const month of expected.contracts.GC.available_months) await gc.getByLabel('GC交割月份 ' + month, { exact: true }).setChecked(month === '2026-09')
    await gc.getByLabel('GC隐藏无数据机构').check()
    await page.waitForTimeout(120)
    const september = deliveryView(expected.contracts.GC, ['2026-09'], {}, { hideNoData: true, distinguishSides: true })
    const filtered = await state(page, 'GC')
    assert.deepEqual(filtered.accounts, september.accounts.map(a => a.institution))
    assert.equal(filtered.accounts.length, 19)
    assert.ok(filtered.tooltip.includes('交付 I：-'), '交付悬停数值显示负号')
    await gc.locator('.delivery-legend button').filter({ hasText: '2026-09' }).click()
    assert.deepEqual((await state(page, 'GC')).accounts, filtered.accounts, '机构过滤只按勾选月份，不随图例改变')
    await gc.locator('.delivery-legend button').filter({ hasText: '2026-09' }).click()
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    assert.equal(await gc.getByLabel('GC隐藏无数据机构').isChecked(), true)
    assert.deepEqual((await state(page, 'GC')).accounts, filtered.accounts)
    await gc.getByLabel('GC隐藏无数据机构').uncheck()
    for (const month of expected.contracts.GC.available_months) await gc.getByLabel('GC交割月份 ' + month, { exact: true }).setChecked(expected.contracts.GC.available_months.slice(-3).includes(month))
    await gc.getByLabel('GC交割月份 2025-12', { exact: true }).check()
    await gc.locator('.delivery-legend button').filter({ hasText: '2026-07' }).click()
    await gc.locator('.delivery-viewport').evaluate(el => { el.scrollTop = el.scrollHeight })
    const selected = await state(page, 'GC')
    assert.ok(selected.scroll > 0)
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    assert.deepEqual((await state(page, 'GC')).series, selected.series)
    assert.equal(await gc.locator('.delivery-legend button').filter({ hasText: '2026-07' }).getAttribute('aria-pressed'), 'false')
    assert.deepEqual((await state(page, 'MGC')).series.map(s => s.name), ['2026-04', '2026-04', '2026-06', '2026-06', '2026-08', '2026-08'])
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.waitForTimeout(160)
      const bounds = await section.evaluate(el => ({ page: document.documentElement.scrollWidth,
        right: el.getBoundingClientRect().right, panels: [...el.querySelectorAll('.delivery-panel')].map(n => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })) }))
      assert.equal(bounds.page, width)
      assert.ok(bounds.right <= width)
      assert.equal(width > 760 ? bounds.panels[0].y === bounds.panels[1].y : bounds.panels[0].x === bounds.panels[1].x, true)
      for (const symbol of ['GC', 'MGC']) assert.ok((await state(page, symbol)).width > 200)
    }
    assert.deepEqual(errors, [])
    if (mode === 'static') assert.ok(requests.every(r => !/\/api(?:\/|$)/.test(new URL(r).pathname)))
    results.push({ mode, GC: 49, MGC: 6, layouts: [1440, 1280, 760, 390], errors })
    await page.close()
  }
  console.log(JSON.stringify({ passed: true, results }))
} finally { await browser.close() }
