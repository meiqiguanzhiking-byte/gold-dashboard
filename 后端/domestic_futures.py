"""同日期、同到期合约的境内外黄金期货连续价格及价差。"""
import math
import json
import re

import pandas as pd

from data_loader import parse_dates
from international_futures import SOURCE as OVERSEAS_SOURCE
from contract_expiry import contract_expiries

DOMESTIC_SOURCE = "黄金期货.csv"
GRAMS_PER_TROY_OUNCE = 31.1034768
PRICE_METHOD = "最近偶数月主力按国内最后报价日换约；国内价格用旧约末日旧价减同日新价累计差额后复权"
METHOD = "最近及第二近偶数月合约分别计算同日同月原始价差；以海外报价日期右连接国内价格，换约取最近同日双合约有效价差之差累计后复权；缺项不补值"


def contract_quotes(frame, date_column, expiry_column, price_columns):
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
        values = tuple(float(value) if pd.notna(value) and math.isfinite(value) and value > 0 else None for value in prices)
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
    adjustment = 0.0
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
                rows.append({"时间": date, "close": None, "raw_close": None, "adjustment": adjustment, "spread": None, "contract": None,
                             "expiry": None, "comex": None, "fx": None, "rollover_from": None, "detail": None})
                continue
            rollover = contracts[active][0][0] if active >= 0 else None
            if active >= 0:
                old_key, _, end = contracts[active]
                new_key = contracts[next_index][0]
                old_quote = local[old_key].get(end, (None,))[0]
                new_quote = local[new_key].get(end, (None,))[0]
                # 必须使用旧约末日两份同日真实报价，缺项时不猜复权差额。
                adjustment = adjustment + old_quote - new_quote if adjustment is not None and old_quote is not None and new_quote is not None else None
            active = next_index
        key = contracts[active][0]
        raw_close = local[key].get(date, (None,))[0]
        close = raw_close + adjustment if raw_close is not None and adjustment is not None else None
        gold, fx = foreign.get(key, {}).get(date, (None, None))
        spread = raw_close - gold * fx / GRAMS_PER_TROY_OUNCE if all(v is not None for v in (raw_close, gold, fx)) else None
        detail = f"合约：{key[0]} · 到期月份：{key[1]} · 国内原始收盘价：{raw_close if raw_close is not None else '缺失'} 元/克 · 累计后复权差额：{round(adjustment, 6) if adjustment is not None else '缺失'} 元/克 · COMEX：{gold if gold is not None else '缺失'} 美元/金衡盎司 · USDCNH期货：{fx if fx is not None else '缺失'} CNH/美元"
        if rollover:
            detail += f" · 换约：{rollover} → {key[0]}"
        rows.append({"时间": date, "close": close, "raw_close": raw_close, "adjustment": adjustment, "spread": spread, "contract": key[0], "expiry": key[1],
                     "comex": gold, "fx": fx, "rollover_from": rollover, "detail": detail})
    return rows


