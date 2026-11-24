"""北京时间15:30价格按相同观察日期换算，不再施加昨日截止。"""
import math

import pandas as pd

from price import SOURCE as DOMESTIC_SOURCE

SOURCE = "伦敦金现与汇率_北京时间1530收盘价.xlsx"
SHEET = "北京时间1530"
VOLATILITY_SOURCE = "黄金ETF波动率指数.csv"
VIX_SOURCE = "VIX.csv"
USD_INDEX_SOURCE = "美元指数.csv"
TREASURY_SOURCE = "美债收益率.xlsx"
GRAMS_PER_TROY_OUNCE = 31.1034768
FORMULA = "Au(T+D)（元/克）−伦敦金现（美元/金衡盎司）×USDCNY（CNY/美元）÷31.1034768"
USDCNY_TIMING_NOTE = "在岸CNY取北京时间同日15:30前最近有效已结束K线；无可用K线时采用网站相同CT日期标签日线close。较早K线存在时差，日线备用可能含15:30之后信息，不能全部视为同步报价。"
USDCNY_QUALITY_NOTE = "在岸CNY已隔离结构异常与多证据极端孤立错价，普通统计候选保留价格待复核；原值、实际取价时间和原因见源CSV质量明细。部分修订使用后续恢复证据，不代表当时已知。"
TIMING_NOTE = "按相同观察日期匹配Au(T+D)收盘价与北京时间15:30伦敦金现、在岸CNY目标价格；不顺延日期。" + USDCNY_TIMING_NOTE
BASIS_NOTE = "海外折算使用在岸人民币CNY汇率；国内外收盘时点可能不同，该价差不代表可交易套利空间。"


def finish_change(item):
    current = item["latest"]
    previous = item["history"][-2] if len(item["history"]) > 1 else None
    current["change_unit"] = item["metadata"].get("change_unit", item["metadata"]["unit"])
    current["change_pct"] = (current["change"] / previous["value"] * 100
                             if current["change"] is not None and previous and previous["value"] else None)


