import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dailyThresholdGroups, yearStart, percentileGroups } from './src/daily-brief.js'

const encode = value => JSON.stringify(value)
export const chunkLimit = 96 * 1024

// 所有派生文件均来自同一份已审阅快照；保留每个原值、空值与观察日期。
export function buildPagesData(snapshot) {
  const assets = new Map()
  const categories = {}
  for (const [category, items] of Object.entries(snapshot.groups)) {
    const batches = []
    let batch = [], bytes = 0
    for (const item of items) for (let offset = 0; offset < item.points.length;) {
      let count = Math.min(1000, item.points.length - offset)
      let segment, length
      // 合约悬浮明细含较长中文文本，按实际UTF-8字节限制拆分。
      do {
        segment = { id: item.metadata.indicator_id, offset, points: item.points.slice(offset, offset + count) }
        length = Buffer.byteLength(encode(segment))
        if (length <= chunkLimit - 1024) break
        if (count === 1) throw new Error('单条静态数据超出分片大小上限')
        count = Math.max(1, Math.floor(count / 2))
      } while (true)
      if (bytes + length > chunkLimit - 1024 && batch.length) { batches.push(batch); batch = []; bytes = 0 }
      batch.push(segment)
      bytes += length + 1
      offset += count
    }
    if (batch.length) batches.push(batch)
    categories[category] = batches.map(segments => {
      const source = encode({ generated_at: snapshot.generated_at, category, segments })
      if (Buffer.byteLength(source) > chunkLimit) throw new Error('静态数据分片超出大小上限')
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
      const name = `data/${category}-${hash}.json`
      assets.set(name, source)
      return name
    })
  }
  // 日报固定20期现货统计、同合约期货比较；保留空值及期限结构所需历史。
  const briefHistoryLimits = { gold_price_anchor: 20, london_gold_spot: 20, usdcnh: 20, gold_futures_daily_quotes: 20,
    au_td_delivery_direction: 30, gold_domestic_spread: 11, gold_futures_spread: 11, gold_futures_secondary_spread: 11, gold_futures_spread_details: 11 }
  const percentileIds = new Set(dailyThresholdGroups.filter(group => percentileGroups.has(group.id)).flatMap(group => group.indicators.map(indicator => indicator.id)))
  const futuresDates = new Set((snapshot.groups.price?.find(item => item.metadata.indicator_id === 'gold_futures_daily_quotes')?.points || []).slice(-2).flatMap(point => {
    let quotes = []
    try { quotes = JSON.parse(point[1])?.quotes || [] } catch { /* 保留缺失明细，不另取价格基准。 */ }
    return [point[0], ...quotes.map(quote => quote.previous_date).filter(Boolean)]
  }))
  const briefPoints = item => item.metadata.indicator_id === 'gold_price_anchor'
    ? item.points.filter((point, index) => index >= item.points.length - briefHistoryLimits.gold_price_anchor || futuresDates.has(point[0]))
    : percentileIds.has(item.metadata.indicator_id)
      ? item.points.filter((point, index) => index >= item.points.length - (briefHistoryLimits[item.metadata.indicator_id] || 2) || point[0] > yearStart(item.points.at(-1)?.[0]))
      : item.points.slice(-(briefHistoryLimits[item.metadata.indicator_id] || 2))
  const compact = { ...snapshot, groups: Object.fromEntries(Object.entries(snapshot.groups).map(([key, items]) => [key,
    items.map(item => ({ ...item, points: briefPoints(item) })),
  ])) }
  compact.delivery_coverage = Object.fromEntries(Object.entries(snapshot.deliveries?.contracts || {}).map(([symbol, contract]) => [symbol,
    { coverage_start: contract.coverage_start, coverage_end: contract.coverage_end },
  ]))
  delete compact.deliveries
  const inventory = encode({ generated_at: snapshot.generated_at, deliveries: snapshot.deliveries ?? null })
  const inventoryName = `data/deliveries-${createHash('sha256').update(inventory).digest('hex').slice(0, 16)}.json`
  assets.set(inventoryName, inventory)
  const bootstrap = { schema_version: 1, snapshot: compact, categories, deliveries: inventoryName }
  assets.set('data/bootstrap.json', encode(bootstrap))
  return { bootstrap, assets }
}

export function pagesDataPlugin() {
  let prepared
  return {
    name: 'pages-snapshot-data',
    apply: 'build',
    buildStart() {
      prepared = buildPagesData(JSON.parse(readFileSync(new URL('../展示版/数据/data/snapshot.json', import.meta.url), 'utf8')))
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { id: 'pages-bootstrap', type: 'application/json' },
        children: encode(prepared.bootstrap).replace(/</g, '\\u003c'), injectTo: 'head-prepend' }]
    },
    generateBundle() {
      for (const [fileName, source] of prepared.assets) this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
