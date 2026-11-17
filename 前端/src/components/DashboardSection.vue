<script setup>
import { computed, inject, provide, ref, watch } from 'vue'
const props = defineProps({ id: String, title: String })
const { register, hidden } = inject('dashboardSections')
register({ id: props.id, title: props.title })
const pageVisible = inject('dashboardContentVisible', computed(() => true))
const visible = computed(() => pageVisible.value && !hidden.value.includes(props.id))
const visited = ref(visible.value)
watch(visible, value => { if (value) visited.value = true }, { flush: 'sync' })
provide('dashboardContentVisible', visible)
</script>
<template><section v-show="!hidden.includes(id)" :id="id" class="section"><slot v-if="visited" /></section></template>