def spread_curve_rows(domestic, overseas):
    """以海外报价日期为右表，分别构造最近/第二近偶数月价差连续线。"""
    local, _ = contract_quotes(domestic, "时间", "交割月份", ["收盘价（元/克）"])
    foreign, dates = contract_quotes(overseas, "日期", "到期期限", ["黄金期货价格", "USDCNH期货价格"])
    contracts = []
    for key in sorted(local, key=lambda k: (k[1], k[0])):
        valid_dates = sorted(date for date, (value,) in local[key].items() if value is not None)
        if int(key[1][-2:]) % 2 == 0 and valid_dates:
            contracts.append((key, valid_dates[-1]))
    if not contracts:
        return [{"时间": date, "main_spread": None, "secondary_spread": None, "spread_detail": None,
                 "main_contract": None, "secondary_contract": None} for date in dates]

    def quote(key, date):
        domestic_close = local[key].get(date, (None,))[0]
        gold, fx = foreign.get(key, {}).get(date, (None, None))
        raw = domestic_close - gold * fx / GRAMS_PER_TROY_OUNCE if all(
            value is not None for value in (domestic_close, gold, fx)) else None
        return raw, domestic_close, gold, fx

    states = [{"index": -1, "adjustment": 0.0, "seen_quote": False} for _ in range(2)]
    output = []
    for date in dates:
        selected, rollovers = [], []
        for rank, state in enumerate(states):
            minimum = selected[0] + 1 if rank and selected[0] >= 0 else (len(contracts) if rank else 0)
            previous = state["index"]
            rollover, anchor = None, None
            if previous < minimum or previous < 0 or date > contracts[previous][1]:
                next_index = next((index for index, (key, end) in enumerate(contracts)
                                   if index >= minimum and index > previous and date <= end
                                   and key[1] >= date[:7] and local[key].get(date, (None,))[0] is not None), -1)
                if next_index >= 0:
                    rollover = contracts[previous][0][0] if previous >= 0 else None
                    if previous >= 0 and state["seen_quote"]:
                        old_key, old_end = contracts[previous]
                        new_key = contracts[next_index][0]
                        overlaps = sorted(day for day in local[old_key].keys() & local[new_key].keys()
                                          if day <= old_end and quote(old_key, day)[0] is not None
                                          and quote(new_key, day)[0] is not None)
                        if overlaps and state["adjustment"] is not None:
                            anchor = overlaps[-1]
                            state["adjustment"] += quote(old_key, anchor)[0] - quote(new_key, anchor)[0]
                        else:
                            # 无同日双合约报价不能推算换约差额；后续复权值保持缺失。
                            state["adjustment"] = None
                    state["index"] = next_index
            selected.append(state["index"] if state["index"] >= minimum
                            and date <= contracts[state["index"]][1] else -1)
            rollovers.append((rollover, anchor))

        values, raw_values, adjustments, details = [], [], [], []
        for rank, index in enumerate(selected):
            if index < 0:
                values.append(None)
                raw_values.append(None)
                adjustments.append(None)
                details.append(("主力" if rank == 0 else "次主力") + "：无可用偶数月合约")
                continue
            key = contracts[index][0]
            raw, domestic_close, gold, fx = quote(key, date)
            state = states[rank]
            if raw is not None:
                state["seen_quote"] = True
            adjusted = raw + state["adjustment"] if raw is not None and state["adjustment"] is not None else None
            values.append(adjusted)
            raw_values.append(raw)
            adjustments.append(state["adjustment"])
            detail = (f"{'主力' if rank == 0 else '次主力'}：{key[0]}（{key[1]}）"
                      f" · 国内原价 {domestic_close if domestic_close is not None else '缺失'} 元/克"
                      f" · COMEX {gold if gold is not None else '缺失'} 美元/金衡盎司"
                      f" · USDCNH期货 {fx if fx is not None else '缺失'} CNH/美元"
                      f" · 累计价差复权额 {round(state['adjustment'], 6) if state['adjustment'] is not None else '缺失'} 元/克")
            rollover, anchor = rollovers[rank]
            if rollover:
                detail += f" · 换约 {rollover}→{key[0]}" + (f"（复权锚点 {anchor}）" if anchor else "（无同日复权锚点）")
            details.append(detail)
        output.append({"时间": date, "main_spread": values[0], "secondary_spread": values[1],
                       "main_raw_spread": raw_values[0], "secondary_raw_spread": raw_values[1],
                       "main_adjustment": adjustments[0], "secondary_adjustment": adjustments[1],
                       "spread_detail": "；".join(details),
                       "main_contract": contracts[selected[0]][0][0] if selected[0] >= 0 else None,
                       "secondary_contract": contracts[selected[1]][0][0] if selected[1] >= 0 else None,
                       "main_expiry": contracts[selected[0]][0][1] if selected[0] >= 0 else None,
                       "secondary_expiry": contracts[selected[1]][0][1] if selected[1] >= 0 else None,
                       "main_rollover_from": rollovers[0][0], "secondary_rollover_from": rollovers[1][0],
                       "main_roll_anchor": rollovers[0][1], "secondary_roll_anchor": rollovers[1][1]})
    return output


