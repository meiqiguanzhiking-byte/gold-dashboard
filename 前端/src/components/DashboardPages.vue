<script setup>
import { nextTick, onBeforeUnmount, onMounted, provide, ref } from 'vue'
const emit = defineEmits(['select'])
const activePage = ref('daily')
const dailySection = ref('charts')
const dailyMenuOpen = ref(false)
const dailyOptions = [{ id: 'news', name: '每日资讯' }, { id: 'charts', name: '日频数据可视化' }, { id: 'quant', name: '量化分析日报' }]
const weeklySection = ref('news')
const weeklyMenuOpen = ref(false)
const weeklyOptions = [{ id: 'news', name: '每周资讯' }, { id: 'charts', name: '周频数据可视化' }, { id: 'quant', name: '量化分析周报' }]
const quantSection = ref('spot')
const quantMenuOpen = ref(false)
const quantOptions = [{ id: 'spot', name: '现价研究' }, { id: 'futures', name: '期货研究' }]
function closeQuantMenu(event) {
  if (!event.target.closest('.page-tab-entry')?.querySelector('#page-tab-quant')) quantMenuOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', closeQuantMenu))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeQuantMenu))
const pages = [{ id: 'daily', name: '每日速递' }, { id: 'weekly', name: '每周速递' }, { id: 'domestic', name: '国内' }, { id: 'foreign', name: '国外' }, { id: 'cross', name: '交叉展示' }, { id: 'quant', name: '量化研究' }, { id: 'strategy', name: '策略线' }, { id: 'research', name: '研报复现' }, { id: 'health', name: '数据健康度' }]
provide('dashboardQuantSection', quantSection)
async function selectQuant(section) {
  quantSection.value = section
  quantMenuOpen.value = false
  await selectPage('quant')
}
function clickPage(page) {
  if (page === 'quant') quantMenuOpen.value = !quantMenuOpen.value
  else quantMenuOpen.value = false
  selectPage(page)
}
provide('dashboardActivePage', activePage)
provide('dashboardDailySection', dailySection)
provide('dashboardSelectDaily', selectDaily)
async function selectDaily(section) {
  dailySection.value = section
  dailyMenuOpen.value = false
  await selectPage('daily')
  await nextTick()
  window.dispatchEvent(new Event('dashboard-page-visible'))
}
provide('dashboardWeeklySection', weeklySection)
provide('dashboardSelectWeekly', selectWeekly)
function selectWeekly(section) {
  weeklySection.value = section
  weeklyMenuOpen.value = false
  selectPage('weekly')
}
provide('dashboardNavigate', async (page, section) => {
  if (!pages.some(p => p.id === page)) return
  if (page === 'daily') dailySection.value = 'charts'
  await selectPage(page)
  await nextTick()
  window.dispatchEvent(new CustomEvent('dashboard-section-open', { detail: { page, section } }))
})
async function selectPage(page) {
  if (activePage.value === page) return
  activePage.value = page
  emit('select', page)
  await nextTick()
  window.dispatchEvent(new Event('dashboard-page-visible'))
}
</script>
<template>
  <nav class="page-tabs" aria-label="一级页面" role="tablist">
    <div v-for="page in pages" :key="page.id" class="page-tab-entry" @mouseenter="page.id === 'weekly' ? (weeklyMenuOpen = true) : page.id === 'daily' && (dailyMenuOpen = true)" @mouseleave="weeklyMenuOpen = false; dailyMenuOpen = false" @focusin="page.id === 'weekly' ? (weeklyMenuOpen = true) : page.id === 'daily' && (dailyMenuOpen = true)" @focusout="!$event.currentTarget.contains($event.relatedTarget) && (weeklyMenuOpen = dailyMenuOpen = false)" @keydown.esc="weeklyMenuOpen = dailyMenuOpen = false">
      <button :id="'page-tab-' + page.id" role="tab" :aria-controls="'page-panel-' + page.id" :aria-selected="activePage === page.id" :aria-expanded="page.id === 'quant' ? quantMenuOpen : undefined" :class="{ selected: activePage === page.id }" @click="clickPage(page.id)" @keydown.esc="quantMenuOpen = false">{{ page.name }}<span v-if="['daily', 'weekly', 'quant', 'research'].includes(page.id)" aria-hidden="true" class="report-arrow">⌄</span></button>
      <div v-if="page.id === 'quant'" v-show="quantMenuOpen" class="report-menu quant-menu" role="group" aria-label="量化研究选项" @keydown.esc="quantMenuOpen = false" @focusout="!$event.currentTarget.parentElement.contains($event.relatedTarget) && (quantMenuOpen = false)">
        <button v-for="option in quantOptions" :key="option.id" :aria-current="activePage === 'quant' && quantSection === option.id ? 'page' : undefined" @click="selectQuant(option.id)">{{ option.name }}</button>
      </div>
      <div v-if="page.id === 'daily'" v-show="dailyMenuOpen" class="report-menu daily-menu" role="group" aria-label="每日速递选项">
        <button v-for="option in dailyOptions" :key="option.id" :aria-current="activePage === 'daily' && dailySection === option.id ? 'page' : undefined" @click="selectDaily(option.id)">{{ option.name }}</button>
      </div>
      <div v-if="page.id === 'weekly'" v-show="weeklyMenuOpen" class="report-menu weekly-menu" role="group" aria-label="每周速递选项">
        <button v-for="option in weeklyOptions" :key="option.id" :aria-current="activePage === 'weekly' && weeklySection === option.id ? 'page' : undefined" @click="selectWeekly(option.id)">{{ option.name }}</button>
      </div>
      <div v-if="page.id === 'research'" class="report-menu" role="group" aria-label="选择研报">
        <span class="report-menu-label">选择研报</span>
        <button @click="selectPage('research')">国泰君安期货-黄金长短双锚</button>
      </div>
    </div>
  </nav>
  <slot />
</template>
<style scoped>
.page-tabs{display:flex;border-top:1px solid #e1e7e4;border-bottom:1px solid #dce4e1;margin:0 0 24px;position:sticky;top:0;background:#f4f6f5f5;z-index:10}.page-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:#728486;padding:14px 28px 12px;font-size:12px;cursor:pointer}.page-tabs button:hover{color:#927d43}.page-tabs button.selected{color:#786b43;border-bottom-color:#aa965e;font-weight:600}
.page-tab-entry{position:relative}.report-arrow{margin-left:5px}.report-menu{display:none;position:absolute;top:100%;left:0;min-width:260px;padding:10px;background:#fff;border:1px solid #dce4e1;border-radius:0 0 8px 8px;box-shadow:0 8px 20px #23393612}.page-tab-entry:hover .report-menu,.page-tab-entry:focus-within .report-menu{display:block}.report-menu-label{display:block;padding:4px 10px 8px;color:#728486;font-size:11px}.report-menu button{display:block;width:100%;padding:10px;text-align:left;white-space:nowrap;color:#786b43;border-radius:4px}.report-menu button:hover{background:#f5f3eb}
.weekly-menu,.daily-menu{min-width:190px}.weekly-menu button[aria-current=page],.daily-menu button[aria-current=page]{background:#f5f3eb;font-weight:600}
.quant-menu{display:block;min-width:190px}.quant-menu button[aria-current=page]{background:#f5f3eb;font-weight:600}
@media(max-width:600px){.page-tab-entry{flex:1}.page-tabs .page-tab-entry>button{width:100%;padding:13px 4px;font-size:11px;white-space:nowrap}.report-menu{left:auto;right:0;min-width:245px}}
@media(max-width:600px){.weekly-menu,.daily-menu{left:0;right:auto;min-width:190px}}
</style>
