<script setup>
import { inject, nextTick, onMounted, onBeforeUnmount, provide, ref, shallowRef } from 'vue'
import SectionPicker from './SectionPicker.vue'
const props = defineProps({ page: String, label: String, pickable: { type: Boolean, default: true } })
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
async function openSection(event) {
  if (event.detail?.page !== props.page || !sections.value.some(s => s.id === event.detail.section)) return
  setHidden(hidden.value.filter(id => id !== event.detail.section))
  await nextTick()
  const target = document.getElementById(event.detail.section)
  target?.setAttribute('tabindex', '-1')
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
onMounted(() => window.addEventListener('dashboard-section-open', openSection))
onBeforeUnmount(() => window.removeEventListener('dashboard-section-open', openSection))
provide('dashboardSections', {
  sections, hidden, setHidden,
  register(section) { sections.value = [...sections.value, section] },
})
</script>
<template><div v-show="activePage === page" :id="'page-panel-' + page" class="page-panel" role="tabpanel" :aria-labelledby="'page-tab-' + page" :aria-label="label"><SectionPicker v-if="pickable" :label="label" /><slot /></div></template>
<style scoped>.page-panel{min-width:0}</style>
