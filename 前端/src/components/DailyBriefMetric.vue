<script setup>
import { isNumber } from '../daily-brief.js'
defineProps({ row: Object, loading: Boolean, failed: Boolean })
const arrow = change => change > 0 ? '▲' : change < 0 ? '▼' : '→'
const trend = change => change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
</script>

<template>
  <div class="daily-metric">
    <dt>{{ row.label }}</dt>
    <template v-if="row.stats">
      <dd v-for="stat in row.stats" :key="stat.label" class="fee-stat">
        <span>{{ stat.label }}</span>
        <div class="value-line"><strong>{{ loading ? '读取中…' : failed ? '数据暂缺' : stat.valueText }}<small>{{ stat.unit }}</small></strong><span v-if="!loading && !failed" class="change-group"><span class="change" :class="trend(stat.change)"><span v-if="isNumber(stat.change)" class="trend-arrow">{{ arrow(stat.change) }} </span>{{ stat.changeText }}</span></span></div>
      </dd>
      <dd class="meta">{{ row.comparisonText }}</dd>
    </template>
    <template v-else>
      <dd class="value-line">
        <strong :class="{ unavailable: row.value == null }">{{ loading ? '读取中…' : failed ? '数据暂缺' : row.valueText }}<small v-if="row.unit && row.unit !== '文本'">{{ row.unit }}</small></strong>
        <span v-if="!loading && !failed && typeof row.value !== 'string'" class="change-group"><span class="change" :class="trend(row.change)"><span v-if="isNumber(row.change)" class="trend-arrow">{{ arrow(row.change) }} </span>{{ row.changeText }}</span><span class="comparison">{{ row.comparisonText }}</span></span>
      </dd>
      <dd class="meta">数据日期：{{ row.date || '未提供' }}</dd>
    </template>
    <dd v-if="row.reason" class="meta">{{ row.reason }}</dd>
  </div>
</template>

<style scoped>
.change-group{display:inline-flex;flex-direction:column;align-items:flex-start;max-width:100%;vertical-align:baseline}.comparison{font-size:10px;font-weight:400;line-height:1.8;color:#8b9997;overflow-wrap:anywhere}
.daily-metric{min-width:0}dt{font-size:13px;color:#9a7b38;font-weight:700;line-height:1.7;margin-bottom:8px}dd{margin:0}.value-line{display:flex;align-items:baseline;gap:6px 12px;flex-wrap:wrap;min-width:0}.value-line strong{font-size:25px;color:#314f59;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.45;overflow-wrap:anywhere}.value-line small{font-size:11px;font-weight:400;color:#81928f;margin-left:5px}.change{font-size:11px;font-weight:600;line-height:1.8;overflow-wrap:anywhere}.up{color:#bd4c48}.down{color:#37846a}.flat{color:#7d8d8b}.meta{font-size:10px;color:#8b9997;line-height:1.8;margin-top:6px;overflow-wrap:anywhere}.unavailable{font-size:16px!important;color:#93a29e!important;font-weight:400!important}.fee-stat{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:5px;font-size:11px;color:#687e83}.fee-stat .value-line{justify-content:flex-end;gap:6px}.fee-stat strong{font-size:17px}.fee-stat .change{font-size:10px}
</style>
