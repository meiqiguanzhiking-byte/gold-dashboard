"""只读上期所合约参数中的EXPIREDATE，不用交割月份猜测最后交易日。"""
import json
import re
from datetime import date
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
