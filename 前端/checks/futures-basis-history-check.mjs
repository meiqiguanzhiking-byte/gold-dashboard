import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { basisHistory } from '../src/futures-basis-history.js'
import { annualizedBasis } from '../src/futures-basis.js'
import { expandSnapshot } from '../src/static-source.js'

const point = (date, quotes) => ({ observation_date: date, value: JSON.stringify({ quotes }) })
const quote = (code, month, close) => ({ contract: code, expiry: month, close })
const fixture = { metadata: { coverage_end: '2026-02-04', contract_expiries: {
  au2602: { expiry_date: '2026-02-02' }, au2604: { expiry_date: '2026-04-15' },
  au2606: { expiry_date: '2026-06-15' }, au2603: { expiry_date: '2026-03-16' },
} }, history: [
  point('2026-01-30', [quote('au2602', '2026-02', 102), quote('au2603', '2026-03', 101), quote('au2604', '2026-04', 103), quote('au2606', '2026-06', 104)]),
  point('2026-02-02', [quote('au2602', '2026-02', 101), quote('au2603', '2026-03', 102), quote('au2604', '2026-04', 105), quote('au2606', '2026-06', 106)]),
  point('2026-02-03', [quote('au2603', '2026-03', 102), quote('au2604', '2026-04', 107), quote('au2606', '2026-06', null)]),
  point('2026-02-04', [quote('au2603', '2026-03', 103), quote('au2604', '2026-04', 106), quote('au2606', '2026-06', 108)]),
] }
const spot = { history: fixture.history.filter(p => p.observation_date !== '2026-02-04').map(p => ({ ...p, value: 100 })) }
const history = basisHistory(fixture, spot)
assert.equal(history[0].quotes[0].value, 2 / 100 * 365 / 3 * 100)
assert.equal(history[1].quotes[0].value, null, '最后报价日剩余0天，不除零')
assert.equal(history[2].quotes.find(q => q.contract === 'au2606').value, null)
assert.ok(history.at(-1).quotes.every(q => q.value === null), '现货不能跨日期补值')
const live = process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'
const api = await (await fetch(new URL('api/price', live))).json()
const byId = Object.fromEntries(api.indicators.map(item => [item.metadata.indicator_id, item]))
const quotesItem = byId.gold_futures_daily_quotes
const real = basisHistory(quotesItem, byId.gold_price_anchor)
// 独立读取用户指定的两张原表逐行核对，防止接口或绘图模型漏掉早期合约。
const rawRows = JSON.parse(execFileSync(fileURLToPath(new URL('../../后端/venv/Scripts/python.exe', import.meta.url)), ['-B', '-X', 'utf8', '-c', `
import sys, json, math
from pathlib import Path
sys.path.insert(0, str(Path.cwd().parent / '后端'))
from config import DATA_DIR
from datetime import date, timedelta
import pandas as pd
f = pd.read_csv(DATA_DIR / '黄金期货.csv')
s = pd.read_excel(DATA_DIR / '黄金现货价格.xlsx', sheet_name='黄金现货价格')
s['时间'] = pd.to_datetime(s['时间']).dt.strftime('%Y-%m-%d')
spots = s.set_index('时间')['价格'].to_dict()
ends = f.loc[f['收盘价（元/克）'].gt(0)].groupby('合约')['时间'].max().to_dict()
confirmed = json.load(sys.stdin)
latest = f['时间'].max()
result = []
for _, row in f.iterrows():
    day, code, month = row['时间'], row['合约'], row['交割月份']
    close, spot = row['收盘价（元/克）'], spots.get(day)
    close = float(close) if pd.notna(close) and math.isfinite(close) and close > 0 else None
    spot = float(spot) if spot is not None and pd.notna(spot) and math.isfinite(spot) and spot > 0 else None
    estimate = date.fromisoformat(month + '-15')
    while estimate.weekday() >= 5:
        estimate += timedelta(days=1)
    end = ends.get(code) if estimate.isoformat() < latest else confirmed.get(code, {}).get('expiry_date')
    days = (date.fromisoformat(end) - date.fromisoformat(day)).days if end else None
    rate = (close - spot) / spot * 365 / days * 100 if close is not None and spot is not None and days is not None and days > 0 else None
    result.append([day, code, close, spot, end, rate])
print(json.dumps(result, allow_nan=False))
`], { cwd: fileURLToPath(new URL('../', import.meta.url)), input: JSON.stringify(quotesItem.metadata.contract_expiries), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
const actualRows = new Map(real.flatMap(row => row.quotes.map(q => [row.observation_date + ':' + q.contract, q])))
assert.equal(actualRows.size, rawRows.length, '每条CSV合约历史报价都进入计算，不能只取当前合约或最近两期')
for (const [day, code, close, spot, end, rate] of rawRows) {
  const actual = actualRows.get(day + ':' + code)
  assert.ok(actual, day + ':' + code)
  assert.equal(actual.close, close)
  assert.equal(actual.spot ?? null, spot)
  assert.equal(actual.expiry_date, end)
  if (rate === null) assert.equal(actual.value, null)
  else assert.ok(Math.abs(actual.value - rate) < 1e-10, day + ':' + code)
}
const snapshot = expandSnapshot(JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8')))
const staticItems = Object.fromEntries(snapshot.price.indicators.map(item => [item.metadata.indicator_id, item]))
assert.deepEqual(basisHistory(staticItems.gold_futures_daily_quotes, staticItems.gold_price_anchor), real,
  '静态和动态的所有合约、观察日期、到期依据及升贴水率一致')
let valid = 0
for (const row of real) for (const q of row.quotes) {
  assert.equal(q.value, annualizedBasis(q, q.spot, row.observation_date).value)
  if (q.value !== null) valid++
}
assert.ok(valid > 10000, '完整历史须包含大量逐合约升贴水率点')

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const displayed = value => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const realByDate = new Map(real.map(row => [row.observation_date, row.quotes]))
const sampleDates = [...new Set([real.at(-1).observation_date, '2020-02-17', '2012-04-13', real[0].observation_date])]
try {
  for (const [mode, url] of [['dynamic', live], ['static', process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], blocked = []
    page.on('pageerror', e => errors.push(e.message))
    if (mode === 'static') await page.route('**/*', route => {
      const target = new URL(route.request().url()), base = new URL(url)
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) || /\/api(?:\/|$)/.test(target.pathname)) {
        blocked.push(target.href)
        return route.abort()
      }
      return route.continue()
    })
    await page.goto(url)
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    const panel = page.locator('[data-futures-basis-table]')
    const select = panel.getByLabel('黄金期货升贴水率日期', { exact: true })
    await page.waitForFunction(expected => document.querySelector('[data-futures-basis-table] select')?.options.length === expected, real.length)
    assert.equal(await select.inputValue(), real.at(-1).observation_date, '默认最新报价日')
    assert.deepEqual(await panel.locator('thead th').allTextContents(), ['期货名称', '期货价格', 'Au99.99收盘价', '基差', '升贴水率'])
    await page.locator('#futures canvas').waitFor()
    assert.equal(await page.locator('#futures canvas').count(), 1, '升贴水率已换成表格，保留左侧成交持仓图')
    for (const date of sampleDates) {
      await select.selectOption(date)
      const expected = realByDate.get(date)
      await page.waitForFunction(({ date, count }) => {
        const panel = document.querySelector('[data-futures-basis-table]')
        return panel?.querySelector('.basis-asof')?.textContent.includes(date) && panel.querySelectorAll('tbody tr').length === count
      }, { date, count: expected.length })
      const actual = await panel.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.textContent.trim())))
      assert.deepEqual(actual, expected.map(q => [q.contract, displayed(q.close), displayed(q.spot), displayed(q.basis), q.value == null ? '—' : displayed(q.value) + '%']), mode + ':' + date)
    }
    await page.getByRole('tab', { name: '国外', exact: true }).click()
    await page.getByRole('tab', { name: '国内', exact: true }).click()
    assert.equal(await select.inputValue(), sampleDates.at(-1), '切页保留历史日期选择')
    const boxes = await page.locator('#futures .chart-panel').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y } }))
    assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2 && boxes[1].x > boxes[0].x, '宽屏左右并排')
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth))
      const scroll = await panel.locator('.basis-table-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; return { left: node.scrollLeft, width: node.clientWidth, content: node.scrollWidth } })
      if (width === 390) assert.ok(scroll.left > 0, '窄屏表格可横向滚动')
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
    console.log(JSON.stringify({ passed: true, mode, contracts: Object.keys(quotesItem.metadata.contract_expiries).length, validPoints: valid, dates: sampleDates }))
    await page.close()
  }
} finally { await browser.close() }
