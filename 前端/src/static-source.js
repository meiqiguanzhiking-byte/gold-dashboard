export const isStatic = true
let bootstrapPromise
let activeDownloads = 0
const waiting = [], resources = new Map(), groups = new Map()

export function expandSnapshot(snapshot) {
  if (snapshot.schema_version !== 1 || !snapshot.generated_at || !snapshot.groups) throw new Error('展示数据格式不受支持，请重新生成并发布')
  const groups = Object.fromEntries(Object.entries(snapshot.groups).map(([category, items]) => [category, {
    indicators: items.map(item => {
      const history = item.points.map(([observation_date, value]) => ({ observation_date, value, release_date: null }))
      const latest = history.at(-1) || { observation_date: null, value: null, release_date: null }
      const previous = history.at(-2)
      const change = typeof latest.value === 'number' && typeof previous?.value === 'number' ? latest.value - previous.value : null
      const change_pct = item.metadata.change_kind === 'absolute_and_percent' && change != null && previous.value !== 0 ? change / previous.value * 100 : null
      return { metadata: item.metadata, history, latest: { ...latest, change, change_pct, change_unit: item.metadata.change_unit }, warnings: item.notes }
    }),
    loaded_at: snapshot.generated_at,
    ...(category === 'inventory' ? { comex: snapshot.comex, deliveries: snapshot.deliveries } : {}),
  }]))
  return { ...groups, meta: { loaded_at: snapshot.generated_at, generated_at: snapshot.generated_at, files: snapshot.files,
    indicators: Object.values(groups).flatMap(group => group.indicators.map(item => item.metadata)), publication: snapshot.publication } }
}

async function download(path, fresh = false) {
  if (!/^(?:data\/)[a-z0-9-]+\.json$/.test(path)) throw new Error('展示数据路径无效')
  if (activeDownloads >= 3) await new Promise(resolve => waiting.push(resolve))
  else activeDownloads++
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60000)
      let retry = true
      try {
        const url = new URL(import.meta.env.BASE_URL + path, document.baseURI)
        const response = await fetch(url, { cache: fresh ? 'no-cache' : 'force-cache', signal: controller.signal })
        if (!response.ok) {
          retry = response.status === 408 || response.status === 429 || response.status >= 500
          throw new Error('展示数据读取失败（HTTP ' + response.status + '）')
        }
        return await response.json()
      } catch (error) {
        if (!retry || attempt === 2) throw new Error(error.name === 'AbortError' ? '展示数据读取超时，请重试' : error.message || '展示数据暂不可用')
      } finally { clearTimeout(timer) }
      await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)))
    }
  } finally {
    if (waiting.length) waiting.shift()()
    else activeDownloads--
  }
}

function resource(path) {
  if (!resources.has(path)) {
    const promise = download(path)
    resources.set(path, promise)
    promise.catch(() => { if (resources.get(path) === promise) resources.delete(path) })
  }
  return resources.get(path)
}

function validateBootstrap(value) {
  if (value?.schema_version !== 1 || !value.categories || !value.snapshot?.generated_at) throw new Error('展示数据索引格式无效')
  expandSnapshot(value.snapshot)
  return value
}

function bootstrap() {
  if (!bootstrapPromise) {
    const embedded = document.getElementById('pages-bootstrap')
    const current = embedded ? Promise.resolve().then(() => validateBootstrap(JSON.parse(embedded.textContent)))
      : download('data/bootstrap.json', true).then(validateBootstrap)
    bootstrapPromise = current
    current.catch(() => { if (bootstrapPromise === current) bootstrapPromise = null })
  }
  return bootstrapPromise
}

async function loadGroup(index, category) {
  const paths = index.categories[category]
  if (!Array.isArray(paths)) throw new Error('展示数据中缺少此区域')
  const parts = await Promise.all(paths.map(resource))
  const items = index.snapshot.groups[category].map(item => ({ ...item, points: [] }))
  const byId = new Map(items.map(item => [item.metadata.indicator_id, item]))
  for (const part of parts) {
    if (part.generated_at !== index.snapshot.generated_at || part.category !== category) throw new Error('展示数据批次不一致，请重新加载')
    for (const segment of part.segments) {
      const item = byId.get(segment.id)
      if (!item || item.points.length !== segment.offset) throw new Error('展示数据分片不完整，请重试')
      item.points.push(...segment.points)
    }
  }
  for (const item of items) if (item.points.length !== item.metadata.published_record_count) throw new Error('展示数据历史不完整，请重试')
  let deliveries
  if (category === 'inventory') {
    const part = await resource(index.deliveries)
    if (part.generated_at !== index.snapshot.generated_at) throw new Error('交割数据批次不一致，请重新加载')
    deliveries = part.deliveries
  }
  return expandSnapshot({ ...index.snapshot, deliveries, groups: { [category]: items } })[category]
}

export async function request(path) {
  if (path === 'reload') {
    // 只有小索引需要检查服务器更新；历史文件带内容哈希，可安全复用缓存。
    const fresh = validateBootstrap(await download('data/bootstrap.json', true))
    bootstrapPromise = Promise.resolve(fresh)
    groups.clear()
    return { status: 'ok' }
  }
  const index = await bootstrap()
  if (path === 'bootstrap') return expandSnapshot(index.snapshot)
  if (path === 'meta') return expandSnapshot(index.snapshot).meta
  const key = index.snapshot.generated_at + ':' + path
  if (!groups.has(key)) {
    const promise = loadGroup(index, path)
    groups.set(key, promise)
    promise.catch(() => { if (groups.get(key) === promise) groups.delete(key) })
  }
  return groups.get(key)
}
