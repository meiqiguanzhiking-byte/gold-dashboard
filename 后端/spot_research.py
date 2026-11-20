"""现价研究行情：只读指定 CSV，不填充、不重新计算原始指标。"""
import csv
import math
import re
from datetime import datetime

from config import DATA_DIR

SOURCE = DATA_DIR / "现价量化数据表" / "境内外现价价差_全历史.csv"
COLUMNS = [
    ("spread", "境内外现价价差", "元/克"),
    ("gold", "黄金现价", "元/克"),
    ("london", "伦敦金现", "美元/金衡盎司"),
    ("fx", "美元兑在岸人民币", "CNY/美元"),
]


def factor_group(header):
    if header.startswith("银行结售汇 ·"):
        return "外汇供求"
    if header.startswith("金银珠宝零售 ·"):
        return "消费需求"
    if "ETF" in header or "SPDR" in header:
        return "投资需求"
    if "波动率" in header or "历史波动率" in header:
        return "波动状态"
    if "持仓" in header:
        return "持仓结构"
    if any(word in header for word in ("美债", "利率", "利差", "通胀", "美元指数", "汇率", "USDCNH", "沪金溢价", "金银比")):
        return "利率与美元"
    return None


def read_spot_market(path=SOURCE, *, include_columns=None):
    columns = [{"id": key, "name": name, "unit": unit, "group": "研究对象"} for key, name, unit in COLUMNS]
    headers = [f"{name}（{unit}）" for _, name, unit in COLUMNS]
    points, seen = [], set()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"日期", *headers}.issubset(reader.fieldnames or []):
            raise ValueError("行情数据缺少日期或所需指标列")
        for header in reader.fieldnames:
            if header in headers or header == "日期" or "所属月份" in header:
                continue
            # 静态导出只读取显式获准字段；新增本地文本或研究字段不自动公开。
            if include_columns is not None and header not in include_columns:
                continue
            group = factor_group(header)
            if not group:
                raise ValueError(f"未配置因子分组：{header}")
            match = re.match(r"^(.*)（([^（）]+)）$", header)
            if not match:
                raise ValueError(f"未配置因子单位：{header}")
            columns.append({"id": "factor_" + str(len(columns)), "name": match[1], "unit": match[2], "group": group})
            headers.append(header)
        for row in reader:
            day = datetime.strptime(row["日期"].strip(), "%Y/%m/%d").date().isoformat()
            if day in seen:
                raise ValueError(f"行情数据存在重复日期：{day}")
            seen.add(day)
            values = []
            for header in headers:
                raw = row[header]
                if raw is None:
                    raise ValueError(f"{day} 行情数据列数不完整")
                value = float(raw.strip()) if raw.strip() else None
                if value is not None and not math.isfinite(value):
                    raise ValueError(f"{day} {header}含非有限数值")
                values.append(value)
            points.append([day, *values])
    points.sort(key=lambda point: point[0])
    for index, column in enumerate(columns, 1):
        valid = [point[0] for point in points if point[index] is not None]
        column.update(missing=sum(point[index] is None for point in points),
                      start=valid[0] if valid else None, end=valid[-1] if valid else None)
    return {"source": path.name, "columns": columns, "points": points,
            "start": points[0][0] if points else None, "end": points[-1][0] if points else None}
