<script setup>
import { computed, inject, provide, ref, watch } from 'vue'
import DailyBrief from './DailyBrief.vue'
import DailyNews from './DailyNews.vue'
import SectionPicker from './SectionPicker.vue'
defineProps({ items: Array, meta: Object, blocks: Object })
const section = inject('dashboardDailySection')
const pageVisible = inject('dashboardContentVisible')
const newsActive = computed(() => pageVisible.value && section.value === 'news')
const chartsActive = computed(() => pageVisible.value && section.value === 'charts')
const newsVisited = ref(newsActive.value), chartsVisited = ref(chartsActive.value)
watch(newsActive, value => { if (value) newsVisited.value = true }, { flush: 'sync' })
watch(chartsActive, value => { if (value) chartsVisited.value = true }, { flush: 'sync' })
provide('dashboardContentVisible', chartsActive)
const selectSection = inject('dashboardSelectDaily')
const options = [{ id: 'news', name: '每日资讯' }, { id: 'charts', name: '日频数据可视化' }, { id: 'quant', name: '量化分析日报' }]
</script>

<template>
  <div class="daily-dispatch">
    <nav class="daily-options" aria-label="每日速递栏目">
      <button v-for="option in options" :key="option.id" :aria-pressed="section === option.id" @click="selectSection(option.id)">{{ option.name }}</button>
    </nav>
    <DailyNews v-if="newsVisited" v-show="section === 'news'" :meta="meta" :active="newsActive" />
    <div v-show="section === 'charts'" class="daily-charts">
      <SectionPicker label="每日速递" />
      <DailyBrief v-if="chartsVisited" v-memo="[chartsActive, chartsActive ? items : null, chartsActive ? meta : null, chartsActive ? blocks : null]" :items="items" :meta="meta" :blocks="blocks" />
    </div>
    <section v-show="section === 'quant'" class="daily-quant" aria-label="量化分析日报">
      <p class="daily-eyebrow">QUANTITATIVE RESEARCH / 黄金投研</p><h2>量化分析日报</h2>
      <div class="daily-placeholder">待建设，后续接入。</div>
    </section>
  </div>
</template>

<style scoped>
.daily-options{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 25px}.daily-options button{cursor:pointer;border:1px solid #dce4e1;background:transparent;color:#728486;border-radius:5px;padding:9px 15px;font-size:12px}.daily-options button[aria-pressed=true]{border-color:#aa965e;background:#f5f3eb;color:#786b43;font-weight:600}.daily-eyebrow{margin:0 0 10px;color:#927d43;font-size:11px;letter-spacing:1px}.daily-quant h2{margin:0;font-size:23px;font-weight:600;color:#263c40}.daily-placeholder{margin:20px 0;padding:45px 20px;border:1px dashed #dce4e1;border-radius:5px;text-align:center;color:#849491;font-size:13px}
</style>
