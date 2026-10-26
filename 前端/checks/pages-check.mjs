import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const target = new URL(base)
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const errors = [], consoleErrors = [], requests = [], blocked = [], layouts = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('request', req => requests.push({ url: req.url(), method: req.method() }))
await page.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin !== target.origin || /\/api(?:\/|$)/.test(url.pathname)) {
    blocked.push(url.href)
    return route.abort('blockedbyclient')
  }
  return route.continue()
})
async function loaded(p = page) {
  await p.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled && document.querySelectorAll('#comex canvas').length === 2)
}
async function layout(width) {
  await page.setViewportSize({ width, height: 1000 })
  await page.waitForTimeout(100)
  const result = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll('.section,.chart-panel,.metric-card,.health-table,.refresh-button')].filter(el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 }).map(el => el.className),
    clipped: [...document.querySelectorAll('.panel-header h3,.metric-number,.comex-primary h3,.comex-delta,.comex-secondary dd')].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.textContent),
    overlaps: [...document.querySelectorAll('.chart-grid,.metric-grid,.comex-banner')].flatMap(grid => {
      const rects = [...grid.children].map(el => el.getBoundingClientRect())
      return rects.flatMap((a, i) => rects.slice(i + 1).filter(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))
    }).length,
  }))
  assert.equal(result.width, width)
  assert.deepEqual(result.outside, [])
  assert.deepEqual(result.clipped, [])
  assert.equal(result.overlaps, 0)
  layouts.push(width)
}
async function chartInk(selector) {
  return page.locator(selector).evaluateAll(canvases => canvases.reduce((total, canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let colored = 0
    for (let i = 0; i < pixels.length; i += 16) if (pixels[i + 3] > 0 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) colored++
    return total + colored
  }, 0))
}
async function waitForInk(selector) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await page.locator(selector).count() && await chartInk(selector) > 15) return
    await page.waitForTimeout(100)
  }
  assert.fail('图表未完成真实内容绘制：' + selector)
}
try {
  await page.goto(base)
  await loaded()
  assert.ok((await page.locator('.environment').textContent()).includes('静态展示版'))
  assert.ok((await page.locator('.static-notice').textContent()).includes('不会随电脑中的文件自动更新'))
  const generatedDate = snapshot.generated_at.slice(0, 10).split('-').map(Number).join('/')
  assert.ok((await page.locator('.data-summary').textContent()).includes(generatedDate))
  assert.equal(await page.getByRole('button', { name: '刷新真实数据', exact: true }).count(), 0)
  assert.equal(await page.locator('main section.section').count(), 14)
  assert.deepEqual(await page.locator('.page-tabs button').allTextContents(), ['国内', '国外', '数据健康度'])
  assert.equal(await page.locator('.page-tabs button[aria-selected="true"]').textContent(), '国内')
  for (const id of ['central-bank', 'au-td', 'futures', 'domestic-etf']) {
    await page.locator('#' + id + ' canvas').first().waitFor()
    assert.ok(await chartInk('#' + id + ' canvas') > 15, id + ' 图表应包含真实绘制内容')
  }
  await page.getByRole('tab', { name: '国外' }).click()
  await page.waitForTimeout(250)
  for (const id of ['positions', 'spdr', 'london', 'comex', 'global-etf']) {
    await page.locator('#' + id + ' canvas').first().waitFor()
    assert.ok(await chartInk('#' + id + ' canvas') > 15, id + ' 图表应包含真实绘制内容')
  }
  assert.ok((await page.locator('#overview').textContent()).includes('数据暂缺'))
  await page.getByRole('tab', { name: '国内' }).click()
  await page.waitForTimeout(250)
  assert.ok((await page.locator('#global-central-bank').textContent()).includes('数据暂缺'))
  assert.equal(await page.locator('#domestic-etf input[type=checkbox]').count(), 7)
  const fundChecks = page.locator('#domestic-etf input[type=checkbox]')
  for (const checkbox of await fundChecks.all()) await checkbox.uncheck()
  await page.locator('#domestic-etf').getByText('请选择至少一只基金', { exact: true }).first().waitFor()
  await page.locator('#domestic-etf').getByRole('button', { name: '全选', exact: true }).click()
  await page.locator('[data-chart-title="境内黄金 ETF 分基金资产规模（亿元）"] canvas').waitFor()
  await page.getByRole('tab', { name: '国外' }).click()
  await page.waitForTimeout(250)
  const range = page.getByLabel('SPDR 黄金持仓趋势（吨）时间区间')
  const spdr = page.locator('#spdr .chart-caption').first()
  await range.selectOption('1M')
  const short = await spdr.textContent()
  await range.selectOption('ALL')
  assert.notEqual(await spdr.textContent(), short)
  await range.selectOption('1Y')
  await page.getByRole('tab', { name: '全球流量 · 月度' }).click()
  await page.locator('[data-chart-title="月度地区热力图"] canvas').first().waitFor()
  await page.getByLabel('全球ETF流量口径').selectOption('usd')
  await page.getByRole('heading', { name: '全球黄金 ETF 月度分地区净流量（美元）', exact: true }).waitFor()
  const regionChecks = page.locator('#global-etf input[type=checkbox]')
  for (const checkbox of await regionChecks.all()) await checkbox.uncheck()
  await page.locator('#global-etf').getByText('请选择至少一个地区', { exact: true }).first().waitFor()
  for (const checkbox of await regionChecks.all()) await checkbox.check()
  await page.getByLabel('热力图时间区间').selectOption('ALL')
  await waitForInk('[data-chart-title="月度地区热力图"] canvas')
  await page.getByLabel('热力图时间区间').selectOption('1Y')
  await page.getByLabel('央行购金排名月份').selectOption({ index: 1 })
  assert.ok((await page.locator('#global-central-bank .ranking-panel header p').first().textContent()).includes(await page.getByLabel('央行购金排名月份').inputValue()))
  await page.getByRole('tab', { name: '数据健康度' }).click()
  await page.waitForTimeout(250)
  await page.getByLabel('搜索数据健康度').fill('COMEX')
  assert.equal(await page.locator('.health-table tbody tr:has(td strong)').count(), 7)
  await page.getByLabel('健康度频率筛选').selectOption('月度')
  assert.equal(await page.locator('.health-table tbody tr:has(td strong)').count(), 0)
  await page.getByLabel('搜索数据健康度').fill('')
  await page.getByLabel('健康度频率筛选').selectOption('全部')
  for (const width of [1280, 1440]) await layout(width)
  await page.getByRole('tab', { name: '国外' }).click()
  await page.waitForTimeout(250)
  await page.getByLabel('COMEX 金属', { exact: true }).selectOption('silver')
  assert.ok((await page.locator('#comex .comex-primary h3').textContent()).includes('白银注册库存'))
  await page.getByLabel('COMEX 时间范围').selectOption('90')
  const goldPoints = snapshot.groups.inventory.find(item => item.metadata.indicator_id === 'comex_gold_registered').points
  const latestGold = goldPoints.at(-1)[0]
  const target90 = new Date(Date.parse(latestGold) - 90 * 86400000).toISOString().slice(0, 10)
  assert.ok((await page.locator('#comex .comex-comparison').textContent()).includes(target90))
  await page.getByLabel('COMEX 金属', { exact: true }).selectOption('gold')
  await page.getByLabel('COMEX 时间范围').selectOption('30')
  assert.ok((await page.locator('#comex .comex-definition').textContent()).includes('待核实'))
  // 通过真实鼠标检验图例开关及两个 COMEX 悬浮提示，读取像素而不保存截图。
  const chart = page.locator('[data-chart-title="COMEX 库存结构"]')
  await chart.scrollIntoViewIfNeeded()
  const box = await chart.boundingBox()
  const fullInk = await chartInk('[data-chart-title="COMEX 库存结构"] canvas')
  await page.mouse.click(box.x + 46, box.y + 12)
  await page.waitForTimeout(80)
  assert.notEqual(await chartInk('[data-chart-title="COMEX 库存结构"] canvas'), fullInk)
  await page.mouse.click(box.x + 46, box.y + 12)
  await page.mouse.move(box.x + 80 + (box.width - 116) * 0.4, box.y + 130)
  await page.waitForTimeout(180)
  const linked = await page.locator('#comex .echart').evaluateAll(elements => elements.map(el => [...el.querySelectorAll('div')].find(t => t.style.position === 'absolute' && t.textContent.includes('观察日期'))?.textContent))
  assert.ok(linked.every(text => text?.includes(goldPoints[2][0])), '悬停应联动相同的真实观察日')
  assert.ok(linked[1].includes('较基期') && linked[1].includes('指数'))
  await page.mouse.move(0, 0)
  const before = await page.locator('#comex .comex-value').textContent()
  const count = requests.filter(r => r.url.includes('snapshot.json')).length
  await page.getByRole('button', { name: '重新加载展示数据' }).click()
  await loaded()
  assert.equal(requests.filter(r => r.url.includes('snapshot.json')).length, count + 1)
  assert.equal(await page.locator('#comex .comex-value').textContent(), before)
  assert.ok((await page.locator('.alert.success').textContent()).includes('已重新读取已发布的展示数据'))
  assert.deepEqual(blocked, [], '展示版不应尝试访问 API 或外部服务')
  assert.ok(requests.every(r => r.method === 'GET' && new URL(r.url).pathname.startsWith(target.pathname)))
  assert.deepEqual(errors, [])
  assert.deepEqual(consoleErrors, [])
  await page.route('**/data/snapshot.json', route => route.abort('failed'))
  await page.getByRole('button', { name: '重新加载展示数据' }).click()
  await page.getByRole('alert').filter({ hasText: '重新加载失败' }).waitFor()
  assert.equal(await page.locator('#comex .comex-value').textContent(), before)
  await page.unroute('**/data/snapshot.json')
  await page.getByRole('button', { name: '重新加载展示数据' }).click()
  await loaded()
  console.log(JSON.stringify({ passed: true, indicators: snapshot.publication.indicator_count, layouts, apiRequests: blocked.length,
    verified: ['built-page-under-subpath', 'relative-assets-and-json', 'no-backend-or-api-access', 'actual-chart-pixels', 'fund-region-date-and-health-filters', 'legend-switch', 'linked-tooltips', 'snapshot-reload-and-failure-retention', 'no-runtime-or-console-errors'] }))
} finally { await browser.close() }
