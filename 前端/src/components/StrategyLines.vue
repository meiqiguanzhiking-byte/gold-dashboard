<script setup>
import DashboardSection from './DashboardSection.vue'
const strategies = [
  { name: '黄金稳健', type: '灰盒', badge: '灰盒 · 套利择时', headline: '持有黄金打底，相对指数争取持续增收', points: ['跟随金价打底', '择时信号增强', '两地价差增强', '仓位动态优化'], structure: '跟随金价打底 ＋ 择时增强 ＋ 两地价差策略增强，追求相对基准的持续增强', risk: '超额收益可能主要来自择时增强与两地价差套利；力争保留金价上涨弹性，净值通常随金价波动，金价下跌时可能产生亏损' },
  { name: '黄金领先', type: '白盒 · 工具型', badge: '白盒 · 工具型', headline: '市场不涨时，争取相对指数获得一定超额', points: ['持有黄金 ＋ 卖出部分大涨空间', '按月收取期权权利金，力争增强收益', '大涨仍留有参与空间', '震荡市力争增收，下跌时寻求一定缓冲'], structure: '不加杠杆：持有黄金 ＋ 卖出部分大涨空间换期权费', risk: '力争在震荡或下跌市中相对占优；大涨时收益设有上限，可能跑输指数' },
  { name: '黄金锐进', type: '白盒 · 工具型', badge: '白盒 · 工具型', headline: '涨时力争约 2 倍弹性，跌时期权工具力求提供缓冲', points: ['以约 2 倍敞口参与金价波动', '买入期权工具对冲部分下行风险', '上涨时力争约 2 倍弹性，下跌时期权工具力求提供缓冲', '期权对冲安排随市场动态调整'], structure: '加 1 倍杠杆：以约 2 倍敞口参与金价波动 ＋ 买入期权工具对冲部分风险', risk: '上涨时力争约 2 倍弹性，下跌时期权工具力求提供缓冲（非对称结构）；杠杆可能同步放大波动与回撤' },
  { name: '黄金绝对收益', type: '灰盒', structure: '绝对收益策略：关注境内外「两地价差」＋ 期权工具对冲部分风险', risk: '力争实现目标年化收益并控制回撤，力求降低对金价涨跌方向的依赖；极端行情下可能出现阶段性亏损，目标不构成承诺' },
]
</script>

