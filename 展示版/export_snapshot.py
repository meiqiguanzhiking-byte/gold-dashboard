"""复用既有只读处理逻辑，按页面白名单输出一个可公开审阅的精简快照。"""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "后端"))

from comex import summarize_comex
from config import DATA_DIR
from data_loader import load_tables, now_iso
from indicators import build_indicators

METADATA_FIELDS = (
    "indicator_id", "indicator_name", "unit", "frequency", "source", "sheet", "updated_at",
    "coverage_start", "coverage_end", "record_count", "valid_count", "missing_count", "status", "statuses",
    "delay_days", "automation_status", "fund", "region", "country",
    "change_unit", "change_kind", "price_basis", "source_unit", "source_reference", "method",
    "window_observations", "annualization_days", "public_use_status",
    "input_sources", "input_indicators", "cutoff_date", "cutoff_timezone", "comparison_basis", "grams_per_troy_ounce", "latest_valid_date",
    "display_digits",
)


def pick(value, fields):
    return {key: value[key] for key in fields if key in value}


def validate_public(value):
    text = json.dumps(value, ensure_ascii=False, allow_nan=False)
    if re.search(r"\b[A-Za-z]:[\\/]|\\\\|localhost|127\.0\.0\.1|Traceback|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY", text, re.I):
        raise ValueError("快照包含不适合发布的信息；未写入数据")


def export():
    policy = json.loads((ROOT / "展示版" / "公开范围.json").read_text(encoding="utf-8"))
    tables, files, _ = load_tables(DATA_DIR)
    groups = build_indicators(tables)
    allowed = set(policy["indicator_ids"])
    allowed.update(f"domestic_{code}_{field}" for code in policy["fund_codes"] for field in policy["fund_fields"])
    if policy["include_existing_country_rankings"]:
        allowed.update(item["metadata"]["indicator_id"] for item in groups["central-bank"]
                       if item["metadata"].get("country") and item["metadata"]["country"] not in policy["excluded_country_columns"])
    used_sources = {item["metadata"]["source"] for items in groups.values() for item in items
                    if item["metadata"]["indicator_id"] in allowed}
    if not tables or any(file["status"] == "读取失败" and file["source"] in used_sources for file in files):
        raise ValueError("所选来源读取失败；未覆盖已有快照，请先检查本地数据")

    exported, source_dates, withheld, point_count = {}, {}, [], 0
    for category, items in groups.items():
        exported[category] = []
        for item in items:
            m = item["metadata"]
            key = m["indicator_id"]
            if key not in allowed:
                continue
            history = item["history"][-2:] if key in policy["latest_only"] else item["history"]
            metadata = pick(m, METADATA_FIELDS)
            notes = list(item["warnings"])
            reason = policy["withheld_indicators"].get(key)
            if m["source"] in policy["withheld_sources"]:
                reason = reason or "此来源尚未确认可公开，展示数据暂缺"
            dependencies = m.get("input_sources", [m["source"]])
            if category == "price" and any(policy.get("source_permissions", {}).get(source) != "approved" or source in policy["withheld_sources"] for source in dependencies):
                reason = "相关来源公开使用尚未确认，静态版不发布价格、汇率及派生指标"
            if any(key in policy["withheld_indicators"] for key in m.get("input_indicators", [])):
                reason = "派生指标的输入项尚未获准公开，展示数据暂缺"
            if reason:
                history = []
                metadata.update(status="数据缺失", statuses=["数据缺失"], valid_count=0, missing_count=0,
                                record_count=0, coverage_start=None, coverage_end=None, updated_at=None,
                                delay_days=None, latest_valid_date=None, publication_withheld=True)
                notes = ["数据暂缺：" + reason]
                withheld.append(key)
            metadata["published_record_count"] = len(history)
            metadata["published_history"] = "未获准公开，未导出历史" if reason else "最新两期，仅供当前值和环比" if key in policy["latest_only"] else "页面所用完整历史"
            points = [[point["observation_date"], point["value"]] for point in history]
            point_count += len(points)
            exported[category].append({"metadata": metadata, "points": points, "notes": notes})
            source_dates.setdefault(m["source"], []).extend(point[0] for point in points)

    summary = summarize_comex(groups["inventory"], tables)
    comex = pick(summary, ("source", "sheet", "unit", "definition", "duplicate_date_count", "invalid_date_count", "quality"))
    comex["metals"] = {metal: pick(info, ("coverage_start", "coverage_end", "latest_valid_date", "record_count", "valid_record_count",
                                         "missing_fields", "total_check_status", "pledged_exceeds_registered_dates"))
                       for metal, info in summary["metals"].items()}
    # 被禁止公开的库存值不得通过质检详情或派生统计再次泄露。
    if summary["source"] in policy["withheld_sources"] or any(key.startswith("comex_") for key in withheld):
        comex["metals"] = {}
        comex["quality"] = {}

    public_files = []
    for file in files:
        if file["source"] not in source_dates:
            continue
        dates = source_dates[file["source"]]
        public_files.append({"source": file["source"], "coverage_start": min(dates, default=None), "latest_date": max(dates, default=None),
                             "status": "数据缺失" if not dates else file["status"],
                             "warnings": ["相关来源公开使用尚未确认，未导出价格、汇率及派生指标"] if not dates else ["仅发布页面白名单指标，原始文件未发布"]})
    snapshot = {
        "schema_version": 1, "generated_at": now_iso(), "groups": exported, "files": public_files, "comex": comex,
        "publication": {"status": policy["publication_status"], "indicator_count": sum(map(len, exported.values())),
                        "point_count": point_count, "withheld_indicators": withheld,
                        "notice": "真实数值和历史序列可被访问或下载；不随本机文件自动更新。公开前确认数据及品牌展示权限。"},
    }
    validate_public(snapshot)
    output = ROOT / "展示版" / "数据" / "data" / "snapshot.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    shutil.copyfile(ROOT / "前端" / "public" / "favicon.svg", output.parent.parent / "favicon.svg")
    print(json.dumps({"indicators": snapshot["publication"]["indicator_count"], "points": point_count, "bytes": output.stat().st_size,
                      "files": [{"source": file["source"], "from": file["coverage_start"], "to": file["latest_date"]} for file in public_files],
                      "withheld": withheld}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        export()
    except (ValueError, OSError, KeyError) as error:
        print("展示快照生成失败：" + str(error).splitlines()[0], file=sys.stderr)
        sys.exit(1)