def add_international_price_indicators(builder):
    table = builder.tables.get((SOURCE, SHEET))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["日期"])
    for key, name, column, unit, reference in [
        ("london_gold_spot", "伦敦金现", "伦敦金现（美元/金衡盎司）", "美元/金衡盎司", "https://www.barchart.com/forex/quotes/%5EXAUUSD/historical-prices"),
        ("usdcnh", "美元兑离岸人民币", "美元兑离岸人民币（CNH/美元）", "CNH/美元", "https://www.barchart.com/forex/quotes/%5EUSDCNH/historical-prices"),
        ("usdcny", "美元兑在岸人民币", "美元兑在岸人民币（CNY/美元）", "CNY/美元", "https://www.barchart.com/forex/quotes/%5EUSDCNY/historical-prices"),
    ]:
        values = pd.to_numeric(frame[column], errors="coerce") if column in frame else pd.Series(float("nan"), index=frame.index)
        values = values.where(values.gt(0)).replace([float("inf"), -float("inf")], float("nan"))
        item = builder.add("price", key, name, unit, "日度", SOURCE, SHEET, column=column, frame=frame, values=values,
                           source_reference=reference, source_unit=unit, change_unit=unit,
                           change_kind="absolute_and_percent", input_sources=[SOURCE],
                           display_digits=4 if key in ("usdcnh", "usdcny") else 2,
                           public_use_status="未确认", price_basis=(USDCNY_TIMING_NOTE if key == "usdcny" else "Barchart精确结束于北京时间15:30的完整30分钟K线收盘价。"),
                           observation_time=("15:30（目标，实际时间可能不同）" if key == "usdcny" else "15:30"), observation_timezone="Asia/Shanghai",
                           warnings=([USDCNY_TIMING_NOTE, USDCNY_QUALITY_NOTE] if key == "usdcny" else []) + ["来源为Barchart市场报价；伦敦金现不是LBMA AM/PM定盘价；汇率分别为离岸CNH、在岸CNY市场报价，不是人民币中间价。",
                                     "缺失不补零、不前值填充，最新期缺失不回退。"])
        finish_change(item)

    volatility = builder.tables.get((VOLATILITY_SOURCE, None))
    volatility_frame = volatility.frame.copy() if volatility else pd.DataFrame(columns=["时间", "波动率"])
    volatility_values = pd.to_numeric(volatility_frame["波动率"], errors="coerce") if "波动率" in volatility_frame else pd.Series(float("nan"), index=volatility_frame.index)
    volatility_values = volatility_values.replace([float("inf"), -float("inf")], float("nan"))
    item = builder.add("price", "gold_etf_volatility_index", "黄金ETF波动率指数（GVZ）", "%", "日度",
                       VOLATILITY_SOURCE, frame=volatility_frame, column="波动率", values=volatility_values,
                       source_reference="https://www.cboe.com/us/indices/dashboard/gvz/", index_symbol="GVZ",
                       display_digits=2, change_unit="百分点", change_kind="absolute_and_percent",
                       warnings=["来源：Cboe 芝加哥期权交易所；按CSV原始日度数值展示，不插值、不前值填充。"])
    finish_change(item)

    vix = builder.tables.get((VIX_SOURCE, None))
    vix_frame = vix.frame.rename(columns={"DATE": "日期"}).copy() if vix else pd.DataFrame(columns=["日期", "CLOSE"])
    vix_frame["日期"] = pd.to_datetime(vix_frame["日期"], format="%m/%d/%Y", errors="coerce")
    vix_values = pd.to_numeric(vix_frame["CLOSE"], errors="coerce") if "CLOSE" in vix_frame else pd.Series(float("nan"), index=vix_frame.index)
    vix_values = vix_values.replace([float("inf"), -float("inf")], float("nan"))
    item = builder.add("price", "vix", "标普500波动率指数（VIX）", "%", "日度", VIX_SOURCE,
                       frame=vix_frame, column="CLOSE", values=vix_values,
                       source_reference="https://www.cboe.com/tradable_products/vix/", index_symbol="VIX",
                       display_digits=2, change_unit="百分点", change_kind="absolute_and_percent",
                       warnings=["来源：Cboe 芝加哥期权交易所；采用VIX.csv的CLOSE日收盘值，保留美国观察日期。",
                                 "DATE按月/日/年解析；不插值、不前值填充。"])
    finish_change(item)

    usd_index = builder.tables.get((USD_INDEX_SOURCE, None))
    usd_frame = usd_index.frame.rename(columns={"Date": "日期"}).copy() if usd_index else pd.DataFrame(columns=["日期", "Close"])
    usd_values = pd.to_numeric(usd_frame["Close"], errors="coerce") if "Close" in usd_frame else pd.Series(float("nan"), index=usd_frame.index)
    usd_values = usd_values.where(usd_values.gt(0)).replace([float("inf"), -float("inf")], float("nan"))
    item = builder.add("price", "usd_index", "美元指数", "点", "日度", USD_INDEX_SOURCE,
                       frame=usd_frame, column="Close", values=usd_values,
                       source_reference="https://quote.eastmoney.com/gb/zsUDI.html", index_symbol="UDI",
                       display_digits=2, change_unit="点", change_kind="absolute_and_percent",
                       warnings=["来源：东方财富UDI美元指数日线收盘值，单位指数点；非美元指数期货或ICE官方结算价。",
                                 "保留来源观察日期，按日期升序展示；缺失不补零、不插值、不前值填充。"])
    finish_change(item)

    items = {i["metadata"]["indicator_id"]: i for i in builder.groups["price"]}
    inputs = [items[key] for key in ("au_td_close", "london_gold_spot", "usdcny")]
    maps = [{p["observation_date"]: p["value"] for p in item["history"]} for item in inputs]
    # 按日期并集保留共同覆盖期内的断点；不因任一输入缺失而跳过最新观察期。
    valid_starts = [next((p["observation_date"] for p in item["history"] if p["value"] is not None), None) for item in inputs]
    start = max(valid_starts) if all(valid_starts) else None
    dates = sorted({date for mapping in maps for date in mapping if start and start <= date})
    values = []
    for date in dates:
        domestic, gold, fx = [mapping.get(date) for mapping in maps]
        valid = all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0 for v in (domestic, gold, fx))
        values.append(domestic - gold * fx / GRAMS_PER_TROY_OUNCE if valid else None)
    spread_frame = pd.DataFrame({"日期": dates, "黄金现价价差": values})
    missing = [i["metadata"]["indicator_id"] for i in inputs if not i["metadata"]["valid_count"]]
    item = builder.add("price", "gold_domestic_spread", "黄金现价价差", "元/克", "日度", SOURCE, SHEET,
                       column="黄金现价价差", frame=spread_frame, values=values, missing_fields=missing,
                       warnings=[TIMING_NOTE, USDCNY_QUALITY_NOTE, BASIS_NOTE, "三项同日有效才计算，缺任一项保留断点；周末或节假日不补值。"],
                       input_sources=[DOMESTIC_SOURCE, SOURCE], input_indicators=["au_td_close", "london_gold_spot", "usdcny"],
                       method=FORMULA, comparison_basis="同日期匹配：Au(T+D)收盘价、北京时间15:30伦敦金现与在岸CNY目标价格（允许同日较早或日线备用）",
                       observation_time="15:30", observation_timezone="Asia/Shanghai",
                       grams_per_troy_ounce=GRAMS_PER_TROY_OUNCE, change_unit="元/克", change_kind="absolute",
                       public_use_status="未确认")
    source_times = [i["metadata"]["updated_at"] for i in inputs if i["metadata"]["updated_at"]]
    item["metadata"]["updated_at"] = max(source_times, default=None)
    item["metadata"]["input_updated_at"] = {i["metadata"]["indicator_id"]: i["metadata"]["updated_at"] for i in inputs}
    latest_valid = item["latest_available"]
    item["metadata"]["latest_valid_date"] = latest_valid["observation_date"] if latest_valid else None
    item["latest"].update(item["metadata"])
    add_implied_exchange_rates(builder)


