import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { isStatic, request } from '@live-source'
import { readLiveBatch } from './dashboard-refresh.js'
export { isStatic }

export const categories = ['etf', 'futures', 'cftc', 'au-td', 'central-bank', 'inventory', 'price']
export const categoryNames = { etf: 'ETF', futures: '黄金期货', cftc: 'CFTC', 'au-td': 'Au(T+D)', 'central-bank': '央行购金', inventory: '库存', price: '黄金价格与波动率', meta: '数据元信息' }
export const regionColors = { north_america: '#0072B2', europe: '#CC79A7', asia: '#E69F00', other: '#6B7280' }
export const regions = [{ id: 'north_america', name: '北美' }, { id: 'europe', name: '欧洲' }, { id: 'asia', name: '亚洲' }, { id: 'other', name: '其他' }]
export const ranges = [{ value: '1M', label: '1 个月' }, { value: '3M', label: '3 个月' }, { value: '1Y', label: '1 年' }, { value: '5Y', label: '5 年' }, { value: 'ALL', label: '全部' }]
export const palette = ['#207c88', '#b59b64', '#6d83ab', '#8c6ca0', '#668e6f', '#b77964', '#86969e']

// 数据健康度按研究资料的十类顺序展示，同组保持原始指标顺序。
const healthSourceGroups = [
  ['伦敦金现与汇率_北京时间1530收盘价.xlsx'],
  ['COMEX黄金与汇率期货.csv'],
  ['黄金ETF波动率指数.csv'],
  ['美债收益率.xlsx'],
  ['央行购金.xlsx'],
  ['AuTD.csv'],
  ['黄金期货.csv'],
  ['黄金ETF份额.xlsx'],
  ['CFTC黄金非商业持仓量.csv', 'CFTC黄金交易量和持仓量.csv'],
  ['SPDR黄金ETF份额.xlsx'],
  ['伦敦金银库存.xlsx'],
  ['COMEX金银库存.xlsx'],
  ['全球黄金ETF流量.xlsx'],
  ['全球央行购金.csv'],
]
const healthSourceRank = new Map(healthSourceGroups.flatMap((sources, index) => sources.map(source => [source, index])))
export function sortHealthSources(items) {
  const rank = item => healthSourceRank.get(item.source) ?? healthSourceGroups.length
  return [...items].sort((a, b) => rank(a) - rank(b))
}

