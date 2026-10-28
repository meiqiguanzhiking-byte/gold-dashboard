// 标准国家/地区名称使用运行时CLDR中文名称；IMF/WGC原表别名精确匹配。
// 仅用于显示，不改变原始键、纳入名单、历史口径或汇总逻辑。
const aliases = {
  'Afghanistan, Islamic Rep. of': 'AF', 'Armenia, Rep. of': 'AM',
  'Azerbaijan, Rep. of': 'AZ', 'Bahamas, The': 'BS', 'Bahrain, Kingdom of': 'BH',
  'Belarus, Rep. of': 'BY', 'Congo, Democratic Republic of': 'CD', 'Congo, Republic of': 'CG',
  'Czech Rep.': 'CZ', 'Egypt, Arab Rep. of': 'EG', 'Estonia, Rep. of': 'EE',
  'Ethiopia, The Federal Dem. Rep. of': 'ET', 'Kazakhstan, Rep. of': 'KZ',
  'Korea, Rep. of': 'KR', 'Kosovo, Republic of': 'XK', 'Kyrgyz Rep.': 'KG',
  "Lao People's Democratic Republic": 'LA', 'North Macedonia, Republic of': 'MK',
  'Micronesia, Federated States of': 'FM', 'Poland, Rep. of': 'PL', 'Russian Federation': 'RU',
  'Serbia, Rep. of': 'RS', 'Slovak Rep.': 'SK', 'Slovenia, Rep. of': 'SI',
  'Syrian Arab Republic': 'SY', 'Tajikistan, Rep. of': 'TJ', 'Timor-Leste, Dem. Rep. of': 'TL',
  'Turkey': 'TR', 'Uzbekistan, Rep. of': 'UZ', 'Venezuela, Republica Bolivariana de': 'VE',
  'Yemen, Republic of': 'YE', 'Myanmar': 'MM', 'Bosnia and Herzegovina': 'BA',
  'Brunei Darussalam': 'BN', 'Cabo Verde': 'CV', 'Dominican Rep.': 'DO', 'Trinidad and Tobago': 'TT',
}
const specialNames = {
  'China, P.R.: Mainland': '中国内地', 'Hong Kong SAR': '中国香港',
  'China, P.R.: Macao': '中国澳门', 'Taiwan Province of China': '中国台湾',
  'Curacao & St. Maarten': '库拉索与荷属圣马丁（合并口径）',
  'Netherlands Antilles': '荷属安的列斯（历史口径）',
  'Euro Area': '欧元区', 'Turkey*': '土耳其（含商业部门口径）',
  'State Oil Fund of the Republic of Azerbaijan (SOFAZ)': '阿塞拜疆共和国国家石油基金（SOFAZ）',
}
const normalize = name => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[’']/g, '').toLowerCase()
let englishCodes, chineseNames
function loadNames() {
  if (englishCodes) return
  const englishNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
  chineseNames = new Intl.DisplayNames(['zh-Hans-CN'], { type: 'region', fallback: 'none' })
  englishCodes = new Map()
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b), name = englishNames.of(code)
    if (name) englishCodes.set(normalize(name), code)
  }
}
export function centralBankEntityName(name, chinese = false) {
  if (!chinese || !name) return name
  if (specialNames[name]) return specialNames[name]
  loadNames()
  const code = aliases[name] || englishCodes.get(normalize(name))
  return code ? chineseNames.of(code) || name : name
}
