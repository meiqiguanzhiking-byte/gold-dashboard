<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isStatic, request } from '@live-source'
import { localTime } from '../data.js'
import { sourceLabel } from '../source-labels.js'
const props = defineProps({ meta: Object, active: Boolean })
const news = ref(null), pending = ref(false), error = ref(''), category = ref('全部')
let timer, controller, sequence = 0
let signature = ''
const categories = computed(() => ['全部', ...new Set((news.value?.events || []).map(event => event.category))])
const events = computed(() => (news.value?.events || []).filter(event => category.value === '全部' || event.category === category.value))
const old = computed(() => news.value?.stale || news.value?.report_date && news.value.report_date !== new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()))
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null } }
const institution = source => sourceLabel(source?.id) === '真实来源待确认' ? source?.institution : sourceLabel(source?.id)
async function read() {
  if (!props.active || pending.value) return
  if (isStatic) { news.value = props.meta?.daily_news || { status: 'not_ready', events: [] }; return }
  const current = ++sequence
  controller = new AbortController()
  pending.value = true; error.value = ''
  try {
    const result = await request('daily-news', { signal: controller.signal })
    if (current === sequence && props.active && !document.hidden) {
      const nextSignature = JSON.stringify(result)
      if (nextSignature !== signature) { news.value = result; signature = nextSignature }
    }
  } catch { if (current === sequence && props.active) error.value = '资讯暂时读取失败，保留上次结果。' }
  finally { if (current === sequence) pending.value = false }
}
function stopPolling() {
  clearInterval(timer); timer = null
  sequence++; controller?.abort(); pending.value = false
}
function syncPolling() {
  stopPolling()
  if (!props.active || document.hidden) return
  read()
  if (!isStatic) timer = setInterval(read, 15000)
}
watch([() => props.active, () => props.meta], syncPolling, { immediate: true })
watch(categories, values => { if (!values.includes(category.value)) category.value = '全部' })
onMounted(() => document.addEventListener('visibilitychange', syncPolling))
onBeforeUnmount(() => { stopPolling(); document.removeEventListener('visibilitychange', syncPolling) })
</script>

<template>
  <section class="daily-news" aria-label="每日资讯" :aria-busy="pending">
    <header class="news-heading"><div><p class="news-eyebrow">DAILY NEWS / 黄金投研</p><h2>每日资讯</h2></div><span class="news-tag">昨日 — 今日</span></header>
    <p v-if="news?.window_start" class="news-period">覆盖 {{ localTime(news.window_start) }} — {{ localTime(news.window_end) }}（北京时间，截止时刻不含）<span v-if="news.generated_at"> · 更新 {{ localTime(news.generated_at) }}</span></p>
    <p v-if="error" class="news-notice" role="status">{{ error }}</p>
    <p v-if="old" class="news-notice" role="status">当前展示 {{ news.report_date }} 的已保存资讯；新一期尚未就绪，旧内容未标为今日。</p>
    <div v-if="news?.status === 'withheld'" class="news-placeholder">每日资讯已接入本地版；该来源的公开摘要范围尚未确认，静态版暂不展示。</div>
    <template v-else-if="news?.status === 'ready' || news?.status === 'empty'">
      <p class="news-coverage">{{ news.coverage_note }}<span v-if="news.missing_sources?.length"> 暂未取得：{{ news.missing_sources.join('、') }}。</span></p>
      <div class="news-filters" aria-label="每日资讯分类"><button v-for="name in categories" :key="name" :aria-pressed="category === name" @click="category = name">{{ name }}</button><span>{{ events.length }} 条资讯</span></div>
      <div v-if="!events.length" class="news-placeholder">{{ news.status === 'empty' ? '本期暂无符合条件的资讯。' : '该分类暂无资讯。' }}</div>
      <ol v-else class="news-timeline">
        <li v-for="event in events" :key="event.id"><article>
          <div class="news-event-time"><time :datetime="event.published_at">{{ localTime(event.published_at) }} 发布</time><span>{{ event.category }}</span></div>
          <h3>{{ event.title }}</h3>
          <p class="news-fact"><strong>{{ institution(event.sources?.[0]) }}{{ event.summary_kind === 'title' ? ' · 发布标题' : ' · 原文摘录' }}：</strong>{{ event.fact }}</p>
          <p class="news-watch"><strong>黄金相关关注点</strong>{{ event.watchpoint }}</p>
          <div class="news-sources"><template v-for="source in event.sources" :key="source.url"><a v-if="safeUrl(source.url)" :href="safeUrl(source.url)" target="_blank" rel="noopener noreferrer">{{ institution(source) }} · 原文 ↗</a></template><span>{{ event.verification === 'official_source' ? '官方原文' : '单一可靠来源报道' }}</span></div>
        </article></li>
      </ol>
    </template>
    <div v-else class="news-placeholder" role="status">{{ pending || news?.status === 'updating' ? '正在准备本期资讯…' : news?.status === 'failed' ? '本期资讯采集失败，稍后随日报更新重试。' : '待日报数据更新后生成本期资讯。' }}</div>
  </section>
</template>

<style scoped>
.daily-news{color:#344e54}.news-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.news-eyebrow{margin:0 0 10px;color:#927d43;font-size:11px;letter-spacing:1px}.news-heading h2{margin:0;font-size:23px;font-weight:600;color:#263c40}.news-tag{padding:6px 10px;background:#eaf2f1;color:#287985;border-radius:4px;font-size:11px}.news-period{font-size:12px;color:#728486;line-height:1.9;margin:14px 0 10px}.news-coverage,.news-notice{padding:12px 16px;background:#f5f3eb;border-left:3px solid #b29a61;color:#786b43;font-size:12px;line-height:1.8}.news-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:20px 0 24px}.news-filters button{cursor:pointer;border:1px solid #dce4e1;background:transparent;color:#728486;border-radius:5px;padding:6px 12px;font-size:12px}.news-filters button[aria-pressed=true]{border-color:#287985;color:#287985;background:#eaf2f1}.news-filters>span{margin-left:auto;color:#728486;font-size:12px}.news-timeline{list-style:none;padding:0;margin:0 0 0 9px;max-width:1100px}.news-timeline li{position:relative;border-left:1px solid #bcd3d6;padding:0 0 27px 27px}.news-timeline li:before{content:'';position:absolute;width:9px;height:9px;background:#287985;border-radius:50%;left:-5px;top:5px}.news-event-time{display:flex;align-items:center;flex-wrap:wrap;gap:12px;font-size:12px}.news-event-time time{color:#287985;font-weight:600}.news-event-time>span{font-size:10px;color:#728486;border:1px solid #dce4e1;padding:2px 6px;border-radius:3px}.news-timeline h3{margin:9px 0 8px;font-size:17px;color:#263c40;line-height:1.6}.news-fact,.news-watch{font-size:13px;line-height:1.95;margin:7px 0;color:#526c72}.news-fact>strong{font-weight:500}.news-watch>strong{display:inline-block;font-size:11px;color:#927d43;margin-right:12px}.news-sources{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:10px;font-size:11px}.news-sources a{color:#287985;text-decoration:none}.news-sources a:hover{text-decoration:underline}.news-sources span{color:#849491}.news-placeholder{margin:20px 0;padding:45px 20px;border:1px dashed #dce4e1;border-radius:5px;text-align:center;color:#849491;font-size:13px}@media(max-width:600px){.news-timeline li{padding-left:20px}.news-heading h2{font-size:21px}}
</style>
