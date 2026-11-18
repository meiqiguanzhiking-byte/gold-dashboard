<script setup>
import { computed, inject, ref } from 'vue'
import WeeklyCurveChart from './WeeklyCurveChart.vue'
import WeeklyTextReport from './WeeklyTextReport.vue'
import SectionPicker from './SectionPicker.vue'
import { buildWeeklyCurves } from '../weekly-curves.js'

const props = defineProps({ items: { type: Array, default: () => [] }, blocks: Object })
const options = [{ id: 'weekly-curves', title: '周度曲线' }, { id: 'weekly-text-report', title: '文字周报' }]
const { register, hidden, setHidden } = inject('dashboardSections')
for (const option of options) register(option)
const selected = computed(() => options.filter(option => !hidden.value.includes(option.id)).map(option => option.id))
function selectModules(ids) {
  setHidden([...hidden.value.filter(id => !options.some(option => option.id === id)), ...options.filter(option => !ids.includes(option.id)).map(option => option.id)])
}
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const end = ref(today)
const models = computed(() => buildWeeklyCurves(props.items, end.value && end.value < today ? end.value : today))
const loading = computed(() => ['price', 'au-td'].some(key => props.blocks?.[key]?.loading))
const error = computed(() => ['price', 'au-td'].map(key => props.blocks?.[key]?.error).filter(Boolean).join('；'))
</script>

<template>
  <section class="weekly-visualization" aria-label="周频数据可视化">
    <h2>周频数据可视化</h2>
    <SectionPicker label="周频数据可视化" :options="options" :selected="selected" @update:selected="selectModules" />
    <div v-show="selected.length" class="curve-toolbar"><p>最近 7 个国内交易观测日 · 曲线与周报共用区间</p><label>截至观察日 <input v-model="end" type="date" :max="today" /></label></div>
    <div v-show="selected.includes('weekly-curves')">
      <p class="window-note">按各组国内原始观察日期截取，缺项保留断点；7个交易观测日不等同于一个自然周。拖动底部滑块可联动缩放，点击图例可显隐曲线。</p>
      <WeeklyCurveChart v-for="model in models" :key="model.id" :model="model" :loading="loading" :error="error" />
    </div>
    <WeeklyTextReport v-show="selected.includes('weekly-text-report')" :models="models" :cutoff="end && end < today ? end : today" :loading="loading" :error="error" />
  </section>
</template>

<style scoped>
.weekly-visualization{color:#344e54}.weekly-visualization h2{margin:0 0 20px;font-size:23px;font-weight:600;color:#263c40}.curve-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px}.curve-toolbar p{margin:0}.curve-toolbar label{display:flex;align-items:center;gap:8px;color:#728486}.curve-toolbar input{font:inherit;color:#344e54;background:#fff;border:1px solid #dce4e1;padding:6px 8px;border-radius:4px}.window-note{font-size:11px;line-height:1.8;color:#728486;margin:12px 0 20px}.curve-toolbar{margin-bottom:16px}button:focus-visible,input:focus-visible{outline:2px solid #287985;outline-offset:3px}
</style>
