<script setup>
import { computed, inject, ref } from 'vue'
import { weeklyNews } from '@weekly-news'
import { sourceLabel } from '../source-labels.js'

const section = inject('dashboardWeeklySection')
const selectSection = inject('dashboardSelectWeekly')
const options = [{ id: 'news', name: '每周资讯' }, { id: 'charts', name: '周频数据可视化' }, { id: 'quant', name: '量化分析周报' }]
const category = ref('全部')
const categories = computed(() => ['全部', ...new Set(weeklyNews.events.map(event => event.category))])
// 日期精度不同的条目按原文发布日期分组；同日未知时分不推定精确先后。
const events = computed(() => weeklyNews.events
  .filter(event => category.value === '全部' || event.category === category.value)
  .toSorted((a, b) => (a.eventAt?.slice(0, 10) || a.publishedDate).localeCompare(b.eventAt?.slice(0, 10) || b.publishedDate)))
const currentTitle = computed(() => options.find(option => option.id === section.value)?.name)
</script>

<template>
  <div class="weekly-brief">
    <nav class="weekly-options" aria-label="每周速递栏目">
      <button v-for="option in options" :key="option.id" :aria-pressed="section === option.id" @click="selectSection(option.id)">{{ option.name }}</button>
    </nav>
    <section v-if="section === 'news'" aria-label="每周资讯">
      <header class="weekly-heading">
        <div><p class="weekly-eyebrow">WEEKLY REVIEW / 黄金投研</p><h2>每周资讯<span v-if="!weeklyNews.publicationWithheld">{{ weeklyNews.start }} — {{ weeklyNews.end }}</span></h2></div>
        <span class="weekly-tag">本周回顾</span>
      </header>
      <div v-if="weeklyNews.publicationWithheld" class="weekly-placeholder">资讯暂未公开，待确认来源公开范围后展示。</div>
      <template v-else>
        <p class="weekly-period">覆盖11月8日00:00至11月14日24:00（北京时间，周日—周六，按本期指定范围） · 回溯核验日期 {{ weeklyNews.verifiedOn }}</p>
        <p class="weekly-coverage">{{ weeklyNews.coverageNote }}</p>
        <div class="weekly-filters" aria-label="资讯分类">
          <button v-for="name in categories" :key="name" :aria-pressed="category === name" @click="category = name">{{ name }}</button>
          <span>{{ events.length }} 条事件</span>
        </div>
        <h3 class="timeline-title">关键事件时间轴</h3>
        <ol class="weekly-timeline">
          <li v-for="event in events" :key="event.id">
            <article>
              <div class="event-time"><time :datetime="event.eventAt || event.publishedDate">{{ event.time }}</time><span>{{ event.category }}</span></div>
              <h4>{{ event.title }}</h4>
              <p class="event-fact">{{ event.fact }}</p>
              <p class="event-watch"><strong>黄金相关关注点</strong>{{ event.watchpoint }}</p>
              <div class="event-source"><a :href="event.url" target="_blank" rel="noopener noreferrer" :title="event.sourceTitle">{{ sourceLabel(event.source) }} · 原文 ↗</a><span>观察期：{{ event.observationPeriod }}</span></div>
              <details class="event-details"><summary>时间与来源说明</summary><p>原文发布日期：{{ event.publishedDate }}；核验日期：{{ weeklyNews.verifiedOn }}。{{ event.timeNote || '事件时间按北京时间展示，原文发布日期保留发布机构当地日期。' }}</p><p v-if="event.verificationNote">核验说明：{{ event.verificationNote }}</p><a v-if="event.calendarUrl" :href="event.calendarUrl" target="_blank" rel="noopener noreferrer">美联储官方日历（核对讲话时间） ↗</a><p>原文：{{ event.sourceTitle }}</p></details>
            </article>
          </li>
        </ol>
        <p class="weekly-footnote">事实依据所列官方原文；黄金相关关注点为传导路径说明。官员讲话及研究观点均不代表新的FOMC决定。</p>
      </template>
    </section>
    <section v-else class="weekly-pending" :aria-label="currentTitle"><p class="weekly-eyebrow">WEEKLY REVIEW / 黄金投研</p><h2>{{ currentTitle }}</h2><div class="weekly-placeholder">待建设，后续接入。</div></section>
  </div>
