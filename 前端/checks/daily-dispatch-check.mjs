import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-breakpad', '--disable-logging'] })
const results = []
try {
  for (const [mode, url] of [
    ['dynamic', process.env.GOLD_FRONTEND_URL || 'http://127.0.0.1:5173/'],
    ['static', process.env.GOLD_PAGES_URL || 'http://127.0.0.1:4173/pages-preview/'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(45000)
    const errors = [], forbidden = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      if (mode === 'static' && /\/api\/|chat\/completions/.test(request.url())) forbidden.push(request.url())
    })
    await page.goto(url)
    const options = page.getByRole('navigation', { name: '每日速递栏目' })
    await options.waitFor()
    assert.equal(await options.getByRole('button').count(), 3)
    await page.locator('.daily-card').first().waitFor()
    const slider = page.locator('#daily-threshold-price')
    await slider.fill('0.7')
    const originalCards = await page.locator('.daily-card').count()
    await options.getByRole('button', { name: '每日资讯', exact: true }).click()
    const news = page.getByRole('region', { name: '每日资讯', exact: true })
    await news.waitFor()
    assert.equal(await page.getByRole('group', { name: '每日速递显示版块' }).isVisible(), false)
    if (mode === 'dynamic') {
      await news.locator('.news-timeline li').first().waitFor()
      assert.ok(await news.locator('a[href^="https://"]').count() > 0)
      assert.match(await news.locator('.news-period').textContent(), /北京时间/)
      await news.getByRole('button', { name: '地缘与金融风险', exact: true }).click()
      assert.ok((await news.locator('.news-event-time>span').allTextContents()).every(text => text === '地缘与金融风险'))
    } else {
      await news.locator('.news-placeholder').filter({ hasText: '静态版暂不展示' }).waitFor()
      assert.equal(await news.locator('.news-timeline li').count(), 0)
    }
    await options.getByRole('button', { name: '量化分析日报', exact: true }).click()
    await page.locator('.daily-quant').waitFor()
    assert.match(await page.locator('.daily-quant').textContent(), /后续接入/)
    await page.getByRole('tab', { name: '每日速递', exact: true }).hover()
    await page.getByRole('group', { name: '每日速递选项' }).getByRole('button', { name: '日频数据可视化', exact: true }).click()
    assert.equal(await slider.inputValue(), '0.7')
    assert.equal(await page.locator('.daily-card').count(), originalCards)
    assert.equal(await page.getByRole('group', { name: '每日速递显示版块' }).isVisible(), true)
    await page.setViewportSize({ width: 390, height: 900 })
    await options.getByRole('button', { name: '每日资讯', exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    assert.deepEqual(forbidden, [])
    results.push({ mode, childPages: 3, chartStatePreserved: true, staticApiCalls: forbidden.length, errors: errors.length })
    await page.close()
  }
  console.log(JSON.stringify(results))
} finally {
  await browser.close()
}
