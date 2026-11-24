"""首屏只保留日报所需的真实观测；完整历史仍由原分类接口提供。"""
import calendar
import json
from datetime import date


HISTORY_LIMITS = {
    "au_td_close": 20, "au_td_close_1500": 20, "london_gold_spot": 20, "usdcnh": 20, "usdcny": 20,
    "gold_futures_daily_quotes": 20, "au_td_delivery_direction": 30,
    "gold_domestic_spread": 11, "gold_futures_spread": 11,
    "gold_futures_secondary_spread": 11, "gold_futures_spread_details": 11,
}
PERCENTILE_IDS = {
    "gold_hv20", "gold_hv60", "gold_etf_volatility_index", "gold_domestic_spread",
    "gold_futures_spread", "gold_futures_secondary_spread", "au_td_volume",
    "futures_volume", "au_td_open_interest", "futures_open_interest",
    "cftc_long", "cftc_short", "cftc_net_long", "domestic_etf_total_shares", "spdr_gold_holdings",
    *("comex_gold_" + kind for kind in ("registered", "pledged", "eligible", "total")),
}
_cached = (None, None)


def compact_dashboard(state):
    global _cached
    cached_state, cached_result = _cached
    if state is cached_state:
        return cached_result
    groups = state["groups"]
    quote_item = next((item for item in groups["price"]
                       if item["metadata"]["indicator_id"] == "gold_futures_daily_quotes"), {})
    futures_dates = set()
    for point in quote_item.get("history", [])[-2:]:
        futures_dates.add(point["observation_date"])
        try:
            quotes = json.loads(point["value"]).get("quotes", [])
            futures_dates.update(quote["previous_date"] for quote in quotes if quote.get("previous_date"))
        except (ValueError, TypeError, AttributeError):
            pass

    def brief_item(item):
        key = item["metadata"]["indicator_id"]
        history = item["history"]
        tail = max(0, len(history) - HISTORY_LIMITS.get(key, 2))
        start = ""
        if key in PERCENTILE_IDS and history:
            latest = date.fromisoformat(history[-1]["observation_date"])
            year = latest.year - 1
            start = latest.replace(year=year, day=min(latest.day, calendar.monthrange(year, latest.month)[1])).isoformat()
        points = [point for index, point in enumerate(history)
                  if index >= tail or (start and point["observation_date"] > start)
                  or (key in ("au_td_close", "au_td_close_1500") and point["observation_date"] in futures_dates)]
        return {**item, "history": points, "returned_history_count": len(points)}

    result = {category: {"category": category, "loaded_at": state["meta"]["loaded_at"],
                         "indicators": [brief_item(item) for item in items]}
              for category, items in groups.items()}
    result["meta"] = {**state["meta"], "delivery_coverage": {
        symbol: {key: contract.get(key) for key in ("coverage_start", "coverage_end")}
        for symbol, contract in (state.get("deliveries") or {}).get("contracts", {}).items()
    }}
    # 同批次复用内存结果；不修改完整缓存、不落盘。
    _cached = (state, result)
    return result
