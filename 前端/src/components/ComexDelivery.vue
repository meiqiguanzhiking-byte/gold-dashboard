<script setup>
import DashboardSection from './DashboardSection.vue'
import ComexDeliveryChart from './ComexDeliveryChart.vue'
import { deliveryNameSources } from '../delivery-institutions.js'
defineProps({ data: Object, loading: Boolean, error: String })
</script>

<template>
  <DashboardSection id="comex-delivery" title="COMEX实物交割">
    <div class="section-heading"><div><span class="section-number">11</span><h2>COMEX实物交割</h2></div><span>月度交割通知 · 吨</span></div>
    <div class="chart-grid delivery-grid">
      <ComexDeliveryChart v-for="symbol in ['GC', 'MGC']" :key="symbol" :symbol="symbol" :product="data?.contracts?.[symbol]" :loading="loading" :error="error" />
    </div>
    <p class="section-footnote">I＝交付（零线左侧），S＝接收（零线右侧）；同一机构的 C/H 账户分别保留，每个账户仅标注一次。数量为交割通知对应的名义吨数，并非仓库实物出入库量；MGC 涉及部分仓单权益，不与 GC 简单相加。空白保留缺失，明确的 0 保持 0。</p>
    <details class="source-details"><summary>机构名称说明与核对来源</summary><p>中文采用可确认的品牌名称及业务词释义，未确认的专名保留英文；不把品牌释义作为完整中文法定名称。原表简称不随意扩写，会员编号、C/H和不同分部保持独立。C表示客户账户，H表示自营账户，不表示机构本身的买卖方向。</p><p><a v-for="source in deliveryNameSources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" class="delivery-name-source">{{ source.title }}</a></p></details>
  </DashboardSection>
</template>

<style scoped>
.delivery-grid{align-items:stretch;grid-template-rows:repeat(5,auto) 520px auto;row-gap:0}
.delivery-name-source{display:inline-block;margin-right:16px}
@media(max-width:760px){.delivery-grid{grid-template-rows:none;row-gap:13px}.delivery-grid :deep(.delivery-panel){display:block;grid-row:auto}}
</style>
