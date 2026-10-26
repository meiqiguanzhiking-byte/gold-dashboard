"""只读加载原始表，不写数据副本、日志或中间文件。"""
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pandas as pd

from config import CSV_ENCODINGS, LOCAL_TIMEZONE


def now_iso():
    return datetime.now(LOCAL_TIMEZONE).isoformat(timespec="seconds")


def parse_dates(values):
    return pd.to_datetime(values, format="mixed", errors="coerce")


@dataclass
class Table:
    source: str
    sheet: str | None
    frame: pd.DataFrame
    updated_at: str


def read_csv(path):
    for encoding in CSV_ENCODINGS:
        try:
            return pd.read_csv(path, encoding=encoding), encoding
        except UnicodeError:
            continue
    raise ValueError("CSV 无法使用已配置的常见编码解码")


def describe_frame(frame, sheet):
    date_col = next((name for name in ("时间", "日期") if name in frame.columns), None)
    dates = parse_dates(frame[date_col]) if date_col else pd.Series(dtype="datetime64[ns]")
    start, end = dates.min(), dates.max()
    return {
        "sheet": sheet, "row_count": len(frame), "columns": list(frame.columns),
        "date_column": date_col,
        "coverage_start": None if pd.isna(start) else start.strftime("%Y-%m-%d"),
        "coverage_end": None if pd.isna(end) else end.strftime("%Y-%m-%d"),
        "invalid_date_count": int(dates.isna().sum()),
        "missing_cell_count": int(frame.isna().sum().sum()),
        "status": "数据缺失" if frame.empty else "仅最新值" if len(frame) == 1 else "短历史" if len(frame) < 90 else "正常",
    }


def load_tables(directory: Path):
    tables, files, warnings = {}, [], []
    if not directory.is_dir():
        return tables, files, ["真实数据目录不存在或不可访问"]
    for path in sorted(directory.iterdir()):
        if not path.is_file() or path.name.startswith("~$"):
            continue
        item = {"source": path.name, "updated_at": None, "sheets": [], "status": "正常", "warnings": []}
        try:
            before = path.stat()
            item["updated_at"] = datetime.fromtimestamp(before.st_mtime, LOCAL_TIMEZONE).isoformat(timespec="seconds")
            if path.suffix.lower() == ".csv":
                frame, encoding = read_csv(path)
                frames = {None: frame}
                item["encoding"] = encoding
            elif path.suffix.lower() == ".xlsx":
                frames = pd.read_excel(path, sheet_name=None, engine="openpyxl")
            else:
                item.update(status="未启用", warnings=["仅启用 CSV/XLSX；Parquet 未启用"])
                files.append(item)
                continue
            after = path.stat()
            if before.st_mtime_ns != after.st_mtime_ns or before.st_size != after.st_size:
                raise ValueError("读取时文件发生变化，请等待更新完成后重新加载")
            for sheet, frame in frames.items():
                tables[(path.name, sheet)] = Table(path.name, sheet, frame, item["updated_at"])
                item["sheets"].append(describe_frame(frame, sheet))
            starts = [r["coverage_start"] for r in item["sheets"] if r["coverage_start"]]
            ends = [r["coverage_end"] for r in item["sheets"] if r["coverage_end"]]
            item.update(coverage_start=min(starts, default=None), coverage_end=max(ends, default=None), latest_date=max(ends, default=None))
            if item["sheets"] and all(r["status"] == "仅最新值" for r in item["sheets"]):
                item["status"] = "仅最新值"
            elif item["sheets"] and all(r["status"] == "短历史" for r in item["sheets"]):
                item["status"] = "短历史"
            if any(r["invalid_date_count"] for r in item["sheets"]):
                item["warnings"].append("存在无法解析的日期，对应记录不进入指标历史")
        except Exception as exc:
            item.update(status="读取失败", warnings=[f"{type(exc).__name__}: {exc}"])
            warnings.append(f"{path.name} 读取失败")
            for key in list(tables):
                if key[0] == path.name:
                    del tables[key]
        files.append(item)
    return tables, files, warnings
