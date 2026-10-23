export const isStatic = true
let snapshotPromise

function expandSnapshot(snapshot) {
  if (snapshot.schema_version !== 1 || !snapshot.generated_at || !snapshot.groups) throw new Error('展示数据格式不受支持，请重新生成并发布')
  const groups = Object.fromEntries(Object.entries(snapshot.groups).map(([category, items]) => [category, {
    indicators: items.map(item => {
      const history = item.points.map(([observation_date, value]) => ({ observation_date, value, release_date: null }))
      const latest = history.at(-1) || { observation_date: null, value: null, release_date: null }
      const previous = history.at(-2)
      const change = typeof latest.value === 'number' && typeof previous?.value === 'number' ? latest.value - previous.value : null
      return { metadata: item.metadata, history, latest: { ...latest, change }, warnings: item.notes }
    }),
    ...(category === 'inventory' ? { comex: snapshot.comex } : {}),
  }]))
  return { ...groups, meta: { loaded_at: snapshot.generated_at, generated_at: snapshot.generated_at, files: snapshot.files,
    indicators: Object.values(groups).flatMap(group => group.indicators.map(item => item.metadata)), publication: snapshot.publication } }
}

async function loadSnapshot() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const url = new URL(import.meta.env.BASE_URL + 'data/snapshot.json', document.baseURI)
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error('展示数据读取失败（HTTP ' + response.status + '）')
    return expandSnapshot(await response.json())
  } catch (error) {
    throw new Error(error.name === 'AbortError' ? '展示数据读取超时，请重试' : error.message || '展示数据暂不可用')
  } finally { clearTimeout(timer) }
}

export async function request(path) {
  if (path === 'reload') {
    const fresh = loadSnapshot()
    try { await fresh; snapshotPromise = fresh } catch (error) { throw error }
    return { status: 'ok' }
  }
  if (!snapshotPromise) {
    const current = loadSnapshot()
    snapshotPromise = current
    current.catch(() => { if (snapshotPromise === current) snapshotPromise = null })
  }
  const data = await snapshotPromise
  if (!Object.hasOwn(data, path)) throw new Error('展示数据中缺少此区域')
  return data[path]
}
