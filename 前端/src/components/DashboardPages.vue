<script setup>
import { nextTick, provide, ref } from 'vue'
const emit = defineEmits(['select'])
const activePage = ref('daily')
const pages = [{ id: 'daily', name: '每日速递' }, { id: 'domestic', name: '国内' }, { id: 'foreign', name: '国外' }, { id: 'cross', name: '交叉展示' }, { id: 'research', name: '研报复现' }, { id: 'health', name: '数据健康度' }]
provide('dashboardActivePage', activePage)
provide('dashboardNavigate', async (page, section) => {
  if (!pages.some(p => p.id === page)) return
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
    <div v-for="page in pages" :key="page.id" class="page-tab-entry">
      <button :id="'page-tab-' + page.id" role="tab" :aria-controls="'page-panel-' + page.id" :aria-selected="activePage === page.id" :class="{ selected: activePage === page.id }" @click="selectPage(page.id)">{{ page.name }}<span v-if="page.id === 'research'" aria-hidden="true" class="report-arrow">⌄</span></button>
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
@media(max-width:600px){.page-tab-entry{flex:1}.page-tabs .page-tab-entry>button{width:100%;padding:13px 4px;font-size:11px;white-space:nowrap}.report-menu{left:auto;right:0;min-width:245px}}
</style>
