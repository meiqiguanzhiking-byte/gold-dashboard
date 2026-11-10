import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { buildPagesData } from '../pages-data.mjs'

const api = 'http://127.0.0.1:8011'
const dynamic = process.env.GOLD_AI_FRONTEND_URL || 'http://127.0.0.1:5175/'
const staticUrl = process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'
async function mode(value) {
  assert.equal((await fetch(api + '/test/model/' + value, { method: 'POST' })).status, 200)
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const errors = []
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(45000)
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text } }, configurable: true }) })
  return page
}
async function ai(page) { await page.locator('.report-status').filter({ hasText: 'AI优化（规则校验通过）' }).waitFor() }
async function rule(page) { await page.waitForFunction(() => document.querySelector('.report-status')?.textContent === '数值规则' && !document.querySelector('#daily-report-body')?.getAttribute('aria-busy')?.includes('true')) }

try {
  await mode('ok')
  for (const [payload, status] of [[{ thresholds: { shares: 2 } }, 422], [{ thresholds: { volume: -1 } }, 422], [{ source_version: 'old-batch' }, 409], [{ paragraphs: ['不得接受客户端自造底稿'] }, 422]]) {
    const response = await fetch(api + '/api/daily-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal(response.status, status)
  }
  const page = await newPage()
  const requests = []
  page.on('request', r => { if (r.url().includes('/api/daily-report')) requests.push(r.postDataJSON()) })
  await page.goto(dynamic)
  await ai(page)
  assert.equal(await page.locator('#daily-report-body p').count(), 3)
  assert.ok(await page.locator('.report-headline').textContent())
  assert.ok(await page.locator('#daily-report-body .report-indicator').count() > 0)
  assert.ok(await page.locator('#daily-report-body .report-value').count() > 0)
  const aiText = await page.locator('#daily-report-body').textContent()
  await page.getByRole('tab', { name: '数值规则', exact: true }).click()
  await rule(page)
  const ruleText = await page.locator('#daily-report-body').textContent()
  assert.notEqual(aiText, ruleText)
  await page.getByRole('tab', { name: 'AI优化', exact: true }).click()
  await ai(page)
  await page.getByRole('button', { name: '复制当前日报', exact: true }).click()
  const copied = await page.evaluate(() => window.__copied)
  assert.ok(copied.includes(await page.locator('.report-headline').textContent()))
  assert.ok(copied.includes('报告日期') && copied.includes('观察日期'))
  assert.ok(copied.includes((await page.locator('#daily-report-body p').allTextContents())[0]))
  await page.locator('#daily-report-body .report-indicator').first().click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('daily-movement'))
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const initial = requests.length
  await page.locator('#daily-threshold-volatility').fill('0.5')
  await ai(page)
  assert.equal(await page.locator('#daily-report-body').textContent(), aiText, '修改阈值仍能查看当天同一份AI日报')
  await page.getByRole('tab', { name: '数值规则', exact: true }).click()
  await rule(page)
  assert.equal(requests.length, initial, '滑块只更新本地规则版，不发送AI请求')
  await page.getByRole('tab', { name: 'AI优化', exact: true }).click()
  await ai(page)
  assert.equal(await page.locator('#daily-report-body').textContent(), aiText, '自定义阈值下切回AI仍读取当天保存稿')
  await page.locator('#daily-threshold-volatility').fill('1')
  await ai(page)
  assert.equal(requests.length, initial, '恢复默认阈值直接复用锁定AI')
  for (const failure of ['invalid', 'unavailable', 'timeout']) {
    await mode(failure)
    await page.locator('.refresh-button').click()
    await rule(page)
    await page.locator('.report-notice').filter({ hasText: failure === 'invalid' ? '未通过规则校验' : '暂不可用' }).waitFor()
    assert.equal(await page.locator('#daily-report-body p').count(), 3)
    assert.ok(!(await page.locator('#daily-report-body').textContent()).includes('999吨'))
  }
  // 数据刷新后会生成新批次AI；不保留上一失败或旧批次状态。
  await mode('ok')
  await page.locator('.refresh-button').click()
  await ai(page)
  console.log('动态版：真实后端协议、阈值、刷新、切换、复制、定位、模型校验/超时/不可用回退通过')
  await page.close()

  const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
  // 单独取测试模型生成结果，仅注入浏览器响应，绝不改写发布快照。
  const published = await (await fetch(api + '/test/public-report')).json()
  assert.equal(published.validation, 'passed')
  assert.equal(published.source_version, snapshot.generated_at)
  for (const success of [false, true]) {
    const page = await newPage()
    const calls = []
    page.on('request', r => { if (/\/api\/|8011|8000|chat\/completions/.test(r.url())) calls.push(r.url()) })
    {
      const daily_report = success ? published : { ...published, ai: null, status: 'rule', validation: 'not_run' }
      const bootstrap = buildPagesData({ ...snapshot, daily_report }).bootstrap
      await page.route(staticUrl, async route => {
        const response = await route.fetch()
        const html = (await response.text()).replace(/(<script[^>]*id="pages-bootstrap"[^>]*>)[\s\S]*?(<\/script>)/,
          (_, start, end) => start + JSON.stringify(bootstrap).replaceAll('<', '\\u003c') + end)
        await route.fulfill({ response, body: html })
      })
    }
    await page.goto(staticUrl)
    if (success) await ai(page)
    else await rule(page)
    assert.ok((await page.locator('#daily-text-report').textContent()).includes(snapshot.generated_at.slice(0, 10)))
    assert.ok((await page.locator('.report-dates').textContent()).includes('生成时间'))
    await page.getByRole('tab', { name: '数值规则', exact: true }).click()
    await rule(page)
    await page.getByRole('tab', { name: 'AI优化', exact: true }).click()
    if (success) await ai(page)
    else await rule(page)
    await page.locator('#daily-threshold-volatility').fill('0.5')
    if (success) await ai(page)
    else await rule(page)
    await page.locator('#daily-threshold-volatility').fill('1')
    if (success) await ai(page)
    await page.getByRole('button', { name: '复制当前日报', exact: true }).click()
    assert.ok((await page.evaluate(() => window.__copied)).includes('报告日期'))
    await page.locator('.refresh-button').click()
    // 刷新直接取真实已发布快照，回到实际的规则兜底状态。
    await page.waitForFunction(() => !document.querySelector('.refresh-button')?.disabled)
    await rule(page)
    assert.deepEqual(calls, [], 'GitHub展示模式严禁任何本地API或模型访问')
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('静态版：预生成AI/规则两种状态、切换、复制、冻结报告日、生成时间、阈值回退和零本地API请求通过')
} finally { await browser.close() }
