import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { buildDailyBrief, beijingDate } from '../src/daily-brief.js'
import { expandSnapshot } from '../src/static-source.js'

const base = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const full = expandSnapshot(snapshot)
const model = buildDailyBrief(Object.entries(full).filter(([key]) => key !== 'meta').flatMap(([, group]) => group.indicators), beijingDate())
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const requests = [], errors = [], attempts = new Map()
let active = 0, maximum = 0, failCentral = true, failRefresh = false
page.on('request', r => { if (r.url().includes('/data/')) requests.push(r.url()) })
page.on('pageerror', e => errors.push(e.message))
await page.route('**/data/*.json', async route => {
  const url = route.request().url(), name = new URL(url).pathname.split('/').at(-1)
  attempts.set(name, (attempts.get(name) || 0) + 1)
  active++; maximum = Math.max(maximum, active)
  try {
    await new Promise(resolve => setTimeout(resolve, 80))
    if (name === 'snapshot.json') return await route.fulfill({ status: 503, body: 'Unavailable' })
    if (name.startsWith('central-bank-') && failCentral || name === 'bootstrap.json' && failRefresh || name.startsWith('price-') && attempts.get(name) === 1) {
      return await route.fulfill({ status: 503, body: 'Unavailable' })
    }
    return await route.continue()
  } finally { active-- }
})
async function ready() { await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled, null, { timeout: 60000 }) }
try {
  await page.goto(base)
  await ready()
  assert.equal(requests.length, 0, '首次打开每日速递不得依赖任何JSON下载')
  assert.equal(await page.locator('.daily-card').count(), 9)
  for (const card of model.cards) for (const row of card.rows) if (!row.stats) {
    assert.ok((await page.locator(`[data-daily-card="${card.id}"]`).textContent()).includes(row.valueText))
  }
  const daily = await page.locator('.daily-movements').textContent()
  await page.getByRole('tab', { name: '数据健康度', exact: true }).click()
  await ready()
  assert.equal(requests.length, 0, '健康度元信息也应随首屏直接可用')
  await page.getByRole('tab', { name: '国内', exact: true }).click()
  await ready()
  assert.ok(maximum <= 3, '同时最多下载三个分片')
  assert.ok([...attempts].some(([name, count]) => name.startsWith('price-') && count === 2), '临时失败应自动重试')
  assert.ok([...attempts].some(([name, count]) => name.startsWith('central-bank-') && count === 3), '持续失败应有界重试')
  assert.equal(await page.locator('.alert.error').count(), 1, '失败应局限于对应分类')
  assert.ok((await page.locator('.alert.error').textContent()).includes('央行购金'))
  await page.locator('#gold-price canvas').first().waitFor()
  assert.ok(!requests.some(url => /\/(?:cftc|inventory|deliveries)-/.test(url)), '国内页不应下载国外独有分类')
  await page.getByRole('tab', { name: '每日速递', exact: true }).click()
  assert.equal(await page.locator('.daily-movements').textContent(), daily, '历史加载失败不能清空首屏速递')
  const priceRequests = requests.filter(url => /\/price-/.test(url)).length
  failCentral = false
  await page.locator('.alert.error').getByRole('button', { name: '重试此区域' }).click()
  await ready()
  assert.equal(await page.locator('.alert.error').count(), 0)
  assert.equal(requests.filter(url => /\/price-/.test(url)).length, priceRequests, '重试一个分类不能重下其他分类')
  failRefresh = true
  await page.locator('.refresh-button').click()
  await ready()
  assert.ok((await page.locator('.alert.error').textContent()).includes('重新加载失败'))
  assert.equal(await page.locator('.daily-movements').textContent(), daily, '刷新失败保留已加载数据')
  failRefresh = false
  await page.locator('.refresh-button').click()
  await ready()
  assert.equal(requests.filter(url => /\/price-/.test(url)).length, priceRequests, '相同版本重载须复用成功分片')
  await page.reload()
  await ready()
  await page.getByRole('tab', { name: '国外', exact: true }).click()
  await ready()
  const months = new Set(snapshot.groups['central-bank'].filter(item => item.metadata.country && item.metadata.aggregation_included).flatMap(item => item.points.map(point => point[0])))
  assert.equal(await page.getByLabel('央行购金排名月份').locator('option').count(), months.size, '直接进入国外页也须加载央行全部历史')
  assert.ok(!requests.some(url => url.includes('snapshot.json')))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, initialJsonRequests: 0, maximumConcurrentDownloads: maximum,
    verified: ['embedded-daily-data', 'health-without-network', 'category-on-demand', 'bounded-retry', 'failure-isolation', 'retry-only-failed-category', 'refresh-failure-retains-data', 'reuse-versioned-chunks'] }))
} finally { await browser.close() }
