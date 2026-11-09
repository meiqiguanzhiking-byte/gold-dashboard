"""Au(T+D) 收盘价及按交易观测值计算的年化历史波动率。"""
import math

import pandas as pd

from data_loader import parse_dates

SOURCE = "AuTD.csv"
METHOD = "日对数收益率；20/60个交易观测收益率；样本标准差（ddof=1）；252日年化。"
HISTORY_NOTE = "源值缺失或收益窗口不足时保持空值；最新期缺失不回退至早期值。"


def add_price_indicators(builder):
    table = builder.tables.get((SOURCE, None))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["时间", "收盘价（元/克）"])
    dates = parse_dates(frame["时间"]) if "时间" in frame else pd.Series(dtype="datetime64[ns]")
    prices = pd.to_numeric(frame["收盘价（元/克）"], errors="coerce") if "收盘价（元/克）" in frame else pd.Series(float("nan"), index=frame.index)
    prices = prices.where(prices.gt(0)).replace([float("inf"), -float("inf")], float("nan"))
    ordered = pd.DataFrame({"时间": dates, "收盘价（元/克）": prices}).dropna(subset=["时间"]).sort_values("时间")
    ordered = ordered.drop_duplicates("时间", keep=False).reset_index(drop=True)
    returns = pd.to_numeric(ordered["收盘价（元/克）"], errors="coerce").apply(lambda value: math.log(value) if pd.notna(value) and value > 0 else float("nan")).diff()
    volatility = {window: returns.rolling(window, min_periods=window).std(ddof=1) * (252 ** 0.5) * 100
                  for window in (20, 60)}
    for key, name, column, values, unit, window in [
        ("au_td_close", "Au(T+D) 收盘价", "收盘价（元/克）", ordered["收盘价（元/克）"], "元/克", None),
        ("gold_hv20", "20日年化历史波动率", "20日年化历史波动率", volatility[20], "%", 20),
        ("gold_hv60", "60日年化历史波动率", "60日年化历史波动率", volatility[60], "%", 60),
    ]:
        series = values.reset_index(drop=True)
        item = builder.add("price", key, name, unit, "日度", SOURCE, None,
                           column=column, frame=ordered, values=series,
                           warnings=[HISTORY_NOTE, "交易日波动率按Au(T+D)收盘价重算；区间筛选不改变计算窗口。"],
                           price_basis="Au(T+D)交易日收盘价（人民币元/克）",
                           source_unit=unit, change_unit="个百分点" if window else "元/克",
                           change_kind="percentage_points" if window else "absolute_and_percent",
                           method=METHOD if window else "AuTD.csv原始收盘价。",
                           window_observations=window, annualization_days=252 if window else None,
                           input_sources=[SOURCE])
        current = item["latest"]
        previous = item["history"][-2] if len(item["history"]) > 1 else None
        current["change_unit"] = item["metadata"]["change_unit"]
        current["change_pct"] = (current["change"] / previous["value"] * 100
                                  if not window and current["change"] is not None and previous and previous["value"] else None)
