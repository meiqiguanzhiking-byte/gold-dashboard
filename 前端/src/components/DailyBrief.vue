<script setup>
import { computed, inject, onMounted, onBeforeUnmount, ref } from 'vue'
import StatusBadge from './StatusBadge.vue'
import DailyBriefMetric from './DailyBriefMetric.vue'
import { isStatic, localTime } from '../data.js'
import { beijingDate, buildDailyBrief } from '../daily-brief.js'

const props = defineProps({ items: { type: Array, default: () => [] }, meta: Object, blocks: Object })
const navigate = inject('dashboardNavigate')
const now = ref(new Date())
let clock
onMounted(() => { clock = setInterval(() => { now.value = new Date() }, 30000) })
onBeforeUnmount(() => clearInterval(clock))
const reportDate = computed(() => beijingDate(now.value))
const brief = computed(() => buildDailyBrief(props.items, reportDate.value))
const cutoff = computed(() => isStatic ? props.meta?.generated_at : props.meta?.loaded_at)
const snapshotDate = computed(() => cutoff.value ? beijingDate(cutoff.value) : null)
const loading = computed(() => Object.values(props.blocks || {}).some(b => b.loading))
const failed = computed(() => Object.values(props.blocks || {}).some(b => b.error))
function state(card) {
  const block = props.blocks?.[card.category]
  if (block?.loading) return '加载中'
  if (block?.error) return '接口失败'
  return [...card.rows, ...(card.fundRows || [])].some(r => r.value == null) ? '部分数据暂缺' : '最新可得'
}
</script>

<template>
  <section id="daily-brief" class="section daily-brief" aria-labelledby="daily-title">
    <header class="daily-heading"><div><h2 id="daily-title">每日速递</h2><p>先看价格，再看资金与持仓；各项均为当前已载入的最新可得信息。</p></div><div class="daily-dates"><strong>报告日期 {{ reportDate }}</strong><span>数据截至时间 {{ cutoff ? localTime(cutoff) : '未提供' }}（北京时间）</span><small>{{ isStatic ? '截至时间为静态快照生成时间' : '截至时间为后端缓存加载时间' }}，并非所有指标的观察日或发布日期。</small></div></header>
    <p v-if="snapshotDate && snapshotDate < reportDate" class="daily-asof-note" role="status">当前数据批次生成于 {{ snapshotDate }}，早于报告日期；展示已载入的最近一期，不代表今日实时行情。{{ isStatic ? '需更新并发布快照才能取得新数据。' : '可使用顶部刷新按钮重新读取真实数据。' }}</p>
    <p v-else class="daily-asof-note">日报展示截至报告日最新可得的信息，不代表全部指标都是今天的数据；请以各项数据日期为准。</p>
    <div class="daily-summary" aria-label="三句话摘要" :aria-busy="loading">
      <p v-for="(text, index) in brief.summary" :key="index"><strong>{{ ['价格表现', '资金与持仓', '最新发布'][index] }}</strong><span>{{ loading ? '正在读取真实数据…' : text }}</span></p>
    </div>
    <p v-if="failed" class="section-footnote" role="status">部分数据读取失败，相应指标显示数据暂缺；其他指标可继续查看。</p>
    <div class="daily-card-grid">
      <article v-for="card in brief.cards" :key="card.id" class="daily-card" :class="card.layout" :data-daily-card="card.id">
        <header><h3>{{ card.title }}</h3><StatusBadge :status="state(card)" /></header>
        <div class="daily-card-content">
          <dl class="daily-main-metrics"><DailyBriefMetric v-for="row in card.rows" :key="row.label" :row="row" :loading="blocks?.[card.category]?.loading" :failed="!!blocks?.[card.category]?.error" /></dl>
          <dl v-if="card.fundRows" class="daily-fund-metrics"><DailyBriefMetric v-for="row in card.fundRows" :key="row.label" :row="row" :loading="blocks?.[card.category]?.loading" :failed="!!blocks?.[card.category]?.error" /></dl>
        </div>
        <p class="daily-card-note">{{ card.note }}</p>
        <button type="button" class="daily-detail" :aria-label="card.title + '查看详情'" @click="navigate(card.page, card.section)">查看{{ card.page === 'domestic' ? '国内' : '国外' }}详情 <span aria-hidden="true">↗</span></button>
      </article>
    </div>
    <details class="daily-release-notes"><summary>查看央行、库存与CFTC最新观察期及发布依据</summary><p v-for="release in brief.releases" :key="release.name"><strong>{{ release.name }}：{{ release.status }}</strong><br>{{ release.observations }}</p><p>观察日期、文件更新时间、缓存加载时间或快照生成时间都不等于发布日期。仅有可核实的发布日期时才标记“今日新发布”，不会因今日重载而称为今日发布。</p></details>
  </section>
</template>

