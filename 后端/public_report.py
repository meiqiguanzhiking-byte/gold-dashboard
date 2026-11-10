"""只以过滤后的公开事实匹配已存日报；静态导出绝不调用模型。"""
from daily_report import make_bundle


def build_public_report(exported, generated_at):
    groups = {}
    withheld = set()
    for category, rows in exported.items():
        groups[category] = []
        for row in rows:
            metadata = row["metadata"]
            blocked = metadata.get("publication_withheld", False)
            if blocked:
                withheld.add(metadata["indicator_id"])
            points = [] if blocked else row["points"]
            groups[category].append({"metadata": metadata, "history": [
                {"observation_date": date, "value": value, "release_date": None} for date, value in points]})
    report = make_bundle(groups, report_date=generated_at[:10], source_version=generated_at, allow_generation=False)
    report["publication_scope"] = "public_only"
    # 被禁止项只能在正文出现数据暂缺；不能附带任何结构化旧值或派生数据。
    for version in (report["rule"], report.get("ai")):
        if version:
            for id in withheld:
                row = version.get("targets", {}).get(id)
                if row and any(row.get(field) is not None for field in ("value", "previousValue", "change", "percent")):
                    raise ValueError("公开日报仍含受限指标")
    return report