export function format(value, digits = 2) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '数据暂缺'
  if (typeof value !== 'number') return String(value)
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2)
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}
export function signed(value) { return value == null ? '未提供' : (value > 0 ? '+' : '') + format(value) }
export function localTime(value) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(value)) : '未提供' }
export function tone(status) { return ({ 正常: 'good', 滞后: 'late', 短历史: 'late', 仅最新值: 'neutral', 人工接入: 'manual', 数据缺失: 'missing', 接口失败: 'bad', 加载中: 'neutral', 未确认: 'neutral' })[status] || 'neutral' }
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) }
export function numeric(point) { return point?.value != null && typeof point.value === 'number' && Number.isFinite(point.value) }
export function dateNumber(value) {
  if (!value) return NaN
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day || 1)
}
export function filteredHistory(item, range, end) {
  const points = item?.history || []
  const last = end || points.at(-1)?.observation_date
  if (!last || range === 'ALL') return points
  const endpoint = new Date(dateNumber(last))
  const months = ({ '1M': 1, '3M': 3, '1Y': 12, '5Y': 60 })[range] || 12
  const target = new Date(Date.UTC(endpoint.getUTCFullYear(), endpoint.getUTCMonth() - months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const start = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(endpoint.getUTCDate(), lastDay))
  return points.filter(p => dateNumber(p.observation_date) >= start && dateNumber(p.observation_date) <= dateNumber(last))
}
export function useDashboard() {
  const blocks = reactive(Object.fromEntries([...categories, 'meta'].map(key => [key, { data: null, loading: true, error: '', complete: false }])))
  const refreshing = ref(false), reloadError = ref(''), clientRefreshedAt = ref(null), notice = ref('')
  const briefItems = ref(null), briefError = ref('')
  const jobs = new Map()
  let syncTimer, checking = false
  let activePage = 'daily', initialized = false
  function loadBlock(key) {
    if (refreshing.value) return Promise.resolve()
    if (jobs.has(key)) return jobs.get(key)
    const block = blocks[key]
    block.loading = true
    block.error = ''
    const job = (async () => {
      try {
        const data = await request(key)
        if (!isStatic && key !== 'meta' && blocks.meta.data?.loaded_at && data.loaded_at !== blocks.meta.data.loaded_at) throw new Error('数据批次已变化，请点击刷新真实数据')
        block.data = data; block.complete = true
      }
      catch (error) { block.error = error.message }
      finally { block.loading = false; jobs.delete(key) }
    })()
    jobs.set(key, job)
    return job
  }
  async function loadPage(page) {
    activePage = page
    if (!isStatic || !initialized || refreshing.value) return
    const needed = { cross: categories, domestic: ['price', 'etf', 'au-td', 'futures', 'central-bank'], foreign: ['price', 'etf', 'inventory', 'cftc', 'central-bank'] }[page] || []
    await Promise.allSettled(needed.filter(key => !blocks[key].complete).map(loadBlock))
  }
  async function loadAll() {
    if (isStatic) {
      try {
        const initial = await request('bootstrap')
        for (const key of [...categories, 'meta']) Object.assign(blocks[key], { data: initial[key], loading: false, error: '', complete: key === 'meta' })
        briefItems.value = categories.flatMap(key => initial[key].indicators)
        briefError.value = ''
        initialized = true
        await loadPage(activePage)
      } catch (error) {
        briefError.value = error.message
        for (const block of Object.values(blocks)) { block.error = error.message; block.loading = false }
      }
    } else {
      await Promise.allSettled([...categories, 'meta'].map(loadBlock))
      const version = blocks.meta.data?.loaded_at
      for (const key of categories) {
        if (version && blocks[key].data && blocks[key].data.loaded_at !== version) {
          Object.assign(blocks[key], { data: null, complete: false, error: '数据批次已变化，请点击刷新真实数据' })
        }
      }
    }
    if (blocks.meta.data) clientRefreshedAt.value = new Date().toISOString()
  }
  async function refresh() {
    if (refreshing.value) return
    refreshing.value = true
    reloadError.value = ''
    notice.value = ''
    // 旧的懒加载先完成，避免刷新后被旧请求覆盖。
    await Promise.allSettled([...jobs.values()])
    const previous = Object.fromEntries(Object.entries(blocks).map(([key, block]) => [key, { ...block }]))
    for (const block of Object.values(blocks)) { block.loading = true; block.error = '' }
    try {
      await request('reload', { method: 'POST' })
      if (isStatic) {
        const initial = await request('bootstrap')
        for (const key of [...categories, 'meta']) Object.assign(blocks[key], { data: initial[key], loading: false, error: '', complete: key === 'meta' })
        briefItems.value = categories.flatMap(key => initial[key].indicators)
        briefError.value = ''
        initialized = true
      } else {
        const batch = await readLiveBatch(request, categories, categoryNames)
        for (const key of [...categories, 'meta']) Object.assign(blocks[key], { data: batch[key], loading: false, error: '', complete: true })
      }
      clientRefreshedAt.value = new Date().toISOString()
      notice.value = isStatic ? '已重新读取已发布的展示数据；本机文件变化不会自动更新此页面' : blocks.meta.data?.status === 'ok' ? '真实数据已同步更新' : '缓存已加载，部分文件读取失败，请查看数据健康度'
    } catch (error) {
      for (const [key, block] of Object.entries(previous)) Object.assign(blocks[key], block)
      reloadError.value = '重新加载失败：' + error.message + '。页面保留上次完整数据，请重试。'
    } finally { refreshing.value = false }
    if (isStatic && !reloadError.value) await loadPage(activePage)
  }
  async function syncUpdatedBatch() {
    if (isStatic || checking || refreshing.value || jobs.size || !blocks.meta.data || document.hidden) return
    checking = true
    let previous
    try {
      const health = await request('health')
      if (health.loaded_at === blocks.meta.data.loaded_at) return
      refreshing.value = true
      previous = Object.fromEntries(Object.entries(blocks).map(([key, block]) => [key, { ...block }]))
      for (const block of Object.values(blocks)) { block.loading = true; block.error = '' }
      const batch = await readLiveBatch(request, categories, categoryNames)
      for (const key of [...categories, 'meta']) Object.assign(blocks[key], { data: batch[key], loading: false, error: '', complete: true })
      clientRefreshedAt.value = new Date().toISOString()
      reloadError.value = ''
      notice.value = '已同步后端更新的数据；AI日报按新观察日自动准备'
    } catch (error) {
      if (previous) {
        for (const [key, block] of Object.entries(previous)) Object.assign(blocks[key], block)
        reloadError.value = '自动同步暂未完成，页面保留上次完整数据，请重试。'
      }
    } finally { if (previous) refreshing.value = false; checking = false }
  }
  onMounted(() => { if (!isStatic) syncTimer = setInterval(syncUpdatedBatch, 30000) })
  onBeforeUnmount(() => clearInterval(syncTimer))
  const all = computed(() => categories.flatMap(category => blocks[category].data?.indicators || []))
  const dailyItems = computed(() => isStatic ? briefItems.value || [] : all.value)
  const dailyBlocks = computed(() => isStatic ? Object.fromEntries(categories.map(key => [key,
    { loading: refreshing.value || (!briefItems.value && !briefError.value), error: briefError.value },
  ])) : blocks)
  const index = computed(() => Object.fromEntries(all.value.map(item => [item.metadata.indicator_id, item])))
  function item(id) { return index.value[id] }
  const meta = computed(() => blocks.meta.data)
  return { blocks, refreshing, reloadError, clientRefreshedAt, notice, all, dailyItems, dailyBlocks, meta, item, loadAll, loadPage, refresh, loadBlock }
}