<template>
  <div class="strategy-lines">
    <DashboardSection id="strategy-layout" title="黄金家族策略布局">
      <header class="strategy-heading">
        <p class="eyebrow">01 / 黄金家族策略布局</p>
        <h2>以指数增强 ＋ 套利为核心的全谱系布局</h2>
        <p class="intro">黄金指数增强（稳健 / 领先 / 锐进）跟随金价、力争持续增强；黄金套利力求降低方向依赖、争取绝对收益，大类资产轮动为延伸。</p>
      </header>
      <div class="family-layout">
        <div class="family-heading">
          <h3>兴证资管黄金家族</h3>
          <p>同一研究底座的策略化表达：<strong>基本面研究底座 × 量化策略引擎 × 智能演化引擎</strong>；每个策略可单独运行，亦可作为组合模块使用</p>
        </div>
        <div class="enhancement-group">
          <div class="series-heading gold-heading"><h3>指数增强系列 <span>跟随金价 ＋ 力争持续增强</span></h3><p>基准：黄金ETF <i>·</i> 季开</p></div>
          <div class="strategy-cards">
            <article v-for="strategy in strategies.slice(0, 3)" :key="strategy.name" class="strategy-card">
              <div class="card-heading"><h4>{{ strategy.name }}</h4><span :class="['strategy-badge', { grey: strategy.type === '灰盒' }]">{{ strategy.badge }}</span></div>
              <p class="card-headline">{{ strategy.headline }}</p>
              <ul><li v-for="point in strategy.points" :key="point">{{ point }}</li></ul>
            </article>
          </div>
        </div>
        <div class="arbitrage-group">
          <div class="series-heading blue-heading"><h3>黄金套利系列 <span>力求降低金价方向依赖，争取绝对收益</span></h3><p>季开</p></div>
          <div class="absolute-card">
            <div><div class="absolute-heading"><h4>黄金绝对收益</h4><strong>弱化金价方向影响，关注「两地价差」机会</strong></div><p>主要关注境内外「两地价差」＋ 期权工具对冲部分风险；收益主要来自价差变化与回归，力求降低对金价涨跌方向的依赖。</p></div>
          </div>
        </div>
        <div class="market-reference"><strong>不同市场环境的策略参考</strong><span>趋势上涨 → 锐进 / 稳健</span><span>高位震荡 → 领先 / 绝对收益</span><span>下跌调整 → 绝对收益</span><span>波动率抬升 → 绝对收益 / 领先</span></div>
      </div>
      <div class="rotation-layout">
        <div class="rotation-label"><h3>大类资产轮动</h3><span>后续布局方向</span></div>
        <article><h4>海外资产轮动</h4><p>黄金 ＋ 美债 ＋ 美股：跨市场避险与风险资产的切换配置</p></article>
        <article><h4>国内资产轮动</h4><p>黄金 ＋ 股指 ＋ 国债：境内股债金三资产的动态平衡</p></article>
      </div>
    </DashboardSection>
    <DashboardSection id="strategy-comparison" title="四大策略">
      <header class="strategy-heading"><p class="eyebrow">02 / 四大策略</p><h2>风险收益特征一览</h2><p class="intro">同一黄金研究底座，四种风险收益形态——灰盒绝对收益与指数增强、白盒工具型策略。</p></header>
      <div class="table-scroll" role="region" aria-label="四大策略风险收益特征对比，可横向滚动" tabindex="0">
        <table>
          <colgroup><col class="category-col"><col class="name-col"><col class="structure-col"><col class="risk-col"></colgroup>
          <thead><tr><th scope="col">类别</th><th scope="col">策略</th><th scope="col">策略结构</th><th scope="col">收益与风险特征</th></tr></thead>
          <tbody><tr v-for="(strategy, index) in strategies" :key="strategy.name">
            <th v-if="index === 0" rowspan="3" scope="rowgroup" class="category enhancement-category">指数增强系列<small>相对收益</small></th>
            <th v-if="index === 3" scope="rowgroup" class="category arbitrage-category">黄金套利系列<small>绝对收益</small></th>
            <th scope="row" class="strategy-name">{{ strategy.name }}<small :class="{ tool: strategy.type !== '灰盒' }">{{ strategy.type }}</small></th>
            <td>{{ strategy.structure }}</td><td>{{ strategy.risk }}</td>
          </tr></tbody>
        </table>
      </div>
      <p class="strategy-footnote">四类策略底层共通：黄金期货 / 黄金ETF ＋ 场外收益互换；白盒工具型策略规则透明，适合作为配置工具；灰盒策略均配套月度归因披露机制，每月拆解收益来源。以上为策略说明，不构成收益承诺；市场有风险，投资须谨慎。</p>
    </DashboardSection>
  </div>
</template>

