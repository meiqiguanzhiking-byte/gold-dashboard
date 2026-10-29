<script setup>
import { computed, inject, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import StatusBadge from './StatusBadge.vue'
import DailyBriefMetric from './DailyBriefMetric.vue'
import { isStatic, localTime } from '../data.js'
import { beijingDate, buildDailyBrief, dailyThresholdGroups, filterDailyMovements, numberText } from '../daily-brief.js'

const props = defineProps({ items: { type: Array, default: () => [] }, meta: Object, blocks: Object })
const navigate = inject('dashboardNavigate')
const now = ref(new Date())
let clock
onMounted(() => { clock = setInterval(() => { now.value = new Date() }, 30000) })
onBeforeUnmount(() => clearInterval(clock))
const reportDate = computed(() => beijingDate(now.value))
const brief = computed(() => buildDailyBrief(props.items, reportDate.value))
const cutoff = computed(() => isStatic ? props.meta?.generated_at : props.meta?.loaded_at)
const loading = computed(() => Object.values(props.blocks || {}).some(b => b.loading))
const failed = computed(() => Object.values(props.blocks || {}).some(b => b.error))
const thresholdKey = 'gold-dashboard:daily-thresholds:v1'
const thresholds = ref(Object.fromEntries(dailyThresholdGroups.map(group => [group.id, group.initial])))
try {
  const saved = JSON.parse(localStorage.getItem(thresholdKey))
  for (const group of dailyThresholdGroups) {
    const value = saved?.[group.id]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= group.max) {
      thresholds.value[group.id] = Number((Math.round(value / group.step) * group.step).toFixed(2))
    }
  }
} catch { /* 存储不可用时使用默认阈值。 */ }
watch(thresholds, value => {
  try { localStorage.setItem(thresholdKey, JSON.stringify(value)) } catch { /* 保留本次打开期间的筛选。 */ }
}, { deep: true })
const thresholdColumns = [dailyThresholdGroups.slice(0, 3), dailyThresholdGroups.slice(3)]
const movements = computed(() => filterDailyMovements(brief.value.movements.filter(row => {
  const block = props.blocks?.[row.category]
  return !block?.loading && !block?.error
}), thresholds.value))
const thresholdText = value => Number(value.toFixed(2)) + '%'
const movementArrow = row => row.trend === 'up' ? '▲' : row.trend === 'down' ? '▼' : '→'
function state(card) {
  const block = props.blocks?.[card.category]
  if (block?.loading) return '加载中'
  if (block?.error) return '接口失败'
  return [...card.rows, ...(card.fundRows || [])].some(r => r.value == null) ? '部分数据暂缺' : '最新可得'
}
</script>

