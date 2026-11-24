// 在展示层计算，保留源数据；不将稀疏的月度值向日频填充。
const definitions = [
  ['fx_total_net_ratio', '总体净结汇比例', '银行汇总'],
  ['fx_securities_net_ratio', '证券投资净结汇比例', '银行汇总 · 银行代客 · 资本与金融项目 · 证券投资'],
  ['fx_new_forward_net_ratio', '新增远期净结汇比例', '远期结售汇 · 签约额'],
  ['fx_outstanding_forward_net_ratio', '未到期远期净结汇比例', '本期末远期结售汇累计未到期额'],
]
const finite = value => typeof value === 'number' && Number.isFinite(value)
const monthIndex = day => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7))

export function simplifyFxFactors(source) {
  const retained = source.columns.map((column, index) => ({ column, index: index + 1 })).filter(({ column }) => column.group !== '外汇供求')
  // 全部输入统一使用亿美元，避免同一因子重复呈现人民币和美元口径。
  const indexOf = name => {
    const index = source.columns.findIndex(column => column.name === name && column.unit === '亿美元')
    return index < 0 ? null : index + 1
  }
  const ratios = definitions.map(([id, name, path]) => ({ id, name, group: '外汇供求', unit: '%',
    inputs: ['差额', '结汇', '售汇'].map(field => indexOf(`银行结售汇 · ${path} · ${field}`)),
    formula: '同一项目差额 ÷（结汇＋售汇）×100%；使用亿美元原值，分母须大于0。' })).filter(column => column.inputs.every(index => index != null))
  const deltaIndex = indexOf('银行结售汇 · 未到期期权Delta净敞口 · 净敞口')
  const monthlyDelta = new Map()
  if (deltaIndex != null) for (const point of source.points) {
    if (finite(point[deltaIndex])) monthlyDelta.set(monthIndex(point[0]), point[deltaIndex])
  }
  const derived = [...ratios, ...(deltaIndex == null ? [] : [{ id: 'fx_option_delta_change', name: '期权 Delta 净敞口变化', group: '外汇供求', unit: '亿美元',
    formula: '当月未到期期权Delta净敞口−上一自然月原值；首月或相邻月份缺失则留空，沿用原字段符号。' }])]
  const points = source.points.map(point => {
    const ratioValues = ratios.map(({ inputs }) => {
      const [net, buy, sell] = inputs.map(index => index == null ? null : point[index])
      return [net, buy, sell].every(finite) && buy + sell > 0 ? net / (buy + sell) * 100 : null
    })
    const current = deltaIndex == null ? null : point[deltaIndex]
    const previous = monthlyDelta.get(monthIndex(point[0]) - 1)
    const change = finite(current) && finite(previous) ? current - previous : null
    return [point[0], ...retained.map(({ index }) => point[index]), ...ratioValues, ...(deltaIndex == null ? [] : [change])]
  })
  const columns = [...retained.map(({ column }) => column), ...derived.map(({ inputs, ...column }) => column)]
  for (let i = retained.length; i < columns.length; i++) {
    const dates = points.filter(point => finite(point[i + 1])).map(point => point[0])
    Object.assign(columns[i], { missing: points.length - dates.length, start: dates[0] || null, end: dates.at(-1) || null })
  }
  return { ...source, columns, points }
}