<style scoped>
.strategy-lines{--strategy-gold:#ad945b;--strategy-blue:#38677e;color:#263c40}
.strategy-heading{margin-bottom:24px}.eyebrow{margin:0 0 10px;color:#927d43;font-size:16px;letter-spacing:.05em}.strategy-heading h2{margin:0;font-size:23px;line-height:1.5;font-weight:600}.intro{margin:12px 0 0;color:#728486;font-size:13px;line-height:1.9}
.family-layout{padding:24px;background:#fff;border:1px solid #d9cba9;border-radius:8px}.family-heading{display:flex;align-items:center;gap:24px;margin-bottom:22px}.family-heading h3{flex-shrink:0;margin:0;color:var(--strategy-blue);font-size:19px}.family-heading p{margin:0;color:#728486;font-size:12px;line-height:1.9}.family-heading strong{color:#425a5d;font-weight:600}
.enhancement-group{padding:16px;background:#fbf9f3;border:1px solid #e9dfc8;border-radius:6px}.series-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.series-heading h3{margin:0;font-size:16px;line-height:1.7;font-weight:600}.series-heading h3 span{margin-left:18px;padding-left:18px;border-left:1px solid currentColor;font-size:14px}.series-heading p{flex-shrink:0;margin:0;font-size:12px}.series-heading i{margin:0 10px;font-style:normal}.gold-heading{color:#8e7539;margin-bottom:16px}.strategy-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.strategy-card{padding:20px;background:#fff;border:1px solid #d9cba9;border-radius:6px}.card-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}h4{margin:0;font-size:18px;font-weight:600}.strategy-badge{padding:5px 12px;background:#f4edda;border-radius:20px;font-size:11px;color:#967a39;white-space:nowrap}.strategy-badge.grey{background:#657078;color:white}.card-headline{min-height:3.6em;margin:14px 0;color:#9b8040;font-size:13px;font-weight:600;line-height:1.8}.strategy-card ul{margin:0;padding-left:17px;font-size:12px;line-height:1.9}.strategy-card li+li{margin-top:5px}
.arbitrage-group{margin-top:16px;padding:16px;background:#f0f5f7;border:1px solid #d5e1e7;border-radius:6px}.blue-heading{color:var(--strategy-blue);margin-bottom:16px}.blue-heading p{color:#728486}.absolute-card{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;padding:20px;background:#fff;border:1px solid #b7cdd7;border-radius:6px}.absolute-heading{display:flex;align-items:center;flex-wrap:wrap;gap:12px 28px}.absolute-heading strong{font-size:13px;color:#9b8040}.absolute-card p{margin:10px 0 0;font-size:12px;line-height:1.9}
.market-reference{display:flex;flex-wrap:wrap;gap:10px 20px;padding:15px 18px;margin-top:16px;background:#f5efdf;border-radius:6px;color:#79683f;font-size:12px;line-height:1.8}.market-reference span{padding-left:20px;border-left:1px solid #d7c9a7}.rotation-layout{display:grid;grid-template-columns:.8fr 1.4fr 1.4fr;gap:16px;margin-top:16px}.rotation-label{display:flex;justify-content:center;flex-direction:column;gap:8px;padding:20px;background:#eef3f5;border:1px solid #d5e1e7;border-radius:6px}.rotation-label h3{margin:0;font-size:16px;color:var(--strategy-blue)}.rotation-label span{font-size:12px;color:#728486}.rotation-layout article{padding:20px;background:#fff;border:1px solid #e1e7e4;border-radius:6px}.rotation-layout h4{font-size:15px}.rotation-layout p{margin:10px 0 0;font-size:12px;line-height:1.9;color:#728486}
.table-scroll{overflow-x:auto;border:1px solid #dce4e1;border-radius:6px;background:#fff}.table-scroll:focus-visible{outline:2px solid var(--strategy-gold);outline-offset:3px}table{border-collapse:collapse;table-layout:fixed;width:100%;min-width:860px;font-size:12px;line-height:1.95}.category-col{width:14%}.name-col{width:16%}.structure-col{width:34%}.risk-col{width:36%}thead{background:#38677e;color:#fff}thead th{padding:16px;font-size:13px;font-weight:600;text-align:left}tbody td,tbody th{padding:24px 20px;border-bottom:1px solid #dce4e1;vertical-align:middle}tbody tr:last-child>*{border-bottom:0}tbody tr:nth-child(even){background:#f6f9f8}.category{text-align:center;font-size:14px;font-weight:600}.enhancement-category{background:#f7f1e3;color:#967a39}.arbitrage-category{background:#eef3f5;color:var(--strategy-blue)}small{display:block;margin-top:8px;font-size:12px;font-weight:400;color:#728486}.strategy-name{text-align:center;font-size:14px;font-weight:600}.strategy-name .tool{color:var(--strategy-blue)}.strategy-footnote{padding:18px 22px;margin:18px 0 0;border:1px solid #dce4e1;border-radius:6px;background:#f6f9f8;font-size:12px;line-height:1.9;color:#728486}
@media(max-width:1100px){.family-heading{align-items:flex-start;flex-direction:column;gap:10px}.strategy-cards{gap:12px}.strategy-card{padding:16px}.series-heading h3 span{display:block;border:0;padding:0;margin:4px 0 0}.rotation-layout{grid-template-columns:1fr 1fr}.rotation-label{grid-column:1/-1;flex-direction:row;align-items:center;justify-content:flex-start}.absolute-card{gap:16px}}
@media(max-width:760px){.strategy-cards{grid-template-columns:1fr}.card-headline{min-height:0}.absolute-card{grid-template-columns:1fr}.rotation-layout{grid-template-columns:1fr}.rotation-label{grid-column:auto}.market-reference{flex-direction:column}.market-reference span{padding:0;border:0}}
@media(max-width:600px){.strategy-heading h2{font-size:19px}.strategy-heading{margin-bottom:18px}.family-layout{padding:14px}.enhancement-group,.arbitrage-group{padding:12px}.series-heading{align-items:flex-start;gap:10px}.series-heading h3{font-size:15px}.series-heading h3 span{font-size:12px}.series-heading p{font-size:11px}.absolute-card{padding:16px}.rotation-layout{gap:12px}.strategy-footnote{padding:16px}.intro{font-size:12px}}
</style>