<template>
  <section id="daily-brief" class="section daily-brief" aria-labelledby="daily-title">
    <header class="daily-heading"><h2 id="daily-title">每日速递</h2><div class="daily-dates"><strong>报告日期 {{ reportDate }}</strong><span>{{ isStatic ? '快照生成时间' : '缓存加载时间' }} {{ cutoff ? localTime(cutoff) : '未提供' }}（北京时间）</span></div></header>
    <section class="daily-movements" aria-labelledby="daily-movements-title" :aria-busy="loading">
      <div class="daily-movements-heading"><h3 id="daily-movements-title">指标变动 <span>{{ movements.length }} 项</span></h3><span>最新可得数据 · 观察日期见各项</span></div>
      <p class="daily-movement-status" role="status" aria-live="polite">{{ loading ? '正在读取数据，已载入的指标先行展示…' : movements.length ? `当前筛选命中 ${movements.length} 项变动` : failed ? '已载入的指标暂无符合条件的变动，部分数据读取失败。' : '当前阈值下暂无符合条件的变动。' }}</p>
      <ul v-if="movements.length" class="daily-movement-list">
        <li v-for="row in movements" :key="row.id" :data-daily-movement="row.id">
          <button type="button" class="daily-movement" :aria-label="row.label + '查看详情'" @click="navigate(row.page, row.section)">
            <span class="movement-name"><small>{{ row.groupLabel }}</small><strong>{{ row.label }}</strong><span class="movement-current" :class="{ 'current-direction': row.group === 'direction' }"><b>{{ row.group === 'direction' ? row.value : numberText(row.value) }}</b><small v-if="row.unit && row.unit !== '文本'">{{ row.unit }}</small></span></span>
            <span class="movement-value" :class="row.trend"><span><span v-if="row.group !== 'direction'" aria-hidden="true">{{ movementArrow(row) }} </span>{{ row.changeText }}</span><small v-if="row.detail">{{ row.detail }}</small></span>
            <span class="movement-dates">观察日期 {{ row.date }} <span>较 {{ row.previousDate }}</span></span>
          </button>
        </li>
      </ul>
    </section>
    <div class="daily-thresholds" role="group" aria-label="指标变动阈值筛选">
      <div class="daily-thresholds-heading"><strong>变动阈值筛选</strong><span>涨跌幅取绝对值，严格大于阈值 · 延期费方向变化始终展示</span></div>
      <div class="daily-threshold-columns">
        <div v-for="(column, index) in thresholdColumns" :key="index" class="daily-threshold-column">
          <div v-for="group in column" :key="group.id" class="daily-threshold" :data-threshold="group.id">
            <div class="threshold-heading">
              <span class="threshold-name" tabindex="0" :aria-describedby="'daily-threshold-tip-' + group.id">
                <label :for="'daily-threshold-' + group.id">{{ group.label }}</label><span class="threshold-info" aria-hidden="true">ⓘ</span>
                <span :id="'daily-threshold-tip-' + group.id" class="threshold-tooltip" role="tooltip"><strong>涵盖指标</strong><span v-for="indicator in group.indicators" :key="indicator.id">{{ indicator.label }}</span><small v-if="group.description">{{ group.description }}</small><small v-if="group.id === 'price' || group.id === 'position'">负值指标以比较期数值的绝对值为分母。</small></span>
              </span>
              <output :for="'daily-threshold-' + group.id">{{ thresholdText(thresholds[group.id]) }}</output>
            </div>
            <input :id="'daily-threshold-' + group.id" v-model.number="thresholds[group.id]" type="range" min="0" :max="group.max" :step="group.step" :aria-valuetext="thresholdText(thresholds[group.id])" :aria-describedby="'daily-threshold-tip-' + group.id" :style="{ '--threshold-fill': (thresholds[group.id] / group.max * 100) + '%' }">
            <div class="threshold-bounds" aria-hidden="true"><span>0%</span><span>{{ group.max }}%</span></div>
          </div>
        </div>
      </div>
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
        <p class="daily-card-source">来源：{{ [...new Set(card.rows.map(row => row.source).filter(Boolean))].join('；') || '真实来源待确认' }}</p>
        <button type="button" class="daily-detail" :aria-label="card.title + '查看详情'" @click="navigate(card.page, card.section)">查看{{ card.page === 'domestic' ? '国内' : '国外' }}详情 <span aria-hidden="true">↗</span></button>
      </article>
    </div>
    <details class="daily-release-notes"><summary>查看央行、库存与CFTC最新观察期及发布依据</summary><p v-for="release in brief.releases" :key="release.name"><strong>{{ release.name }}：{{ release.status }}</strong><br>{{ release.observations }}</p><p>观察日期、文件更新时间、缓存加载时间或快照生成时间都不等于发布日期。仅有可核实的发布日期时才标记“今日新发布”，不会因今日重载而称为今日发布。</p></details>
  </section>
</template>

