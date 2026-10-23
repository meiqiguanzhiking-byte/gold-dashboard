<script setup>
import { computed } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { format, signed } from '../data.js'
const props = defineProps({ item: Object, label: String, loading: Boolean, error: String, price: Boolean })
const state = computed(() => props.loading ? '加载中' : props.error ? '接口失败' : props.item?.metadata.status || '数据缺失')
const value = computed(() => props.loading ? '读取中…' : props.error ? '接口请求失败' : props.price && props.item?.latest.value == null ? '价格数据待补充' : format(props.item?.latest.value))
const isRatio = computed(() => props.item?.metadata.unit?.startsWith('比例'))
const change = computed(() => {
  const raw = props.item?.latest.change
  if (raw == null) return '暂不可计算'
  if (isRatio.value) return signed(raw * 100) + ' 个百分点'
  const absolute = signed(raw) + ' ' + props.item.metadata.unit
  return props.price ? absolute + '（' + (props.item.latest.change_pct == null ? '涨跌幅暂不可计算' : signed(props.item.latest.change_pct) + '%') + '）' : absolute
})
</script>
<template>
  <article class="metric-card" :title="error || item?.warnings.join('；')">
    <div class="metric-top"><h3>{{ label || item?.metadata.indicator_name }}</h3><StatusBadge :status="state" /></div>
    <div class="metric-number" :class="{ unavailable: !item || item.latest.value == null || loading || error }">{{ isRatio && item?.latest.value != null && !loading && !error ? format(item.latest.value * 100) + '%' : value }}<small v-if="!isRatio && item?.latest.value != null && !loading && !error">{{ item.metadata.unit }}</small></div>
    <div class="metric-change" :class="{ positive: item?.latest.change > 0, negative: item?.latest.change < 0 }">较上一期 {{ change }}</div>
    <div class="metric-date"><span>{{ item?.latest.observation_date || '观察日期未提供' }}</span><span>{{ item?.metadata.frequency || '频率未提供' }}</span></div>
    <p v-if="error" class="inline-error">{{ error }}</p>
    <div v-else class="metric-source">{{ item?.metadata.source === '未提供' ? '价格口径待确认' : item?.metadata.source || '数据源暂不可用' }}<span v-if="item?.latest.value == null"> · 单位{{ item?.metadata.unit || '未提供' }}</span></div>
  </article>
</template>
