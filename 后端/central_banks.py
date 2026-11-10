"""按正式 CSV 汇总全球央行黄金储备月度净变化。"""
import hashlib
import json
import math
import re
from zipfile import BadZipFile
from datetime import date, datetime
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

from config import CENTRAL_BANK_CHANGES_FILE

SOURCE = "全球央行购金.csv"
SCOPE_FILE = Path(__file__).with_name("central_bank_scope.json")
NOTICE = "基于已报告数据，可能随补报修订；不代表完整全球总量。"


def read_reported_months(path):
    """只读原始Monthly表；保留数值0，原表空白保持缺失，不用CSV的补零判断报告。"""
    with Path(path).open("rb") as stream:
        book = load_workbook(stream, read_only=True, data_only=True)
        try:
            rows = iter(book["Monthly"].values)
            header = next(row for row in rows if "Country" in row and "Comments" in row)
            col = header.index("Country")
            dates = [(i, d.strftime("%Y-%m")) for i, d in enumerate(header) if isinstance(d, (date, datetime))]
            result, entities = {d: {} for _, d in dates}, set()
            if len(result) != len(dates) or not dates:
                raise ValueError("原表月份重复或缺失")
            for row in rows:
                name = str(row[col] or "").strip()
                if not name:
                    continue
                if name in entities:
                    raise ValueError("原表机构重复")
                entities.add(name)
                for i, month in dates:
                    v = row[i]
                    if v is None or isinstance(v, str) and not v.strip():
                        result[month][name] = None
                    elif isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                        result[month][name] = v
                    else:
                        raise ValueError("原表包含非有限数字或未识别文本")
            return result, entities
        finally:
            book.close()


def add_central_bank_changes(builder, evidence_file=CENTRAL_BANK_CHANGES_FILE):
    """按正式 CSV 直接构建全球央行月度变化。

    CSV 是该指标的唯一准据。机构列的空值、非数字值以及缺少的机构列均按 0
    处理，因此不会再因为 WGC 证据表覆盖范围或逐机构数值差异而隐藏整个月份。
    ``evidence_file`` 保留在函数签名中，以兼容既有调用方，但不再参与取值核验。
    """
    scope = json.loads(SCOPE_FILE.read_text(encoding="utf-8"))
    included, excluded = scope["included_entities"], scope["excluded_entities"]
    if len(set(included)) != len(included) or set(included) & set(excluded):
        raise ValueError("机构纳入与排除名单冲突")
    table = builder.tables.get((SOURCE, None))
    frame = table.frame.copy() if table else pd.DataFrame(columns=["时间"])
    if "时间" not in frame:
        frame = pd.DataFrame(columns=["时间", *frame.columns])
    columns = [c for c in frame if c != "时间"]
    notes = [NOTICE, "以全球央行购金.csv为准；原值为储备月度净变化，不再差分；正值合计为买入量，负值合计为卖出量，二者相加为净买入。",
             "买入/卖出是机构净变化正负分组，不是交易流水；机构缺失、空值或非数字值均按0处理。"]

    # 统一把 CSV 中的机构字段转换为数值，并按用户指定口径把缺失值视作 0。
    # 缺少整列的机构也按 0 处理，避免单个机构字段变化导致整个月份消失。
    numeric = frame.copy()
    for c in columns:
        numeric[c] = pd.to_numeric(numeric[c], errors="coerce").fillna(0.0)
    restored = numeric
    sums = {"purchases": [], "sales": [], "net": [], "count": []}
    for idx, row in frame.iterrows():
        # CSV 中未列出的纳入机构同样按 0 参与汇总。
        values = [float(numeric.at[idx, c]) if c in numeric.columns else 0.0 for c in included]
        positive = math.fsum(v for v in values if v > 0)
        negative = math.fsum(v for v in values if v < 0)
        sums["purchases"].append(positive)
        sums["sales"].append(negative)
        sums["net"].append(positive + negative)
        sums["count"].append(len(values))
    for country in columns:
        slug = re.sub(r"[^a-z0-9]+", "_", country.lower()).strip("_")
        suffix = hashlib.sha1(country.encode("utf-8")).hexdigest()[:8]
        builder.add("central-bank", f"central_bank_country_{slug}_{suffix}", f"{country} 黄金储备月度净变化",
                    "吨", "月度", SOURCE, column=country, frame=restored,
                    warnings=notes, country=country, aggregation_included=country in included,
                    entity_type="纳入官方储备实体" if country in included else "排除：" + excluded.get(country, "待核实"),
                    source_reference=scope["source_reference"])
    for field, key, name, unit in [
        ("purchases", "global_central_bank_gross_purchases", "月买入量（已报告正变化合计）", "吨"),
        ("sales", "global_central_bank_gross_sales", "月卖出量（已报告负变化合计）", "吨"),
        ("net", "global_central_bank_net_purchases", "全球黄金储备净变化合计（已报告）", "吨"),
        ("count", "global_central_bank_reporting_count", "月度纳入机构数", "家"),
    ]:
        builder.add("central-bank", key, name, unit, "月度", SOURCE, frame=frame, values=sums[field], warnings=notes,
                    source_reference=scope["source_reference"], scope_entity_count=len(included),
                    aggregation_scope=scope if field == "net" else None,
                    coverage_basis="CSV纳入机构口径，非完整全球总量", reporting_evidence="全球央行购金.csv",
                    method="Σ正变化；Σ负变化；净变化＝正变化合计＋负变化合计；机构缺失或空值按0")
