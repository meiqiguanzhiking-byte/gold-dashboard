<script setup>
import { inject } from 'vue'
defineProps({ page: String, label: String })
const activePage = inject('dashboardActivePage')
</script>
<template><div v-show="activePage === page" :id="'page-panel-' + page" class="page-panel" role="tabpanel" :aria-labelledby="'page-tab-' + page" :aria-label="label"><slot /></div></template>
<style scoped>.page-panel{min-width:0}</style>