def add_implied_exchange_rates(builder):
    """同日金价计算隐含汇率，两种市场汇率各自独立计算溢价。"""
    items = {i["metadata"]["indicator_id"]: i for i in builder.groups["price"]}
    keys = ["au_td_close", "london_gold_spot", "usdcnh", "usdcny"]
    maps = {key: {p["observation_date"]: p["value"] for p in items[key]["history"]} for key in keys}
    starts = [next((p["observation_date"] for p in items[key]["history"] if p["value"] is not None), None)
              for key in keys[:2]]
    start = max(starts) if all(starts) else None
    dates = sorted({date for key in keys[:2] for date in maps[key] if start and date >= start})
    valid_price = lambda v: isinstance(v, (int, float)) and math.isfinite(v) and v > 0
    implied = [maps["au_td_close"][date] / maps["london_gold_spot"][date] * GRAMS_PER_TROY_OUNCE
               if all(valid_price(maps[key].get(date)) for key in keys[:2]) else None for date in dates]
    frame = pd.DataFrame({"日期": dates})
    for key, name, fx in [
        ("gold_implied_fx", "黄金隐含汇率", None),
        ("gold_premium_cnh", "沪金溢价（相对离岸人民币）", "usdcnh"),
        ("gold_premium_cny", "沪金溢价（相对在岸人民币）", "usdcny"),
    ]:
        inputs = keys[:2] + ([fx] if fx else [])
        values = [value - maps[fx][date] if value is not None and valid_price(maps[fx].get(date)) else None
                  for date, value in zip(dates, implied)] if fx else implied
        item = builder.add("price", key, name, "人民币/美元", "日度", SOURCE, SHEET,
                           column=key, frame=frame.assign(**{key: values}), values=values,
                           display_digits=4, input_sources=[DOMESTIC_SOURCE, SOURCE], input_indicators=inputs,
                           missing_fields=[k for k in inputs if not items[k]["metadata"]["valid_count"]],
                           method="Au(T+D)收盘价÷伦敦金现×31.1034768" + (f"−{fx.upper()}" if fx else ""),
                           change_kind="absolute", change_unit="人民币/美元",
                           observation_time="15:30", observation_timezone="Asia/Shanghai",
                           grams_per_troy_ounce=GRAMS_PER_TROY_OUNCE,
                           comparison_basis="同日期Au(T+D)收盘价及北京时间15:30伦敦金现、市场汇率",
                           warnings=([USDCNY_TIMING_NOTE, USDCNY_QUALITY_NOTE] if fx == "usdcny" else []) + ["同日期匹配，缺项保留空值，不插值或前值填充。",
                                     "沪金溢价为汇率差值，不是百分比，也不是元/克价差。"])
        item["metadata"]["updated_at"] = max((items[k]["metadata"]["updated_at"] for k in inputs
                                                 if items[k]["metadata"]["updated_at"]), default=None)
        item["metadata"]["latest_valid_date"] = (item["latest_available"] or {}).get("observation_date")
        item["latest"].update(item["metadata"])


def add_treasury_yield_indicators(builder):
    table = builder.tables.get((TREASURY_SOURCE, "日频美债收益率"))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["时间"])
    for indicator_id, name, column, unit, series_id in [
        ("ust_10y_yield", "10年美债收益率", "10年美债收益率", "%", "DGS10"),
        ("ust_2y_yield", "2年美债收益率", "2年美债收益率", "%", "DGS2"),
        ("ust_10y_2y_spread", "10年－2年期限利差", "10年－2年期限利差", "百分点", "T10Y2Y"),
        ("ust_10y_real_yield", "10年实际利率", "10年实际利率", "%", "DFII10"),
        ("ust_10y_breakeven_inflation", "10年盈亏平衡通胀率（BEI）", "10年盈亏平衡通胀率（BEI）", "%", "T10YIE"),
    ]:
        values = pd.to_numeric(frame[column], errors="coerce") if column in frame else pd.Series(float("nan"), index=frame.index)
        values = values.replace([float("inf"), -float("inf")], float("nan"))
        item = builder.add("price", indicator_id, name, unit, "日度", TREASURY_SOURCE, "日频美债收益率",
                           column=column, frame=frame, values=values,
                           source_reference=f"https://fred.stlouisfed.org/series/{series_id}",
                           series_id=series_id, display_digits=2,
                           change_unit="百分点", change_kind="absolute_and_percent",
                           warnings=["来源：FRED；沿用美债收益率工作簿原始日度序列，空值不补零、不前值填充。"])
        finish_change(item)
