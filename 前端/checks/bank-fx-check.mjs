import assert from 'node:assert/strict'
import { bankFxLevels, bankFxSeries } from '../src/bank-fx.js'

const items = []
const paths = [[], ['银行自身'], ['银行代客'], ['银行代客', '经常项目'], ['银行代客', '经常项目', '货物贸易'], ['银行代客', '资本与金融项目'], ['银行代客', '资本与金融项目', '直接投资']]
for (const currency of ['cny', 'usd']) {
  for (const [group, choices] of [['banks', paths], ['forward', [['签约额'], ['平仓额'], ['展期额']]], ['outstanding', [[]]], ['options', [[]]]]) {
    for (const path of choices) {
      const legs = group === 'options' ? ['净敞口'] : group === 'forward' && path[0] !== '签约额' ? ['差额'] : ['结汇', '售汇', '差额']
      for (const leg of legs) items.push({ metadata: { bank_fx_currency: currency, bank_fx_group: group, bank_fx_path: path, bank_fx_leg: leg }, history: [{ observation_date: '2026-09', value: leg === '售汇' ? 80 : 100 }] })
    }
  }
}
const levels = bankFxLevels(items, 'cny', 'banks', ['银行代客', '经常项目'])
assert.deepEqual(levels.map(level => level.options), [['银行自身', '银行代客'], ['经常项目', '资本与金融项目'], ['货物贸易']])
assert.ok(levels.every(level => level.total))
for (const currency of ['cny', 'usd']) {
  for (const [group, path] of [['banks', []], ['banks', ['银行代客', '经常项目', '货物贸易']], ['forward', ['签约额']], ['outstanding', []]]) {
    const series = bankFxSeries(items, currency, group, path)
    assert.deepEqual(series.map(s => s.type), ['bar', 'bar', 'line'])
    assert.equal(series[1].valueTransform(80), -80)
    assert.equal(series[1].valueTransform(0), 0)
    assert.equal(series[1].item.history[0].value, 80)
    assert.ok(series.every(s => s.item.metadata.bank_fx_currency === currency))
  }
  for (const [group, path] of [['forward', ['平仓额']], ['forward', ['展期额']], ['options', []]]) {
    const series = bankFxSeries(items, currency, group, path)
    assert.equal(series.length, 1)
    assert.equal(series[0].type, 'line')
  }
}
console.log('Bank FX hierarchy, chart types and sale sign passed')
