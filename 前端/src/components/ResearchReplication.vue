<script setup>
import { computed, ref } from 'vue'
import ResearchEtfMonthly from './ResearchEtfMonthly.vue'
import ResearchMacroMonthly from './ResearchMacroMonthly.vue'
import ResearchDualAnchor from './ResearchDualAnchor.vue'
const overview = ref(null)
const latestState = computed(() => overview.value?.state_counts.find(s => s.state === overview.value.latest.state)?.name)
const percent = v => (v * 100).toFixed(2) + '%'
const direction = v => v > 0 ? '看涨' : v < 0 ? '看跌' : '中性'
const modules = [
  { id: 'research-etf', number: '01', title: '黄金ETF月度预测模型', description: '从全球黄金ETF月度流量出发，研究下一月黄金收益。' },
  { id: 'research-macro', number: '02', title: '长期宏观定价模型', description: '结合美元指数、VIX、全球央行净购金与时间趋势，研究长期价格中枢及偏离。' },
  { id: 'research-dual-anchor', number: '03', title: '长短双锚组合框架', description: '结合月度资金方向与长期价格位置，观察共振、背离及后续演化。' },
]
</script>

<template>
  <div class="research-replication">
    <header class="research-heading">
      <p>研报复现 · 第一篇</p>
      <h2>国泰君安期货-黄金长短双锚</h2>
      <span>《黄金溢价几何？长短双锚下的定价再审视》 · 2026年11月2日</span>
    </header>
    <nav class="research-outline" aria-label="研报版块">
      <a v-for="module in modules" :key="module.id" :href="'#' + module.id">{{ module.title }}</a>
    </nav>
    <div v-if="overview" class="dual-summary" aria-label="长短双锚概览">
      <div><span>最新完整月份</span><strong>{{ overview.latest.month }}</strong><small>{{ latestState }}</small></div>
      <div><span>ETF短期锚</span><strong>{{ direction(overview.latest.etf) }}</strong><small>预测次月收益 {{ percent(overview.latest.predicted) }}</small></div>
      <div><span>宏观长期锚</span><strong>{{ direction(overview.latest.macro) }}</strong><small>价格偏离 {{ percent(overview.latest.deviation) }}</small></div>
      <div><span>长期看涨阈值 P30</span><strong>{{ percent(overview.threshold) }}</strong><small>长期看跌阈值为偏离率＞0</small></div>
    </div>
    <section v-for="module in modules" :id="module.id" :key="module.id" class="research-module">
      <div class="research-module-heading">
        <div><span class="research-number">{{ module.number }}</span><h3>{{ module.title }}</h3></div>
        <span class="research-pending">样本内复现</span>
      </div>
      <p class="research-description">{{ module.description }}</p>
      <ResearchEtfMonthly v-if="module.id === 'research-etf'" />
      <ResearchMacroMonthly v-else-if="module.id === 'research-macro'" />
      <ResearchDualAnchor v-else @loaded="overview = $event" />
    </section>
  </div>
</template>

<style scoped>
.dual-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 24px;color:#425b5f}.dual-summary>div{padding:16px;background:#f5f8f7;border-radius:6px;display:flex;flex-direction:column;gap:8px}.dual-summary span,.dual-summary small{color:#7c8d8e;font-size:11px;line-height:1.6}.dual-summary strong{font-size:24px;font-weight:600;color:#287985}@media(max-width:850px){.dual-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.dual-summary strong{font-size:21px}}
.research-heading{padding:4px 0 20px}.research-heading p{margin:0 0 10px;color:#927d43;font-size:12px}.research-heading h2{margin:0 0 12px;color:#263c40;font-size:23px;font-weight:600}.research-heading>span{color:#728486;font-size:12px}.research-outline{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px}.research-outline a{padding:9px 14px;border:1px solid #dce4e1;border-radius:5px;color:#5e7475;text-decoration:none;font-size:12px}.research-outline a:hover{border-color:#aa965e;color:#786b43}.research-module{margin-bottom:22px;padding:24px;background:#fff;border:1px solid #e1e7e4;border-radius:8px;scroll-margin-top:72px}.research-module-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.research-module-heading>div{display:flex;align-items:center;gap:12px}.research-number{font-size:12px;color:#aa965e}.research-module h3{margin:0;font-size:17px;font-weight:600;color:#263c40}.research-pending{flex-shrink:0;padding:4px 9px;border-radius:4px;background:#f5f3eb;color:#8c7b4e;font-size:11px}.research-description{color:#728486;font-size:12px;line-height:1.8;margin:12px 0 20px}.research-placeholder{display:flex;align-items:center;justify-content:center;min-height:120px;background:#f8faf9;border:1px dashed #dce4e1;border-radius:5px;color:#8b9999;font-size:12px}@media(max-width:600px){.research-heading h2{font-size:19px}.research-module{padding:18px 14px}.research-module h3{font-size:15px}.research-module-heading>div{gap:8px}.research-outline{gap:8px}.research-outline a{padding:8px 10px}}
</style>
