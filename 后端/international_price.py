"""已核对日频收盘价表；同标签日期换算，排除北京时间今日和未来记录。"""
import math
from datetime import datetime, timedelta

import pandas as pd

from config import LOCAL_TIMEZONE
from price import SOURCE as DOMESTIC_SOURCE

SOURCE = "伦敦金现与汇率.xlsx"
SHEET = "日频收盘价"
GRAMS_PER_TROY_OUNCE = 31.1034768
FORMULA = "Au99.99（元/克）−伦敦金现（美元/金衡盎司）×USDCNH（CNH/美元）÷31.1034768"
TIMING_NOTE = "按来源同名日期比较非同步收盘，排除北京时间今日及未来记录；不顺延日期，不前值填充。"
BASIS_NOTE = "海外折算使用离岸人民币CNH，含CNH/CNY口径差异；各市场收盘不同步，不代表同步溢价或可交易套利空间。"


def finish_change(item):
    current = item["latest"]
    previous = item["history"][-2] if len(item["history"]) > 1 else None
    current["change_unit"] = item["metadata"]["unit"]
    current["change_pct"] = (current["change"] / previous["value"] * 100
                             if current["change"] is not None and previous and previous["value"] else None)


def add_international_price_indicators(builder, today=None):
    today = today or datetime.now(LOCAL_TIMEZONE).date()
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
                           public_use_status="未确认", price_basis="Barchart日线close，保持来源日期；今日记录可能尚未收盘。",
                           warnings=["来源为Barchart日线close；伦敦金现不是LBMA AM/PM定盘价，汇率是离岸CNH而非在岸CNY或中间价。",
                                     "今日标签记录可能仍在形成，最新源值不等于已完成收盘；价差单独排除今日及未来记录。",
                                     "缺失不补零、不前值填充，最新期缺失不回退。"])
        finish_change(item)

    items = {i["metadata"]["indicator_id"]: i for i in builder.groups["price"]}
    inputs = [items[key] for key in ("gold_price_anchor", "london_gold_spot", "usdcnh")]
    maps = [{p["observation_date"]: p["value"] for p in item["history"]} for item in inputs]
    cutoff = (today - timedelta(days=1)).isoformat()
    # 按日期并集保留共同覆盖期内的断点；不因任一输入缺失而跳过最新观察期。
    valid_starts = [next((p["observation_date"] for p in item["history"] if p["value"] is not None), None) for item in inputs]
    start = max(valid_starts) if all(valid_starts) else None
    dates = sorted({date for mapping in maps for date in mapping if start and start <= date <= cutoff})
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
                       method=FORMULA, cutoff_date=cutoff, cutoff_timezone="Asia/Shanghai", comparison_basis="同名日期的非同步收盘价差",
                       grams_per_troy_ounce=GRAMS_PER_TROY_OUNCE, change_unit="元/克", change_kind="absolute",
                       public_use_status="未确认")
    source_times = [i["metadata"]["updated_at"] for i in inputs if i["metadata"]["updated_at"]]
    item["metadata"]["updated_at"] = max(source_times, default=None)
    item["metadata"]["input_updated_at"] = {i["metadata"]["indicator_id"]: i["metadata"]["updated_at"] for i in inputs}
    latest_valid = item["latest_available"]
    item["metadata"]["latest_valid_date"] = latest_valid["observation_date"] if latest_valid else None
    item["latest"].update(item["metadata"])
