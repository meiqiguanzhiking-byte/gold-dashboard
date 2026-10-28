"""启动时缓存；重新加载构建新快照后一次替换。"""
from threading import Lock

from config import DATA_DIR
from data_loader import load_tables, now_iso
from indicators import build_indicators
from comex import summarize_comex
from deliveries import build_deliveries


class DataStore:
    def __init__(self):
        self._snapshot = None
        self._lock = Lock()

    @property
    def snapshot(self):
        return self._snapshot

    def reload(self):
        with self._lock:
            tables, files, warnings = load_tables(DATA_DIR)
            groups = build_indicators(tables)
            indicators = [item for items in groups.values() for item in items]
            missing = [item["metadata"]["indicator_id"] for item in indicators if item["latest"]["value"] is None]
            errors = [f["source"] for f in files if f["status"] == "读取失败"]
            loaded_at = now_iso()
            for item in groups["price"]:
                item["metadata"]["loaded_at"] = loaded_at
                item["latest"]["loaded_at"] = loaded_at
            meta = {
                "loaded_at": loaded_at, "data_directory": str(DATA_DIR),
                "status": "degraded" if errors or not tables else "ok",
                "files": files, "indicators": [item["metadata"] for item in indicators],
                "warnings": warnings + ["发布日期未提供，automation_status 为未确认；延迟阈值仅用于提示", "当前仅启用 CSV/XLSX；Parquet 未启用"],
                "missing_indicators": missing, "read_errors": errors,
                "comex": summarize_comex(groups["inventory"], tables),
            }
            self._snapshot = {"groups": groups, "meta": meta, "deliveries": build_deliveries(tables)}
            return meta


store = DataStore()
