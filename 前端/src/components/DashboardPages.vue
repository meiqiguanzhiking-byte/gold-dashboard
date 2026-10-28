<script setup>
import { nextTick, provide, ref } from 'vue'
const activePage = ref('daily')
const pages = [{ id: 'daily', name: '每日速递' }, { id: 'domestic', name: '国内' }, { id: 'foreign', name: '国外' }, { id: 'health', name: '数据健康度' }]
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
  await nextTick()
  window.dispatchEvent(new Event('dashboard-page-visible'))
}
</script>
<template>
  <nav class="page-tabs" aria-label="一级页面" role="tablist"><button v-for="page in pages" :id="'page-tab-' + page.id" :key="page.id" role="tab" :aria-controls="'page-panel-' + page.id" :aria-selected="activePage === page.id" :class="{ selected: activePage === page.id }" @click="selectPage(page.id)">{{ page.name }}</button></nav>
  <slot />
</template>
<style scoped>
.page-tabs{display:flex;border-top:1px solid #e1e7e4;border-bottom:1px solid #dce4e1;margin:0 0 24px;position:sticky;top:0;background:#f4f6f5f5;z-index:10}.page-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:#728486;padding:14px 28px 12px;font-size:12px;cursor:pointer}.page-tabs button:hover{color:#927d43}.page-tabs button.selected{color:#786b43;border-bottom-color:#aa965e;font-weight:600}
@media(max-width:600px){.page-tabs button{flex:1;padding:13px 6px;font-size:11px}}
</style>
