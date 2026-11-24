<script setup>
import { computed, inject, nextTick, onMounted, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'
import SectionPicker from './SectionPicker.vue'
const props = defineProps({ page: String, label: String, pickable: { type: Boolean, default: true }, pickerOptions: { type: Array, default: null }, pickerSelected: { type: Array, default: null }, defaultHidden: { type: Array, default: () => [] } })
defineEmits(['picker-update'])
const activePage = inject('dashboardActivePage')
const visible = computed(() => activePage.value === props.page)
const visited = ref(visible.value)
watch(visible, value => { if (value) visited.value = true }, { flush: 'sync' })
provide('dashboardContentVisible', visible)
const storageKey = `gold-dashboard:sections:${props.defaultHidden.length ? 'v2' : 'v1'}:${props.page}`
const sections = shallowRef([])
const hidden = ref([...props.defaultHidden])
try {
  const saved = JSON.parse(localStorage.getItem(storageKey))
  if (Array.isArray(saved?.hidden) && saved.hidden.every(id => typeof id === 'string')) hidden.value = saved.hidden
} catch { /* 存储不可用或记录损坏时使用页面默认选择，仍可在本次打开期间操作。 */ }
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
<template><div v-show="visible" :id="'page-panel-' + page" class="page-panel" role="tabpanel" :aria-labelledby="'page-tab-' + page" :aria-label="label"><template v-if="visited"><SectionPicker v-if="pickable" :label="label" :options="pickerOptions" :selected="pickerSelected" @update:selected="$emit('picker-update', $event)" /><slot /></template></div></template>
<style scoped>.page-panel{min-width:0}</style>
