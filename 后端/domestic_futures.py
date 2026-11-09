"""同日期、同到期合约的境内外黄金期货连续价格及价差。"""
import math
import json
import re

import pandas as pd

from data_loader import parse_dates
from international_futures import SOURCE as OVERSEAS_SOURCE
from contract_expiry import contract_expiries, basis_contract_expiries

DOMESTIC_SOURCE = "黄金期货.csv"
SPREAD_SOURCE = "黄金期货主力合约.csv"
SPREAD_COLUMNS = [f"{product}{rank}价格" for rank in ("近端主力", "远端主力")
                  for product in ("黄金期货", "COMEX期货", "USDCNH期货")]
SPREAD_REQUIRED = ["日期", "近端主力合约", "远端主力合约", *SPREAD_COLUMNS]
GRAMS_PER_TROY_OUNCE = 31.1034768
PRICE_METHOD = "最近偶数月主力按国内最后报价日换约；使用国内原始收盘价，不复权"
METHOD = "按黄金期货主力合约.csv的近端主力合约、远端主力合约标识及各自三列价格计算价差；不复权，缺项不补值"


def contract_quotes(frame, date_column, expiry_column, price_columns, allow_zero_columns=()):
    """原表标识与月份双重核对；重复日期/合约的全部价格置空。"""
    required = [date_column, "合约", expiry_column, *price_columns]
    if not set(required).issubset(frame.columns):
        return {}, []
    data = frame[required].copy()
    data[date_column] = parse_dates(data[date_column]).dt.strftime("%Y-%m-%d")
    for column in price_columns:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    quotes, dates = {}, set()
    for row in data.itertuples(index=False, name=None):
        date, contract, expiry, *prices = row
        if not isinstance(date, str):
            continue
        dates.add(date)
        if not re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", str(expiry)):
            continue
        if str(contract).lower() != "au" + expiry[2:4] + expiry[5:7] or date[:7] > expiry:
            continue
        values = tuple(float(value) if pd.notna(value) and math.isfinite(value)
                       and (value >= 0 if column in allow_zero_columns else value > 0)
                       else None for column, value in zip(price_columns, prices))
        by_date = quotes.setdefault((str(contract).lower(), str(expiry)), {})
        by_date[date] = (None,) * len(prices) if date in by_date else values
    return quotes, sorted(dates)


def continuous_futures_rows(domestic, overseas):
    local, dates = contract_quotes(domestic, "时间", "交割月份", ["收盘价（元/克）"])
    foreign, _ = contract_quotes(overseas, "日期", "到期期限", ["黄金期货价格", "USDCNH期货价格"])
    contracts = []
    for key in sorted(local, key=lambda k: (k[1], k[0])):
        valid_dates = sorted(date for date, values in local[key].items() if values[0] is not None)
        if int(key[1][-2:]) % 2 == 0 and valid_dates:
            contracts.append((key, valid_dates[0], valid_dates[-1]))
    if not contracts:
        return []
    start = min(first for _, first, _ in contracts)
    rows, active = [], -1
    for date in dates:
        if date < start:
            continue
        rollover = None
        if active < 0 or date > contracts[active][2]:
            next_index = next((index for index, (key, _, end) in enumerate(contracts)
                               if index > active and date <= end
                               and key[1] >= date[:7]
                               and local[key].get(date, (None,))[0] is not None), None)
            if next_index is None:
                rows.append({"时间": date, "close": None, "raw_close": None, "spread": None, "contract": None,
                             "expiry": None, "comex": None, "fx": None, "rollover_from": None, "detail": None})
                continue
            rollover = contracts[active][0][0] if active >= 0 else None
            active = next_index
        key = contracts[active][0]
        raw_close = local[key].get(date, (None,))[0]
        close = raw_close
        gold, fx = foreign.get(key, {}).get(date, (None, None))
        spread = raw_close - gold * fx / GRAMS_PER_TROY_OUNCE if all(v is not None for v in (raw_close, gold, fx)) else None
        detail = f"合约：{key[0]} · 到期月份：{key[1]} · 国内原始收盘价：{raw_close if raw_close is not None else '缺失'} 元/克 · COMEX：{gold if gold is not None else '缺失'} 美元/金衡盎司 · USDCNH期货：{fx if fx is not None else '缺失'} CNH/美元"
        if rollover:
            detail += f" · 换约：{rollover} → {key[0]}"
        rows.append({"时间": date, "close": close, "raw_close": raw_close, "spread": spread, "contract": key[0], "expiry": key[1],
                     "comex": gold, "fx": fx, "rollover_from": rollover, "detail": detail})
    return rows