def add_domestic_futures(builder):
    domestic = builder.tables.get((DOMESTIC_SOURCE, None))
    overseas = builder.tables.get((OVERSEAS_SOURCE, None))
    rows = continuous_futures_rows(domestic.frame, overseas.frame if overseas else pd.DataFrame()) if domestic else []
    spread_rows = spread_curve_rows(domestic.frame, overseas.frame) if domestic and overseas else []
    quotes, dates = contract_quotes(domestic.frame, "时间", "交割月份", ["收盘价（元/克）"]) if domestic else ({}, [])
    selected = {row["时间"]: row["contract"] for row in rows}
    expiries = contract_expiries(dates[-1]) if dates else {}
    daily_quotes = []
    for index, date in enumerate(dates):
        previous_date = dates[index - 1] if index else None
        contracts = [{"contract": code, "expiry": expiry, "close": history[date][0],
                      **(expiries.get(code, {}) if index >= len(dates) - 2 else {}),
                      "previous_close": history.get(previous_date, (None,))[0], "previous_date": previous_date}
                     for (code, expiry), history in sorted(quotes.items(), key=lambda entry: entry[0][1]) if date in history]
        daily_quotes.append({"时间": date, "quotes": json.dumps({"main_contract": selected.get(date), "quotes": contracts}, ensure_ascii=False)})
    builder.add("price", "gold_futures_daily_quotes", "国内黄金期货当日各合约原始收盘价", "文本", "日度", DOMESTIC_SOURCE,
                column="quotes", frame=pd.DataFrame(daily_quotes, columns=["时间", "quotes"]), display_digits=2,
                method="最近偶数月合约；原始收盘价不复权；变化比较同一合约上一交易观察日，缺失不跨期填补")
    frame = pd.DataFrame(rows, columns=["时间", "close", "detail"])
    spread_frame = pd.DataFrame(spread_rows, columns=["时间", "main_spread", "secondary_spread", "spread_detail"])
    domestic_missing, overseas_missing = [], []
    for target, table, required in [(domestic_missing, domestic, ["时间", "合约", "交割月份", "收盘价（元/克）"]),
                                    (overseas_missing, overseas, ["日期", "合约", "到期期限", "黄金期货价格", "USDCNH期货价格"])]:
        target.extend(required if table is None else [column for column in required if column not in table.frame])
    for indicator_id, name, column, unit, target_frame in [
        ("gold_futures_close", "黄金期货连续价格（差额后复权）", "close", "元/克", frame),
        ("gold_futures_spread", "主力黄金期货价差（差额后复权）", "main_spread", "元/克", spread_frame),
        ("gold_futures_secondary_spread", "次主力黄金期货价差（差额后复权）", "secondary_spread", "元/克", spread_frame),
        ("gold_futures_contract", "黄金期货合约与折算明细", "detail", "文本", frame),
        ("gold_futures_spread_details", "主力及次主力期货价差合约明细", "spread_detail", "文本", spread_frame),
    ]:
        valid_dates = [row["时间"] for row in (rows if column in ("close", "detail") else spread_rows) if row[column] is not None]
        builder.add("price", indicator_id, name, unit, "日度", DOMESTIC_SOURCE, column=column, frame=target_frame,
                    input_sources=[DOMESTIC_SOURCE] if column == "close" else [DOMESTIC_SOURCE, OVERSEAS_SOURCE],
                    method=PRICE_METHOD if column in ("close", "detail") else METHOD,
                    calculation="连续价格＝国内原始收盘价＋累计换约差额（旧约末日旧价−同日新价）" if column == "close" else "原始价差＝国内期货原价 − COMEX同月原价 × USDCNH同月期货价 ÷ 31.1034768；换约后累计旧约−新约同日原始价差",
                    comparison_basis="海外报价日期为右表；相同观察日期、相同原表合约标识与到期月份；交易所收盘时点可能不同，含CNH/CNY口径差异",
                    grams_per_troy_ounce=GRAMS_PER_TROY_OUNCE, latest_valid_date=valid_dates[-1] if valid_dates else None,
                    display_digits=2, missing_fields=domestic_missing if column == "close" else domestic_missing + overseas_missing,
                    warnings=[METHOD, "价差按海外报价日期右连接国内同日同月价格；缺项为空，不错移日期、不前填；图线可跨缺值直接连接。",
                              "原表未提供确切到期日及境外交易所官方合约代码；原表au标识仅作为同月份关联键。"])
