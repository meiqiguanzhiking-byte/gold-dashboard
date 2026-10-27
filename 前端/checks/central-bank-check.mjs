import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'

const title = '全球黄金储备净变化合计（吨）'
const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const preview = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const dynamic = await (await fetch(new URL('api/central-bank', live))).json()
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const published = expandSnapshot(snapshot)['central-bank']
const ids = ['gross_purchases', 'gross_sales', 'net_purchases', 'reporting_count'].map(id => 'global_central_bank_' + id)
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const results = []
async function chart(page, actions = []) {
  return page.evaluate(async ({ title, actions }) => {
    let init
    if (document.querySelector('script[src*="/@vite/client"]')) init = (await import('/src/charts.js')).echarts.init
    else {
      const url = performance.getEntriesByType('resource').find(r => /chart-core-.*\.js/.test(r.name)).name
      init = Object.values(await import(url)).find(f => typeof f === 'function' && f.toString().includes('afterinit'))
    }
    const el = document.querySelector(`[data-chart-title="${title}"]`)
    const c = init(el)
    for (const action of actions) c.dispatchAction(action)
    const o = c.getOption(), dates = o.xAxis[0].data
    const i = dates.length - 1
    const tooltip = o.tooltip[0].formatter(o.series.map((s, seriesIndex) => ({ seriesIndex, axisValue: dates[i], color: s.itemStyle.color })))
    return { dates, series: o.series.map(s => ({ name: s.name, type: s.type, values: s.data, smooth: s.smooth, axis: s.yAxisIndex, stack: s.stack })),
      min: o.yAxis[0].min, max: o.yAxis[0].max, axes: o.yAxis.length, tooltip,
      pixel: c.convertToPixel({ xAxisIndex: 0 }, dates[i]), zoom: o.dataZoom[0].start }
  }, { title, actions })
}
try {
  for (const [mode, url, source] of [['dynamic', live, dynamic], ['static', preview, published]]) {
    const items = Object.fromEntries(source.indicators.map(i => [i.metadata.indicator_id, i]))
    const expected = ids.map(id => new Map(items[id].history.map(p => [p.observation_date, p.value])))
    const latest = items[ids[2]].latest.observation_date
    const scope = items[ids[2]].metadata.aggregation_scope
    for (const [date, net] of expected[2]) {
      if (net == null) continue
      assert.ok(Math.abs(net - expected[0].get(date) - expected[1].get(date)) < 1e-8)
      assert.ok(expected[0].get(date) >= 0 && expected[1].get(date) <= 0)
    }
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], requests = []
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    p.on('request', r => requests.push(r.url()))
    await p.goto(url)
    await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    await p.getByRole('tab', { name: '国外', exact: true }).click()
    const section = p.locator('#global-central-bank')
    await section.locator('canvas').first().waitFor()
    await p.getByLabel('央行购金排名月份').selectOption(latest)
    assert.ok((await section.locator('.central-report-count').textContent()).includes(`${expected[3].get(latest)} / ${scope.included_entities.length}`))
    for (const range of ['1M', '1Y', 'ALL']) {
      await p.getByLabel(title + '时间区间').selectOption(range)
      const c = await chart(p)
      assert.equal(c.axes, 1)
      assert.deepEqual(c.series.map(s => s.type), ['bar', 'bar', 'line'])
      assert.ok(c.series.every(s => s.axis === 0))
      assert.equal(c.series[2].smooth, false)
      assert.ok(c.min <= 0 && c.max >= 0, '柱线组合轴必须包含零')
      for (let i = 0; i < 3; i++) c.dates.forEach((d, n) => assert.equal(c.series[i].values[n], expected[i].get(d)))
      assert.ok(c.tooltip.includes('报告机构数') && c.tooltip.includes(String(expected[3].get(latest))))
    }
    await chart(p, [{ type: 'dataZoom', start: 94, end: 100 }, { type: 'legendUnSelect', name: '买入量（正变化合计）' }])
    await p.waitForTimeout(160)
    const zoomed = await chart(p)
    assert.ok(zoomed.min <= 0 && zoomed.max >= 0)
    await chart(p, [{ type: 'legendSelect', name: '买入量（正变化合计）' }])
    await p.getByRole('tab', { name: '国内', exact: true }).click()
    await p.getByRole('tab', { name: '国外', exact: true }).click()
    assert.equal((await chart(p)).zoom, zoomed.zoom)
    await p.getByLabel(title + '时间区间').selectOption('1Y')
    const plot = p.locator(`[data-chart-title="${title}"]`)
    await plot.scrollIntoViewIfNeeded()
    const box = await plot.boundingBox(), c = await chart(p)
    await p.mouse.move(box.x + c.pixel, box.y + 120)
    await p.waitForTimeout(150)
    assert.ok((await plot.textContent()).includes('报告机构数'), '真实鼠标悬停应显示当月报告机构数')
    await p.mouse.move(0, 0)
    for (const width of [1280, 1440]) {
      await p.setViewportSize({ width, height: 1000 })
      await p.waitForTimeout(180)
      const bounds = await section.evaluate(el => ({ width: document.documentElement.scrollWidth, right: el.getBoundingClientRect().right,
        outside: [...document.querySelectorAll('body *')].filter(n => { const r = n.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 }).slice(0, 12).map(n => ({ tag: n.tagName, className: String(n.className), text: n.textContent.slice(0, 60), right: n.getBoundingClientRect().right })),
        clipped: [...el.querySelectorAll('h3,.central-month-summary,.central-report-count')].some(n => n.scrollWidth > n.clientWidth + 2) }))
      assert.equal(bounds.width, width, JSON.stringify(bounds))
      assert.ok(bounds.right <= width)
      assert.equal(bounds.clipped, false)
    }
    await p.getByRole('button', { name: mode === 'dynamic' ? '刷新真实数据' : '重新加载展示数据' }).click()
    await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    assert.ok((await section.locator('.central-report-count').textContent()).includes(String(expected[3].get(latest))))
    assert.deepEqual(errors, [])
    if (mode === 'static') assert.ok(requests.every(u => new URL(u).pathname.startsWith(new URL(preview).pathname) && !/\/api(?:\/|$)/.test(new URL(u).pathname)))
    results.push({ mode, latest, reportingCount: expected[3].get(latest), layouts: [1280, 1440], errors })
    await p.close()
  }
  console.log(JSON.stringify({ passed: true, results }))
} finally { await browser.close() }
