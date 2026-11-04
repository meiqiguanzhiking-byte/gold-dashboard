<script setup>
import { computed, inject, nextTick, ref, useId } from 'vue'
const props = defineProps({ label: String, options: { type: Array, default: null }, selected: { type: Array, default: null } })
const emit = defineEmits(['update:selected'])
const { sections, hidden, setHidden } = inject('dashboardSections')
const options = computed(() => props.options || sections.value)
const external = computed(() => props.selected !== null)
const empty = computed(() => external.value ? props.selected.length === 0 : sections.value.length > 0 && sections.value.every(s => hidden.value.includes(s.id)))
const openNavigation = ref(null)
const navigationId = useId()
function leaveFocus(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) openNavigation.value = null
}
async function jumpTo(option, link) {
  if (!isChecked(option.id)) toggle(option.id, true)
  openNavigation.value = null
  await nextTick()
  const target = document.getElementById(link.id)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}
function isChecked(id) { return external.value ? props.selected.includes(id) : !hidden.value.includes(id) }
function toggle(id, checked) {
  if (external.value) {
    emit('update:selected', checked ? [...props.selected, id] : props.selected.filter(value => value !== id))
    return
  }
  setHidden(checked ? hidden.value.filter(value => value !== id) : [...hidden.value, id])
}
function selectAll() { external.value ? emit('update:selected', options.value.map(option => option.id)) : setHidden([]) }
function clearAll() { external.value ? emit('update:selected', []) : setHidden(sections.value.map(section => section.id)) }
</script>
<template>
  <fieldset class="section-picker" :aria-label="label + '显示版块'">
    <legend>显示版块</legend>
    <div class="section-options">
      <div v-for="option in options" :key="option.id" class="section-option" @mouseenter="option.links?.length && (openNavigation = option.id)" @mouseleave="openNavigation = null" @focusout="leaveFocus" @keydown.esc.stop="openNavigation = null">
        <label><input type="checkbox" :checked="isChecked(option.id)" @change="toggle(option.id, $event.target.checked)">{{ option.title }}</label>
        <template v-if="option.links?.length">
          <button type="button" class="section-jump-trigger" :aria-label="option.title + '分类导航'" :aria-expanded="openNavigation === option.id" :aria-controls="navigationId + '-' + option.id" @focus="openNavigation = option.id" @click="openNavigation = option.id">⌄</button>
          <nav v-if="openNavigation === option.id" :id="navigationId + '-' + option.id" class="section-jump-popup" :aria-label="option.title + '分类导航'">
            <strong>{{ option.title }}</strong>
            <div class="section-jump-links"><a v-for="link in option.links" :key="link.id" :href="'#' + link.id" @click.prevent="jumpTo(option, link)">{{ link.title }}<span aria-hidden="true">↘</span></a></div>
          </nav>
        </template>
      </div>
      <div class="section-actions"><button class="text-button" type="button" @click="selectAll">全选</button><button class="text-button" type="button" @click="clearAll">清空</button></div>
    </div>
  </fieldset>
  <div v-if="empty" class="sections-empty" role="status"><span>请选择要显示的版块</span><button class="text-button" type="button" @click="selectAll">恢复全选</button></div>
</template>
<style scoped>
.section-option{position:relative;display:flex;align-items:center;gap:3px;max-width:100%}.section-jump-trigger{border:0;background:transparent;color:#927d43;padding:0 3px;font-size:14px;line-height:18px}.section-jump-popup{position:absolute;top:100%;left:0;z-index:25;width:280px;max-width:calc(100vw - 64px);padding:14px;background:#fff;border:1px solid #dfe6df;border-radius:5px;box-shadow:0 5px 18px #29434a20}.section-jump-popup>strong{display:block;color:#506970;font-size:11px;font-weight:600;margin-bottom:10px}.section-jump-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.section-jump-links a{display:flex;justify-content:space-between;gap:6px;text-decoration:none;font-size:11px;color:#6c807f;padding:8px;border-radius:3px;background:#f8faf7}.section-jump-links a:hover{background:#f3efe4;color:#857448}.section-jump-links a span{color:#a39671}@media(max-width:760px){.section-jump-popup{left:auto;right:0;width:240px}}
.section-picker{min-width:0;margin:0 0 24px;padding:12px 16px 14px;border:1px solid #dfe6df;border-radius:5px;background:#f9faf8}.section-picker legend{padding:0 6px;font-size:12px;color:#506970;font-weight:600}.section-options{display:flex;align-items:center;flex-wrap:wrap;gap:12px 22px}.section-options label{display:flex;align-items:center;gap:6px;font-size:11px;color:#6c807f;cursor:pointer;max-width:100%}.section-options input{margin:0;accent-color:#927d43;flex-shrink:0}.section-actions{display:flex;gap:16px;margin-left:auto}.sections-empty{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:16px;padding:40px 15px 64px;color:#849491;font-size:12px}@media(max-width:760px){.section-picker{padding:10px 12px 12px}.section-options{gap:12px 16px}.section-actions{margin-left:0}}
</style>
