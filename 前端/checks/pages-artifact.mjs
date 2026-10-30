import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildPagesData, chunkLimit } from '../pages-data.mjs'
import { expandSnapshot } from '../src/static-source.js'
import { buildDailyBrief, beijingDate } from '../src/daily-brief.js'
import { gzipSync } from 'node:zlib'

const project = fileURLToPath(new URL('../../', import.meta.url))
export const snapshotPath = path.join(project, '展示版/数据/data/snapshot.json')
export const distPath = path.join(project, '展示版/dist')
const snapshotOnly = process.argv.includes('--snapshot-only')
const forbidden = /\b[A-Za-z]:[\\/]|localhost|127\.0\.0\.1|\/api\/|Traceback|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|C:\\Users\\|D:\\兴证资管/i
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
assert.equal(snapshot.schema_version, 1)
assert.ok(!forbidden.test(JSON.stringify(snapshot)), '快照不得包含本机地址、路径、接口或密钥')
assert.deepEqual(Object.keys(snapshot).filter(key => key !== 'deliveries').sort(), ['comex', 'files', 'generated_at', 'groups', 'publication', 'schema_version'])
if (snapshot.deliveries) {
  assert.equal(snapshot.deliveries.source, '黄金交割.xlsx')
  assert.equal(snapshot.deliveries.unit, '吨')
  assert.equal(snapshot.deliveries.release_date, null)
  for (const [symbol, product] of Object.entries(snapshot.deliveries.contracts)) {
    assert.ok(['GC', 'MGC'].includes(symbol))
    assert.deepEqual(product.months, [...new Set(product.months)].sort())
    assert.equal(new Set(product.accounts.map(a => a.institution)).size, product.accounts.length)
    assert.ok(product.available_months.every(month => product.months.includes(month)))
    for (const account of product.accounts) {
      assert.match(account.institution, /\[[CH]\]$/)
      for (const side of ['issued', 'stopped']) {
        assert.equal(account[side].length, product.months.length)
        assert.ok(account[side].every(value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0))
      }
    }
  }
}
assert.equal(snapshot.publication.indicator_count, Object.values(snapshot.groups).reduce((n, rows) => n + rows.length, 0))
const ids = new Set()
const policy = JSON.parse(await readFile(path.join(project, '展示版/公开范围.json'), 'utf8'))
for (const rows of Object.values(snapshot.groups)) for (const item of rows) {
  assert.deepEqual(Object.keys(item).sort(), ['metadata', 'notes', 'points'])
  assert.ok(!ids.has(item.metadata.indicator_id))
  ids.add(item.metadata.indicator_id)
  assert.ok(item.metadata.unit && item.metadata.frequency)
  assert.deepEqual(item.points.map(p => p[0]), item.points.map(p => p[0]).sort())
  assert.ok(item.points.every(p => p.length === 2 && (p[1] === null || typeof p[1] === 'string' || Number.isFinite(p[1]))))
  assert.ok(!('source_column' in item.metadata) && !('component_columns' in item.metadata))
  const priceSources = item.metadata.input_sources || [item.metadata.source]
  if (['黄金现货价格.xlsx', '伦敦金现与汇率_北京时间1530收盘价.xlsx'].includes(item.metadata.source) && priceSources.some(source => policy.source_permissions?.[source] !== 'approved' || policy.withheld_sources.includes(source))) {
    assert.equal(item.points.length, 0, '未获准的价格及派生波动率不得导出历史或数值')
    assert.equal(item.metadata.publication_withheld, true)
    assert.equal(item.metadata.coverage_start, null)
    assert.equal(item.metadata.coverage_end, null)
    assert.equal(item.metadata.valid_count, 0)
    assert.equal(item.metadata.updated_at, null)
  }
}
for (const id of ['gold_price_anchor', 'gold_hv20', 'gold_hv60', 'london_gold_spot', 'usdcnh', 'gold_domestic_spread']) assert.ok(ids.has(id), '静态版应保留新指标或明确的缺失占位')
for (const id of ['domestic_etf_total_shares', 'au_td_close']) assert.ok(ids.has(id), '每日速递应保留合计份额与收盘价缺失占位')
const totalShares = snapshot.groups.etf.find(item => item.metadata.indicator_id === 'domestic_etf_total_shares')
if (!totalShares.metadata.publication_withheld) {
  const funds = policy.fund_codes.map(code => snapshot.groups.etf.find(item => item.metadata.indicator_id === `domestic_${code}_shares`))
  assert.ok(funds.every(Boolean), '总份额曲线须保留同口径七只基金')
  const dates = [...new Set(funds.flatMap(item => item.points.map(([date]) => date)))].sort()
  const maps = funds.map(item => new Map(item.points))
  assert.deepEqual(totalShares.points.map(([date]) => date), dates, '总份额曲线必须保留与分基金相同的完整历史，不能仅导出最新两期')
  for (const [date, value] of totalShares.points) {
    const values = maps.map(points => points.get(date))
    const complete = values.every(value => typeof value === 'number' && Number.isFinite(value))
    if (complete) assert.ok(typeof value === 'number' && Math.abs(value - values.reduce((sum, value) => sum + value, 0)) < 1e-6, `总份额须等于同日七只基金之和：${date}`)
    else assert.equal(value, null, `缺项不补零：${date}`)
  }
}
assert.ok(!ids.has('spdr_close') && !ids.has('spdr_volume') && !ids.has('cftc_trading_volume'))
assert.ok([...ids].filter(id => /^domestic_/.test(id)).every(id => !id.endsWith('_nav')))
const prepared = buildPagesData(snapshot)
const initial = expandSnapshot(prepared.bootstrap.snapshot)
const full = expandSnapshot(snapshot)
const flatten = groups => Object.entries(groups).filter(([key]) => key !== 'meta').flatMap(([, group]) => group.indicators)
assert.deepEqual(buildDailyBrief(flatten(initial), beijingDate(snapshot.generated_at)), buildDailyBrief(flatten(full), beijingDate(snapshot.generated_at)), '首屏精简数据必须保留全部速递数值、日期和比较基准')
for (const [category, paths] of Object.entries(prepared.bootstrap.categories)) {
  const rebuilt = prepared.bootstrap.snapshot.groups[category].map(item => ({ ...item, points: [] }))
  const byId = new Map(rebuilt.map(item => [item.metadata.indicator_id, item]))
  for (const file of paths) {
    const content = prepared.assets.get(file)
    assert.ok(Buffer.byteLength(content) <= chunkLimit)
    const part = JSON.parse(content)
    assert.equal(part.generated_at, snapshot.generated_at)
    for (const segment of part.segments) {
      const item = byId.get(segment.id)
      assert.equal(item.points.length, segment.offset)
      item.points.push(...segment.points)
    }
  }
  assert.deepEqual(rebuilt, snapshot.groups[category], '历史拆分重组必须逐值一致：' + category)
}
if (!snapshotOnly) {
  async function walk(dir) {
    const files = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) files.push(...await walk(p))
      else files.push(p)
    }
    return files
  }
  const files = await walk(distPath)
  for (const file of files) {
    assert.ok(/\.(html|js|css|svg|json)$/.test(file), '展示产物只允许网站资源：' + path.basename(file))
    const content = await readFile(file, 'utf8')
    assert.ok(!forbidden.test(content), '构建产物包含本机地址、路径或接口：' + path.basename(file))
  }
  assert.equal(files.filter(f => f.endsWith('.json')).length, prepared.assets.size + 1)
  for (const [name, content] of prepared.assets) assert.equal(await readFile(path.join(distPath, name), 'utf8'), content)
  const html = await readFile(path.join(distPath, 'index.html'), 'utf8')
  const embedded = html.match(/<script[^>]*id="pages-bootstrap"[^>]*>([\s\S]*?)<\/script>/)?.[1]
  assert.deepEqual(JSON.parse(embedded), prepared.bootstrap, '首屏数据必须内嵌HTML，无需另行下载JSON')
  assert.deepEqual(JSON.parse(await readFile(path.join(distPath, 'data/snapshot.json'), 'utf8')), snapshot)
}
console.log(JSON.stringify({ passed: true, scope: snapshotOnly ? 'snapshot' : 'snapshot-and-built-artifact', indicators: ids.size, rawFilesIncluded: false,
  bootstrapBytes: Buffer.byteLength(JSON.stringify(prepared.bootstrap)), bootstrapGzipBytes: gzipSync(JSON.stringify(prepared.bootstrap)).length, historyChunkLimit: chunkLimit }))