<style scoped>
.daily-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:14px}
.daily-heading h2{font-size:20px;color:#344e58;margin:0;font-weight:600}
.daily-dates{display:flex;flex-direction:column;gap:6px;max-width:480px;text-align:right;font-size:11px;color:#687d80;line-height:1.7}
.daily-dates strong{font-size:13px;font-weight:500;color:#3e5860}
.daily-movements{padding:16px 18px;background:#f8faf8;border:1px solid #e0e7df;border-left:3px solid #b39b61;border-radius:4px;margin-bottom:18px}
.daily-movements-heading,.daily-thresholds-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px 18px;flex-wrap:wrap}
.daily-movements-heading h3{font-size:14px;color:#536a6e;margin:0;font-weight:600}.daily-movements-heading h3 span{margin-left:8px;font-size:11px;color:#9a7b38;font-weight:500}
.daily-movements-heading>span,.daily-thresholds-heading>span{font-size:10px;color:#81928c;line-height:1.8}
.daily-movement-status{font-size:11px;color:#81928c;margin:8px 0 0;line-height:1.8}
.daily-movement-list{list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 0;padding:0}.daily-movement-list li{min-width:0}
.daily-movement{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 12px;width:100%;height:100%;border:1px solid #e2e9e2;background:white;border-radius:4px;padding:12px 14px;text-align:left;cursor:pointer;color:#526c72;font:inherit}
.daily-movement:hover{border-color:#b39b61;background:#fffef9}.daily-movement:focus-visible{outline:2px solid #9a7b38;outline-offset:2px}
.movement-name{display:flex;flex-direction:column;gap:4px;min-width:0}.movement-name small{font-size:10px;color:#9a7b38}.movement-name strong{font-size:12px;font-weight:600;line-height:1.7;overflow-wrap:anywhere}
.movement-current{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 6px;margin-top:3px;line-height:1.5;color:#314f59}.movement-current b{font-size:21px;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}.movement-current small{font-size:10px;color:#81928f;font-weight:400}.movement-current.current-direction b{font-size:14px}
.movement-value{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:4px;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.6}.movement-value small{font-size:10px;font-weight:400}.movement-value.up{color:#bd4c48}.movement-value.down{color:#37846a}.movement-value.flat{color:#7d8d8b}.movement-value.direction{max-width:230px;font-size:11px;color:#9a7b38}
.movement-dates{grid-column:1/-1;display:flex;gap:4px 16px;flex-wrap:wrap;font-size:10px;color:#8b9997;line-height:1.8}
.daily-thresholds{border-top:1px solid #dde5e1;border-bottom:1px solid #dde5e1;padding:15px 0 20px;margin-bottom:20px}.daily-thresholds-heading{margin-bottom:18px}.daily-thresholds-heading strong{font-size:12px;font-weight:600;color:#687c7c}
.daily-threshold-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:48px}.daily-threshold-column{display:flex;flex-direction:column;gap:20px;min-width:0}.daily-threshold{min-width:0}.threshold-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.threshold-name{position:relative;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#857448;cursor:help;border-bottom:1px dotted #b9aa82;line-height:1.8;outline-offset:3px}.threshold-name label{cursor:help}.threshold-info{font-size:11px;font-weight:400;color:#a39570}
.threshold-tooltip{position:absolute;z-index:20;top:calc(100% + 8px);left:0;box-sizing:border-box;width:280px;max-width:calc(100vw - 90px);display:none;padding:12px 14px;border:1px solid #dce4df;border-radius:5px;background:#fff;box-shadow:0 5px 18px #314f591a;color:#526c72;font-weight:400;line-height:1.9;cursor:default}.threshold-tooltip:before{content:'';position:absolute;top:-9px;left:0;width:100%;height:9px}.threshold-tooltip strong,.threshold-tooltip>span,.threshold-tooltip small{display:block}.threshold-tooltip strong{color:#9a7b38;font-size:11px;margin-bottom:4px}.threshold-tooltip>span{font-size:11px}.threshold-tooltip small{font-size:10px;color:#8b9997;margin-top:6px}.threshold-name:hover .threshold-tooltip,.threshold-name:focus-within .threshold-tooltip{display:block}
.threshold-heading output{font-size:15px;font-weight:600;color:#536b72;font-variant-numeric:tabular-nums}
.daily-threshold input[type="range"]{appearance:none;-webkit-appearance:none;display:block;box-sizing:border-box;width:100%;height:6px;border:0;border-radius:3px;background:linear-gradient(to right,#b39b61 var(--threshold-fill),#e3e9e4 var(--threshold-fill));cursor:pointer;margin:9px 0 8px;touch-action:pan-y}
.daily-threshold input[type="range"]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:15px;height:15px;border:2px solid #fff;border-radius:50%;background:#a48c52;box-shadow:0 0 0 1px #b39b61}.daily-threshold input[type="range"]::-moz-range-thumb{width:11px;height:11px;border:2px solid #fff;border-radius:50%;background:#a48c52;box-shadow:0 0 0 1px #b39b61}.daily-threshold input[type="range"]:focus-visible{outline:2px solid #9a7b38;outline-offset:5px}
.threshold-bounds{display:flex;justify-content:space-between;color:#95a19b;font-size:10px;line-height:1.8}
.daily-card-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;align-items:stretch}
.daily-card{grid-column:span 3;min-width:0;border:1px solid #e1e8e3;border-radius:5px;background:#fff;padding:18px;display:flex;flex-direction:column}
.daily-card.autd,.daily-card.etf{grid-column:1/-1}.daily-card.last{grid-column:span 4}
.daily-card-source{font-size:10px;line-height:1.8;color:#8b9997;margin:0 0 8px;overflow-wrap:anywhere}
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
@media(max-width:900px){.daily-heading{flex-direction:column;gap:10px}.daily-dates{text-align:left}.daily-threshold-columns{gap:28px}.daily-movement-list{grid-template-columns:minmax(0,1fr)}.daily-card{grid-column:span 6}.daily-card.last{grid-column:span 12}.autd .daily-main-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 0}.autd .daily-main-metrics :deep(.daily-metric:nth-child(3)){padding-left:0;border-left:0}.etf .daily-card-content{grid-template-columns:minmax(0,1fr)}.etf .daily-main-metrics{grid-template-columns:repeat(2,minmax(0,1fr));padding:0 0 20px;border-right:0;border-bottom:1px solid #e5eae6}.daily-fund-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:601px) and (max-width:1100px){.daily-movement-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.daily-movement-list{grid-template-columns:minmax(0,1fr)}.daily-threshold-columns{grid-template-columns:minmax(0,1fr);gap:20px}.daily-movements{padding:14px 12px}.daily-movement{grid-template-columns:minmax(0,1fr);padding:12px}.movement-value{align-items:flex-start}.movement-value.direction{max-width:none}}
@media(max-width:520px){.daily-card{grid-column:1/-1}.autd .daily-main-metrics{grid-template-columns:minmax(0,1fr)}.autd .daily-main-metrics :deep(.daily-metric){padding:0 0 16px!important;border-left:0;border-bottom:1px solid #e5eae6}.autd .daily-main-metrics :deep(.daily-metric:last-child){border-bottom:0;padding-bottom:0!important}.daily-fund-metrics,.etf .daily-main-metrics{grid-template-columns:minmax(0,1fr)}}
</style>
