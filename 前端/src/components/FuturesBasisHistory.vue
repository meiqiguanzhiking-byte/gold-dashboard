<script setup>
import { computed, ref, watch } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { basisHistory } from '../futures-basis-history.js'

const props = defineProps({ quotes: Object, spot: Object, loading: Boolean, error: String })
const history = computed(() => basisHistory(props.quotes, props.spot))
const byDate = computed(() => new Map(history.value.map(row => [row.observation_date, row.quotes])))
const dates = computed(() => [...byDate.value.keys()].sort().reverse())
const selectedDate = ref('')
watch(dates, values => { if (!values.includes(selectedDate.value)) selectedDate.value = values[0] || '' }, { immediate: true })
const rows = computed(() => byDate.value.get(selectedDate.value) || [])
const message = computed(() => props.loading ? '正在读取真实数据…' : props.error ? '接口请求失败：' + props.error : !rows.value.length ? '该日无可用合约记录。' : '')
const status = computed(() => props.loading ? '加载中' : props.error ? '接口失败' : !rows.value.some(row => row.value != null) ? '数据缺失' : props.quotes?.metadata.status || '正常')
const number = value => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const detail = row => `最后交易日：${row.expiry_date || '未确认'}；剩余自然日：${row.days ?? '未知'}；${row.expiry_basis || ''}${row.reason ? '；' + row.reason : ''}`
</script>

<template>
  <article class="chart-panel basis-panel" aria-labelledby="futures-basis-title" data-futures-basis-table>
    <header class="panel-header">
      <div><h3 id="futures-basis-title">黄金期货各合约升贴水率</h3><p>价格与基差：元/克 · 升贴水率：年化百分比</p></div>
      <div class="basis-controls"><label>日期<select v-model="selectedDate" aria-label="黄金期货升贴水率日期" :disabled="loading || !dates.length"><option v-for="date in dates" :key="date" :value="date">{{ date }}</option></select></label><StatusBadge :status="status" /></div>
    </header>
    <p class="basis-asof">{{ selectedDate || '日期未提供' }} · {{ rows.length }} 个合约</p>
    <div v-if="message" class="basis-message" role="status">{{ message }}</div>
    <div v-else class="basis-table-scroll" tabindex="0" aria-label="黄金期货升贴水率表格，可横向滚动">
      <table class="basis-table" aria-label="黄金期货各合约升贴水率">
        <thead><tr><th scope="col">期货名称</th><th scope="col">期货价格</th><th scope="col">Au99.99收盘价</th><th scope="col">基差</th><th scope="col">升贴水率</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.contract" :data-contract="row.contract">
          <th scope="row" :title="detail(row)">{{ row.contract }}</th>
          <td>{{ number(row.close) }}</td><td>{{ number(row.spot) }}</td><td>{{ number(row.basis) }}</td><td :title="detail(row)">{{ row.value == null ? '—' : number(row.value) + '%' }}</td>
        </tr></tbody>
      </table>
    </div>
    <p class="basis-note">基差＝期货价格−同日Au99.99收盘价。升贴水率＝基差÷Au99.99收盘价×365÷剩余自然日×100%。缺失或剩余天数≤0时显示“—”。</p>
    <div class="chart-source">来源：上海期货交易所；上海黄金交易所</div>
  </article>
</template>

<style scoped>
.basis-panel{display:flex;flex-direction:column}.basis-controls{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.basis-controls label{display:flex;align-items:center;gap:6px;font-size:10px;color:#829296;white-space:nowrap}.basis-controls select{font-size:10px;max-width:145px}.basis-asof{margin:16px 0 12px;font-size:10px;color:#829296}.basis-table-scroll{width:100%;overflow-x:auto;outline-offset:3px}.basis-table{width:100%;min-width:460px;border-collapse:collapse;white-space:nowrap;font-size:11px;font-variant-numeric:tabular-nums}.basis-table th,.basis-table td{padding:12px 8px;border-bottom:1px solid #e7ede9;text-align:right}.basis-table thead th{background:#edf3f0;color:#63787e;font-size:10px;font-weight:500}.basis-table th:first-child{text-align:left}.basis-table tbody th{color:#35575e;font-weight:500}.basis-table tbody td{color:#536970}.basis-table tbody tr:hover{background:#f7faf8}.basis-note{margin:auto 0 0;padding-top:15px;font-size:10px;color:#879795;line-height:1.8}.basis-message{padding:45px 10px;text-align:center;color:#8c9a9a;font-size:11px}@media(max-width:480px){.basis-panel .panel-header{flex-wrap:wrap}.basis-controls{width:100%;justify-content:flex-end}.basis-table th,.basis-table td{padding:11px 7px}}
</style>
