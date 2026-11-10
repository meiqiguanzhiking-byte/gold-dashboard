import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expandSnapshot } from '../src/static-source.js'
import { readLiveBatch } from '../src/dashboard-refresh.js'
import { beijingDate, buildDailyBrief, dailyThresholdGroups, filterDailyMovements } from '../src/daily-brief.js'
import { buildDailyReport } from '../src/daily-report.js'

// 所有API由浏览器拦截，不触碰生产刷新和付费模型。
const categories = ['etf', 'futures', 'cftc', 'au-td', 'central-bank', 'inventory', 'price']
let calls = 0
const consistent = key => ({ loaded_at: 'batch-2', ...(key === 'meta' ? {} : { indicators: [] }) })
await assert.rejects(readLiveBatch(async key => {
  if (key === 'etf') throw Error('offline')
  return consistent(key)
}, categories), /etf/)
const retried = await readLiveBatch(async key => {
  const round = Math.floor(calls++ / 8)
  return { ...consistent(key), loaded_at: !round && key === 'price' ? 'batch-1' : 'batch-2' }
}, categories)
assert.equal(retried.price.loaded_at, 'batch-2')
assert.equal(calls, 16)
await assert.rejects(readLiveBatch(async key => ({ ...consistent(key), loaded_at: key === 'price' ? 'other' : 'batch-2' }), categories), /批次/)

