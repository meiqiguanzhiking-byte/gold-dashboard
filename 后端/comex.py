"""COMEX 吨数口径；只读原值、逐期核验，不合并盎司表。"""
import math

import pandas as pd

from data_loader import parse_dates

SOURCE = "COMEX金银库存.xlsx"
SHEET = "COMEX金银库存"
SPECS = [
    ("gold", "registered", "黄金注册库存（吨）"),
    ("gold", "pledged", "黄金已质押库存（吨）"),
    ("gold", "eligible", "黄金合格库存（吨）"),
    ("gold", "total", "黄金总库存（吨）"),
    ("silver", "registered", "白银注册库存（吨）"),
    ("silver", "eligible", "白银合格库存（吨）"),
    ("silver", "total", "白银总库存（吨）"),
]
DEFINITION = {
    "confirmed": False,
    "status": "已质押扣减口径待核实",
    "exchange_definition": "CME 官方 FAQ 说明已质押仓单仍为注册库存，但本地表的映射与统计范围尚未确认",
    "reference": "https://www.cmegroup.com/trading/metals/files/comex-gold-warrants-faq.pdf",
    "pending": [
        "确认本地黄金已质押列对应 CME Gold Stock Report 的 Pledged 字段，且包含在本地注册列中",
        "确认两列使用同一观察日期、报告时点、仓库及合约统计范围",
        "补充工作簿的原始报告来源及吨数转换说明；同日列值满足大小关系不等于口径已确认",
    ],
}


def add_comex_indicators(builder):
    table = builder.tables.get((SOURCE, SHEET))
    for metal, kind, column in SPECS:
        values, invalid, negative = None, 0, 0
        if table is not None and column in table.frame:
            raw = table.frame[column]
            numbers = pd.to_numeric(raw, errors="coerce")
            finite = numbers.map(lambda v: pd.notna(v) and math.isfinite(v))
            negative = int((numbers < 0).sum())
            invalid = int((raw.notna() & ~finite).sum())
            values = numbers.where(finite & (numbers >= 0))
        notes = ["仅采用吨数工作表；盎司表为另一单位口径，不相加、不补点。按实际观察日展示，不假定交易日历或发布日历。"]
        if invalid or negative:
            notes.append(f"{invalid} 个非数值或非有限值、{negative} 个负库存置空，保留日期断点")
        if metal == "gold":
            notes.append(DEFINITION["status"] + "；不扣减、不计算已质押占比，不将已质押重复加进总库存")
        item = builder.add(
            "inventory", f"comex_{metal}_{kind}", "COMEX " + column.removesuffix("（吨）"),
            "吨", "日度", SOURCE, SHEET, column=column, values=values,
            warnings=notes, metal=metal, inventory_type=kind,
            invalid_value_count=invalid, negative_value_count=negative,
        )
        if invalid or negative:
            item["metadata"]["statuses"].append("数据异常")


def summarize_comex(items, tables):
    table = tables.get((SOURCE, SHEET))
    by_id = {i["metadata"]["indicator_id"]: i for i in items if i["metadata"]["indicator_id"].startswith("comex_")}
    dates = sorted({p["observation_date"] for i in by_id.values() for p in i["history"]})
    maps = {key: {p["observation_date"]: p["value"] for p in item["history"]} for key, item in by_id.items()}
    duplicate_dates, invalid_dates = 0, 0
    if table is not None:
        date_column = next((c for c in ("时间", "日期") if c in table.frame), None)
        if date_column:
            raw_dates = parse_dates(table.frame[date_column])
            invalid_dates = int(raw_dates.isna().sum())
            counts = raw_dates.dropna().dt.strftime("%Y-%m-%d").value_counts()
            duplicate_dates = int((counts > 1).sum())
    metals = {}
    for metal in ("gold", "silver"):
        expected = [kind for m, kind, _ in SPECS if m == metal]
        def at(kind, date):
            return maps.get(f"comex_{metal}_{kind}", {}).get(date)
        checks, max_error, invalid_subset = [], 0.0, []
        for date in dates:
            registered, eligible, total = (at(kind, date) for kind in ("registered", "eligible", "total"))
            complete = all(v is not None for v in (registered, eligible, total))
            error = abs(registered + eligible - total) if complete else None
            # 只容忍浮点/原表四舍五入误差，不改写任何库存值。
            passed = math.isclose(registered + eligible, total, rel_tol=1e-9, abs_tol=1e-6) if complete else None
            checks.append({"date": date, "passed": passed, "absolute_error_tonnes": error})
            if error is not None:
                max_error = max(max_error, error)
            pledged = at("pledged", date)
            if metal == "gold" and pledged is not None and registered is not None and pledged > registered:
                invalid_subset.append(date)
        complete_dates = [date for date in dates if all(at(kind, date) is not None for kind in expected)]
        registered_dates = [date for date in dates if at("registered", date) is not None]
        missing = [by_id[f"comex_{metal}_{kind}"]["metadata"]["source_column"] for kind in expected
                   if by_id[f"comex_{metal}_{kind}"]["metadata"]["valid_count"] == 0]
        metals[metal] = {
            "coverage_start": dates[0] if dates else None, "coverage_end": dates[-1] if dates else None,
            "latest_valid_date": registered_dates[-1] if registered_dates else None,
            "record_count": len(dates), "valid_record_count": len(complete_dates),
            "missing_fields": missing, "total_checks": checks,
            "total_check_status": "通过" if checks and all(c["passed"] is True for c in checks) else "不一致" if any(c["passed"] is False for c in checks) else "数据不足",
            "max_total_error_tonnes": max_error, "pledged_exceeds_registered_dates": invalid_subset,
        }
    return {"source": SOURCE, "sheet": SHEET, "unit": "吨", "frequency": "日度",
            "updated_at": table.updated_at if table else None,
            "ignored_sheets": [s for source, s in tables if source == SOURCE and s != SHEET],
            "raw_record_count": len(table.frame) if table else 0,
            "invalid_date_count": invalid_dates, "duplicate_date_count": duplicate_dates,
            "definition": DEFINITION, "metals": metals,
            "quality": {key: {field: item["metadata"][field] for field in ("record_count", "valid_count", "missing_count", "invalid_value_count", "negative_value_count")}
                        for key, item in by_id.items()},
            "total_formula": "总库存＝注册库存＋合格库存；已质押库存不重复计入",
            "summary_scope": "完整缓存；接口日期筛选仅作用于 indicators.history"}
