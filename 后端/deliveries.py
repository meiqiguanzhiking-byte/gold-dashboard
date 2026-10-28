"""只读黄金交割宽表：源值已为公吨，I交付、S接收，空白不补零。"""
import math
import re
from datetime import datetime

import pandas as pd

SOURCE = "黄金交割.xlsx"
CONTRACTS = {"GC": "标准黄金期货 GC", "MGC": "微型黄金期货 MGC"}


def build_deliveries(tables):
    result = {"source": SOURCE, "unit": "吨", "frequency": "月度", "release_date": None,
              "basis": "CME Issues and Stops 月度交割通知名义数量；源表已换算为公吨，不再次换算。",
              "contracts": {}}
    for symbol, title in CONTRACTS.items():
        table = tables.get((SOURCE, symbol))
        product = {"symbol": symbol, "title": title, "sheet": symbol, "months": [],
                   "available_months": [], "accounts": [], "updated_at": table.updated_at if table else None,
                   "coverage_start": None, "coverage_end": None, "release_date": None, "warnings": []}
        result["contracts"][symbol] = product
        if table is None:
            product["warnings"].append("来源工作表缺失")
            continue
        frame = table.frame
        if list(frame.columns[:2]) != ["机构名称（C/H）", "I/S"]:
            product["warnings"].append("机构名称或I/S表头与已核对结构不符，暂停展示")
            continue
        columns = []
        for column in frame.columns[2:]:
            if not isinstance(column, (pd.Timestamp, datetime)):
                product["warnings"].append("月份表头不是日期，暂停展示")
                break
            month = pd.Timestamp(column).strftime("%Y-%m")
            if month in [m for m, _ in columns]:
                product["warnings"].append("月份表头重复，暂停展示")
                break
            columns.append((month, column))
        else:
            columns.sort()
            product["months"] = [month for month, _ in columns]
            accounts, duplicates = {}, set()
            for _, row in frame.iterrows():
                if pd.isna(row.iloc[0]) and pd.isna(row.iloc[1]):
                    continue
                name, side = str(row.iloc[0]).strip(), str(row.iloc[1]).strip()
                match = re.fullmatch(r".+\[([CH])\]", name)
                if not match or side not in ("I", "S"):
                    product["warnings"].append("存在无法识别的机构/C/H或I/S记录，暂停展示")
                    accounts.clear()
                    break
                account = accounts.setdefault(name, {"institution": name, "origin": match[1], "issued": None, "stopped": None})
                field = "issued" if side == "I" else "stopped"
                if account[field] is not None:
                    duplicates.add((name, field))
                    continue
                values = []
                for _, column in columns:
                    raw = row[column]
                    if pd.isna(raw):
                        values.append(None)
                    elif isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw) and raw >= 0:
                        values.append(float(raw))
                    else:
                        values.append(None)
                        product["warnings"].append("非数值、非有限或负交割数量已留空")
                account[field] = values
            for name, field in duplicates:
                accounts[name][field] = [None] * len(columns)
            if duplicates:
                product["warnings"].append("重复I/S记录对应方向已留空，不相加或任选一行")
            for account in accounts.values():
                for field in ("issued", "stopped"):
                    if account[field] is None:
                        account[field] = [None] * len(columns)
                        product["warnings"].append("部分机构缺少I/S方向记录，缺失方向保持空白")
            product["accounts"] = list(accounts.values())
            product["available_months"] = [month for i, (month, _) in enumerate(columns)
                                             if any(a[field][i] is not None for a in accounts.values() for field in ("issued", "stopped"))]
            months = product["available_months"]
            product["coverage_start"] = months[0] if months else None
            product["coverage_end"] = months[-1] if months else None
        product["warnings"] = list(dict.fromkeys(product["warnings"]))
    return result