const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const batches = [expandSnapshot(snapshot), expandSnapshot(snapshot)]
const today = beijingDate()
for (const [index, batch] of batches.entries()) {
  for (const key of [...categories, 'meta']) batch[key].loaded_at = `2026-11-10T00:00:0${index}+00:00`
}
const priceRow = batches[1].price.indicators.find(row => row.metadata.indicator_id === 'au_td_close')
priceRow.history.at(-1).value += 1
priceRow.latest.value = priceRow.history.at(-1).value
const thresholds = Object.fromEntries(dailyThresholdGroups.map(group => [group.id, group.initial]))
const ruleFor = batch => {
  const items = categories.flatMap(key => batch[key].indicators)
  const brief = buildDailyBrief(items, today)
  return buildDailyReport(items, today, brief, filterDailyMovements(brief.movements, thresholds), thresholds)
}
const rules = batches.map(ruleFor)
const savedAi = { ...rules[0], title: '黄金市场每日行情观察' }
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(45000)
  await page.addInitScript(() => {
    const interval = window.setInterval.bind(window)
    window.__batchPolls = []
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 30000) window.__batchPolls.push(() => callback(...args))
      return interval(callback, delay, ...args)
    }
  })
  let batchIndex = 0, mode = 'ok', reloads = 0, reportReads = 0
  let releaseReload, reloadEntered
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(5)
    const json = (value, status = 200) => route.fulfill({ status, json: value })
    if (path === 'health') return json({ status: 'ok', loaded_at: batches[batchIndex].meta.loaded_at })
    if (path === 'reload') {
      reloads++
      reloadEntered?.()
      if (mode === 'delayed') await new Promise(resolve => { releaseReload = resolve })
      if (mode === 'reload-failure') return json({ detail: 'read failed' }, 503)
      batchIndex = 1
      return json({ status: 'ok', loaded_at: batches[1].meta.loaded_at })
    }
    if (path === 'daily-report') {
      reportReads++
      return json({ ...snapshot.daily_report, status: 'ai', validation: 'passed', ai: savedAi,
        report_date: today, source_version: batches[batchIndex].meta.loaded_at,
        rule: rules[batchIndex], ai_matches_current: batchIndex === 0 })
    }
    if (path === 'etf' && mode === 'category-failure') return json({ detail: 'offline' }, 503)
    if (categories.includes(path) || path === 'meta') {
      const result = batches[batchIndex][path]
      return json(mode === 'mixed' && path === 'price' ? { ...result, loaded_at: 'old-batch' } : result)
    }
    throw Error('Unexpected API: ' + path)
  })
  await page.goto(process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/')
  const button = page.getByRole('button', { name: '刷新真实数据', exact: true })
  await button.waitFor()
  await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
  await page.locator('.report-status').filter({ hasText: 'AI优化（规则校验通过）' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.daily-main-metrics')?.textContent.includes('读取中'))
  const aiText = await page.locator('#daily-report-body').textContent()
  const before = await page.locator('.daily-main-metrics').allTextContents()
  const refreshedTime = await page.locator('.data-summary').textContent()
  const sliders = await page.getByRole('slider').count()
  assert.equal(sliders, 7)
  await page.locator('#daily-threshold-volatility').fill('0.5')
  await page.getByRole('tab', { name: '数值规则', exact: true }).click()
  await page.getByRole('tab', { name: 'AI优化', exact: true }).click()
  assert.equal(await page.locator('#daily-report-body').textContent(), aiText)
  // AI中被当前筛选排除的指标也必须可定位。
  const linked = page.locator('#daily-report-body .report-indicator').filter({ hasText: '波动率' }).first()
  if (await linked.count()) {
    const id = (await linked.getAttribute('href')).slice(1)
    await page.locator('#daily-threshold-volatility').fill('5')
    await linked.click()
    assert.equal(await page.locator('#' + id).isVisible(), true)
  }
  const settled = () => page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
  for (const failure of ['reload-failure', 'category-failure', 'mixed']) {
    mode = failure
    await button.click()
    await settled()
    await page.locator('.alert.error').filter({ hasText: '页面保留上次完整数据' }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.daily-main-metrics')?.textContent.includes('读取中'))
    assert.deepEqual(await page.locator('.daily-main-metrics').allTextContents(), before)
    assert.equal(await page.locator('.data-summary').textContent(), refreshedTime)
    await page.locator('.report-status').filter({ hasText: 'AI优化（规则校验通过）' }).waitFor()
    assert.equal(await page.locator('#daily-report-body').textContent(), aiText)
  }
  mode = 'delayed'
  const entered = new Promise(resolve => { reloadEntered = resolve })
  await button.click()
  await entered
  assert.equal(await page.locator('.refresh-button').isDisabled(), true)
  assert.match(await page.locator('.report-loading').textContent(), /读取/)
  // 快速重复触发点击也只能发出一次刷新请求。
  const count = reloads
  await page.locator('.refresh-button').evaluate(el => { el.click(); el.click() })
  assert.equal(reloads, count)
  releaseReload()
  await settled()
  assert.notDeepEqual(await page.locator('.daily-main-metrics').allTextContents(), before)
  assert.equal(await page.locator('.alert.error').count(), 0)
  await page.locator('.report-status').filter({ hasText: 'AI优化（规则校验通过）' }).waitFor()
  assert.equal(await page.locator('#daily-report-body').textContent(), aiText)
  assert.match(await page.locator('.report-notice').textContent(), /今日已保存稿/)
  await page.getByRole('tab', { name: '数值规则', exact: true }).click()
  assert.notEqual(await page.locator('#daily-report-body').textContent(), aiText)
  assert.equal(await page.locator('.daily-card').count(), before.length)
  assert.equal(await page.getByRole('slider').count(), sliders)
  // 模拟后端自动加载了新批次，页面轮询只读同步，不发起手动刷新。
  mode = 'ok'
  batchIndex = 0
  const manualReloads = reloads
  await page.evaluate(() => Promise.all(window.__batchPolls.map(callback => callback())))
  await settled()
  assert.deepEqual(await page.locator('.daily-main-metrics').allTextContents(), before)
  batchIndex = 1
  await page.evaluate(() => Promise.all(window.__batchPolls.map(callback => callback())))
  await settled()
  assert.notDeepEqual(await page.locator('.daily-main-metrics').allTextContents(), before)
  assert.equal(reloads, manualReloads, '自动同步不能调用POST刷新或触发付费生成')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, atomicRefresh: true, failuresKeepCompleteBatch: true,
    duplicateRefreshBlocked: true, automaticBatchSync: true, lockedAiRemainsReadable: true, reportLinks: true, reportReads, paidModelCalls: 0 }))
} finally { await browser.close() }
