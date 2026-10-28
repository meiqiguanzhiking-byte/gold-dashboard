import { paddedExtent } from './adaptive-axis.js'

const colors = ['#0072B2', '#E69F00', '#569F69', '#CC79A7', '#6B7280', '#56B4E9', '#B78E5C', '#8E79B7', '#417D76', '#BA7580', '#87964B', '#6583A0', '#A37B53']
export const deliveryColor = month => colors[((Number(month.slice(0, 4)) * 12 + Number(month.slice(5))) % colors.length + colors.length) % colors.length]
export const deliveryNumber = (value, digits = 4) => value == null || !Number.isFinite(value) ? '未报告' : Math.abs(value).toLocaleString('zh-CN', { maximumFractionDigits: digits })
export const deliveryIssuedNumber = (value, digits = 4) => value == null || !Number.isFinite(value) ? '未报告' : (value === 0 ? '' : '-') + deliveryNumber(value, digits)
export function deliverySideColor(month, side) {
  const hex = deliveryColor(month).slice(1)
  const target = side === 'issued' ? 255 : 0
  const weight = side === 'issued' ? .48 : .1
  return '#' + [0, 2, 4].map(offset => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * (1 - weight) + target * weight).toString(16).padStart(2, '0')).join('')
}
const hasQuantity = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function deliveryView(product, selectedMonths, selectedLegend = {}, options = {}) {
  const months = (product?.months || []).filter(month => selectedMonths.includes(month))
  const allAccounts = product?.accounts || []
  const monthIndices = months.map(month => product.months.indexOf(month))
  const accounts = options.hideNoData ? allAccounts.filter(account => monthIndices.some(index => ['issued', 'stopped'].some(field => hasQuantity(account[field]?.[index])))) : allAccounts
  const series = months.flatMap(month => {
    const index = product.months.indexOf(month)
    return ['issued', 'stopped'].map(field => ({
      name: month, type: 'bar', stack: month, stackStrategy: 'samesign', barWidth: 8, barGap: '35%',
      itemStyle: { color: options.distinguishSides ? deliverySideColor(month, field) : deliveryColor(month) },
      label: { show: true, position: field === 'issued' ? 'left' : 'right', color: '#627477', fontSize: 9, distance: 4,
        formatter: point => point.value === 0 ? '' : field === 'issued' && options.distinguishSides ? deliveryIssuedNumber(point.value) : deliveryNumber(point.value) },
      emphasis: { focus: 'series' },
      data: accounts.map(account => {
        const value = account[field]?.[index]
        return hasQuantity(value) ? (field === 'issued' ? -value : value) : null
      }),
    }))
  })
  const values = series.filter(s => selectedLegend[s.name] !== false).flatMap(s => s.data).filter(v => v != null)
  const maximum = values.length ? Math.max(...values.map(Math.abs)) : 0
  const extent = paddedExtent(-maximum, maximum, true)
  const limit = Math.max(Math.abs(extent.min), Math.abs(extent.max))
  return { months, accounts, totalAccounts: allAccounts.length, series, min: -limit, max: limit,
    height: options.fixedHeight ?? Math.max(options.minimumHeight ?? 300, accounts.length * Math.max(40, months.length * 12 + 18) + 66),
    missing: accounts.reduce((n, account) => n + months.reduce((count, month) => {
      const i = product.months.indexOf(month)
      return count + ['issued', 'stopped'].filter(field => account[field]?.[i] == null).length
    }, 0), 0) }
}