<style scoped>
.daily-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:14px}
.daily-heading h2{font-size:20px;color:#344e58;margin:0;font-weight:600}
.daily-heading p{font-size:11px;line-height:1.8;color:#81928f;margin:7px 0 0}
.daily-dates{display:flex;flex-direction:column;gap:6px;max-width:480px;text-align:right;font-size:11px;color:#687d80;line-height:1.7}
.daily-dates strong{font-size:13px;font-weight:500;color:#3e5860}.daily-dates small{font-size:10px;color:#8b9997}
.daily-asof-note{font-size:11px;line-height:1.8;color:#857448;margin:10px 0 18px}
.daily-summary{padding:5px 0 12px;border-top:1px solid #dde5e1;border-bottom:1px solid #dde5e1;margin-bottom:20px}
.daily-summary p{display:grid;grid-template-columns:88px minmax(0,1fr);gap:12px;line-height:1.9;margin:10px 0 0;font-size:12px;color:#536b72}
.daily-summary strong{font-weight:500;color:#857448}
.daily-card-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;align-items:stretch}
.daily-card{grid-column:span 3;min-width:0;border:1px solid #e1e8e3;border-radius:5px;background:#fff;padding:18px;display:flex;flex-direction:column}
.daily-card.autd,.daily-card.etf{grid-column:1/-1}.daily-card.last{grid-column:span 4}
.daily-card header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.daily-card h3{font-size:17px;line-height:1.6;color:#3e5860;font-weight:600;margin:0}
.daily-card-content{margin:20px 0 16px;min-width:0}.daily-card dl{margin:0;min-width:0}
.daily-card[data-daily-card="international-price"] :deep(.value-line){flex-wrap:nowrap;align-items:flex-start}
.daily-card[data-daily-card="international-price"] :deep(.value-line strong){flex-shrink:0;white-space:nowrap}
.daily-card[data-daily-card="international-price"] :deep(.value-line small){display:block;margin-left:0}
.daily-card[data-daily-card="international-price"] :deep(.change-group){flex:1;min-width:0;padding-top:4px}
.daily-card[data-daily-card="international-price"] :deep(.trend-arrow){display:inline-block;width:14px}
.daily-card[data-daily-card="international-price"] :deep(.comparison){padding-left:14px}
.daily-card:not([data-daily-card="international-price"]) :deep(.value-line){flex-wrap:nowrap;align-items:flex-start}
.daily-card:not([data-daily-card="international-price"]) :deep(.value-line strong){flex-shrink:0;white-space:nowrap}
.daily-card:not([data-daily-card="international-price"]) :deep(.value-line small){display:inline;margin-left:5px}
.daily-card:not([data-daily-card="international-price"]) :deep(.change-group){flex:1;min-width:0;padding-top:0}
.daily-card:not([data-daily-card="international-price"]) :deep(.change){display:block;line-height:18px;box-sizing:border-box}
.daily-card:not([data-daily-card="international-price"]) :deep(.trend-arrow){display:inline-block;width:14px}
.daily-card:not([data-daily-card="international-price"]) :deep(.comparison){padding-left:14px;line-height:18px}
.daily-card.autd :deep(.fee-stat),.daily-card.autd :deep(.fee-stat .value-line){align-items:center}
.daily-card.autd :deep(.fee-stat .value-line strong){display:inline-flex;align-items:center}
.daily-card.autd :deep(.fee-stat){justify-content:flex-start;gap:16px}
.daily-card.autd :deep(.fee-stat .value-line){justify-content:flex-start}
.daily-main-metrics{display:grid;gap:20px}
.autd .daily-main-metrics{grid-template-columns:repeat(4,minmax(0,1fr));gap:0}
.autd .daily-main-metrics :deep(.daily-metric){padding:0 20px;border-left:1px solid #e5eae6}
.autd .daily-main-metrics :deep(.daily-metric:first-child){padding-left:0;border-left:0}
.autd .daily-main-metrics :deep(.daily-metric:last-child){padding-right:0}
.etf .daily-card-content{display:grid;grid-template-columns:minmax(360px,1.15fr) minmax(0,2.85fr);gap:24px}
.etf .daily-main-metrics{padding-right:24px;border-right:1px solid #e5eae6}
.daily-fund-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px 18px}
.daily-fund-metrics :deep(.value-line){column-gap:8px}
.daily-fund-metrics :deep(.value-line strong){font-size:20px}
.daily-card-note{font-size:10px;line-height:1.8;color:#8a9895;margin:auto 0 12px;overflow-wrap:anywhere}
.daily-detail{border:0;border-top:1px solid #edf1ee;background:transparent;text-align:left;padding:10px 0 0;color:#607978;font-size:11px;display:flex;justify-content:space-between}
.daily-detail:hover{color:#857448}.daily-release-notes{font-size:11px;line-height:1.9;color:#83918e;margin:20px 0 0}
.daily-release-notes summary{cursor:pointer;color:#607878}.daily-release-notes strong{font-weight:500}.daily-release-notes p{overflow-wrap:anywhere}
@media(max-width:1100px){.daily-fund-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.daily-card{padding:15px}.autd .daily-main-metrics :deep(.daily-metric){padding:0 13px}.etf .daily-card-content{grid-template-columns:minmax(0,1fr)}.etf .daily-main-metrics{grid-template-columns:repeat(2,minmax(0,1fr));padding:0 0 20px;border-right:0;border-bottom:1px solid #e5eae6}}
@media(max-width:900px){.daily-heading{flex-direction:column;gap:10px}.daily-dates{text-align:left}.daily-summary p{grid-template-columns:1fr;gap:2px}.daily-card{grid-column:span 6}.daily-card.last{grid-column:span 12}.autd .daily-main-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 0}.autd .daily-main-metrics :deep(.daily-metric:nth-child(3)){padding-left:0;border-left:0}.etf .daily-card-content{grid-template-columns:minmax(0,1fr)}.etf .daily-main-metrics{grid-template-columns:repeat(2,minmax(0,1fr));padding:0 0 20px;border-right:0;border-bottom:1px solid #e5eae6}.daily-fund-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.daily-card{grid-column:1/-1}.autd .daily-main-metrics{grid-template-columns:minmax(0,1fr)}.autd .daily-main-metrics :deep(.daily-metric){padding:0 0 16px!important;border-left:0;border-bottom:1px solid #e5eae6}.autd .daily-main-metrics :deep(.daily-metric:last-child){border-bottom:0;padding-bottom:0!important}.daily-fund-metrics,.etf .daily-main-metrics{grid-template-columns:minmax(0,1fr)}}
</style>