</template>

<style scoped>
.weekly-brief{color:#344e54}.weekly-options{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 25px}.weekly-options button,.weekly-filters button{cursor:pointer;border:1px solid #dce4e1;background:transparent;color:#728486;border-radius:5px;padding:9px 15px;font-size:12px}.weekly-options button[aria-pressed=true]{border-color:#aa965e;background:#f5f3eb;color:#786b43;font-weight:600}.weekly-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.weekly-eyebrow{margin:0 0 10px;color:#927d43;font-size:11px;letter-spacing:1px}.weekly-heading h2,.weekly-pending h2{margin:0;font-size:23px;font-weight:600;color:#263c40}.weekly-heading h2 span{display:inline-block;margin-left:16px;color:#728486;font-size:14px;font-weight:400}.weekly-tag{flex-shrink:0;padding:6px 10px;background:#eaf2f1;color:#287985;border-radius:4px;font-size:11px}.weekly-period{font-size:12px;color:#728486;line-height:1.9;margin:14px 0 10px}.weekly-coverage{padding:12px 16px;background:#f5f3eb;border-left:3px solid #b29a61;color:#786b43;font-size:12px;line-height:1.8}.weekly-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:20px 0 24px}.weekly-filters button{padding:6px 12px}.weekly-filters button[aria-pressed=true]{border-color:#287985;color:#287985;background:#eaf2f1}.weekly-filters>span{margin-left:auto;color:#728486;font-size:12px}.timeline-title{border-left:3px solid #b29a61;padding-left:12px;font-size:17px;margin:0 0 24px}.weekly-timeline{list-style:none;padding:0;margin:0 0 0 9px;max-width:1100px}.weekly-timeline li{position:relative;border-left:1px solid #bcd3d6;padding:0 0 27px 27px}.weekly-timeline li:before{content:'';position:absolute;width:9px;height:9px;background:#287985;border-radius:50%;left:-5px;top:5px}.weekly-timeline li:last-child{padding-bottom:5px}.event-time{display:flex;align-items:center;flex-wrap:wrap;gap:12px;font-size:12px}.event-time time{color:#287985;font-weight:600}.event-time>span{font-size:10px;color:#728486;border:1px solid #dce4e1;padding:2px 6px;border-radius:3px}.weekly-timeline h4{margin:9px 0 8px;font-size:17px;color:#263c40;line-height:1.6}.event-fact,.event-watch{margin:0 0 9px;font-size:13px;line-height:1.95}.event-watch{color:#5c7377}.event-watch strong{color:#927d43;font-weight:500;margin-right:10px}.event-source{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:11px;line-height:1.8;color:#728486}.event-source a,.event-details a{color:#287985;text-decoration:none}.event-source a:hover,.event-details a:hover{text-decoration:underline}.event-details{margin-top:8px;font-size:11px;color:#728486;line-height:1.8}.event-details summary{cursor:pointer;display:list-item}.event-details p{margin:7px 0}.weekly-footnote{border-top:1px solid #dce4e1;margin-top:24px;padding:14px 0;color:#728486;font-size:11px;line-height:1.8}.weekly-placeholder{margin:22px 0;padding:45px 20px;border:1px dashed #dce4e1;border-radius:6px;color:#728486;text-align:center;font-size:13px;background:#f8faf9}@media(max-width:600px){.weekly-heading{align-items:flex-start}.weekly-heading h2{font-size:20px}.weekly-heading h2 span{display:block;margin:10px 0 0;font-size:12px}.weekly-timeline li{padding-left:19px}.weekly-timeline h4{font-size:15px}.weekly-options{gap:6px}.weekly-options button{padding:9px 10px;font-size:11px}.weekly-filters>span{margin-left:0}.weekly-coverage{padding:10px 12px}.event-fact,.event-watch{font-size:12px}}
</style>
