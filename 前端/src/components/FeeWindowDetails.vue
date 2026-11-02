<script setup>
import { ref, useId } from 'vue'

defineProps({ window: { type: Object, required: true }, align: { type: String, default: 'start' } })
const opened = ref(false)
const tooltipId = useId()
function leaveFocus(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) opened.value = false
}
</script>

<template>
  <span class="fee-detail" :class="'align-' + align" @mouseenter="opened = true" @mouseleave="opened = false" @focusin="opened = true" @focusout="leaveFocus" @keydown.esc.stop="opened = false">
    <button type="button" class="fee-detail-trigger" :aria-describedby="opened ? tooltipId : undefined" @click="opened = true"><slot>近{{ window.size }}个交易观测日</slot></button>
    <span v-if="opened" :id="tooltipId" class="fee-detail-popup" role="tooltip">
      <span class="fee-detail-content" tabindex="0" :aria-label="'近' + window.size + '个交易观测日交收方向明细'">
        <span class="fee-detail-heading">交收方向 · 实际 {{ window.count }} 条（由近到远）</span>
        <span v-for="point in window.observations" :key="point.date" class="fee-detail-row"><span>{{ point.date }}</span><span :class="{ 'direction-long': point.direction === '多支付给空', 'direction-short': point.direction === '空支付给多' }">{{ point.direction }}</span></span>
        <span v-if="window.incomplete" class="fee-detail-note">样本不足{{ window.size }}条，展示全部已有观察记录。</span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.fee-detail { position:relative; display:inline-block; max-width:100%; text-align:left; }
.fee-detail-trigger { padding:0; border:0; background:none; color:inherit; font:inherit; line-height:inherit; text-decoration:underline dotted #9dafad; text-underline-offset:4px; cursor:help; }
.fee-detail-popup { position:absolute; top:100%; left:0; z-index:20; width:280px; max-width:calc(100vw - 40px); padding-top:6px; color:#536970; font-size:11px; font-weight:400; line-height:1.7; }
.align-center .fee-detail-popup { left:50%; transform:translateX(-50%); }
.align-end .fee-detail-popup { left:auto; right:0; }
.fee-detail-content { display:block; max-height:310px; overflow-y:auto; overscroll-behavior:contain; padding:10px 12px; background:#fff; border:1px solid #dfe7e3; border-radius:5px; box-shadow:0 5px 18px #29434a20; }
.fee-detail-heading { display:block; color:#35575e; margin-bottom:6px; }
.fee-detail-row { display:flex; justify-content:space-between; gap:12px; padding:4px 0; border-top:1px solid #edf1ef; font-variant-numeric:tabular-nums; }
.fee-detail-row > span:first-child { white-space:nowrap; }
.fee-detail-row > span:last-child { text-align:right; overflow-wrap:anywhere; }
.direction-long { color:#b64d45; }
.direction-short { color:#32805b; }
.fee-detail-note { display:block; margin-top:6px; color:#879795; font-size:10px; }
</style>
