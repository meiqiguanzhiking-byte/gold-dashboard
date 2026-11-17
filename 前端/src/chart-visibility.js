import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// 只在当前页面且接近视口时绘制；隐藏后保留实例、图例和缩放，仅记录待更新。
export function useChartVisibility(element, draw, resize) {
  const active = inject('dashboardContentVisible', computed(() => true))
  const inView = ref(false)
  let dirty = true, frame, intersection, observer
  const canDraw = () => active.value && inView.value && !!element.value?.clientWidth && !!element.value?.clientHeight
  function schedule() {
    if (frame || !active.value) return
    frame = requestAnimationFrame(async () => {
      frame = null
      await nextTick()
      if (!canDraw()) return
      if (dirty) { dirty = false; await draw() }
      else resize?.()
    })
  }
  function requestDraw() { dirty = true; schedule() }
  watch(active, schedule, { flush: 'post' })
  onMounted(() => {
    intersection = new IntersectionObserver(entries => {
      inView.value = entries[0].isIntersecting
      if (inView.value) schedule()
    }, { rootMargin: '250px 0px' })
    observer = new ResizeObserver(schedule)
    watch(element, (el, previous) => {
      if (previous) { intersection.unobserve(previous); observer.unobserve(previous) }
      inView.value = false
      if (el) { intersection.observe(el); observer.observe(el) }
    }, { immediate: true, flush: 'post' })
    window.addEventListener('dashboard-page-visible', schedule)
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    observer?.disconnect(); intersection?.disconnect()
    window.removeEventListener('dashboard-page-visible', schedule)
  })
  return { requestDraw, canDraw }
}
