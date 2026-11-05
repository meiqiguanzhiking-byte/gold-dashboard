<script setup>
defineProps({ report: Object, loading: Boolean })
defineEmits(['indicator-click'])
</script>

<template>
  <article class="text-report" :aria-busy="loading">
    <header><h3 id="daily-text-report-title">文字日报</h3><span>报告日期 {{ report.reportDate }} · 北京时间</span></header>
    <p class="report-dates">主要价格观察日期 {{ report.observationDates }} · 现货15:30，期货15:00（北京时间）</p>
    <p v-if="loading" class="report-loading" role="status">正在读取日报数据…</p>
    <div v-else class="report-content"><p v-for="(paragraph, index) in report.richParagraphs" :key="index"><strong class="report-title">{{ report.titles[index] }}：</strong><template v-for="(token, tokenIndex) in paragraph" :key="tokenIndex"><a v-if="token.type === 'indicator'" class="report-indicator" :href="'#daily-movement-' + token.id" @click.prevent="$emit('indicator-click', token.id)">{{ token.text }}</a><strong v-else-if="token.type === 'value'" class="report-value">{{ token.text }}</strong><template v-else>{{ token.text }}</template></template></p></div>
  </article>
</template>

<style scoped>
.text-report{border:1px solid #e0e7df;border-left:3px solid #b39b61;border-radius:5px;background:#fff;padding:16px 18px;margin-bottom:18px}.text-report header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px 18px}.text-report h3{margin:0;font-size:14px;font-weight:600;color:#536a6e}.text-report header span,.report-dates{font-size:10px;line-height:1.8;color:#8b9997}.report-dates{margin:8px 0 12px}.report-content p{margin:0 0 12px;color:#526c72;font-size:13px;line-height:2;overflow-wrap:anywhere}.report-content p:last-child{margin-bottom:0}.report-content strong{font-weight:600;color:#857448}.report-loading{color:#849491;font-size:12px}@media(max-width:600px){.text-report{padding:14px 12px}}
</style>

<style scoped>
.report-content .report-indicator{color:#2f8060;font-weight:700;text-decoration:none;border-bottom:1px dotted #6ca58a;cursor:pointer}.report-content .report-indicator:hover{color:#1d6547;border-bottom-style:solid}.report-content .report-indicator:focus-visible{outline:2px solid #47876a;outline-offset:3px;border-radius:2px}.report-content .report-value{color:inherit;font-weight:700;font-variant-numeric:tabular-nums}
</style>
