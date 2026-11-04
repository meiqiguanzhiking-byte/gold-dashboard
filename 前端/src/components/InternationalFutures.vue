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
    const digits = series[0].item.metadata.display_digits ?? 2
    const format = value => value == null ? '缺失' : value.toFixed(digits)
    return `到期月份：${point.contract_expiry} · 原表标识：${point.source_contract} · 原始收盘价：${format(point.raw_value)} · 累计调整：${format(point.adjustment)}`
      + (point.rollover_from ? ` · 换约：${point.rollover_from} → ${point.contract_expiry}` : '')
      + (point.rollover_reference_date ? ` · 价差基准日：${point.rollover_reference_date} · 本次调整：${format(point.rollover_gap)}` : '')
      + (point.adjustment_missing ? ' · 缺少新旧合约共同报价，无法复权' : '')
  }
}
const goldDetails = computed(() => contractDetails(gold.value))
const fxDetails = computed(() => contractDetails(fx.value))
const note = '主力：最近偶数月合约；后复权保留早期基准，按换约前最近共同报价日价差累计调整后续价格'
</script>
<template>
  <div class="filter-bar"><label>时间区间<select v-model="range" aria-label="境外期货时间区间"><option v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</option></select></label><span>最近偶数月主力 · 后复权 · 北京时间15:00</span></div>
  <div class="chart-grid">
    <ChartPanel :key="'gold-' + range" title="COMEX黄金期货（美元/金衡盎司）" description="北京时间15:00收盘价 · 主力连续后复权" :series="gold" :tooltip-details="goldDetails" range="ALL" fixed-range :loading="loading" :error="error" latest-time="15:00" :note="note" />
    <ChartPanel :key="'fx-' + range" title="美元兑离岸人民币期货（CNH/美元）" description="北京时间15:00收盘价 · 主力连续后复权" :series="fx" :tooltip-details="fxDetails" range="ALL" fixed-range :loading="loading" :error="error" latest-time="15:00" :note="note" />
  </div>
</template>
