"""北京时间15:30价格按相同观察日期换算，不再施加昨日截止。"""
import math

import pandas as pd

from price import SOURCE as DOMESTIC_SOURCE

SOURCE = "伦敦金现与汇率_北京时间1530收盘价.xlsx"
SHEET = "北京时间1530"
GRAMS_PER_TROY_OUNCE = 31.1034768
FORMULA = "Au99.99（元/克）−伦敦金现（美元/金衡盎司）×USDCNH（CNH/美元）÷31.1034768"
TIMING_NOTE = "按相同观察日期匹配Au99.99收盘价、北京时间15:30伦敦金现及汇率；不再限制截至昨日，不顺延日期。"
BASIS_NOTE = "海外折算使用离岸人民币CNH，含CNH/CNY口径差异；该价差不代表可交易套利空间。"


def finish_change(item):
    current = item["latest"]
    previous = item["history"][-2] if len(item["history"]) > 1 else None
    current["change_unit"] = item["metadata"]["unit"]
    current["change_pct"] = (current["change"] / previous["value"] * 100
                             if current["change"] is not None and previous and previous["value"] else None)


def add_international_price_indicators(builder):
    table = builder.tables.get((SOURCE, SHEET))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["日期"])
    for key, name, column, unit, reference in [
        ("london_gold_spot", "伦敦金现", "伦敦金现（美元/金衡盎司）", "美元/金衡盎司", "https://www.barchart.com/forex/quotes/%5EXAUUSD/historical-prices"),
        ("usdcnh", "美元兑离岸人民币", "美元兑离岸人民币（CNH/美元）", "CNH/美元", "https://www.barchart.com/forex/quotes/%5EUSDCNH/historical-prices"),
    ]:
        values = pd.to_numeric(frame[column], errors="coerce") if column in frame else pd.Series(float("nan"), index=frame.index)
        values = values.where(values.gt(0)).replace([float("inf"), -float("inf")], float("nan"))
        item = builder.add("price", key, name, unit, "日度", SOURCE, SHEET, column=column, frame=frame, values=values,
                           source_reference=reference, source_unit=unit, change_unit=unit,
                           change_kind="absolute_and_percent", input_sources=[SOURCE],
                           display_digits=4 if key == "usdcnh" else 2,
                           public_use_status="未确认", price_basis="Barchart精确结束于北京时间15:30的完整30分钟K线收盘价。",
                           observation_time="15:30", observation_timezone="Asia/Shanghai",
                           warnings=["来源为Barchart北京时间15:30半小时K线收盘价；伦敦金现不是LBMA AM/PM定盘价，汇率是离岸CNH而非在岸CNY或中间价。",
                                     "缺失不补零、不前值填充，最新期缺失不回退。"])
        finish_change(item)

    items = {i["metadata"]["indicator_id"]: i for i in builder.groups["price"]}
    inputs = [items[key] for key in ("gold_price_anchor", "london_gold_spot", "usdcnh")]
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
    spread_frame = pd.DataFrame({"日期": dates, "国内外价差": values})
    missing = [i["metadata"]["indicator_id"] for i in inputs if not i["metadata"]["valid_count"]]
    item = builder.add("price", "gold_domestic_spread", "国内外价差", "元/克", "日度", SOURCE, SHEET,
                       column="国内外价差", frame=spread_frame, values=values, missing_fields=missing,
                       warnings=[TIMING_NOTE, BASIS_NOTE, "三项同日有效才计算，缺任一项保留断点；周末或节假日不补值。"],
                       input_sources=[DOMESTIC_SOURCE, SOURCE], input_indicators=["gold_price_anchor", "london_gold_spot", "usdcnh"],
                       method=FORMULA, comparison_basis="同日期匹配：Au99.99收盘价与北京时间15:30海外价格及汇率",
                       observation_time="15:30", observation_timezone="Asia/Shanghai",
                       grams_per_troy_ounce=GRAMS_PER_TROY_OUNCE, change_unit="元/克", change_kind="absolute",
                       public_use_status="未确认")
    source_times = [i["metadata"]["updated_at"] for i in inputs if i["metadata"]["updated_at"]]
    item["metadata"]["updated_at"] = max(source_times, default=None)
    item["metadata"]["input_updated_at"] = {i["metadata"]["indicator_id"]: i["metadata"]["updated_at"] for i in inputs}
    latest_valid = item["latest_available"]
    item["metadata"]["latest_valid_date"] = latest_valid["observation_date"] if latest_valid else None
    item["latest"].update(item["metadata"])
