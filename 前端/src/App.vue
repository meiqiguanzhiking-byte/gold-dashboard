<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import ChartPanel from './components/ChartPanel.vue'
import MetricCard from './components/MetricCard.vue'
import StatusBadge from './components/StatusBadge.vue'
import RankingChart from './components/RankingChart.vue'
import FlowHeatmap from './components/FlowHeatmap.vue'
import ComexInventory from './components/ComexInventory.vue'
import ComexDelivery from './components/ComexDelivery.vue'
import VolatilityCard from './components/VolatilityCard.vue'
import AutdFeeTable from './components/AutdFeeTable.vue'
import DailyBrief from './components/DailyBrief.vue'
import DashboardPages from './components/DashboardPages.vue'
import DashboardPage from './components/DashboardPage.vue'
import DashboardSection from './components/DashboardSection.vue'
import { centralBankEntityName } from './central-bank-names.js'
import { useDashboard, isStatic, categoryNames, format, localTime, regions, regionColors, palette, numeric, sortHealthSources } from './data.js'

const { blocks, meta, all, dailyItems, dailyBlocks, item, refreshing, reloadError, clientRefreshedAt, notice, loadAll, loadPage, refresh, loadBlock } = useDashboard()
const coreCards = [
  { id: 'gold_price_anchor', category: 'price', label: '上金所Au99.99收盘价', price: true },
  { id: 'gold-volatility', category: 'price', volatility: true },
  { id: 'domestic_etf_total_assets', category: 'etf', label: '境内黄金 ETF 总资产规模' },
  { id: 'london_gold_spot', category: 'price', label: '伦敦金现', price: true },
  { id: 'spdr_gold_holdings', category: 'etf', label: 'SPDR 黄金持仓' },
  { id: 'cftc_net_long', category: 'cftc', label: 'CFTC 非商业净多头' },
  { id: 'global_etf_weekly_total_tonnes', category: 'etf', label: '全球黄金 ETF 周度净流入' },
  { id: 'global_central_bank_net_purchases', category: 'central-bank', label: '全球黄金储备净变化合计（已报告）' },
]
const domesticCards = coreCards.filter(card => ['gold_price_anchor', 'gold-volatility', 'domestic_etf_total_assets'].includes(card.id))
const foreignCards = coreCards.filter(card => !domesticCards.includes(card))
const tradeCards = [
  { id: 'futures_volume', category: 'futures', label: '黄金期货总成交量' },
  { id: 'futures_open_interest', category: 'futures', label: '黄金期货总持仓量' },
  { id: 'futures_main_contract', category: 'futures', label: '黄金期货主力合约' },
  { id: 'au_td_volume', category: 'au-td', label: 'Au(T+D) 成交量' },
  { id: 'au_td_open_interest', category: 'au-td', label: 'Au(T+D) 持仓量' },
  { id: 'au_td_delivery_direction', category: 'au-td', label: 'Au(T+D) 交收方向' },
]
const positionCards = [{ id: 'cftc_long', label: '非商业多头持仓' }, { id: 'cftc_short', label: '非商业空头持仓' }, { id: 'cftc_net_long', label: '非商业净多头持仓' }, { id: 'cftc_net_long_ratio', label: '非商业净多头占比' }]
const allMetadata = computed(() => meta.value?.indicators || all.value.map(i => i.metadata))
const asOf = computed(() => allMetadata.value.map(m => m.coverage_end).filter(Boolean).sort().at(-1) || '未提供')
const failures = computed(() => Object.entries(blocks).filter(([, b]) => b.error))
const pending = computed(() => Object.values(blocks).some(b => b.loading))
const countStatus = s => allMetadata.value.filter(m => m.status === s || m.statuses?.includes(s)).length
const missingCount = computed(() => countStatus('数据缺失'))
function line(id, name, color, rest = {}) { return { item: item(id), name, color, ...rest } }
const priceItems = computed(() => ['gold_price_anchor', 'gold_hv20', 'gold_hv60'].map(id => item(id)))
const priceWithheld = computed(() => priceItems.value.some(i => i?.metadata.publication_withheld))
const priceNote = computed(() => priceWithheld.value ? '数据暂缺：新增来源公开使用尚未确认，静态版不发布价格及派生波动率。' : '非连续全史：上游未取得2003-04-16至2008-08-10历史；空值保留断点，不补零、不平滑补点。')
const overseasNote = '北京时间15:30结束的半小时K线收盘价；伦敦金现不是LBMA定盘价，汇率为离岸CNH。'
const withheldReason = id => item(id)?.metadata.publication_withheld ? '数据暂缺：来源公开使用尚未确认，静态版不发布该指标及派生数值。' : ''
const spreadNote = computed(() => {
  const m = item('gold_domestic_spread')?.metadata
  return withheldReason('gold_domestic_spread') || `按相同观察日期匹配Au99.99收盘价、北京时间15:30海外金价及汇率；最新有效观察 ${m?.latest_valid_date || '数据暂缺'}。折线跳过空值连接前后有效数据，不补值；折算使用CNH，含CNH/CNY口径差异。`
})

