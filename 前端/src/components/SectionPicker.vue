<script setup>
import { computed, inject } from 'vue'
const props = defineProps({ label: String, options: { type: Array, default: null }, selected: { type: Array, default: null } })
const emit = defineEmits(['update:selected'])
const { sections, hidden, setHidden } = inject('dashboardSections')
const options = computed(() => props.options || sections.value)
const external = computed(() => props.selected !== null)
const empty = computed(() => external.value ? props.selected.length === 0 : sections.value.length > 0 && sections.value.every(s => hidden.value.includes(s.id)))
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
    <div class="section-options"><label v-for="option in options" :key="option.id"><input type="checkbox" :checked="isChecked(option.id)" @change="toggle(option.id, $event.target.checked)">{{ option.title }}</label><div class="section-actions"><button class="text-button" type="button" @click="selectAll">全选</button><button class="text-button" type="button" @click="clearAll">清空</button></div></div>
  </fieldset>
  <div v-if="empty" class="sections-empty" role="status"><span>请选择要显示的版块</span><button class="text-button" type="button" @click="selectAll">恢复全选</button></div>
</template>
<style scoped>
.section-picker{min-width:0;margin:0 0 24px;padding:12px 16px 14px;border:1px solid #dfe6df;border-radius:5px;background:#f9faf8}.section-picker legend{padding:0 6px;font-size:12px;color:#506970;font-weight:600}.section-options{display:flex;align-items:center;flex-wrap:wrap;gap:12px 22px}.section-options label{display:flex;align-items:center;gap:6px;font-size:11px;color:#6c807f;cursor:pointer;max-width:100%}.section-options input{margin:0;accent-color:#927d43;flex-shrink:0}.section-actions{display:flex;gap:16px;margin-left:auto}.sections-empty{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:16px;padding:40px 15px 64px;color:#849491;font-size:12px}@media(max-width:760px){.section-picker{padding:10px 12px 12px}.section-options{gap:12px 16px}.section-actions{margin-left:0}}
</style>
