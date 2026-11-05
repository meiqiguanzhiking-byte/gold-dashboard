import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { beijingDate, buildDailyBrief, yearPercentile, yearStart, percentileGroups } from '../src/daily-brief.js'
import { expandSnapshot } from '../src/static-source.js'
import { buildPagesData } from '../pages-data.mjs'

assert.equal(yearStart('2024-02-29'), '2023-02-28')
assert.equal(yearStart('2026-01-05'), '2025-01-05')
assert.equal(yearStart('2026-02-30'), null)
const sample = [
  { observation_date: '2025-11-05', value: 0 },
  { observation_date: '2025-11-06', value: 2 },
  { observation_date: '2026-04-07', value: null },
  { observation_date: '2026-05-08', value: 4 },
  { observation_date: '2026-11-05', value: 2 },
  { observation_date: '2026-11-06', value: -1 },
]
assert.ok(Math.abs(yearPercentile(sample, '2026-11-05', 2) - 200 / 3) < 1e-10)
assert.equal(yearPercentile(sample.slice(3, 4), '2026-11-05', 2), null)
assert.equal(yearPercentile(sample, '2026-11-05', null), null)

const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const flatten = data => Object.entries(data).filter(([key]) => key !== 'meta').flatMap(([, group]) => group.indicators)
const items = flatten(expandSnapshot(snapshot))
const date = beijingDate()
const original = buildDailyBrief(items, date).movements
const compact = buildDailyBrief(flatten(expandSnapshot(buildPagesData(snapshot).bootstrap.snapshot)), date).movements
for (const row of original.filter(row => percentileGroups.has(row.group))) {
  const history = items.find(item => item.metadata.indicator_id === row.id).history
  assert.equal(row.yearPercentile, yearPercentile(history, row.date, row.value), row.id)
  assert.equal(compact.find(item => item.id === row.id)?.yearPercentile, row.yearPercentile, `静态首屏 ${row.id}`)
}
assert.ok(original.some(row => percentileGroups.has(row.group) && row.yearPercentile != null))
console.log('近一年分位数、缺失值及静态首屏一致性检查通过')
