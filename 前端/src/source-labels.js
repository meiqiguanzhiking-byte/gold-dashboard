// 真实来源依据用户提供的《数据更新来源_初.txt》；文件名仅用于内部匹配。
const sourceLabels = {
  '黄金现货价格.xlsx': '上海黄金交易所',
  '央行购金.xlsx': '国家外汇管理局',
  'AuTD.csv': '上海黄金交易所',
  '黄金期货.csv': '上海期货交易所',
  '黄金ETF份额.xlsx': '上海证券交易所和深圳证券交易所',
  'CFTC黄金非商业持仓量.csv': 'CFTC 美国商品期货交易委员会',
  'CFTC黄金交易量和持仓量.csv': 'CME Group 芝商所',
  'SPDR黄金ETF份额.xlsx': 'WGC 世界黄金协会',
  '伦敦金银库存.xlsx': 'LBMA 伦敦金银市场协会',
  'COMEX金银库存.xlsx': 'CME Group 芝商所',
  '全球黄金ETF流量.xlsx': 'WGC 世界黄金协会',
  '全球央行购金.csv': 'WGC 世界黄金协会',
  '伦敦金现与汇率_北京时间1530收盘价.xlsx': 'Barchart 官网',
  '黄金交割.xlsx': 'CME Group 芝商所',
}

export function sourceLabel(metadataOrSource) {
  if (metadataOrSource?.indicator_id === 'gold_domestic_spread') return '上海黄金交易所；Barchart 官网（同日价格及汇率折算）'
  const source = typeof metadataOrSource === 'string' ? metadataOrSource : metadataOrSource?.source
  return sourceLabels[source] || '真实来源待确认'
}
