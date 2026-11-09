import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { expandSnapshot } from '../src/static-source.js'
import { futuresContinuousSeries } from '../src/international-futures.js'
import { filteredHistory } from '../src/data.js'

const snapshot = JSON.parse(await readFile(new URL('../../展示版/数据/data/snapshot.json', import.meta.url), 'utf8'))
const items = expandSnapshot(snapshot).price.indicators
assert.deepEqual(futuresContinuousSeries([], 'comex'), [])
for (const product of ['comex', 'sgx_usdcnh']) {
  const source = items.find(item => item.metadata.indicator_id === `intl_futures_main_${product}`)
  assert.ok(source?.history.length)
  assert.equal(source.metadata.source, '黄金期货主力合约.csv')
  const actual = futuresContinuousSeries(items, product, 'ALL', 'actual')[0].item
  const adjusted = futuresContinuousSeries(items, product, 'ALL')[0].item
  let cumulative = 0, complete = true, switches = 0
  for (let index = source.history.length - 1; index >= 0; index--) {
    const row = JSON.parse(source.history[index].value)
    assert.equal(actual.history[index].source_contract, row.contract)
    assert.equal(actual.history[index].value, row.raw_value)
    const expected = complete && row.raw_value != null ? row.raw_value + cumulative : null
    assert.equal(adjusted.history[index].value, expected)
    if (row.rollover) {
      switches++
      assert.ok(row.rollover.from !== row.rollover.to)
      if (row.rollover.gap == null) complete = false
      else {
        assert.equal(row.rollover.gap, row.rollover.new_price - row.rollover.old_price)
        cumulative += row.rollover.gap
      }
    }
  }
  assert.equal(adjusted.history.at(-1).value, actual.history.at(-1).value)
  assert.ok(switches > 0)
  assert.deepEqual(futuresContinuousSeries(items, product, '1Y')[0].item.history, filteredHistory(adjusted, '1Y'))
  console.log(JSON.stringify({ product, records: source.history.length, switches, latest: adjusted.history.at(-1).value, passed: true }))
}
