// 同一浏览器、禁用缓存，记录首屏与栏目完整加载；可选固定4Mbps/150ms网络。
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'

const base = process.env.GOLD_PAGES_URL || 'https://meiqiguanzhiking-byte.github.io/gold-dashboard/'
const profile = process.env.GOLD_SPEED_PROFILE || 'current-network'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
if (profile === '4mbps-150ms') await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 150, downloadThroughput: 4 * 1000 * 1000 / 8, uploadThroughput: 1000 * 1000 / 8,
})
const errors = [], failures = [], stages = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }) })
const ready = () => page.waitForFunction(() => document.querySelector('.refresh-button')?.disabled === false, null, { timeout: 180000 })
async function record(stage, started) {
  const result = await page.evaluate(() => ({
    at: performance.now(),
    resources: performance.getEntriesByType('resource').map(e => ({ name: e.name, ms: Math.round(e.duration), transfer: e.transferSize, encoded: e.encodedBodySize })),
    navigation: performance.getEntriesByType('navigation').map(e => ({ ttfbMs: Math.round(e.responseStart), htmlBytes: e.encodedBodySize }))[0],
    fcpMs: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
  }))
  const resources = result.resources.filter(r => !seen.has(r.name))
  result.resources.forEach(r => seen.add(r.name))
  const row = { stage, elapsedMs: Math.round(result.at - started), requests: resources.length,
    jsonRequests: resources.filter(r => /\/data\//.test(r.name)).length,
    transferredBytes: resources.reduce((n, r) => n + r.transfer, 0),
    encodedBytes: resources.reduce((n, r) => n + r.encoded, 0),
    slowest: resources.sort((a, b) => b.ms - a.ms).slice(0, 3).map(r => ({ file: r.name.split('/').at(-1), ms: r.ms })),
    ...(stage === 'daily' ? { navigation: result.navigation, fcpMs: result.fcpMs } : {}) }
  stages.push(row)
  console.log(JSON.stringify(row))
}
const seen = new Set()
try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await ready()
  await page.locator('#daily-brief .daily-card').nth(24).waitFor()
  await record('daily', 0)
  for (const [name, selector] of [['国内', '#gold-price canvas'], ['国外', '#overseas-price canvas']]) {
    const started = await page.evaluate(() => performance.now())
    await page.getByRole('tab', { name, exact: true }).click()
    await ready()
    await page.locator(selector).first().scrollIntoViewIfNeeded()
    await page.locator(selector).first().waitFor()
    await record(name === '国内' ? 'domestic' : 'foreign-after-domestic', started)
  }
  const result = { base, profile, measuredAt: new Date().toISOString(), cache: 'disabled', stages, errors, failures }
  if (process.env.GOLD_SPEED_OUTPUT) await writeFile(process.env.GOLD_SPEED_OUTPUT, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ complete: true, errors, failures }))
  if (errors.length || await page.locator('.alert.error').count()) process.exitCode = 1
} finally { await browser.close() }
