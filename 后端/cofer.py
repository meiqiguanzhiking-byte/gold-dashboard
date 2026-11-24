"""IMF COFER九币种季度份额；直接采用正式CSV百分比。"""
import pandas as pd

SOURCE = "COFER_全球币种份额.csv"
CURRENCIES = [
    ("usd", "美元"), ("eur", "欧元"), ("jpy", "日元"), ("gbp", "英镑"),
    ("cny", "人民币"), ("cad", "加元"), ("aud", "澳元"), ("chf", "瑞士法郎"), ("other", "其他货币"),
]


def add_cofer_indicators(builder):
    table = builder.tables.get((SOURCE, None))
    frame = table.frame.rename(columns={"季度末日期": "日期"}).copy() if table else pd.DataFrame(columns=["日期"])
    for code, currency in CURRENCIES:
        column = currency + "_占比百分比"
        values = pd.to_numeric(frame[column], errors="coerce") if column in frame else pd.Series(float("nan"), index=frame.index)
        values = values.where(values.between(0, 100))
        builder.add("central-bank", "cofer_" + code + "_share", currency + "外汇储备份额", "%", "季度", SOURCE,
                    column=column, frame=frame, values=values, display_digits=2, change_unit="百分点",
                    source_reference="https://data.imf.org/en/Datasets/COFER",
                    method="直接采用CSV占比百分比，不除以100；按季度末日期升序展示",
                    warnings=["来源：IMF COFER；保留原始季度末日期和百分比，缺失不补零、不插值。",
                              "人民币2016Q4前、加元和澳元2012Q4前未单列，保留空值。",
                              "1999年为旧已分配分母；2000Q1起采用2025Q3发布版追溯插补的全球口径。仅含外汇储备，不含黄金、SDR和IMF储备头寸。"])