def spread_curve_rows(frame):
    """直接采用指定CSV的近端/远端标识和六列报价，不另行选约或匹配。"""
    if not set(SPREAD_REQUIRED).issubset(frame.columns):
        return []
    data = frame[SPREAD_REQUIRED].copy()
    data["日期"] = parse_dates(data["日期"]).dt.strftime("%Y-%m-%d")
    for column in SPREAD_COLUMNS:
        data[column] = pd.to_numeric(data[column], errors="coerce")
    output = []
    for record in data.to_dict("records"):
        date = record["日期"]
        if not isinstance(date, str):
            continue
        row, details = {"时间": date}, []
        for prefix, rank in (("main", "近端主力"), ("secondary", "远端主力")):
            raw_contract = record[rank + "合约"]
            contract = str(raw_contract).strip().lower() if pd.notna(raw_contract) else None
            domestic_close, gold, fx = [
                float(record[product + rank + "价格"])
                if pd.notna(record[product + rank + "价格"])
                and math.isfinite(record[product + rank + "价格"])
                and record[product + rank + "价格"] > 0 else None
                for product in ("黄金期货", "COMEX期货", "USDCNH期货")]
            spread = domestic_close - gold * fx / GRAMS_PER_TROY_OUNCE if contract and all(
                value is not None for value in (domestic_close, gold, fx)) else None
            row[prefix + "_spread"] = spread
            row[prefix + "_contract"] = contract
            details.append(f"{rank}：{contract or '缺失'}"
                           f" · 国内原价 {domestic_close if domestic_close is not None else '缺失'} 元/克"
                           f" · COMEX {gold if gold is not None else '缺失'} 美元/金衡盎司"
                           f" · USDCNH期货 {fx if fx is not None else '缺失'} CNH/美元")
        row["spread_detail"] = "；".join(details)
        output.append(row)
    return output