const etfTab = ref('weekly'), selectedFunds = ref([]), selectedRegions = ref(regions.map(r => r.id)), flowUnit = ref('tonnes')
const funds = computed(() => (blocks.etf.data?.indicators || []).filter(i => /^domestic_\d+_assets$/.test(i.metadata.indicator_id)))
let fundsInitialized = false
watch(funds, values => { if (!fundsInitialized && values.length) { selectedFunds.value = values.map(i => i.metadata.fund); fundsInitialized = true } })
const fundShareSeries = computed(() => [
  ...funds.value.map((fund, index) => ({
    item: item(fund.metadata.indicator_id.replace('_assets', '_shares')),
    name: fund.metadata.fund, color: palette[index] + '66', type: 'bar', stack: 'domestic-etf-shares',
  })).filter(s => selectedFunds.value.includes(s.name)),
  line('domestic_etf_total_shares', '七只基金总份额', '#287985'),
])
const fundPeriod = computed(() => funds.value.map(i => i.latest.observation_date).filter(Boolean).sort().at(-1))
const fundRanking = computed(() => funds.value.filter(i => selectedFunds.value.includes(i.metadata.fund)).map(i => ({ name: i.metadata.fund, item: i, point: i.history.find(p => p.observation_date === fundPeriod.value) })).filter(r => numeric(r.point)).sort((a, b) => b.point.value - a.point.value))
const shareLines = computed(() => funds.value.filter(i => selectedFunds.value.includes(i.metadata.fund)).map((i, index) => {
  const shares = item(i.metadata.indicator_id.replace('_assets', '_shares'))
  if (!shares) return null
  const history = shares.history.map((p, n, rows) => ({ ...p, value: numeric(p) && numeric(rows[n - 1]) ? p.value - rows[n - 1].value : null }))
  return { item: { ...shares, metadata: { ...shares.metadata, indicator_name: shares.metadata.fund + ' 份额较上期变化' }, history }, name: shares.metadata.fund, color: palette[funds.value.indexOf(i)], type: 'bar' }
}).filter(Boolean))
const flowFrequency = computed(() => etfTab.value === 'monthly' ? 'monthly' : 'weekly')
const flowSeries = computed(() => regions.filter(r => selectedRegions.value.includes(r.id)).map(r => line('global_etf_' + flowFrequency.value + '_' + r.id + '_' + flowUnit.value, r.name, regionColors[r.id], { type: 'bar', stack: 'flow' })))

const countryItems = computed(() => (blocks['central-bank'].data?.indicators || []).filter(i => i.metadata.country && i.metadata.aggregation_included))
const countryMonths = computed(() => [...new Set(countryItems.value.flatMap(i => i.history.map(p => p.observation_date)))].sort().reverse())
const countryMonth = ref('')
const chineseCentralNames = ref(false)
const centralName = computed(() => { const chinese = chineseCentralNames.value; return name => centralBankEntityName(name, chinese) })
watch(countryMonths, months => { if (!countryMonth.value || !months.includes(countryMonth.value)) countryMonth.value = months[0] || '' })
const countryRows = computed(() => countryItems.value.map(i => ({ name: i.metadata.country, item: i, point: i.history.find(p => p.observation_date === countryMonth.value) })).filter(r => numeric(r.point)))
const buying = computed(() => countryRows.value.filter(r => r.point.value > 0).sort((a, b) => b.point.value - a.point.value))
const selling = computed(() => countryRows.value.filter(r => r.point.value < 0).sort((a, b) => a.point.value - b.point.value))
const undisclosed = computed(() => countryItems.value.filter(i => !numeric(i.history.find(p => p.observation_date === countryMonth.value))).length)
const centralScope = computed(() => item('global_central_bank_net_purchases')?.metadata.aggregation_scope)
const centralPoint = (id, month = countryMonth.value) => item(id)?.history.find(p => p.observation_date === month)?.value
const reportedCount = computed(() => centralPoint('global_central_bank_reporting_count'))
const centralTooltip = month => `数据月份：${month}；报告机构数：${format(centralPoint('global_central_bank_reporting_count', month), 0)} / ${centralScope.value?.included_entities.length || '未提供'}。基于已报告数据，可能随补报修订；非完整全球总量。`

