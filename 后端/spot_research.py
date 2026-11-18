"""现价研究行情：只读指定 CSV，不填充、不重新计算原始指标。"""
import csv
import math
from datetime import datetime

from config import DATA_DIR

SOURCE = DATA_DIR / "现价量化数据表" / "境内外现价价差_全历史.csv"
COLUMNS = [
    ("spread", "境内外现价价差", "元/克"),
    ("gold", "黄金现价", "元/克"),
    ("london", "伦敦金现", "美元/金衡盎司"),
    ("fx", "美元兑在岸人民币", "CNY/美元"),
]


def read_spot_market(path=SOURCE):
    columns = [{"id": key, "name": name, "unit": unit} for key, name, unit in COLUMNS]
    headers = [f"{name}（{unit}）" for _, name, unit in COLUMNS]
    points, seen = [], set()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"日期", *headers}.issubset(reader.fieldnames or []):
            raise ValueError("行情数据缺少日期或所需指标列")
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
