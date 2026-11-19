<script setup>
import { ref } from 'vue'
import SpotMarketChart from './SpotMarketChart.vue'
import SpotSpreadStatistics from './SpotSpreadStatistics.vue'
import SpotRollingIC from './SpotRollingIC.vue'
const marketData = ref(null)

const pages = [
  { id: 'factors', name: '因子数据概况' },
  { id: 'backtest', name: '回测' },
  { id: 'live', name: '实盘' },
]
const activePage = ref('factors')
</script>

<template>
  <div class="spot-research">
    <nav class="spot-options" aria-label="现价研究栏目" role="tablist">
      <button v-for="page in pages" :id="'spot-tab-' + page.id" :key="page.id"
        role="tab" :aria-selected="activePage === page.id" :aria-controls="'spot-panel-' + page.id"
        @click="activePage = page.id">{{ page.name }}</button>
    </nav>
    <section v-for="page in pages" v-show="activePage === page.id" :id="'spot-panel-' + page.id"
      :key="page.id" role="tabpanel" :aria-labelledby="'spot-tab-' + page.id">
      <header>
        <p>现价研究</p>
        <h2>{{ page.name }}</h2>
      </header>
      <template v-if="page.id === 'factors'">
        <SpotMarketChart @loaded="marketData = $event" />
        <SpotSpreadStatistics :data="marketData" />
        <SpotRollingIC :data="marketData" />
      </template>
      <div v-else class="spot-empty">{{ page.name }}内容待添加</div>
    </section>
  </div>
</template>

<style scoped>
.spot-options{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 25px}
.spot-options button{cursor:pointer;border:1px solid #dce4e1;background:transparent;color:#728486;border-radius:5px;padding:9px 15px;font-size:12px}
.spot-options button:hover{border-color:#aa965e;color:#786b43}
.spot-options button[aria-selected=true]{border-color:#aa965e;background:#f5f3eb;color:#786b43;font-weight:600}
.spot-options button:focus-visible{outline:2px solid #aa965e;outline-offset:3px}
.spot-research header{padding:4px 0 20px}
.spot-research header p{margin:0 0 10px;color:#927d43;font-size:12px}
.spot-research h2{margin:0;color:#263c40;font-size:23px;font-weight:600}
.spot-empty{padding:40px 24px;background:#fff;border:1px solid #e1e7e4;border-radius:8px;color:#728486;font-size:12px}
@media(max-width:600px){.spot-options{gap:6px}.spot-options button{padding:9px 10px;font-size:11px}.spot-research h2{font-size:19px}.spot-empty{padding:28px 14px}}
</style>
