<script setup>
import { inject, nextTick, provide, ref, shallowRef } from 'vue'
import SectionPicker from './SectionPicker.vue'
const props = defineProps({ page: String, label: String })
const activePage = inject('dashboardActivePage')
const storageKey = `gold-dashboard:sections:v1:${props.page}`
const sections = shallowRef([])
const hidden = ref([])
try {
  const saved = JSON.parse(localStorage.getItem(storageKey))
  if (Array.isArray(saved?.hidden) && saved.hidden.every(id => typeof id === 'string')) hidden.value = saved.hidden
} catch { /* 存储不可用或记录损坏时默认全选，仍可在本次打开期间操作。 */ }
function setHidden(ids) {
  hidden.value = [...new Set(ids)]
  try { localStorage.setItem(storageKey, JSON.stringify({ hidden: hidden.value })) } catch { /* 不阻断页面使用。 */ }
  nextTick(() => window.dispatchEvent(new Event('dashboard-page-visible')))
}
provide('dashboardSections', {
  sections, hidden, setHidden,
  register(section) { sections.value = [...sections.value, section] },
})
</script>
<template><div v-show="activePage === page" :id="'page-panel-' + page" class="page-panel" role="tabpanel" :aria-labelledby="'page-tab-' + page" :aria-label="label"><SectionPicker :label="label" /><slot /></div></template>
<style scoped>.page-panel{min-width:0}</style>
