<script setup>
import StatusBadge from './StatusBadge.vue'
import { sourceLabel } from '../source-labels.js'
import { format, signed } from '../data.js'
defineProps({ items: { type: Array, default: () => [] }, loading: Boolean, error: String })
</script>
<template>
  <article class="metric-card volatility-card">
    <div class="metric-top"><h3>年化历史波动率</h3><StatusBadge :status="loading ? '加载中' : error ? '接口失败' : items.some(item => item?.latest.value == null) ? '数据缺失' : items[0]?.metadata.status || '数据缺失'" /></div>
    <div v-for="(item, index) in items" :key="index" class="volatility-row" :title="item?.warnings.join('；')">
      <div class="volatility-value"><span>{{ index === 0 ? '20日' : '60日' }}</span><strong>{{ loading ? '读取中…' : error ? '接口请求失败' : item?.latest.value == null ? '数据暂缺' : format(item.latest.value) + '%' }}</strong></div>
      <div class="metric-change">较上期 {{ item?.latest.change == null || loading || error ? '暂不可计算' : signed(item.latest.change) + ' 个百分点' }}</div>
      <div class="volatility-date">观察日期 {{ item?.latest.observation_date || '未提供' }}</div>
    </div>
    <p v-if="error" class="inline-error">{{ error }}</p><p v-else-if="items.some(item => item?.latest.value == null)" class="inline-note">{{ items.find(item => item?.metadata.publication_withheld)?.warnings[0] || '数据不足：上游缺值或有效收益窗口不足，不回退至早期值。' }}</p>
    <div class="metric-source">来源：{{ sourceLabel(items[0]?.metadata) }} · 日度</div>
  </article>
</template>
<style scoped>
.volatility-row{margin-top:10px}.volatility-value{display:flex;align-items:baseline;justify-content:space-between;gap:8px;color:#718587;font-size:10px}.volatility-value strong{font-size:19px;font-weight:600;color:#2e4852;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.volatility-row .metric-change{margin-top:3px;min-height:0}.volatility-date{font-size:9px;color:#829296;margin-top:3px}.inline-note{font-size:9px;line-height:1.6;color:#8a9798;margin:8px 0 0}
</style>
