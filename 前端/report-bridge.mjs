// Python后端与静态导出共同调用纯规则模块；不启动浏览器，不请求网络。
import { readFileSync } from 'node:fs'
import { beijingDate, buildDailyBrief, dailyThresholdGroups, filterDailyMovements } from './src/daily-brief.js'
import { buildDailyReport } from './src/daily-report.js'

const input = JSON.parse(readFileSync(0, 'utf8'))
const thresholds = Object.fromEntries(dailyThresholdGroups.map(g => [g.id, g.initial]))
for (const group of dailyThresholdGroups) {
  const value = input.thresholds?.[group.id]
  if (value !== undefined) {
    if (!Number.isFinite(value) || value < 0 || value > group.max) throw new Error('Invalid threshold')
    thresholds[group.id] = Number((Math.round(value / group.step) * group.step).toFixed(2))
  }
}
const items = Object.values(input.groups).flat()
const date = input.reportDate || beijingDate()
const brief = buildDailyBrief(items, date)
const movements = filterDailyMovements(brief.movements, thresholds)
const report = buildDailyReport(items, date, brief, movements, thresholds)
// 缺失描述统一；保留原版规则、链接、加粗标记。
report.paragraphs = report.paragraphs.map(p => p.replaceAll('数据缺失', '数据暂缺'))
report.richParagraphs = report.richParagraphs.map(p => p.map(t => ({ ...t, text: t.text.replaceAll('数据缺失', '数据暂缺') })))
report.title = '黄金市场日报'
const referenced = new Set(report.richParagraphs.flat().filter(t => t.type === 'indicator').map(t => t.id))
report.targets = Object.fromEntries(Object.entries(report.targets).filter(([id]) => referenced.has(id)))
const catalog = Object.fromEntries(dailyThresholdGroups.flatMap(g => g.indicators.map(i => [i.id, { ...i, group: g.id }])))
process.stdout.write(JSON.stringify({ rule: report, thresholds, catalog }))
