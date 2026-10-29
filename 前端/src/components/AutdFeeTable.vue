<script setup>
import { computed } from 'vue'
import StatusBadge from './StatusBadge.vue'
import { sourceLabel } from '../source-labels.js'
import { summarizeAutdFees } from '../autd-fees.js'

const props = defineProps({ item: Object, loading: Boolean, error: String })
const windows = computed(() => summarizeAutdFees(props.item))
const message = computed(() => props.loading ? '正在读取真实数据…' : props.error ? '接口请求失败：' + props.error : !windows.value[0].count ? '数据暂缺：未取得交收方向记录。' : '')
const status = computed(() => props.loading ? '加载中' : props.error ? '接口失败' : !windows.value[0].valid ? '数据缺失' : windows.value.some(w => w.incomplete || w.unknown) ? '样本不足或方向缺失' : props.item?.metadata.status || '正常')
const days = (w, side) => w.valid ? w[side] : '数据暂缺'
</script>

<template>
  <article class="chart-panel autd-fee-panel" aria-labelledby="autd-fee-title">
    <header class="panel-header"><div><h3 id="autd-fee-title">Au(T+D) 延期费情况</h3><p>最近7个、30个交易观测日 · 支付方向天数</p></div><StatusBadge :status="status" /></header>
    <p class="fee-asof">截至最新观察日：{{ windows[0].end || '未提供' }}</p>
    <div v-if="message" class="fee-message" role="status">{{ message }}</div>
    <template v-else>
      <table class="fee-table" aria-label="Au(T+D) 延期费支付方向统计">
        <thead>
          <tr><th rowspan="2" scope="col">品种</th><th v-for="w in windows" :key="w.size" colspan="2" scope="colgroup">近{{ w.size }}个交易观测日</th></tr>
          <tr><template v-for="w in windows" :key="w.size"><th scope="col">空方支付<br>（天）</th><th scope="col">多方支付<br>（天）</th></template></tr>
        </thead>
        <tbody><tr><th scope="row">Au(T+D)</th><template v-for="w in windows" :key="w.size"><td>{{ days(w, 'short') }}</td><td>{{ days(w, 'long') }}</td></template></tr></tbody>
      </table>
      <div class="fee-windows"><p v-for="w in windows" :key="w.size" :data-fee-window="w.size">
        <strong>近{{ w.size }}个交易观测日</strong><span>{{ w.start || '未提供' }} — {{ w.end || '未提供' }}</span>
        <span>实际 {{ w.count }} 条 · 交收平衡 {{ w.balanced }} 天 · 缺失/未识别 {{ w.unknown }} 天<span v-if="w.incomplete"> · 样本不足{{ w.size }}条</span></span>
      </p></div>
    </template>
    <p class="fee-note">“空支付给多”计入空方支付，“多支付给空”计入多方支付。交收平衡及缺失单列，不填补周末和节假日；不代表自然日计费天数或费用金额。统计窗口独立于左侧图表时间区间。</p>
    <div class="chart-source">来源：{{ sourceLabel(item?.metadata || 'AuTD.csv') }} · 交收方向</div>
  </article>
</template>

<style scoped>
.autd-fee-panel { display:flex; flex-direction:column; }
.fee-asof { margin:16px 0 12px; font-size:10px; color:#829296; }
.fee-table { width:100%; table-layout:fixed; border-collapse:collapse; font-size:11px; text-align:center; }
.fee-table th,.fee-table td { border:1px solid #dfe7e3; padding:13px 5px; overflow-wrap:anywhere; }
.fee-table thead tr:first-child { background:#eaf1ef; color:#35575e; }
.fee-table thead tr:nth-child(2) { background:#f6f8f7; color:#63787e; }
.fee-table th { font-weight:500; line-height:1.7; }
.fee-table th:first-child { width:65px; }
.fee-table td { font-size:22px; font-weight:600; color:#287985; font-variant-numeric:tabular-nums; }
.fee-windows { margin:15px 0; }
.fee-windows p { display:flex; flex-direction:column; gap:5px; color:#829296; font-size:10px; line-height:1.6; margin:0 0 13px; }
.fee-windows strong { color:#536970; font-weight:500; }
.fee-note { margin:auto 0 0; color:#879795; font-size:10px; line-height:1.8; padding-top:10px; }
.fee-message { padding:35px 10px; text-align:center; color:#8c9a9a; }
@media(max-width:480px) { .fee-table { font-size:10px; } .fee-table td { font-size:19px; } .fee-table th:first-child { width:56px; } }
</style>
