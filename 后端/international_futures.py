"""境外期货原始合约及按主力表标识构造的实际价格、回溯复权序列。"""
import re
import json
import math

import pandas as pd

SOURCE = "COMEX黄金与汇率期货.csv"
PRODUCTS = (
    ("comex", "COMEX黄金期货", "黄金期货价格", "美元/金衡盎司", "CME 芝商所", 2),
    ("sgx_usdcnh", "美元兑离岸人民币期货", "USDCNH期货价格", "CNH/美元", "SGX 新加坡交易所", 4),
)


MAIN_SOURCE = "黄金期货主力合约.csv"
QUOTE_SOURCE = SOURCE


def add_marked_main_futures(builder):
    """按主力表标识取原价，换月价差只使用同日报价。"""
    table = builder.tables.get((MAIN_SOURCE, None))
    if table is None or not {"日期", "主力合约"}.issubset(table.frame.columns):
        return
    raw = builder.tables.get((QUOTE_SOURCE, None))
    frame = table.frame.copy()
    frame["日期"] = pd.to_datetime(frame["日期"], errors="coerce").dt.strftime("%Y-%m-%d")
    frame = frame.dropna(subset=["日期"]).sort_values("日期").drop_duplicates("日期", keep=False)

    def price(value):
        try:
            result = float(value)
            return result if math.isfinite(result) and result > 0 else None
        except (TypeError, ValueError):
            return None

    for product, name, quote_column, unit, exchange, digits in PRODUCTS:
        prefix = "COMEX" if product == "comex" else "USDCNH"
        main_column = prefix + "期货主力价格"
        if main_column not in frame:
            continue
        quotes = {}
        if raw is not None and {"日期", "合约", quote_column}.issubset(raw.frame.columns):
            for date, contract, value in raw.frame[["日期", "合约", quote_column]].itertuples(index=False, name=None):
                stamp = pd.to_datetime(date, errors="coerce")
                if pd.notna(stamp):
                    key = (stamp.strftime("%Y-%m-%d"), str(contract))
                    quotes[key] = None if key in quotes else price(value)
        rows, prior = [], None
        for row in frame.to_dict("records"):
            date, contract = row["日期"], str(row["主力合约"])
            value = price(row.get(main_column))
            if not rows and value is None:
                continue
            rollover = None
            if prior and contract != prior:
                old = quotes.get((date, prior))
                if old is None and str(row.get("次主力合约")) == prior:
                    old = price(row.get(prefix + "期货次主力价格"))
                rollover = {"from": prior, "to": contract, "old_price": old,
                            "new_price": value, "gap": value - old if value is not None and old is not None else None}
            rows.append({"日期": date, "contract": contract, "raw_value": value, "rollover": rollover})
            prior = contract
        if not rows:
            continue
        cumulative, complete = 0.0, True
        for row in reversed(rows):
            row["adjustment"] = cumulative if complete else None
            row["adjusted_value"] = row["raw_value"] + cumulative if complete and row["raw_value"] is not None else None
            event = row["rollover"]
            if event:
                if event["gap"] is None:
                    complete = False
                else:
                    cumulative += event["gap"]
        builder.add("price", f"intl_futures_main_{product}", name + "主力连续（主力表标识）", unit, "日度", MAIN_SOURCE,
                    frame=pd.DataFrame(rows), values=[json.dumps(row, ensure_ascii=False, allow_nan=False) for row in rows],
                    main_futures_product=product, exchange=exchange, display_digits=digits,
                    observation_time="15:00", observation_timezone="Asia/Shanghai",
                    input_sources=[MAIN_SOURCE, raw.source] if raw is not None else [MAIN_SOURCE],
                    method="主力按黄金期货主力合约.csv标识；实际价格保留换月跳空；长期复权将换月日新−旧价差累加至更早历史，最新价格不变。",
                    warnings=["原表au合约代码为月份关联标识，不视为境外交易所官方代码。",
                              "换月日新旧报价不足时，无法确定的更早复权值保持缺失，不使用跨日涨跌替代价差。"])


def add_international_futures(builder):
    add_marked_main_futures(builder)
    table = builder.tables.get((SOURCE, None))
    if table is None:
        return
    frame = table.frame
    if not {"日期", "合约", "到期期限"}.issubset(frame.columns):
        return
    for (contract, expiry), rows in frame.groupby(["合约", "到期期限"], dropna=False, sort=True):
        if not re.fullmatch(r"[A-Za-z0-9]+", str(contract)) or not re.fullmatch(r"\d{4}-\d{2}", str(expiry)):
            continue
        for product, name, column, unit, exchange, digits in PRODUCTS:
            values = pd.to_numeric(rows[column], errors="coerce") if column in rows else pd.Series(float("nan"), index=rows.index)
            values = values.where(values.gt(0)).replace([float("inf"), -float("inf")], float("nan"))
            builder.add("price", f"intl_futures_{product}_{contract}_{str(expiry).replace('-', '')}",
                        f"{name} · {expiry}", unit, "日度", SOURCE, column=column, frame=rows, values=values,
                        futures_product=product, contract_expiry=str(expiry), source_contract=str(contract),
                        exchange=exchange, display_digits=digits, observation_time="15:00", observation_timezone="Asia/Shanghai",
                        warnings=["北京时间15:00收盘价；页面按最近偶数月合约衔接，直接使用所选合约原始收盘价，不复权。",
                                  "原表合约代码为数据关联标识，不视为境外交易所官方代码。"])
