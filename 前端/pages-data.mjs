import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const encode = value => JSON.stringify(value)
export const chunkLimit = 96 * 1024

// 所有派生文件均来自同一份已审阅快照；保留每个原值、空值与观察日期。
export function buildPagesData(snapshot) {
  const assets = new Map()
  const categories = {}
  for (const [category, items] of Object.entries(snapshot.groups)) {
    const batches = []
    let batch = [], bytes = 0
    for (const item of items) for (let offset = 0; offset < item.points.length; offset += 1000) {
      const segment = { id: item.metadata.indicator_id, offset, points: item.points.slice(offset, offset + 1000) }
      const length = Buffer.byteLength(encode(segment))
      if (bytes + length > chunkLimit - 1024 && batch.length) { batches.push(batch); batch = []; bytes = 0 }
      batch.push(segment)
      bytes += length + 1
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
  // 首屏随HTML携带最新两期，延期费保留30期；全量元信息供健康度页直接使用。
  const compact = { ...snapshot, groups: Object.fromEntries(Object.entries(snapshot.groups).map(([key, items]) => [key,
    items.map(item => ({ ...item, points: item.points.slice(item.metadata.indicator_id === 'au_td_delivery_direction' ? -30 : -2) })),
  ])) }
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
