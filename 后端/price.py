"""已核对上游 Au99.99 字段映射；只读价格和波动率结果，不重算收益窗口。"""
import pandas as pd

SOURCE = "黄金现货价格.xlsx"
SHEET = "黄金现货价格"
METHOD = "日对数收益率；20/60个交易观测收益率；样本标准差（ddof=1）；252日年化。只读取上游计算结果。"
PUBLIC_NOTE = "新增来源公开再分发及商业使用授权未确认；静态公开版不发布价格及其派生波动率数值。"
HISTORY_NOTE = "非连续全史：上游未取得2003-04-16至2008-08-10历史；保留原始缺失，不补零、不插值。"


def add_price_indicators(builder):
    table = builder.tables.get((SOURCE, SHEET))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["时间"])
    for key, name, column, unit, window in [
        ("gold_price_anchor", "上金所Au99.99收盘价", "价格", "元/克", None),
        ("gold_hv20", "20日年化历史波动率", "20日年化历史波动率", "%", 20),
        ("gold_hv60", "60日年化历史波动率", "60日年化历史波动率", "%", 60),
    ]:
        values = pd.to_numeric(frame[column], errors="coerce") if column in frame else pd.Series([None] * len(frame), dtype="float64")
        # 负波动率与非正价格无效；真实零波动率有效。比例仅在接入边界转换一次。
        values = values.where(values.ge(0) if window else values.gt(0))
        values = values.replace([float("inf"), -float("inf")], float("nan"))
        if window:
            values = values * 100
        item = builder.add("price", key, name, unit, "日度", SOURCE, SHEET,
                           column=column, frame=frame, values=values,
                           warnings=[HISTORY_NOTE, "源值缺失或收益窗口不足时保持空值；最新期缺失不回退至早期值。"],
                           price_basis="上金所Au99.99交易日收盘价（人民币元/克）",
                           source_reference="https://www.sge.com.cn/sjzx/mrhq",
                           source_unit="decimal_fraction" if window else "元/克",
                           change_unit="个百分点" if window else "元/克",
                           change_kind="percentage_points" if window else "absolute_and_percent",
                           method=METHOD if window else "原表收盘价，不以ETF价格替代。",
                           window_observations=window, annualization_days=252 if window else None,
                           public_use_status="未确认", public_use_note=PUBLIC_NOTE)
        current = item["latest"]
        previous = item["history"][-2] if len(item["history"]) > 1 else None
        current["change_unit"] = item["metadata"]["change_unit"]
        current["change_pct"] = (current["change"] / previous["value"] * 100
                                  if not window and current["change"] is not None and previous and previous["value"] else None)