const healthSearch = ref(''), healthFrequency = ref('全部'), healthStatus = ref('全部'), healthPage = ref(1)
const healthTimedIndicators = new Set(['gold_price_anchor', 'london_gold_spot', 'usdcnh', 'gold_domestic_spread'])
const orderedHealthMetadata = computed(() => sortHealthSources(allMetadata.value).map(m =>
  healthTimedIndicators.has(m.indicator_id) ? { ...m, indicator_name: `${m.indicator_name}（15:30）` } : m,
))
const healthFiles = computed(() => sortHealthSources(meta.value?.files || []))
const healthRows = computed(() => orderedHealthMetadata.value.filter(m => (!healthSearch.value || (m.indicator_name + m.source).toLowerCase().includes(healthSearch.value.toLowerCase())) && (healthFrequency.value === '全部' || m.frequency === healthFrequency.value) && (healthStatus.value === '全部' || m.status === healthStatus.value || m.statuses?.includes(healthStatus.value) || m.automation_status === healthStatus.value)))
const healthPages = computed(() => Math.max(1, Math.ceil(healthRows.value.length / 15)))
const visibleHealth = computed(() => healthRows.value.slice((healthPage.value - 1) * 15, healthPage.value * 15))
watch([healthSearch, healthFrequency, healthStatus], () => { healthPage.value = 1 })
watch(healthPages, count => { healthPage.value = Math.min(count, healthPage.value) })
onMounted(loadAll)
</script>

