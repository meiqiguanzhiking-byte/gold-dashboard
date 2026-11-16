<script setup>
import { computed, ref, watch } from 'vue'
import ChartPanel from './ChartPanel.vue'
import { bankFxGroups, bankFxLevels, bankFxSeries } from '../bank-fx.js'

const props = defineProps({ items: { type: Array, default: () => [] }, currency: String, loading: Boolean, error: String })
const group = ref('banks'), path = ref([])
const currencyLabel = computed(() => props.currency === 'cny' ? '人民币计价' : '美元计价')
watch(group, value => { path.value = value === 'forward' ? ['签约额'] : [] })
const levels = computed(() => bankFxLevels(props.items, props.currency, group.value, path.value))
const series = computed(() => bankFxSeries(props.items, props.currency, group.value, path.value))
const selectionLabel = computed(() => [bankFxGroups.find(g => g.value === group.value)?.label, ...path.value].join(' · '))
const reason = computed(() => series.value.some(s => s.item.metadata.publication_withheld) ? '该序列暂未纳入展示数据' : '')
function selectLevel(depth, value) { path.value = [...path.value.slice(0, depth), ...(value ? [value] : [])] }
</script>
<template>
  <ChartPanel :title="'银行结售汇（' + currencyLabel + '）'" :description="selectionLabel" :series="series" :loading="loading" :error="error" :reason="reason" range="5Y" note="结汇柱向上、售汇柱向下，差额为折线；提示框显示原始金额。单序列使用折线；缺失不补零。">
    <template #filters>
      <div class="bank-fx-filters">
        <label>类别<select v-model="group" :aria-label="currencyLabel + '结售汇类别'"><option v-for="option in bankFxGroups" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <label v-for="level in levels" :key="group + ':' + level.depth">{{ group === 'forward' ? '业务' : '分项' }}<select :value="path[level.depth] || ''" :aria-label="currencyLabel + '结售汇第' + (level.depth + 1) + '级分项'" @change="selectLevel(level.depth, $event.target.value)"><option v-if="level.total" value="">合计</option><option v-for="option in level.options" :key="option" :value="option">{{ option }}</option></select></label>
      </div>
    </template>
  </ChartPanel>
</template>
<style scoped>
.bank-fx-filters{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin:0 0 14px}.bank-fx-filters label{display:flex;align-items:center;gap:6px;font-size:10px;color:#718082;min-width:0}.bank-fx-filters select{font-size:11px;max-width:100%;min-width:90px}.bank-fx-filters label:first-child select{max-width:270px}@media(max-width:600px){.bank-fx-filters{justify-content:flex-start}.bank-fx-filters label:first-child{width:100%}.bank-fx-filters label:first-child select{flex:1;min-width:0}}
</style>
