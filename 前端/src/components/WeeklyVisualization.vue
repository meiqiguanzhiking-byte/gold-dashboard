<script setup>
import { computed, ref } from 'vue'
import WeeklyCurveChart from './WeeklyCurveChart.vue'
import { buildWeeklyCurves } from '../weekly-curves.js'

const props = defineProps({ items: { type: Array, default: () => [] }, blocks: Object })
const module = ref('curves')
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const end = ref(today)
const models = computed(() => buildWeeklyCurves(props.items, end.value && end.value < today ? end.value : today))
const loading = computed(() => ['price', 'au-td'].some(key => props.blocks?.[key]?.loading))
const error = computed(() => ['price', 'au-td'].map(key => props.blocks?.[key]?.error).filter(Boolean).join('；'))
</script>

<template>
  <section class="weekly-visualization" aria-label="周频数据可视化">
    <h2>周频数据可视化</h2>
    <nav aria-label="周频可视化模块" class="module-options">
      <button :aria-pressed="module === 'curves'" @click="module = 'curves'">周度曲线</button>
      <button :aria-pressed="module === 'report'" @click="module = 'report'">文字周报</button>
    </nav>
    <div v-show="module === 'curves'">
      <div class="curve-toolbar"><p>最近 7 个国内交易观测日 · 三层共日期轴</p><label>截至观察日 <input v-model="end" type="date" :max="today" /></label></div>
      <p class="window-note">按各组国内原始观察日期截取，缺项保留断点；7个交易观测日不等同于一个自然周。拖动底部滑块可联动缩放，点击图例可显隐曲线。</p>
      <WeeklyCurveChart v-for="model in models" :key="model.id" :model="model" :loading="loading" :error="error" />
    </div>
    <div v-show="module === 'report'" class="report-pending"><h3>文字周报</h3><p>待明确周报内容与生成口径后接入。</p></div>
  </section>
</template>

<style scoped>
.weekly-visualization{color:#344e54}.weekly-visualization h2{margin:0 0 20px;font-size:23px;font-weight:600;color:#263c40}.module-options{display:flex;gap:8px;margin-bottom:18px}.module-options button{border:1px solid #dce4e1;background:transparent;color:#728486;border-radius:5px;padding:9px 16px;cursor:pointer}.module-options button[aria-pressed=true]{border-color:#287985;color:#287985;background:#eaf2f1}.curve-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px}.curve-toolbar p{margin:0}.curve-toolbar label{display:flex;align-items:center;gap:8px;color:#728486}.curve-toolbar input{font:inherit;color:#344e54;background:#fff;border:1px solid #dce4e1;padding:6px 8px;border-radius:4px}.window-note{font-size:11px;line-height:1.8;color:#728486;margin:12px 0 20px}.report-pending{padding:32px 20px;border:1px dashed #dce4e1;background:#f8faf9;font-size:13px}.report-pending h3{margin-top:0;font-size:16px}button:focus-visible,input:focus-visible{outline:2px solid #287985;outline-offset:3px}
</style>
