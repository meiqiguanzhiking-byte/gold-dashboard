const valid = value => typeof value === 'number' && Number.isFinite(value)
const number = (value, digits = 2) => value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const signed = (value, digits = 2) => (value > 0 ? '+' : '') + number(value, digits)
const text = value => ({ type: 'text', text: value })
const value = content => ({ type: 'value', text: content })
const metric = content => ({ type: 'indicator', text: content })
const range = points => points.length ? `${points[0].date}至${points.at(-1).date}` : '观察区间暂缺'

export function weeklyTrend(values) {
  if (values.length < 2) return '不足两个观察日，走势暂无法判断'
  if (values.some(v => !valid(v))) return '期间有数据缺失，走势暂无法判断'
  const directions = values.slice(1).map((v, i) => Math.sign(v - values[i])).filter(Boolean)
  if (!directions.length) return '持平'
  const turns = directions.slice(1).filter((v, i) => v !== directions[i]).length
  if (!turns) return directions[0] > 0 ? '持续上行' : '持续下行'
  if (turns === 1) return directions[0] > 0 ? '先升后降' : '先降后升'
  const net = values.at(-1) - values[0]
  return `震荡，较期初${net > 0 ? '上涨' : net < 0 ? '下跌' : '持平'}`
}

// 仅分割连续相同的指定合约；A→B→A仍是三段，不能跨换约拼接比较。
export function weeklyContractSegments(points) {
  const segments = []
  for (const point of points) {
    const previous = segments.at(-1)
    if (previous && previous.contract === point.contract) previous.points.push(point)
    else segments.push({ contract: point.contract, points: [point] })
  }
  return segments
}

function describe(points, key, name, unit, digits = 2) {
  const tokens = [metric(name), text('：')]
  const first = points[0], last = points.at(-1)
  if (!last) return [...tokens, text('数据暂缺。')]
  const rows = points.filter(p => valid(p[key]))
  tokens.push(text(`期末（${last.date}）`), valid(last[key]) ? value(number(last[key], digits) + unit) : text('数据暂缺'))
  if (points.length > 1 && valid(first[key]) && valid(last[key])) {
    const change = last[key] - first[key]
    tokens.push(text(`，较区间首日（${first.date}）变化`), value(signed(change, digits) + unit))
    if (key !== 'spread' && first[key] !== 0) tokens.push(text('（'), value(signed(change / Math.abs(first[key]) * 100) + '%'), text('）'))
  } else tokens.push(text(points.length < 2 ? '，仅有一天数据，暂无涨跌比较' : '，期初或期末数据缺失，暂无涨跌比较'))
  if (rows.length) {
    const minimum = Math.min(...rows.map(p => p[key])), maximum = Math.max(...rows.map(p => p[key]))
    const at = extreme => rows.filter(p => p[key] === extreme).map(p => p.date).join('、')
    tokens.push(text(rows.length < points.length ? '；已有数据中最低' : '；区间最低'), value(number(minimum, digits) + unit), text(`（${at(minimum)}），最高`), value(number(maximum, digits) + unit), text(`（${at(maximum)}）`))
  }
  tokens.push(text(`；${weeklyTrend(points.map(p => p[key]))}。`))
  return tokens
}

function spreadDescription(points) {
  const tokens = describe(points, 'spread', '价差', '元/克')
  const first = points[0]?.spread, last = points.at(-1)?.spread
  if (!valid(last)) return tokens
  tokens.push(text('期末'), value(last > 0 ? `国内升水${number(last)}元/克` : last < 0 ? `国内贴水${number(-last)}元/克` : '内外平价'))
  if (points.length > 1 && valid(first)) {
    if (first * last < 0) tokens.push(text(first > 0 ? '，由区间首日的升水转为贴水' : '，由区间首日的贴水转为升水'))
    else if (first === 0 && last !== 0) tokens.push(text(last > 0 ? '，由区间首日的平价转为升水' : '，由区间首日的平价转为贴水'))
    else if (last === 0 && first !== 0) tokens.push(text('，由区间首日的升贴水回到平价'))
    else if (first !== 0 && last !== 0) {
      const delta = Math.abs(last) - Math.abs(first)
      tokens.push(text(`，较区间首日${last > 0 ? '升水' : '贴水'}${delta === 0 ? '幅度不变' : delta > 0 ? '扩大' : '收窄'}`))
      if (delta !== 0) tokens.push(value(number(Math.abs(delta)) + '元/克'))
    }
  }
  return [...tokens, text('。')]
}

export function buildWeeklyReport(models, cutoff, unavailable = false) {
  const paragraphs = [[], []]
  const periods = models.map(model => `${model.title}：${range(model.points)}（${model.points.length}个交易观测日）`)
  for (const model of models) {
    if (paragraphs[0].length) paragraphs.forEach(p => p.push({ type: 'break', text: '\n' }))
    const scope = `${model.title}（${range(model.points)}）`
    if (unavailable || model.withheld || !model.points.length) {
      const reason = unavailable ? '数据读取失败，周报暂不可用。' : model.withheld ? '相关数据暂未获准公开。' : '该区间数据暂缺。'
      paragraphs.forEach(p => p.push(metric(scope), text('：' + reason)))
      continue
    }
    let segments = [{ contract: null, points: model.points }], note = ''
    if (model.id !== 'spot') {
      segments = weeklyContractSegments(model.points)
      const changes = segments.slice(1).map((segment, i) => `${segment.points[0].date}由${segments[i].contract || '未知合约'}换为${segment.contract || '未知合约'}`)
      if (changes.length || segments.some(s => !s.contract)) note = changes.length ? `${changes.join('；')}。换约前后分别比较涨跌和走势。` : '部分日期缺少合约信息，涨跌和走势仅比较合约明确的时段。'
    }
    paragraphs.forEach(p => p.push(metric(scope), text('：' + note)))
    for (const segment of segments) {
      const { points, contract } = segment
      if (model.id !== 'spot') paragraphs.forEach(p => p.push(metric(`${contract || '合约不明'}（${range(points)}）`), text('：')))
      if (model.id !== 'spot' && !contract) {
        paragraphs.forEach(p => p.push(text('合约信息缺失，涨跌和走势暂无法判断。')))
        continue
      }
      paragraphs[0].push(metric(model.localLabel), text('：' + weeklyTrend(points.map(p => p.domestic)) + '；'),
        metric(model.id === 'spot' ? '伦敦金' : 'COMEX黄金期货'), text('：' + weeklyTrend(points.map(p => p.overseas)) + '；'),
        metric(model.fxLabel), text('：' + weeklyTrend(points.map(p => p.fx)) + '。'))
      paragraphs[1].push(...spreadDescription(points))
    }
  }
  const titles = ['国内外黄金行情', '价差现状与走势']
  return { cutoff, periods, titles, paragraphs,
    plain: `文字周报（数值规则）\n截至观察日 ${cutoff}\n${periods.join('；')}\n` + paragraphs.map((p, i) => `${titles[i]}：${p.map(t => t.text).join('')}`).join('\n\n') }
}
