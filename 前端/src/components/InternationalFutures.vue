<script setup>
import { computed, ref } from 'vue'
import ChartPanel from './ChartPanel.vue'
import { ranges } from '../data.js'
import { futuresContinuousSeries } from '../international-futures.js'
const props = defineProps({ items: { type: Array, default: () => [] }, loading: Boolean, error: String })
const range = ref('1Y')
const gold = computed(() => futuresContinuousSeries(props.items, 'comex', range.value))
const fx = computed(() => futuresContinuousSeries(props.items, 'sgx_usdcnh', range.value))
function contractDetails(series) {
  const points = new Map((series[0]?.item.history || []).map(point => [point.observation_date, point]))
  return date => {
    const point = points.get(date)
    if (!point?.contract_expiry) return '当日无可用合约报价'
    return `到期月份：${point.contract_expiry} · 原表标识：${point.source_contract}` + (point.rollover_from ? ` · 换约：${point.rollover_from} → ${point.contract_expiry}` : '')
  }
}
const goldDetails = computed(() => contractDetails(gold.value))
const fxDetails = computed(() => contractDetails(fx.value))
const note = '原表未提供主力标识及确切到期日；按到期顺序，以最后报价日换约，原价直连、不复权'
</script>
<template>
  <div class="filter-bar"><label>时间区间<select v-model="range" aria-label="境外期货时间区间"><option v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</option></select></label><span>单合约连续 · 按到期顺序换约</span></div>
  <div class="chart-grid">
    <ChartPanel :key="'gold-' + range" title="COMEX黄金期货（美元/金衡盎司）" description="单条连续曲线；横轴日期，纵轴价格" :series="gold" :tooltip-details="goldDetails" range="ALL" fixed-range :loading="loading" :error="error" :note="note" />
    <ChartPanel :key="'fx-' + range" title="美元兑离岸人民币期货（CNH/美元）" description="单条连续曲线；1美元对应的离岸人民币数量" :series="fx" :tooltip-details="fxDetails" range="ALL" fixed-range :loading="loading" :error="error" :note="note" />
  </div>
</template>
