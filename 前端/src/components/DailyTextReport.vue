<script setup>
import { useDailyAi } from '../daily-ai.js'
import { localTime } from '../data.js'
const props = defineProps({ report: Object, loading: Boolean, unavailable: Boolean, thresholds: Object, meta: Object })
defineEmits(['indicator-click'])
const { currentReport, preference, isAi, status, notice, copy, copyStatus, generatedAt, pending } = useDailyAi(props)
</script>

<template>
  <article class="text-report" :aria-busy="loading">
    <header><h3 id="daily-text-report-title">文字日报</h3><span>报告日期 {{ currentReport.reportDate }} · 北京时间</span></header>
    <div class="report-controls"><div class="report-tabs" role="tablist" aria-label="日报版本"><button id="daily-ai-tab" type="button" role="tab" :aria-selected="isAi" aria-controls="daily-report-body" @click="preference = 'ai'">AI优化</button><button id="daily-rule-tab" type="button" role="tab" :aria-selected="!isAi" aria-controls="daily-report-body" @click="preference = 'rule'">数值规则</button></div><span class="report-status" role="status">{{ status }}</span><button type="button" class="report-copy" :disabled="loading" @click="copy">{{ copyStatus || '复制当前日报' }}</button></div>
    <p class="report-dates">主要价格观察日期 {{ currentReport.observationDates }} · 现货15:30，期货15:00（北京时间）<template v-if="generatedAt"> · 生成时间 {{ localTime(generatedAt) }}</template></p>
    <p v-if="notice" class="report-notice" role="status">{{ notice }}</p>
    <p v-if="loading" class="report-loading" role="status">正在读取日报数据…</p>
    <div v-else id="daily-report-body" class="report-content" role="tabpanel" :aria-labelledby="isAi ? 'daily-ai-tab' : 'daily-rule-tab'" :aria-busy="pending"><h4 v-if="isAi" class="report-headline">{{ currentReport.title }}</h4><p v-for="(paragraph, index) in currentReport.richParagraphs" :key="index"><strong class="report-title">{{ currentReport.titles[index] }}：</strong><template v-for="(token, tokenIndex) in paragraph" :key="tokenIndex"><a v-if="token.type === 'indicator'" class="report-indicator" :href="'#daily-movement-' + token.id" @click.prevent="$emit('indicator-click', token.id, currentReport.targets?.[token.id])">{{ token.text }}</a><strong v-else-if="token.type === 'value'" class="report-value">{{ token.text }}</strong><template v-else>{{ token.text }}</template></template></p></div>
  </article>
</template>

<style scoped>
.text-report{border:1px solid #e0e7df;border-left:3px solid #b39b61;border-radius:5px;background:#fff;padding:16px 18px;margin-bottom:18px}.text-report header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px 18px}.text-report h3{margin:0;font-size:14px;font-weight:600;color:#536a6e}.text-report header span,.report-dates{font-size:10px;line-height:1.8;color:#8b9997}.report-dates{margin:8px 0 12px}.report-content p{margin:0 0 12px;color:#526c72;font-size:13px;line-height:2;overflow-wrap:anywhere}.report-content p:last-child{margin-bottom:0}.report-content strong{font-weight:600;color:#857448}.report-loading{color:#849491;font-size:12px}@media(max-width:600px){.text-report{padding:14px 12px}}
</style>

<style scoped>
.report-content .report-indicator{color:#2f8060;font-weight:700;text-decoration:none;border-bottom:1px dotted #6ca58a;cursor:pointer}.report-content .report-indicator:hover{color:#1d6547;border-bottom-style:solid}.report-content .report-indicator:focus-visible{outline:2px solid #47876a;outline-offset:3px;border-radius:2px}.report-content .report-value{color:inherit;font-weight:700;font-variant-numeric:tabular-nums}
.report-controls{display:flex;gap:10px 16px;align-items:center;flex-wrap:wrap;margin:12px 0 0}.report-tabs{display:flex;gap:18px;border-bottom:1px solid #dde5e1}.report-tabs button{border:0;background:transparent;padding:6px 0 8px;color:#849491;font-size:12px;border-bottom:2px solid transparent}.report-tabs button[aria-selected="true"]{color:#857448;font-weight:600;border-bottom-color:#b39b61}.report-status{font-size:10px;color:#458166}.report-copy{margin-left:auto;border:1px solid #dce5df;border-radius:4px;background:#f8faf8;color:#526c72;padding:5px 10px;font-size:11px}.report-notice{font-size:10px;color:#8b9997;margin:0 0 10px;line-height:1.7}.report-headline{font-size:15px;font-weight:600;color:#3e5860;line-height:1.8;margin:0 0 10px}
</style>
