<script setup>
import { computed, inject } from 'vue'
import SpotResearch from './SpotResearch.vue'
const section = inject('dashboardQuantSection')
const title = computed(() => section.value === 'futures' ? '期货研究' : '现价研究')
</script>

<template>
  <section class="quant-research" :aria-label="title">
    <SpotResearch v-if="section !== 'futures'" />
    <template v-else>
    <header>
      <p>量化研究</p>
      <h2>{{ title }}</h2>
    </header>
    <div class="quant-empty">研究内容待添加</div>
    </template>
  </section>
</template>

<style scoped>
.quant-research header{padding:4px 0 20px}.quant-research header p{margin:0 0 10px;color:#927d43;font-size:12px}.quant-research h2{margin:0;color:#263c40;font-size:23px;font-weight:600}.quant-empty{padding:40px 24px;background:#fff;border:1px solid #e1e7e4;border-radius:8px;color:#728486;font-size:12px}@media(max-width:600px){.quant-research h2{font-size:19px}.quant-empty{padding:28px 14px}}
</style>