def add_domestic_futures(builder):
    domestic = builder.tables.get((DOMESTIC_SOURCE, None))
    overseas = builder.tables.get((OVERSEAS_SOURCE, None))
    rows = continuous_futures_rows(domestic.frame, overseas.frame if overseas else pd.DataFrame()) if domestic else []
    spread_source = builder.tables.get((SPREAD_SOURCE, None))
    spread_rows = spread_curve_rows(spread_source.frame) if spread_source else []
    spread_missing = SPREAD_REQUIRED if spread_source is None else [c for c in SPREAD_REQUIRED if c not in spread_source.frame]
    quotes, dates = contract_quotes(domestic.frame, "时间", "交割月份", ["收盘价（元/克）"]) if domestic else ({}, [])
    futures_quotes, _ = contract_quotes(domestic.frame, "时间", "交割月份", ["收盘价（元/克）", "持仓量（吨）"],
                                        allow_zero_columns=("持仓量（吨）",)) if domestic else ({}, [])
    selected = {row["时间"]: row["contract"] for row in rows}
    expiries = contract_expiries(dates[-1]) if dates else {}
    basis_expiries = basis_contract_expiries(quotes, dates[-1], expiries) if dates else {}
    daily_quotes = []
    for index, date in enumerate(dates):
        previous_date = dates[index - 1] if index else None
        contracts = [{"contract": code, "expiry": expiry, "close": history[date][0],
                      "open_interest": futures_quotes.get((code, expiry), {}).get(date, (None, None))[1],
                      **(basis_expiries.get(code, {}) if index >= len(dates) - 2 else {}),
                      "previous_close": history.get(previous_date, (None,))[0], "previous_date": previous_date}
                     for (code, expiry), history in sorted(quotes.items(), key=lambda entry: entry[0][1]) if date in history]
        daily_quotes.append({"时间": date, "quotes": json.dumps({"main_contract": selected.get(date), "quotes": contracts}, ensure_ascii=False)})
    builder.add("price", "gold_futures_daily_quotes", "国内黄金期货当日各合约原始收盘价", "文本", "日度", DOMESTIC_SOURCE,
                column="quotes", frame=pd.DataFrame(daily_quotes, columns=["时间", "quotes"]), display_digits=2,
                contract_expiries=basis_expiries,
                method="保存全部合约当日原价及持仓量；供每日速递及主力连续曲线选约使用")
    frame = pd.DataFrame(rows, columns=["时间", "close", "detail"])
    spread_frame = pd.DataFrame(spread_rows, columns=["时间", "main_spread", "secondary_spread", "spread_detail"])
    domestic_missing, overseas_missing = [], []
    for target, table, required in [(domestic_missing, domestic, ["时间", "合约", "交割月份", "收盘价（元/克）"]),
                                    (overseas_missing, overseas, ["日期", "合约", "到期期限", "黄金期货价格", "USDCNH期货价格"])]:
        target.extend(required if table is None else [column for column in required if column not in table.frame])
    for indicator_id, name, column, unit, target_frame in [
        ("gold_futures_close", "黄金期货连续价格（不复权）", "close", "元/克", frame),
        ("gold_futures_spread", "近端主力黄金期货价差（不复权）", "main_spread", "元/克", spread_frame),
        ("gold_futures_secondary_spread", "远端主力黄金期货价差（不复权）", "secondary_spread", "元/克", spread_frame),
        ("gold_futures_contract", "黄金期货合约与折算明细", "detail", "文本", frame),
        ("gold_futures_spread_details", "近端及远端主力期货价差合约明细", "spread_detail", "文本", spread_frame),
    ]:
        valid_dates = [row["时间"] for row in (rows if column in ("close", "detail") else spread_rows) if row[column] is not None]
        is_spread = column in ("main_spread", "secondary_spread", "spread_detail")
        builder.add("price", indicator_id, name, unit, "日度", SPREAD_SOURCE if is_spread else DOMESTIC_SOURCE, column=column, frame=target_frame,
                    input_sources=[SPREAD_SOURCE] if is_spread else [DOMESTIC_SOURCE] if column == "close" else [DOMESTIC_SOURCE, OVERSEAS_SOURCE],
                    method=PRICE_METHOD if column in ("close", "detail") else METHOD,
                    calculation="连续价格＝所选合约国内原始收盘价，不复权" if column == "close" else "原始价差＝国内期货原价 − COMEX同月原价 × USDCNH同月期货价 ÷ 31.1034768；不复权",
                    comparison_basis="同一CSV记录日期下，分别读取近端、远端标识和对应国内、COMEX、USDCNH三列原价；含CNH/CNY口径及收盘时点差异" if is_spread else "海外报价日期为右表；相同观察日期、相同原表合约标识与到期月份；交易所收盘时点可能不同，含CNH/CNY口径差异",
                    grams_per_troy_ounce=GRAMS_PER_TROY_OUNCE, latest_valid_date=valid_dates[-1] if valid_dates else None,
                    display_digits=2, missing_fields=spread_missing if is_spread else domestic_missing if column == "close" else domestic_missing + overseas_missing,
                    warnings=[METHOD, "直接读取指定CSV的六列报价；缺项为空，不前填；图线跨缺值直接连接。"] if is_spread else [PRICE_METHOD, "价差按海外报价日期右连接国内同日同月价格；缺项为空，不错移日期、不前填；图线可跨缺值直接连接。",
                              "原表未提供确切到期日及境外交易所官方合约代码；原表au标识仅作为同月份关联键。"])
