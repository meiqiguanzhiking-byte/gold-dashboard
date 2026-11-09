<script setup>
import { computed, ref } from 'vue'
import ChartPanel from './ChartPanel.vue'
import { ranges } from '../data.js'
import { futuresContinuousSeries } from '../international-futures.js'
const props = defineProps({ items: { type: Array, default: () => [] }, loading: Boolean, error: String })
const range = ref('1Y')
const priceMode = ref('adjusted')
const gold = computed(() => futuresContinuousSeries(props.items, 'comex', range.value, priceMode.value))
const fx = computed(() => futuresContinuousSeries(props.items, 'sgx_usdcnh', range.value, priceMode.value))
function contractDetails(series) {
  const points = new Map((series[0]?.item.history || []).map(point => [point.observation_date, point]))
  return date => {
    const point = points.get(date)
    if (!point?.contract_expiry) return '当日无可用合约报价'
    const digits = series[0].item.metadata.display_digits ?? 2
    const format = value => value == null ? '缺失' : value.toFixed(digits)
    return `到期月份：${point.contract_expiry} · 原表标识：${point.source_contract} · 原始收盘价：${format(point.raw_value)}`
      + (priceMode.value === 'adjusted' ? ` · 累计回溯调整：${format(point.adjustment)}` : '')
      + (point.rollover ? ` · 换约：${point.rollover.from} → ${point.rollover.to} · 换月价差（新−旧）：${format(point.rollover.gap)}` : '')
  }
}
const goldDetails = computed(() => contractDetails(gold.value))
const fxDetails = computed(() => contractDetails(fx.value))
const note = computed(() => priceMode.value === 'adjusted'
  ? '主力按主力表标识；回溯复权：将换月日新−旧价差累加至更早历史，最新价格不变'
  : '主力按主力表标识；逐日原始价格，保留换月跳空')
const description = computed(() => '北京时间15:00收盘价 · ' + (priceMode.value === 'adjusted' ? '主力连续长期复权' : '主力连续实际价格'))
</script>
<template>
  <div class="filter-bar"><label>时间区间<select v-model="range" aria-label="境外期货时间区间"><option v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</option></select></label><label>价格口径<select v-model="priceMode" aria-label="境外期货价格口径"><option value="actual">实际价格</option><option value="adjusted">长期复权</option></select></label><span>主力按主力表标识 · 北京时间15:00</span></div>
  <div class="chart-grid">
    <ChartPanel :key="'gold-' + range + priceMode" title="COMEX黄金期货（美元/金衡盎司）" :description="description" :series="gold" :tooltip-details="goldDetails" range="ALL" fixed-range :loading="loading" :error="error" latest-time="15:00" :note="note" />
    <ChartPanel :key="'fx-' + range + priceMode" title="美元兑离岸人民币期货（CNH/美元）" :description="description" :series="fx" :tooltip-details="fxDetails" range="ALL" fixed-range :loading="loading" :error="error" latest-time="15:00" :note="note" />
  </div>
</template>
