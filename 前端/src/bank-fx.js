export const bankFxGroups = [
  { value: 'banks', label: '银行汇总' },
  { value: 'forward', label: '远期结售汇' },
  { value: 'outstanding', label: '本期末远期结售汇累计未到期额' },
  { value: 'options', label: '未到期期权Delta净敞口' },
]

const matching = (items, currency, group) => items.filter(item =>
  item.metadata.bank_fx_currency === currency && item.metadata.bank_fx_group === group)
const prefixOf = (prefix, path) => prefix.every((part, index) => path[index] === part)

export function bankFxLevels(items, currency, group, path) {
  const paths = matching(items, currency, group).map(item => item.metadata.bank_fx_path)
  const levels = []
  for (let depth = 0; depth <= path.length; depth++) {
    const prefix = path.slice(0, depth)
    const candidates = paths.filter(p => prefixOf(prefix, p))
    const children = [...new Set(candidates.map(p => p[depth]).filter(Boolean))]
    if (!children.length) break
    levels.push({ depth, total: candidates.some(p => p.length === depth), options: children })
    if (!path[depth]) break
  }
  return levels
}

export function bankFxSeries(items, currency, group, path) {
  const selected = matching(items, currency, group).filter(item =>
    JSON.stringify(item.metadata.bank_fx_path) === JSON.stringify(path))
  const paired = selected.some(item => item.metadata.bank_fx_leg === '结汇')
    && selected.some(item => item.metadata.bank_fx_leg === '售汇')
  return selected.map(item => {
    const leg = item.metadata.bank_fx_leg
    return { item, name: leg, color: ({ 结汇: '#287985', 售汇: '#ad945b' })[leg] || '#6d83ab',
      type: paired && leg !== '差额' ? 'bar' : 'line',
      stack: paired && leg !== '差额' ? 'bank-fx' : undefined,
      valueTransform: paired && leg === '售汇' ? value => value === 0 ? 0 : -value : undefined }
  })
}