<template>
  <div class="dashboard">
    <header class="topbar"><div class="brand"><span class="brand-mark">Au</span><div><strong>兴证资管 · 研究监测</strong><span>{{ isStatic ? 'GOLD MARKET / STATIC SNAPSHOT' : 'GOLD MARKET / LOCAL DATA' }}</span></div></div><span class="environment"><i></i>{{ isStatic ? '静态展示版 · 真实数据快照' : '本地真实数据 · 只读接入' }}</span></header>
    <main>
      <section class="page-intro"><div><p class="eyebrow">PRECIOUS METALS / 黄金研究</p><h1>黄金市场指标看板</h1><p class="intro-note">从交易、持仓与资金流观察黄金市场</p></div><button class="refresh-button" :disabled="refreshing || pending" @click="refresh"><span :class="{ spinning: refreshing }">↻</span>{{ refreshing ? '正在重新加载…' : isStatic ? '重新加载展示数据' : '刷新真实数据' }}</button></section>
      <p v-if="isStatic" class="static-notice">静态展示版：数据不会随电脑中的文件自动更新。重新加载仅读取已发布的快照；观察日期和口径以各指标标注为准。网页中的真实数值和历史序列可被访问或下载。</p>
      <div class="data-summary"><span>数据截至 <strong>{{ asOf }}</strong><small>各来源频率不同</small></span><span v-if="isStatic">快照生成 <strong>{{ localTime(meta?.generated_at) }}</strong><small>北京时间</small></span><span>{{ isStatic ? '页面读取' : '最近刷新' }} <strong>{{ localTime(clientRefreshedAt) }}</strong></span><span class="summary-status"><i :class="{ warning: failures.length || missingCount }"></i>{{ pending ? '读取中' : failures.length ? failures.length + (isStatic ? ' 个区域读取异常' : ' 个接口异常') : isStatic ? '展示数据已载入' : '接口已连接' }}<small v-if="!pending">{{ missingCount }} 项数据缺失 · {{ countStatus('滞后') }} 项滞后{{ isStatic ? '（快照生成时）' : '' }}</small></span></div>
      <DashboardPages @select="loadPage">
      <div v-if="reloadError" class="alert error" role="alert">{{ reloadError }}</div><div v-else-if="notice" class="alert success" role="status">{{ notice }}</div>
      <div v-for="[key, block] in failures" :key="key" class="alert error" role="alert"><span>{{ categoryNames[key] }}{{ isStatic ? '展示数据读取失败' : '接口失败' }}：{{ block.error }}。其他区域可继续查看。</span><button class="text-button" :disabled="block.loading" @click="loadBlock(key)">{{ isStatic ? '重试此区域' : '重试此接口' }}</button></div>

      <DashboardPage page="daily" label="每日速递" :pickable="false"><DailyBrief :items="dailyItems" :meta="meta" :blocks="dailyBlocks" /></DashboardPage>
      <DashboardPage page="domestic" label="国内">
      <DashboardSection id="overview" title="国内核心指标"><div class="section-heading"><div><span class="section-number">概览</span><h2>国内核心指标</h2></div><span>不同观察频率独立显示</span></div><div class="metric-grid core-grid"><template v-for="card in domesticCards" :key="card.id"><VolatilityCard v-if="card.volatility" :items="[item('gold_hv20'), item('gold_hv60')]" :loading="blocks.price.loading" :error="blocks.price.error" /><MetricCard v-else :item="item(card.id)" :label="card.label" :price="card.price" :loading="blocks[card.category].loading" :error="blocks[card.category].error" /></template></div><p class="section-footnote">卡片日期为各指标观察日期，刷新时间不代表数据发布日期。</p></DashboardSection>

      <DashboardSection id="gold-price" title="黄金价格与波动率">
        <div class="section-heading"><div><span class="section-number">现价</span><h2>黄金价格与波动率</h2></div><span>上金所Au99.99 · 日度</span></div>
        <p class="section-footnote">历史波动率反映过去价格波动程度，不代表未来涨跌方向。</p>
        <p class="section-footnote">{{ priceNote }}</p>
        <div class="chart-grid">
          <ChartPanel title="上金所Au99.99收盘价（元/克）" description="上金所交易日期收盘价；人民币元/克" :series="[line('gold_price_anchor', 'Au99.99收盘价', '#287985')]" :loading="blocks.price.loading" :error="blocks.price.error" :reason="priceWithheld ? priceNote : ''" :note="priceNote" />
          <ChartPanel title="20日与60日年化历史波动率（%）" description="上游计算结果；切换区间不重新计算波动率" :series="[line('gold_hv20', '20日年化历史波动率', '#287985'), line('gold_hv60', '60日年化历史波动率', '#ad945b')]" :loading="blocks.price.loading" :error="blocks.price.error" :reason="priceWithheld ? priceNote : ''" note="缺值或收益窗口不足时显示数据不足；不按零处理，不前值填充" />
          <ChartPanel class="wide" title="黄金现价价差（元/克）" description="Au99.99 − 海外金价人民币折算值；同日期匹配，北京时间15:30海外价格及汇率" :series="[line('gold_domestic_spread', '黄金现价价差', '#287985', { connectNulls: true })]" :loading="blocks.price.loading" :error="blocks.price.error" :reason="withheldReason('gold_domestic_spread')" :note="spreadNote" />
        </div>
        <p class="section-footnote">黄金现价价差＝Au99.99（元/克）−伦敦金现（美元/金衡盎司）×USDCNH（CNH/美元）÷31.1034768。1金衡盎司＝31.1034768克。仅比较同名日期各自收盘，包含CNH/CNY口径差异，不代表同步溢价或可交易套利空间。</p>
        <p class="section-footnote">方法：日对数收益率、20/60个交易观测收益率、样本标准差（ddof=1）、252日年化；只读取上游结果。窗口不足或源值缺失时保持数据暂缺。</p>
        <p v-if="!priceWithheld" class="section-footnote">来源：黄金现货价格.xlsx / 黄金现货价格 · 文件更新 {{ localTime(item('gold_price_anchor')?.metadata.updated_at) }} · 缓存加载 {{ localTime(blocks.price.data?.loaded_at) }} · 发布日期未知（null）。</p>
      </DashboardSection>
      <DashboardSection id="central-bank" title="央行购金">
        <div class="section-heading"><div><span class="section-number">01</span><h2>央行购金</h2></div><span>月度储备 · 机构未确认</span></div>
        <div class="chart-grid">
          <ChartPanel title="央行黄金储备（吨，机构未确认）" :series="[line('central_bank_reserves', '原表央行储备', '#ad945b')]" :loading="blocks['central-bank'].loading" :error="blocks['central-bank'].error" note="工作表未明确国家或机构，不认定为中国官方储备" />
        </div>
      </DashboardSection>

      <DashboardSection id="au-td" title="Au(T+D)">
        <div class="section-heading"><div><span class="section-number">02</span><h2>Au(T+D)</h2></div><StatusBadge status="日度" /></div>
        <div class="metric-grid trade-grid"><MetricCard v-for="card in tradeCards.filter(card => card.category === 'au-td')" :key="card.id" :item="item(card.id)" :label="card.label" :loading="blocks[card.category].loading" :error="blocks[card.category].error" /></div>
        <div class="chart-grid autd-grid">
          <ChartPanel title="Au(T+D) 成交量与持仓量（吨）" description="成交量柱状图与持仓量折线图 · 日度原始记录" :series="[line('au_td_volume', '成交量（吨）', '#abc6ca', { type: 'bar' }), line('au_td_open_interest', '持仓量（吨）', '#287985')]" :loading="blocks['au-td'].loading" :error="blocks['au-td'].error" />
          <AutdFeeTable :item="item('au_td_delivery_direction')" :loading="blocks['au-td'].loading" :error="blocks['au-td'].error" />
        </div>
      </DashboardSection>

      <DashboardSection id="futures" title="上期所黄金期货">
        <div class="section-heading"><div><span class="section-number">03</span><h2>上期所黄金期货</h2></div><StatusBadge status="日度" /></div>
        <div class="metric-grid trade-grid"><MetricCard v-for="card in tradeCards.filter(card => card.category === 'futures')" :key="card.id" :item="item(card.id)" :label="card.label" :loading="blocks[card.category].loading" :error="blocks[card.category].error" /></div>
        <div class="chart-grid">
          <ChartPanel title="黄金期货成交量与持仓量（吨）" description="成交量柱状图与持仓量折线图 · 同单位共用坐标轴" :series="[line('futures_volume', '成交量（吨）', '#abc6ca', { type: 'bar' }), line('futures_open_interest', '持仓量（吨）', '#287985')]" :loading="blocks.futures.loading" :error="blocks.futures.error" note="全市场数据采用后端按日期聚合；主力按成交量最高确定" />
        </div>
      </DashboardSection>

      <DashboardSection id="domestic-etf" title="场内黄金 ETF 份额">
        <div class="section-heading"><div><span class="section-number">04</span><h2>场内黄金 ETF 份额</h2></div><span>境内七只基金 · 日度</span></div>
        <div class="filter-bar"><span>基金筛选</span><label v-for="fund in funds" :key="fund.metadata.fund"><input v-model="selectedFunds" type="checkbox" :value="fund.metadata.fund">{{ fund.metadata.fund }}</label><button class="text-button" @click="selectedFunds = funds.map(i => i.metadata.fund)">全选</button></div>
        <div class="chart-grid">
          <ChartPanel title="境内黄金 ETF 总资产规模（亿元）" :series="[line('domestic_etf_total_assets', '七只基金合计', '#ad945b')]" :loading="blocks.etf.loading" :error="blocks.etf.error" note="总量固定覆盖七只基金，不随基金筛选改变" />
          <RankingChart title="境内黄金 ETF 资产规模排名" :rows="fundRanking" :period="fundPeriod" unit="亿元" :loading="blocks.etf.loading" :error="blocks.etf.error" />
          <ChartPanel title="境内黄金 ETF 总份额与分基金份额（万份）" description="总份额折线与七只基金浅色堆叠柱状图 · 同单位共用坐标轴" :series="fundShareSeries" :loading="blocks.etf.loading" :error="blocks.etf.error" note="折线固定覆盖七只基金；基金筛选和图例仅调整显示，不改变合计口径。任一基金当日缺失时合计为空，不补零。" />
          <ChartPanel title="境内黄金 ETF 份额较上期变化（万份）" description="原始份额的相邻观察期差额；缺失任一期时不计算" :series="shareLines" :loading="blocks.etf.loading" :error="blocks.etf.error" :reason="!selectedFunds.length ? '请选择至少一只基金' : ''" note="按原始份额做简单差分，不视为净申购金额" />
        </div>
      </DashboardSection>

      </DashboardPage>

      <DashboardPage page="foreign" label="国外">
      <DashboardSection id="foreign-overview" title="国外核心指标"><div class="section-heading"><div><span class="section-number">概览</span><h2>国外核心指标</h2></div><span>不同观察频率独立显示</span></div><div class="metric-grid core-grid"><MetricCard v-for="card in foreignCards" :key="card.id" :item="item(card.id)" :label="card.label" :price="card.price" :loading="blocks[card.category].loading" :error="blocks[card.category].error" /></div><p class="section-footnote">伦敦金现及汇率采用北京时间15:30半小时K线收盘价；全球黄金储备净变化仅汇总已报告机构，不代表完整全球总量。</p></DashboardSection>

      <DashboardSection id="overseas-price" title="伦敦金现与汇率">
        <div class="section-heading"><div><span class="section-number">现价</span><h2>伦敦金现与汇率</h2></div><span>北京时间15:30 · 半小时K线收盘价</span></div>
        <div class="chart-grid">
          <ChartPanel title="伦敦金现（美元/金衡盎司）" :description="overseasNote" :series="[line('london_gold_spot', '伦敦金现', '#ad945b')]" :loading="blocks.price.loading" :error="blocks.price.error" :reason="withheldReason('london_gold_spot')" note="来源：Barchart ^XAUUSD北京时间15:30半小时K线close" />
          <ChartPanel title="美元兑离岸人民币（CNH/美元）" description="1美元对应的离岸人民币数量；不等于在岸CNY或人民币中间价" :series="[line('usdcnh', '美元兑离岸人民币', '#287985')]" :loading="blocks.price.loading" :error="blocks.price.error" :reason="withheldReason('usdcnh')" note="来源：Barchart ^USDCNH北京时间15:30半小时K线close；缺失保留空值" />
        </div>
      </DashboardSection>

      <DashboardSection id="positions" title="CFTC 黄金非商业持仓">
        <div class="section-heading"><div><span class="section-number">05</span><h2>CFTC 黄金非商业持仓</h2></div><span>周度非商业持仓 · 原表单位为吨</span></div>
        <div class="metric-grid position-grid"><MetricCard v-for="card in positionCards" :key="card.id" :item="item(card.id)" :label="card.label" :loading="blocks.cftc.loading" :error="blocks.cftc.error" /></div>
        <div class="chart-grid">
          <ChartPanel title="CFTC 多空持仓与净多头（吨）" description="多头、空头堆叠柱状图与净多头折线叠加" :series="[line('cftc_long', '非商业多头', '#5e9eab', { type: 'bar', stack: 'positions' }), line('cftc_short', '非商业空头', '#c98a6f', { type: 'bar', stack: 'positions' }), line('cftc_net_long', '非商业净多头', '#294e62')]" :loading="blocks.cftc.loading" :error="blocks.cftc.error" note="堆叠为多空总规模，净多头使用来源净值列" />
          <ChartPanel title="CFTC 非商业净多头持仓（吨）" description="单独观察净持仓方向与历史变化" :series="[line('cftc_net_long', '净多头（吨）', '#287985')]" :loading="blocks.cftc.loading" :error="blocks.cftc.error" />
        </div>
        <p class="section-footnote">CFTC 日度交易文件不与周度仓位混用；原表早期周度记录并非固定每 7 天，保留实际观察日。</p>
      </DashboardSection>

      <DashboardSection id="spdr" title="SPDR 黄金 ETF 份额">
        <div class="section-heading"><div><span class="section-number">06</span><h2>SPDR 黄金 ETF 份额</h2></div><StatusBadge status="日度" /></div>
        <div class="chart-grid">
          <ChartPanel title="SPDR 黄金持仓趋势（吨）" :series="[line('spdr_gold_holdings', 'SPDR 持有黄金', '#ad945b')]" :loading="blocks.etf.loading" :error="blocks.etf.error" note="采用总持有黄金数，不以 ETF 份额或价格替代持仓" />
        </div>
      </DashboardSection>

      <DashboardSection id="london" title="伦敦金银库存">
        <div class="section-heading"><div><span class="section-number">07</span><h2>伦敦金银库存</h2></div><StatusBadge status="月度" /></div>
        <div class="chart-grid">
          <ChartPanel title="伦敦黄金库存趋势（吨）" :series="[line('london_gold', '黄金库存', '#ad945b')]" :loading="blocks.inventory.loading" :error="blocks.inventory.error" />
          <ChartPanel title="伦敦白银库存趋势（吨）" :series="[line('london_silver', '白银库存', '#6d83ab')]" :loading="blocks.inventory.loading" :error="blocks.inventory.error" />
        </div>
      </DashboardSection>

      <ComexInventory :items="blocks.inventory.data?.indicators || []" :summary="blocks.inventory.data?.comex" :loading="blocks.inventory.loading" :error="blocks.inventory.error" />

      <DashboardSection id="global-etf" title="全球黄金 ETF 流量">
        <div class="section-heading"><div><span class="section-number">09</span><h2>全球黄金 ETF 流量</h2></div><span>周度与月度分开展示</span></div>
        <div class="tab-row" role="tablist" aria-label="全球 ETF 观察频率"><button v-for="tab in [{ id: 'weekly', name: '全球流量 · 周度' }, { id: 'monthly', name: '全球流量 · 月度' }]" :key="tab.id" role="tab" :aria-selected="etfTab === tab.id" :class="{ selected: etfTab === tab.id }" @click="etfTab = tab.id">{{ tab.name }}</button></div>
        <div class="filter-bar"><span>地区筛选</span><label v-for="r in regions" :key="r.id"><input v-model="selectedRegions" type="checkbox" :value="r.id"><i class="region-dot" :style="{ background: regionColors[r.id] }"></i>{{ r.name }}</label><label class="unit-select">统计口径<select v-model="flowUnit" aria-label="全球ETF流量口径"><option value="tonnes">吨数流量</option><option value="usd">美元资金流</option></select></label></div>
        <div class="chart-grid">
          <ChartPanel :key="etfTab + flowUnit" :title="'全球黄金 ETF ' + (etfTab === 'monthly' ? '月度' : '周度') + '分地区净流量（' + (flowUnit === 'tonnes' ? '吨' : '美元') + '）'" description="正值在零轴上方、负值在零轴下方；地区颜色固定" :series="flowSeries" :loading="blocks.etf.loading" :error="blocks.etf.error" :reason="!selectedRegions.length ? '请选择至少一个地区' : ''" note="同频率分地区堆叠；可通过图例开关地区" />
          <ChartPanel :key="etfTab + flowUnit + 'total'" :title="'全球黄金 ETF ' + (etfTab === 'monthly' ? '月度' : '周度') + '净流量合计（' + (flowUnit === 'tonnes' ? '吨' : '美元') + '）'" :series="[line('global_etf_' + flowFrequency + '_total_' + flowUnit, '四地区合计', '#278b94', { type: 'bar', signed: true })]" :loading="blocks.etf.loading" :error="blocks.etf.error" note="四地区总量固定，不随地区筛选改变" />
          <FlowHeatmap v-if="etfTab === 'monthly'" :items="blocks.etf.data?.indicators || []" :selected="selectedRegions" :loading="blocks.etf.loading" :error="blocks.etf.error" />
        </div>
      </DashboardSection>

      <DashboardSection id="global-central-bank" title="全球央行购金">
        <div class="section-heading"><div><span class="section-number">10</span><h2>全球央行购金</h2></div><StatusBadge status="月度" /></div>
        <div class="filter-bar country-filter"><label>数据月份<select v-model="countryMonth" aria-label="央行购金排名月份"><option v-for="month in countryMonths" :key="month" :value="month">{{ month }}</option></select></label><label><input v-model="chineseCentralNames" type="checkbox" aria-label="全球央行购金名称翻译中文">国家/地区名称翻译中文</label><span class="central-report-count">报告机构数：{{ format(reportedCount, 0) }} / {{ centralScope?.included_entities.length || '未提供' }}</span><span>纳入范围内 {{ undisclosed }} 个实体该期缺失或未通过核验；不计作零</span></div>
        <p class="central-month-summary">{{ countryMonth || '数据月份暂缺' }} · 买入量 {{ format(centralPoint('global_central_bank_gross_purchases')) }} 吨 · 卖出量 {{ format(centralPoint('global_central_bank_gross_sales')) }} 吨 · 净买入 {{ format(centralPoint('global_central_bank_net_purchases')) }} 吨</p>
        <div class="chart-grid">
          <ChartPanel title="全球黄金储备净变化合计（吨）" description="已报告月度净变化：正值合计在零轴上方、负值合计在下方，折线表示净买入；同一吨数轴" :series="[line('global_central_bank_gross_purchases', '买入量（正变化合计）', '#78b6cf', { type: 'bar', stack: 'official-changes' }), line('global_central_bank_gross_sales', '卖出量（负变化合计）', '#8b72a0', { type: 'bar', stack: 'official-changes' }), line('global_central_bank_net_purchases', '净买入', '#355d7b')]" :loading="blocks['central-bank'].loading" :error="blocks['central-bank'].error" :tooltip-details="centralTooltip" note="基于已报告数据，可能随补报修订；非完整全球总量。买入/卖出为机构净变化分组，并非实际交易流水。" />
        </div>
        <details class="source-details central-scope"><summary>汇总范围与机构名单（固定口径）</summary><p>WGC Changes Monthly 为月度储备净变化，单位吨，不再差分。共纳入 {{ centralScope?.included_entities.length || '未提供' }} 个官方储备实体；{{ centralName('Turkey') }} 采用央行自有黄金＋财政部黄金，剔除商业部门相关黄金。SOFAZ 全历史排除，季度披露不摊入月份；{{ centralName('Euro Area') }} 不与成员国重复计算。</p><p>报告机构数按原始 Monthly 表有数值的机构计数，真实0计入，原表空白不计入。现有CSV曾补零，后台以只读原始表逐月核验并恢复空白；无法核验的月份保持缺失。该范围并非完整全球总量，储备变化可能含调整、掉期及其他非交易因素。</p><p><strong>纳入：</strong>{{ centralScope?.included_entities.map(centralName).join('；') || '数据暂缺' }}</p><p v-for="(reason, entity) in centralScope?.excluded_entities || {}" :key="entity"><strong>排除 {{ centralName(entity) }}：</strong>{{ reason }}</p><p>来源：World Gold Council（WGC），IMF IFS及各官方机构披露。基于已报告数据，可能随补报修订。</p></details>
        <div class="chart-grid">
          <RankingChart title="当月买入国家/地区 · 正变化排序" :rows="buying" :period="countryMonth" unit="吨" :loading="blocks['central-bank'].loading" :error="blocks['central-bank'].error" :name-formatter="centralName" note="与上方汇总使用相同纳入名单；仅列已报告正值，不是交易流水" />
          <RankingChart title="当月卖出国家/地区 · 负变化排序" :rows="selling" :period="countryMonth" unit="吨" negative :loading="blocks['central-bank'].loading" :error="blocks['central-bank'].error" :name-formatter="centralName" note="与上方汇总使用相同纳入名单；缺失不计作零，真实0不列入排名" />
        </div>
      </DashboardSection>

      <ComexDelivery :data="blocks.inventory.data?.deliveries" :loading="blocks.inventory.loading" :error="blocks.inventory.error" />
      </DashboardPage>

      <DashboardPage page="health" label="数据健康度">
      <DashboardSection id="health" title="数据健康度"><div class="section-heading"><div><span class="section-number">11</span><h2>数据健康度</h2></div><span>{{ allMetadata.length }} 个指标 · {{ meta?.files.length || '—' }} 个文件</span></div><div class="health-filters"><input v-model="healthSearch" placeholder="搜索指标或来源文件" aria-label="搜索数据健康度"><select v-model="healthFrequency" aria-label="健康度频率筛选"><option>全部</option><option>日度</option><option>周度</option><option>月度</option><option>未提供</option></select><select v-model="healthStatus" aria-label="健康度状态筛选"><option>全部</option><option>正常</option><option>滞后</option><option>短历史</option><option>仅最新值</option><option>人工接入</option><option>未确认</option><option>数据缺失</option></select><span>自动化状态按来源披露，不假定已自动接入</span></div>
        <div v-if="blocks.meta.loading" class="table-message">正在读取元数据…</div><div v-else-if="blocks.meta.error" class="alert caution">元信息接口失败，使用已成功接口的指标元数据；文件级信息暂不可用。</div>
        <div class="health-table"><table><thead><tr><th>数据项 / 来源</th><th>更新频率</th><th>最新观察期</th><th>历史起始</th><th>文件最近更新</th><th>数据延迟</th><th>自动化状态</th><th>数据状态</th></tr></thead><tbody><tr v-for="m in visibleHealth" :key="m.indicator_id"><td><strong>{{ m.indicator_name }}</strong><small>{{ m.source }}{{ m.sheet ? ' / ' + m.sheet : '' }}</small></td><td>{{ m.frequency }}</td><td>{{ m.coverage_end || '未提供' }}</td><td>{{ m.coverage_start || '未提供' }}</td><td>{{ localTime(m.updated_at) }}</td><td>{{ m.delay_days == null ? '未提供' : m.delay_days + ' 天' }}</td><td><StatusBadge :status="m.automation_status" /></td><td><StatusBadge :status="m.status" /><span v-if="m.status !== '滞后' && m.statuses?.includes('滞后')" class="secondary-status">滞后</span></td></tr><tr v-if="!visibleHealth.length"><td colspan="8" class="table-message">{{ pending ? '读取中…' : '没有符合筛选条件的数据项' }}</td></tr></tbody></table></div>
        <div class="pagination"><span>共 {{ healthRows.length }} 项 · 第 {{ healthPage }} / {{ healthPages }} 页</span><button :disabled="healthPage <= 1" @click="healthPage--">上一页</button><button :disabled="healthPage >= healthPages" @click="healthPage++">下一页</button></div>
        <details class="source-details"><summary>查看文件读取状态与数据口径</summary><div v-for="file in healthFiles" :key="file.source" class="file-row"><strong>{{ file.source }}</strong><span>{{ file.coverage_start || '未提供' }} — {{ file.latest_date || '未提供' }}</span><StatusBadge :status="file.status" /><small>{{ file.warnings.join('；') }}</small></div><p>缺失保持空值；真实零值显示为 0。日/周/月延迟阈值为后端配置的提示阈值，不代表发布日历。原始发布日期未提供，数据健康度显示“未提供”。</p></details>
      </DashboardSection>
      </DashboardPage>
      </DashboardPages><footer class="page-footer"><span>黄金市场指标看板 · {{ isStatic ? '静态展示版' : '本地真实文件' }}</span><span>不插值 · 不前值填充 · 不生成虚构数据</span></footer>
    </main>
  </div>
</template>

<style scoped>
.static-notice { margin:16px 0 0; padding:10px 12px; border-left:2px solid #b69b64; background:#f7f4eb; color:#867348; font-size:11px; line-height:1.8; }
.chart-grid > :only-child { grid-column: 1 / -1; }
.trade-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.central-month-summary { font-size:11px; color:#536970; line-height:1.8; }
.central-scope p { font-size:11px; line-height:1.9; overflow-wrap:anywhere; }
.autd-grid { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); }
@media (max-width: 1000px) { .central-month-summary { font-size:11px; color:#536970; line-height:1.8; }
.central-scope p { font-size:11px; line-height:1.9; overflow-wrap:anywhere; }
.autd-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 760px) {
  .trade-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .section { scroll-margin-top: 40px; }
}
</style>
