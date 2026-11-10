"""黄金市场本地只读数据 API。"""
import asyncio
from contextlib import asynccontextmanager
from datetime import date

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

from config import ALLOWED_ORIGINS
from indicators import CATEGORIES
from store import store
from research_etf import get_etf_replication
from research_macro import get_macro_replication
from research_dual_anchor import get_dual_anchor
from daily_report import report_service


@asynccontextmanager
async def lifespan(app):
    await asyncio.to_thread(store.reload)
    report_service.prewarm(store.snapshot)
    yield


app = FastAPI(title="黄金市场指标 API", version="1.0.0", lifespan=lifespan,
              description="启动时只读加载真实 CSV/XLSX 并缓存到内存。POST /api/reload 刷新缓存；不插值、不生成模拟数据。")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=["GET", "POST"], allow_headers=["*"])


def snapshot():
    if store.snapshot is None:
        raise HTTPException(503, "数据尚未加载")
    return store.snapshot


@app.get("/api/health")
def health():
    meta = snapshot()["meta"]
    return {"status": meta["status"], "loaded_at": meta["loaded_at"],
            "file_count": len(meta["files"]), "indicator_count": len(meta["indicators"]),
            "read_errors": meta["read_errors"]}


@app.get("/api/meta")
def metadata():
    return snapshot()["meta"]


@app.post("/api/reload")
async def reload_data():
    meta = await asyncio.to_thread(store.reload)
    report_service.prewarm(store.snapshot)
    return {"status": meta["status"], "loaded_at": meta["loaded_at"],
            "file_count": len(meta["files"]), "read_errors": meta["read_errors"],
            "warnings": meta["warnings"], "missing_indicators": meta["missing_indicators"]}


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    thresholds: dict[Literal["spread", "price", "volatility", "rates", "shares", "volume", "position"], float] = Field(default_factory=dict)
    source_version: str | None = Field(default=None, max_length=80)


@app.post("/api/daily-report")
async def daily_report(body: ReportRequest):
    state = snapshot()
    limits = {"spread": 5, "price": 5, "volatility": 5, "rates": 5, "shares": 1, "volume": 10, "position": 1}
    if any(value < 0 or value > limits[key] for key, value in body.thresholds.items()):
        raise HTTPException(422, "无效日报阈值")
    if body.source_version and body.source_version != state["meta"]["loaded_at"]:
        raise HTTPException(409, "数据批次已更新，请刷新日报")
    try:
        future = report_service.submit(state, body.thresholds)
        return await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(future)), timeout=390)
    except Exception:
        # 日报异常独立于所有数据接口；前端立即保留本地规则底稿。
        raise HTTPException(503, "AI日报暂不可用，请使用数值规则") from None


@app.get("/api/research/etf-monthly")
def research_etf_monthly():
    try:
        return get_etf_replication()
    except (OSError, ValueError, KeyError) as error:
        raise HTTPException(503, "ETF月度复现数据暂不可用：" + str(error)) from error


@app.get("/api/research/macro-monthly")
def research_macro_monthly():
    try:
        return get_macro_replication()
    except (OSError, ValueError, KeyError) as error:
        raise HTTPException(503, "长期宏观复现数据暂不可用：" + str(error)) from error


@app.get("/api/research/dual-anchor")
def research_dual_anchor():
    try:
        return get_dual_anchor()
    except (OSError, ValueError, KeyError) as error:
        raise HTTPException(503, "双锚复现数据暂不可用：" + str(error)) from error


def category_handler(category):
    def endpoint(
        indicator_id: str | None = Query(None, description="按指标 ID 筛选"),
        frequency: str | None = Query(None, description="日度 / 周度 / 月度 / 未提供；不同频率独立返回"),
        start_date: date | None = Query(None), end_date: date | None = Query(None),
        include_history: bool = Query(True),
    ):
        if start_date and end_date and start_date > end_date:
            raise HTTPException(422, "起始日期不得晚于结束日期")
        state = snapshot()
        items = state["groups"][category]
        if indicator_id is not None:
            items = [item for item in items if item["metadata"]["indicator_id"] == indicator_id]
            if not items:
                raise HTTPException(404, "该分类中没有此指标")
        if frequency is not None:
            if frequency not in ("日度", "周度", "月度", "未提供"):
                raise HTTPException(422, "无效频率")
            items = [item for item in items if item["metadata"]["frequency"] == frequency]
        output = []
        for item in items:
            history = item["history"] if include_history else []
            if start_date or end_date:
                def in_range(row):
                    raw = row["observation_date"]
                    observed = pd.Timestamp(raw)
                    lower = observed.date()
                    upper = (observed + pd.offsets.MonthEnd(0)).date() if len(raw) == 7 else lower
                    return (not start_date or upper >= start_date) and (not end_date or lower <= end_date)
                history = [row for row in history if in_range(row)]
            output.append({**item, "history": history, "returned_history_count": len(history)})
        return {"category": category, "loaded_at": state["meta"]["loaded_at"], "indicators": output,
                **({"comex": state["meta"]["comex"], "deliveries": state.get("deliveries")} if category == "inventory" else {}),
                "warnings": list(dict.fromkeys(note for item in output for note in item["warnings"])),
                "missing_fields": [{"indicator_id": item["metadata"]["indicator_id"], "fields": item["missing_fields"]} for item in output if item["missing_fields"]],
                "query": {"start_date": start_date, "end_date": end_date, "include_history": include_history,
                          "latest_scope": "latest 始终为完整缓存的最新观察期；latest_available 为最近非空值"}}
    endpoint.__name__ = category.replace("-", "_")
    return endpoint


for category in CATEGORIES:
    app.add_api_route(f"/api/{category}", category_handler(category), methods=["GET"], tags=[category])
