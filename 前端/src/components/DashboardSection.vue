<script setup>
import { inject } from 'vue'
const props = defineProps({ id: String, title: String })
const { register, hidden } = inject('dashboardSections')
register({ id: props.id, title: props.title })
</script>
<template><section v-show="!hidden.includes(id)" :id="id" class="section"><slot /></section></template>
