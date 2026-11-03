"""同日期、同到期合约的境内外黄金期货连续价格及价差。"""
import math
import re

import pandas as pd

from data_loader import parse_dates

DOMESTIC_SOURCE = "黄金期货.csv"
OVERSEAS_SOURCE = "COMEX黄金与汇率期货.csv"
GRAMS_PER_TROY_OUNCE = 31.1034768
METHOD = "仅使用三项存在共同报价的到期合约，按到期顺序持有；当前合约最后一条同日三项齐全报价当日仍使用原合约，之后换约；中途缺项不提前换约；原价不复权"


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
    common = []
    for key in sorted(local.keys() & foreign.keys(), key=lambda k: (k[1], k[0])):
        valid_dates = sorted(date for date in local[key].keys() & foreign[key].keys()
                             if all(value is not None for value in (*local[key][date], *foreign[key][date])))
        if valid_dates:
            common.append((key, valid_dates[0], valid_dates[-1]))
    if not common:
        return []
    start = min(first for _, first, _ in common)
    rows, active = [], -1
    for date in dates:
        if date < start:
            continue
        rollover = None
        if active < 0 or date > common[active][2]:
            next_index = next((index for index, (key, _, end) in enumerate(common)
                               if index > active and date <= end
                               and all(value is not None for value in (*local[key].get(date, (None,)), *foreign[key].get(date, (None, None))))), None)
            if next_index is None:
                rows.append({"时间": date, "close": None, "spread": None, "contract": None,
                             "expiry": None, "comex": None, "fx": None, "rollover_from": None, "detail": None})
                continue
            rollover = common[active][0][0] if active >= 0 else None
            active = next_index
        key = common[active][0]
        close = local[key].get(date, (None,))[0]
        gold, fx = foreign[key].get(date, (None, None))
        spread = close - gold * fx / GRAMS_PER_TROY_OUNCE if all(v is not None for v in (close, gold, fx)) else None
        detail = f"合约：{key[0]} · 到期月份：{key[1]} · COMEX：{gold if gold is not None else '缺失'} 美元/金衡盎司 · USDCNH期货：{fx if fx is not None else '缺失'} CNH/美元"
        if rollover:
            detail += f" · 换约：{rollover} → {key[0]}"
        rows.append({"时间": date, "close": close, "spread": spread, "contract": key[0], "expiry": key[1],
                     "comex": gold, "fx": fx, "rollover_from": rollover, "detail": detail})
    return rows


def add_domestic_futures(builder):
    domestic = builder.tables.get((DOMESTIC_SOURCE, None))
    overseas = builder.tables.get((OVERSEAS_SOURCE, None))
    rows = continuous_futures_rows(domestic.frame, overseas.frame) if domestic and overseas else []
    frame = pd.DataFrame(rows, columns=["时间", "close", "spread", "detail"])
    missing_fields = []
    for table, required in [(domestic, ["时间", "合约", "交割月份", "收盘价（元/克）"]),
                            (overseas, ["日期", "合约", "到期期限", "黄金期货价格", "USDCNH期货价格"])]:
        missing_fields.extend(required if table is None else [column for column in required if column not in table.frame])
    for indicator_id, name, column, unit in [
        ("gold_futures_close", "黄金期货连续价格", "close", "元/克"),
        ("gold_futures_spread", "黄金期货价差", "spread", "元/克"),
        ("gold_futures_contract", "黄金期货合约与折算明细", "detail", "文本"),
    ]:
        valid_dates = [row["时间"] for row in rows if row[column] is not None]
        builder.add("price", indicator_id, name, unit, "日度", DOMESTIC_SOURCE, column=column, frame=frame,
                    input_sources=[DOMESTIC_SOURCE, OVERSEAS_SOURCE], method=METHOD,
                    calculation="国内黄金期货收盘价 − COMEX同到期合约价格 × USDCNH同到期合约期货价格 ÷ 31.1034768",
                    comparison_basis="相同观察日期、相同原表合约标识与到期月份；交易所收盘时点可能不同，含CNH/CNY口径差异",
                    grams_per_troy_ounce=GRAMS_PER_TROY_OUNCE, latest_valid_date=valid_dates[-1] if valid_dates else None,
                    display_digits=2, missing_fields=missing_fields,
                    warnings=[METHOD, "缺少任何同日期同合约输入时价差为空；不使用现货汇率、不匹配近似月份、不前值填充。",
                              "原表未提供确切到期日及境外交易所官方合约代码；原表au标识仅作为同月份关联键。"])
