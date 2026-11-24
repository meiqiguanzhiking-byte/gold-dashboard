"""WGC季度供需七分项，直接展示单季度吨数。"""
import pandas as pd

SOURCE = "全球黄金季度供需分项.xlsx"
SHEET = "季度供需"
SPECS = [
    ("gold_supply_mine", "矿产金供给", "矿产金供给（吨）"),
    ("gold_supply_hedging", "生产商净套保", "生产商净套保（吨）"),
    ("gold_supply_recycled", "回收金供给", "回收金供给（吨）"),
    ("gold_demand_jewellery", "首饰制造需求", "首饰制造需求（吨）"),
    ("gold_demand_technology", "科技需求", "科技需求（吨）"),
    ("gold_demand_investment", "投资需求", "投资需求（吨）"),
    ("gold_demand_central_banks", "央行净购金需求", "央行净购金需求（吨）"),
]


def add_gold_supply_demand(builder):
    table = builder.tables.get((SOURCE, SHEET))
    frame = table.frame if table else pd.DataFrame(columns=["日期"])
    for key, name, column in SPECS:
        values = pd.to_numeric(frame[column], errors="coerce") if column in frame else pd.Series(float("nan"), index=frame.index)
        values = values.replace([float("inf"), -float("inf")], float("nan"))
        builder.add("central-bank", key, name, "吨", "季度", SOURCE, SHEET,
                    frame=frame, column=column, values=values, display_digits=1,
                    source_reference="https://www.gold.org/goldhub/data/gold-demand-by-country",
                    method="直接采用WGC单季度供需分项原值，不累计、不再差分",
                    warnings=["来源：WGC 世界黄金协会；季度末观察日期，单位为吨。缺失不补零、不插值。",
                              "首饰为制造需求，区别于首饰消费；央行净购金和生产商净套保保留正负值。"])
