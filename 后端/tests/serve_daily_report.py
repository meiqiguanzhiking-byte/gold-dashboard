"""手动启动浏览器集成测试环境；模型协议替身，不导出任何AI测试文案。"""
import json
from http.server import ThreadingHTTPServer
import os
from pathlib import Path
import sys
import threading
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import daily_report
from test_daily_report import ModelHandler
from daily_report import DailyReportCache, report_service
from public_report import build_public_report
from main import app
from store import store
import uvicorn

snapshot = json.loads((Path(__file__).resolve().parents[2] / "展示版/数据/data/snapshot.json").read_text(encoding="utf-8"))
groups = {category: [{"metadata": row["metadata"], "history": [
    {"observation_date": date, "value": value, "release_date": None} for date, value in row["points"]],
    "latest": {"value": row["points"][-1][1] if row["points"] else None}, "warnings": row["notes"], "missing_fields": []}
    for row in rows] for category, rows in snapshot["groups"].items()}
store._snapshot = {"groups": groups, "deliveries": snapshot.get("deliveries"), "meta": {
    "loaded_at": snapshot["generated_at"], "status": "ok", "files": snapshot["files"], "comex": snapshot["comex"],
    "read_errors": [], "warnings": [], "missing_indicators": [], "indicators": [row["metadata"] for rows in groups.values() for row in rows]}}

test_cache_directory = tempfile.TemporaryDirectory()
daily_report.persistent_reports = DailyReportCache(Path(test_cache_directory.name) / "reports.sqlite3")

server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()
os.environ.update(GOLD_REPORT_AI_URL=f"http://127.0.0.1:{server.server_port}/v1/chat/completions", GOLD_REPORT_AI_MODEL="protocol-test-only", GOLD_REPORT_AI_TIMEOUT="1", GOLD_REPORT_AI_KEY="")


@app.post("/test/model/{mode}")
def set_mode(mode: str):
    ModelHandler.mode = mode
    with report_service.lock:
        report_service.jobs.clear()
    daily_report.persistent_reports = DailyReportCache(Path(test_cache_directory.name) / (mode + "-reports.sqlite3"))
    report_service.prewarm(store.snapshot)
    return {"mode": mode}


@app.get("/test/public-report")
def public_report():
    state = store.snapshot
    exported = {category: [{"metadata": row["metadata"], "points": [
        [point["observation_date"], point["value"]] for point in row["history"]]}
        for row in rows] for category, rows in state["groups"].items()}
    return build_public_report(exported, state["meta"]["loaded_at"])


async def reload_fixture():
    report_service.prewarm(store.snapshot)
    return {"status": "ok", "loaded_at": store.snapshot["meta"]["loaded_at"]}


# 只在测试进程替换重载；其他接口使用真实main.py实现。
for route in app.routes:
    if getattr(route, "path", "") == "/api/reload":
        app.routes.remove(route)
        break
app.add_api_route("/api/reload", reload_fixture, methods=["POST"])

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8011, lifespan="off")
