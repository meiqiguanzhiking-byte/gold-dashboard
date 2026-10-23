import { computed, reactive, ref } from 'vue'
import { isStatic, request } from './live-source.js'
export { isStatic }

export const categories = ['etf', 'futures', 'cftc', 'au-td', 'central-bank', 'inventory', 'price']
export const categoryNames = { etf: 'ETF', futures: '黄金期货', cftc: 'CFTC', 'au-td': 'Au(T+D)', 'central-bank': '央行购金', inventory: '库存', price: '黄金价格与波动率', meta: '数据元信息' }
export const regionColors = { north_america: '#247d91', europe: '#7c91bc', asia: '#558e79', other: '#b39761' }
export const regions = [{ id: 'north_america', name: '北美' }, { id: 'europe', name: '欧洲' }, { id: 'asia', name: '亚洲' }, { id: 'other', name: '其他' }]
export const ranges = [{ value: '1M', label: '1 个月' }, { value: '3M', label: '3 个月' }, { value: '1Y', label: '1 年' }, { value: '5Y', label: '5 年' }, { value: 'ALL', label: '全部' }]
export const palette = ['#207c88', '#b59b64', '#6d83ab', '#8c6ca0', '#668e6f', '#b77964', '#86969e']

// 数据健康度按研究资料的十类顺序展示，同组保持原始指标顺序。
const healthSourceGroups = [
  ['黄金现货价格.xlsx'],
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
  const blocks = reactive(Object.fromEntries([...categories, 'meta'].map(key => [key, { data: null, loading: true, error: '' }])))
  const refreshing = ref(false), reloadError = ref(''), clientRefreshedAt = ref(null), notice = ref('')
  async function loadBlock(key) {
    const block = blocks[key]
    block.loading = true
    block.error = ''
    try { block.data = await request(key) } catch (error) { block.data = null; block.error = error.message } finally { block.loading = false }
  }
  async function loadAll() {
    await Promise.allSettled([...categories, 'meta'].map(loadBlock))
    clientRefreshedAt.value = new Date().toISOString()
  }
  async function refresh() {
    if (refreshing.value) return
    refreshing.value = true
    reloadError.value = ''
    notice.value = ''
    try {
      const result = await request('reload', { method: 'POST' })
      notice.value = isStatic ? '已重新读取已发布的展示数据；本机文件变化不会自动更新此页面' : result.status === 'ok' ? '后端缓存已重新加载' : '缓存已加载，部分文件读取失败，请查看数据健康度'
      await loadAll()
    } catch (error) { reloadError.value = '重新加载失败：' + error.message + '。页面保留上次数据。' } finally { refreshing.value = false }
  }
  const all = computed(() => categories.flatMap(category => blocks[category].data?.indicators || []))
  const index = computed(() => Object.fromEntries(all.value.map(item => [item.metadata.indicator_id, item])))
  function item(id) { return index.value[id] }
  const meta = computed(() => blocks.meta.data)
  return { blocks, refreshing, reloadError, clientRefreshedAt, notice, all, meta, item, loadAll, refresh, loadBlock }
}
