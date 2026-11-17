"""同日金银收盘价比值及原表珠宝零售月度金额、同比。"""
import pandas as pd

from data_loader import parse_dates

RETAIL_SOURCE = "金银珠宝零售.xlsx"
RETAIL_SHEET = "Sheet1"
RETAIL_PREFIX = "金银珠宝类商品零售类值:"
RETAIL_SPECS = [
    ("jewelry_retail_monthly", "当月值(2月累计填充)", "亿元"),
    ("jewelry_retail_monthly_yoy", "当月同比(2月累计填充)", "%"),
    ("jewelry_retail_cumulative", "累计值", "亿元"),
    ("jewelry_retail_cumulative_yoy", "累计同比", "%"),
]


def add_gold_silver_retail(builder):
    gold = next(i for i in builder.groups["price"] if i["metadata"]["indicator_id"] == "au_td_close")
    table = builder.tables.get(("AgTD.csv", None))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["时间", "收盘价（元/千克）"])
    dates = parse_dates(frame["时间"]) if "时间" in frame else pd.Series(dtype="datetime64[ns]")
    prices = pd.to_numeric(frame["收盘价（元/千克）"], errors="coerce") if "收盘价（元/千克）" in frame else pd.Series(float("nan"), index=frame.index)
    silver = pd.DataFrame({"时间": dates, "close": prices}).dropna(subset=["时间"])
    silver = silver.drop_duplicates("时间", keep=False).sort_values("时间")
    silver["时间"] = silver["时间"].dt.strftime("%Y-%m-%d")
    silver_prices = dict(zip(silver["时间"], silver["close"]))
    gold_prices = {p["observation_date"]: p["value"] for p in gold["history"]}
    start = max(min(gold_prices), min(silver_prices)) if gold_prices and silver_prices else None
    dates = sorted(d for d in gold_prices.keys() | silver_prices.keys() if start and d >= start)
    valid = lambda value: value is not None and pd.notna(value) and float("inf") > value > 0
    ratios = [gold_prices[d] * 1000 / silver_prices[d]
              if valid(gold_prices.get(d)) and valid(silver_prices.get(d)) else None for d in dates]
    item = builder.add("price", "gold_silver_ratio", "金银比", "倍", "日度", "AgTD.csv",
                       column="金银比", frame=pd.DataFrame({"日期": dates, "金银比": ratios}),
                       input_sources=["AuTD.csv", "AgTD.csv"], input_indicators=["au_td_close"],
                       display_digits=2, method="Au(T+D)收盘价（元/克）×1000÷Ag(T+D)收盘价（元/千克）",
                       warnings=["同日原始收盘价换算为相同质量单位后相除；缺项、零价或无效价格不计算，不跨日期补值。"])
    item["metadata"]["updated_at"] = max(filter(None, [gold["metadata"]["updated_at"], table.updated_at if table else None]), default=None)
    item["latest"].update(item["metadata"])

    table = builder.tables.get((RETAIL_SOURCE, RETAIL_SHEET))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["日期"])
    if "指标名称" in frame:
        frame = frame.rename(columns={"指标名称": "日期"})
    if "日期" in frame:
        frame["日期"] = parse_dates(frame["日期"]).dt.strftime("%Y-%m")
    for key, label, unit in RETAIL_SPECS:
        column = RETAIL_PREFIX + label
        values = pd.to_numeric(frame[column], errors="coerce") if column in frame else pd.Series(float("nan"), index=frame.index)
        values = values.replace([float("inf"), -float("inf")], float("nan"))
        builder.add("price", key, "金银珠宝零售 · " + label, unit, "月度", RETAIL_SOURCE, RETAIL_SHEET,
                    column=column, frame=frame, values=values, display_digits=1,
                    input_sources=[RETAIL_SOURCE], method="直接读取原表金额及同比，2月累计填充采用原表已处理列，不另行分摊或重算。",
                    warnings=["金额单位为亿元，同比单位为%；同比原值直接表示百分数，不再乘100。空值不补零。"])
