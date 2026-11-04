<script setup>
import { ref, useId } from 'vue'
import { isNumber, numberText } from '../daily-brief.js'

defineProps({ details: { type: Object, required: true } })
const opened = ref(false)
const popupId = useId()
function leaveFocus(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) opened.value = false
}
</script>

<template>
  <span class="basis-detail" @mouseenter="opened = true" @mouseleave="opened = false" @focusin="opened = true" @focusout="leaveFocus" @keydown.esc.stop="opened = false">
    <button type="button" class="basis-trigger" :aria-describedby="opened ? popupId : undefined" @click="opened = true">升贴水率 ⓘ</button>
    <span v-if="opened" :id="popupId" class="basis-popup" role="tooltip">
      <span class="basis-content" tabindex="0" aria-label="当日全部合约升贴水率">
        <strong>{{ details.date || '未提供' }} · 全部合约升贴水率</strong>
        <span class="basis-note">Au99.99现货：{{ numberText(details.spot) }} 元/克</span>
        <span v-for="quote in details.quotes" :key="quote.contract" class="basis-quote">
          <span><b>{{ quote.contract.replace(/^au/i, 'Au') }}</b><small>最后交易日 {{ quote.expiry_date || '未确认' }}<template v-if="quote.days != null"> · {{ quote.days }}天</template></small></span>
          <span class="basis-rate" :class="{ positive: quote.value > 0, negative: quote.value < 0 }">{{ numberText(quote.value) }}{{ isNumber(quote.value) ? '%' : '' }}<small v-if="isNumber(quote.change)" :class="{ positive: quote.change > 0, negative: quote.change < 0 }">{{ quote.change > 0 ? '+' : '' }}{{ numberText(quote.change) }} 个百分点<br>较 {{ quote.previousDate }}</small><small v-else>变化暂不可计算</small><small v-if="quote.reason">{{ quote.reason }}</small></span>
        </span>
        <span v-if="!details.quotes.length" class="basis-note">合约数据暂缺</span>
        <span class="basis-note">(期货−现货)÷现货×365÷剩余自然日；期现价格与剩余天数均以此观察日为准。到期日采用上期所最后交易日。</span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.basis-rate small.positive{color:#bd4c48}.basis-rate small.negative{color:#37846a}
.basis-detail{position:relative;display:inline-block;max-width:100%}.basis-trigger{padding:0;border:0;background:none;color:inherit;font:inherit;line-height:inherit;text-decoration:underline dotted #9dafad;text-underline-offset:4px;cursor:help}.basis-popup{position:absolute;z-index:25;top:100%;left:0;width:380px;max-width:calc(100vw - 70px);padding-top:6px;color:#536970;font-size:11px;font-weight:400;line-height:1.8}.basis-content{display:block;max-height:350px;overflow-y:auto;overscroll-behavior:contain;background:#fff;border:1px solid #dfe7e3;border-radius:5px;box-shadow:0 5px 18px #29434a20;padding:12px}.basis-content>strong{display:block;font-size:11px;color:#35575e;margin-bottom:5px}.basis-quote{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-top:1px solid #edf1ef;font-variant-numeric:tabular-nums}.basis-quote b{font-weight:500}.basis-quote small{display:block;font-size:9px;color:#8b9997;font-weight:400}.basis-rate{text-align:right;font-weight:600;flex-shrink:0;max-width:45%}.positive{color:#bd4c48}.negative{color:#37846a}.basis-note{display:block;font-size:10px;color:#879795;margin:5px 0;overflow-wrap:anywhere}
</style>
