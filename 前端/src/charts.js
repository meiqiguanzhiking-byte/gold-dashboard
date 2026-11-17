import * as echarts from 'echarts/core'
import { LineChart, BarChart, HeatmapChart, CustomChart, ScatterChart, BoxplotChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkPointComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { escapeHtml, format } from './data.js'
import { latestValueLabels } from './latest-value-labels.js'

echarts.use([LineChart, BarChart, HeatmapChart, CustomChart, ScatterChart, BoxplotChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkPointComponent, CanvasRenderer])
echarts.registerPreprocessor(latestValueLabels)
export { echarts }
export function tooltipRow(item, point, color) {
  const m = item.metadata
  const valueText = typeof point?.value === 'number' && Number.isInteger(m.display_fixed_digits)
    ? point.value.toLocaleString('zh-CN', { minimumFractionDigits: m.display_fixed_digits, maximumFractionDigits: m.display_fixed_digits })
    : format(point?.value, m.display_digits ?? 2)
  const marker = '<span aria-hidden="true" class="tooltip-marker" style="display:inline-block;width:12px;height:5px;border-radius:1px;margin-right:6px;vertical-align:middle;background-color:' + escapeHtml(color || '#849092') + '"></span>'
  return '<div class="tooltip-item"><strong>' + marker + escapeHtml(m.indicator_name) + '</strong><br>数值：' + escapeHtml(valueText) + ' ' + escapeHtml(m.unit) + '<br>日期：' + escapeHtml(point?.observation_date || '未提供') + '</div>'
}
export const axisLabel = { color: '#849092', fontSize: 10, hideOverlap: true }
export const tooltipStyle = { backgroundColor: 'rgba(255, 255, 255, 0.95)', borderColor: '#dce3e2', textStyle: { color: '#29393c', fontSize: 11 }, extraCssText: 'box-shadow:0 4px 20px #20303416;max-width:420px;white-space:normal', confine: true }
