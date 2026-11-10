import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isStatic, request } from '@live-source'

export function sameThresholds(a, b) {
  return !!a && !!b && ['spread', 'price', 'volatility', 'rates', 'shares', 'volume', 'position'].every(key => a[key] === b[key])
}

export function validAi(bundle) {
  if (bundle?.status !== 'ai' || bundle.validation !== 'passed' || !bundle.ai?.title || bundle.ai.paragraphs?.length !== 3 || bundle.ai.richParagraphs?.length !== 3) return false
  return bundle.ai.richParagraphs.every((tokens, index) => Array.isArray(tokens) && tokens.map(t => t.text).join('') === bundle.ai.paragraphs[index])
}

// 只读取后端已锁定的日报；滑块不发请求、不生成新的AI。
export function useDailyAi(props) {
  const result = ref(null), pending = ref(false), preference = ref(null)
  const reason = ref(''), copyStatus = ref('')
  let copyTimer
  watch([() => props.loading, () => props.unavailable, () => props.meta,
    () => props.report.reportDate], (_, __, onCleanup) => {
    // 刷新未完成或接口暂时失败时，保留当日已读取的成功稿。
    if (result.value?.report_date !== props.report.reportDate) result.value = null
    reason.value = ''
    copyStatus.value = ''
    if (props.loading || props.unavailable) { pending.value = false; return }
    if (isStatic) {
      const saved = props.meta?.daily_report
      if (saved) result.value = saved
      else reason.value = '暂无已发布的AI日报，显示数值规则'
      pending.value = false
      return
    }
    const controller = new AbortController()
    if (result.value && result.value.source_version !== props.meta?.loaded_at) result.value = { ...result.value, ai_matches_current: false }
    let current = true
    pending.value = true
    const timer = setTimeout(async () => {
      try {
        const response = await request('daily-report', { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_version: props.meta?.loaded_at }) })
        if (current && response.source_version === props.meta?.loaded_at && response.report_date === props.report.reportDate) result.value = response
      } catch { if (current) reason.value = 'AI服务暂不可用，已显示数值规则' }
      finally { if (current) pending.value = false }
    }, 500)
    onCleanup(() => { current = false; clearTimeout(timer); controller.abort() })
  }, { immediate: true })
  const aiAvailable = computed(() => validAi(result.value))
  const isAi = computed(() => preference.value !== 'rule' && aiAvailable.value)
  const currentReport = computed(() => isAi.value ? result.value.ai : props.report)
  const status = computed(() => isAi.value ? 'AI优化（规则校验通过）' : '数值规则')
  const generatedAt = computed(() => isAi.value ? result.value?.generated_at : props.meta?.generated_at || props.meta?.loaded_at)
  const notice = computed(() => {
    if (pending.value) return '正在读取已保存日报，当前显示数值规则'
    if (aiAvailable.value) return isAi.value && result.value.ai_matches_current === false ? 'AI日报为今日已保存稿；刷新后的最新数据请查看数值规则和指标卡。' : ''
    return reason.value || ({ not_configured: 'AI服务尚未配置，已显示数值规则', validation_failed: 'AI文案未通过规则校验，当日尝试已结束，显示数值规则', model_unavailable: 'AI服务暂不可用，当日尝试已结束，显示数值规则', no_saved_report: '暂无已保存的AI日报，显示数值规则', daily_limit: '当日日报已锁定，不再调用模型，显示数值规则', attempt_locked: '日报正在生成或尝试已锁定，当前显示数值规则', cache_unavailable: '日报保存暂不可用，已暂停模型调用，显示数值规则' })[result.value?.fallback_reason] || ''
  })
  async function copy() {
    const report = currentReport.value
    const text = [report.title || '黄金市场日报', `报告日期 ${report.reportDate} · 北京时间`,
      `主要价格观察日期 ${report.observationDates}`, generatedAt.value ? `生成时间 ${generatedAt.value}` : '',
      ...report.paragraphs.map((p, index) => `${report.titles[index]}：${p}`)].filter(Boolean).join('\n\n')
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const input = document.createElement('textarea')
        const previous = document.activeElement
        input.value = text; input.style.cssText = 'position:fixed;left:-10000px;top:0'
        document.body.append(input)
        try { input.select(); if (!document.execCommand('copy')) throw new Error('copy') }
        finally { input.remove(); previous?.focus({ preventScroll: true }) }
      }
      copyStatus.value = '已复制'
    } catch { copyStatus.value = '复制失败，请手动选择正文复制' }
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copyStatus.value = '' }, 2500)
  }
  onBeforeUnmount(() => clearTimeout(copyTimer))
  return { currentReport, pending, preference, isAi, status, notice, copy, copyStatus,
    generatedAt }
}
