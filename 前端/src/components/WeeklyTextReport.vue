<script setup>
import { computed, ref, watch } from 'vue'
import { buildWeeklyReport } from '../weekly-report.js'
import { localTime } from '../data.js'
import { sourceLabel } from '../source-labels.js'

const props = defineProps({ models: { type: Array, required: true }, cutoff: String, loading: Boolean, error: String })
const report = computed(() => buildWeeklyReport(props.models, props.cutoff, !!props.error))
const generatedAt = ref(''), copyStatus = ref('')
watch([report, () => props.loading], () => { generatedAt.value = props.loading ? '' : new Date().toISOString(); copyStatus.value = '' }, { immediate: true })
const sources = computed(() => [...new Set(props.models.flatMap(model => model.sources.map(sourceLabel)))].join('；'))
const note = '涨跌按期末与期初收盘价比较。7个交易观测日包含6次日间变化，可能跨自然周。行情只写国内金价、海外原币金价和汇率的走势。缺失数据留空，期货使用未复权价格，换约前后分别比较。现价用USDCNY，期货用对应的USDCNH期货。两者分别采用在岸和离岸人民币报价，各市场收盘时间也有差异。周报只描述数值变化，不解释宏观原因。'
async function copy() {
  try { await navigator.clipboard.writeText(report.value.plain + '\n\n口径：' + note + '\n来源：' + sources.value); copyStatus.value = '已复制' }
  catch { copyStatus.value = '复制失败，请手动复制正文' }
}
</script>

<template>
  <article class="weekly-text-report" :aria-busy="loading" aria-label="文字周报">
    <header><h3>文字周报</h3><span>截至观察日 {{ cutoff }} · 北京时间</span></header>
    <div class="report-controls"><span class="rule-version">数值规则</span><button :disabled="loading || !!error" @click="copy">{{ copyStatus || '复制当前周报' }}</button></div>
    <p class="report-dates">{{ report.periods.join('；') }}<template v-if="generatedAt"> · 生成时间 {{ localTime(generatedAt) }}</template></p>
    <p v-if="loading" role="status" class="report-notice">正在读取周报数据…</p>
    <p v-else-if="error" role="status" class="report-notice">数据读取失败：{{ error }}。周报暂不可用。</p>
    <div v-else class="report-content"><p v-for="(paragraph, index) in report.paragraphs" :key="index"><strong class="report-title">{{ report.titles[index] }}：</strong><template v-for="(token, i) in paragraph" :key="i"><br v-if="token.type === 'break'" /><strong v-else-if="token.type === 'indicator'" class="report-indicator">{{ token.text }}</strong><strong v-else-if="token.type === 'value'" class="report-value">{{ token.text }}</strong><template v-else>{{ token.text }}</template></template></p></div>
    <details class="report-method"><summary>统计口径与来源</summary><p>{{ note }}</p><p>判断走势时，先忽略相邻两日持平的情况。其余变化方向相同，记为持续上行或下行；方向改变一次，记为先升后降或先降后升；改变多次，记为震荡。每天都相同则记为持平。期间有缺值时，暂不判断走势。高低点取自已有数据，同一高低点出现多次时列出所有日期。</p><p>海外现价以北京时间15:30为目标取价时间，在岸汇率有时取同日较早K线或备用日线，因此报价未必同步。期末数据缺失时保留为空。页面所列生成时间是周报生成时间。</p><p>来源：{{ sources || '真实来源待确认' }}</p></details>
  </article>
</template>

<style scoped>
.weekly-text-report{border:1px solid #e0e7df;border-left:3px solid #b39b61;border-radius:5px;background:#fff;padding:16px 18px;margin-bottom:18px}.weekly-text-report header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px 18px}.weekly-text-report h3{margin:0;font-size:14px;font-weight:600;color:#536a6e}.weekly-text-report header span,.report-dates{font-size:10px;line-height:1.8;color:#8b9997}.report-controls{display:flex;align-items:center;gap:16px;margin:12px 0 0}.rule-version{color:#857448;font-size:12px;font-weight:600;border-bottom:2px solid #b39b61;padding:6px 0 8px}.report-controls button{margin-left:auto;border:1px solid #dce5df;border-radius:4px;background:#f8faf8;color:#526c72;padding:5px 10px;font-size:11px;cursor:pointer}.report-controls button:disabled{opacity:.6;cursor:default}.report-dates{margin:8px 0 12px}.report-content p{margin:0 0 12px;color:#526c72;font-size:13px;line-height:2;overflow-wrap:anywhere}.report-content .report-title{color:#857448;font-weight:600}.report-indicator{color:#2f8060;font-weight:700}.report-value{font-weight:700;font-variant-numeric:tabular-nums}.report-notice,.report-method{font-size:11px;line-height:1.8;color:#849491}.report-method summary{cursor:pointer}.report-method p{margin:6px 0;overflow-wrap:anywhere}button:focus-visible,summary:focus-visible{outline:2px solid #287985;outline-offset:3px}@media(max-width:600px){.weekly-text-report{padding:14px 12px}}
</style>
