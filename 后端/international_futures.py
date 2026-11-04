"""按原始到期合约保存境外黄金与汇率期货，不合成主力或复权价格。"""
import re

import pandas as pd

SOURCE = "COMEX黄金与汇率期货_北京时间15收盘价.csv"
PRODUCTS = (
    ("comex", "COMEX黄金期货", "黄金期货价格", "美元/金衡盎司", "CME 芝商所", 2),
    ("sgx_usdcnh", "美元兑离岸人民币期货", "USDCNH期货价格", "CNH/美元", "SGX 新加坡交易所", 4),
)


def add_international_futures(builder):
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
