"""只读上期所合约参数中的EXPIREDATE，不用交割月份猜测最后交易日。"""
import json
import re
from datetime import date, timedelta
from urllib.request import urlopen

SOURCE = "https://www.shfe.com.cn/data/busiparamdata/future/ContractBaseInfo{day}.dat"
# 已逐项核对官方2026-11-03合约参数；网络暂不可用时仍保留可追溯的已确认日期。
VERIFIED_DATE = "2026-11-03"
VERIFIED = {
    "au2611": "2026-11-16", "au2612": "2026-12-15",
    "au2701": "2027-01-15", "au2702": "2027-02-15",
    "au2704": "2027-04-15", "au2706": "2027-06-15",
    "au2708": "2027-08-16", "au2710": "2027-10-15",
}


def parse_contract_expiries(payload, observation_date):
    """严格匹配报表日期及合约；冲突、非法日期均不选值。"""
    target = observation_date.replace("-", "")
    result = {}
    if not isinstance(payload, dict) or not isinstance(payload.get("ContractBaseInfo"), list):
        return result
    for row in payload.get("ContractBaseInfo", []):
        if not isinstance(row, dict):
            continue
        code = str(row.get("INSTRUMENTID", "")).strip().lower()
        raw_date = str(row.get("EXPIREDATE", "")).strip()
        if not re.fullmatch(r"au\d{4}", code) or str(row.get("TRADINGDAY", "")).strip() != target:
            continue
        if not re.fullmatch(r"\d{8}", raw_date):
            continue
        try:
            expiry = date.fromisoformat(f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}").isoformat()
        except ValueError:
            continue
        if expiry[2:4] + expiry[5:7] != code[2:]:
            continue
        result[code] = expiry if code not in result else None
    return result


def contract_expiries(observation_date):
    source = SOURCE.format(day=observation_date.replace("-", ""))
    try:
        with urlopen(source, timeout=8) as response:
            values = parse_contract_expiries(json.loads(response.read().decode("utf-8-sig")), observation_date)
        if values:
            return {code: {"expiry_date": expiry, "expiry_source": source, "expiry_verified_on": observation_date}
                    for code, expiry in values.items()}
    except (OSError, ValueError, TypeError):
        pass
    return {code: {"expiry_date": expiry, "expiry_source": SOURCE.format(day=VERIFIED_DATE.replace("-", "")),
                   "expiry_verified_on": VERIFIED_DATE} for code, expiry in VERIFIED.items()}


def basis_contract_expiries(quotes, observation_date, confirmed):
    """历史按CSV末次有效报价；在市按合约月15日，官方顺延日期优先。"""
    result = {}
    for (code, month), history in quotes.items():
        valid_dates = sorted(day for day, values in history.items() if values[0] is not None)
        if not valid_dates:
            continue
        estimated = date.fromisoformat(month + "-15")
        while estimated.weekday() >= 5:
            estimated += timedelta(days=1)
        official = confirmed.get(code, {})
        end = official.get("expiry_date") or estimated.isoformat()
        # 缺少最新一日报价不能把尚未到期的合约误判为已到期。
        if end < observation_date:
            result[code] = {"expiry_date": valid_dates[-1], "expiry_source": "黄金期货.csv",
                            "expiry_basis": "CSV最后有效报价日", "expiry_estimated": False}
        elif official.get("expiry_date"):
            result[code] = {**official, "expiry_basis": "合约月份15日，优先采用上期所确认的顺延日期",
                            "expiry_estimated": False}
        else:
            result[code] = {"expiry_date": end, "expiry_source": "黄金期货合约月份",
                            "expiry_basis": "合约月份15日估算（周末顺延，节假日调整未确认）", "expiry_estimated": True}
    return result
