import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const project = fileURLToPath(new URL('../../', import.meta.url))
export const snapshotPath = path.join(project, '展示版/数据/data/snapshot.json')
export const distPath = path.join(project, '展示版/dist')
const snapshotOnly = process.argv.includes('--snapshot-only')
const forbidden = /\b[A-Za-z]:[\\/]|localhost|127\.0\.0\.1|\/api\/|Traceback|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|C:\\Users\\|D:\\兴证资管/i
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
assert.equal(snapshot.schema_version, 1)
assert.ok(!forbidden.test(JSON.stringify(snapshot)), '快照不得包含本机地址、路径、接口或密钥')
assert.deepEqual(Object.keys(snapshot).sort(), ['comex', 'files', 'generated_at', 'groups', 'publication', 'schema_version'])
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
assert.ok(!ids.has('spdr_close') && !ids.has('spdr_volume') && !ids.has('cftc_trading_volume'))
assert.ok([...ids].filter(id => /^domestic_/.test(id)).every(id => !id.endsWith('_nav')))
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
  assert.equal(files.filter(f => f.endsWith('.json')).length, 1)
  assert.deepEqual(JSON.parse(await readFile(path.join(distPath, 'data/snapshot.json'), 'utf8')), snapshot)
}
console.log(JSON.stringify({ passed: true, scope: snapshotOnly ? 'snapshot' : 'snapshot-and-built-artifact', indicators: ids.size, rawFilesIncluded: false }))
