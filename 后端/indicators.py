"""使用已核对的真实表头映射指标，保持来源单位和频率。"""
import hashlib
import math
import re
from datetime import datetime

import pandas as pd

from config import LAG_DAYS, LOCAL_TIMEZONE
from data_loader import parse_dates
from comex import add_comex_indicators
from price import add_price_indicators
from international_price import add_international_price_indicators

CATEGORIES = ("central-bank", "etf", "inventory", "futures", "cftc", "au-td", "price")


def scalar(value):
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


class Builder:
    def __init__(self, tables):
        self.tables = tables
        self.groups = {category: [] for category in CATEGORIES}

    def add(self, category, indicator_id, name, unit, frequency, source, sheet=None,
            column=None, values=None, frame=None, warnings=None, missing_fields=None, **extra):
        table = self.tables.get((source, sheet))
        notes = list(warnings or [])
        missing = list(missing_fields or [])
        data = frame if frame is not None else table.frame if table else pd.DataFrame()
        date_col = next((c for c in ("时间", "日期") if c in data.columns), None)
        if table is None:
            missing.append("source_table")
        if date_col is None:
            missing.append("observation_date")
        if column is not None and column not in data.columns:
            missing.append(column)
        if unit in ("未提供", "未确认"):
            missing.append("unit")
        if frequency == "未提供":
            missing.append("frequency")
        history = []
        if date_col is not None:
            dates = parse_dates(data[date_col])
            if values is None:
                values = data[column] if column in data.columns else [None] * len(data)
            for raw_date, date, value in zip(data[date_col], dates, values):
                if pd.isna(date):
                    continue
                # YYYY-MM 保持月度标签；工作簿的月末观察日保留原值。
                observation = str(raw_date) if re.fullmatch(r"\d{4}-\d{2}", str(raw_date)) else date.strftime("%Y-%m-%d")
                history.append({"observation_date": observation, "release_date": None, "value": scalar(value)})
            history.sort(key=lambda row: row["observation_date"])
            counts = pd.Series([row["observation_date"] for row in history], dtype="str").value_counts()
            duplicates = counts[counts > 1].index.tolist()
            if duplicates:
                # 不随意选择重复日期记录；冲突值置空并明确提示。
                unique = {row["observation_date"]: row for row in history}
                for date in duplicates:
                    unique[date] = {"observation_date": date, "release_date": None, "value": None}
                history = [unique[key] for key in sorted(unique)]
                notes.append(f"{len(duplicates)} 个日期存在重复记录，冲突值置空")
        latest = history[-1] if history else {"observation_date": None, "release_date": None, "value": None}
        valid = [row for row in history if row["value"] is not None]
        status = "数据缺失" if not valid else "仅最新值" if len(history) == 1 else "短历史" if len(history) < 90 else "正常"
        statuses = [status]
        lag = None
        if latest["observation_date"]:
            observed = pd.Timestamp(latest["observation_date"])
            if len(latest["observation_date"]) == 7:
                observed = observed + pd.offsets.MonthEnd(0)
            lag = max(0, (datetime.now(LOCAL_TIMEZONE).date() - observed.date()).days)
            if frequency in LAG_DAYS and lag > LAG_DAYS[frequency]:
                statuses.append("滞后")
                if status == "正常":
                    status = "滞后"
                    statuses.remove("正常")
        null_count = len(history) - len(valid)
        if null_count:
            notes.append(f"{null_count} 条记录缺失；空值保持 null，不按零处理")
        if history and latest["value"] is None:
            status = "数据缺失"
            if status not in statuses:
                statuses.append(status)
        if len(history) == 1:
            notes.append("仅最新值，无可用历史趋势")
        elif 0 < len(history) < 90:
            notes.append("少于 90 条记录，标记为短历史")
        if dates_invalid := (int(parse_dates(data[date_col]).isna().sum()) if date_col else 0):
            notes.append(f"{dates_invalid} 条记录观察日期无法解析，未进入历史")
        missing.extend(["release_date", "automation_status"])
        metadata = {
            "indicator_id": indicator_id, "indicator_name": name, "unit": unit,
            "frequency": frequency, "source": source, "sheet": sheet,
            "source_column": column, "updated_at": table.updated_at if table else None,
            "coverage_start": history[0]["observation_date"] if history else None,
            "coverage_end": history[-1]["observation_date"] if history else None,
            "record_count": len(history), "valid_count": len(valid), "missing_count": null_count,
            "status": status, "statuses": list(dict.fromkeys(statuses)), "delay_days": lag,
            "delay_threshold_days": LAG_DAYS.get(frequency), "automation_status": "未确认",
            "release_date": None, **extra,
        }
        latest_full = {**metadata, **latest}
        previous = history[-2] if len(history) > 1 else None
        latest_full["change"] = (latest["value"] - previous["value"]
                                  if previous and isinstance(latest["value"], (int, float))
                                  and isinstance(previous["value"], (int, float)) else None)
        item = {"metadata": metadata, "history": history, "latest": latest_full,
                "latest_available": valid[-1] if valid else None,
                "warnings": list(dict.fromkeys(notes + ["原始表未提供发布日期；数据采集自动化程度未确认"])),
                "missing_fields": list(dict.fromkeys(missing))}
        self.groups[category].append(item)
        return item

    def columns(self, category, source, sheet, frequency, specs, **extra):
        for indicator_id, name, column, unit in specs:
            self.add(category, indicator_id, name, unit, frequency, source, sheet, column=column, **extra)


def strict_sum(frame, columns):
    # 任一组成项为空时总量为空，不把部分覆盖误标为合计。
    if any(column not in frame.columns for column in columns):
        return [None] * len(frame)
    numeric = frame[columns].apply(pd.to_numeric, errors="coerce")
    return numeric.sum(axis=1, min_count=len(columns))


def build_indicators(tables):
    b = Builder(tables)
    add_price_indicators(b)
    add_international_price_indicators(b)
    b.columns("au-td", "AuTD.csv", None, "日度", [
        ("au_td_open_interest", "Au(T+D) 持仓量", "持仓量（吨）", "吨"),
        ("au_td_volume", "Au(T+D) 成交量", "交易量（吨）", "吨"),
        ("au_td_delivery_direction", "Au(T+D) 交收方向", "交收方向", "文本"),
    ])
    b.columns("cftc", "CFTC黄金非商业持仓量.csv", None, "周度", [
        ("cftc_total", "CFTC 市场总持仓", "市场总持仓（吨）", "吨"),
        ("cftc_long", "CFTC 非商业多头持仓", "非商业多头持仓（吨）", "吨"),
        ("cftc_short", "CFTC 非商业空头持仓", "非商业空头持仓（吨）", "吨"),
        ("cftc_net_long", "CFTC 非商业净多头持仓", "非商业净多头持仓（吨）", "吨"),
        ("cftc_long_ratio", "CFTC 非商业多头占比", "非商业多头占比", "比例（0–1）"),
        ("cftc_short_ratio", "CFTC 非商业空头占比", "非商业空头占比", "比例（0–1）"),
        ("cftc_net_long_ratio", "CFTC 非商业净多头占比", "非商业净多头占比", "比例（0–1）"),
    ], warnings=["按周度指标标识；早期原始日期并非严格每 7 天，不重采样或补点；持仓单位直接采用原表的吨"])
    b.columns("cftc", "CFTC黄金交易量和持仓量.csv", None, "日度", [
        ("cftc_trading_volume", "黄金交易量（CFTC 文件）", "交易量（吨）", "吨"),
        ("cftc_trading_open_interest", "黄金持仓量（CFTC 文件）", "持仓量（吨）", "吨"),
    ], warnings=["日度依据原始日期间隔判断；具体交易场所、发布机制未提供，不与 CFTC 周度持仓混用"])
    b.columns("inventory", "伦敦金银库存.xlsx", "伦敦金银库存", "月度", [
        ("london_gold", "伦敦黄金库存", "黄金库存（吨）", "吨"),
        ("london_silver", "伦敦白银库存", "白银库存（吨）", "吨"),
    ])
    add_comex_indicators(b)
    b.columns("etf", "SPDR黄金ETF份额.xlsx", "SPDR黄金ETF行情", "日度", [
        ("spdr_gold_holdings", "SPDR 黄金持仓", "总持有黄金数（吨）", "吨"),
        ("spdr_close", "SPDR ETF 收盘价", "收盘价（美元/份）", "美元/份"),
        ("spdr_gold_per_share", "SPDR 每份黄金量", "每份黄金量（吨/份）", "吨/份"),
        ("spdr_volume", "SPDR 成交量", "成交量", "未提供"),
        ("spdr_shares", "SPDR 份额", "份额", "未提供"),
    ], warnings=["SPDR ETF 收盘价不是黄金现货价格；成交量与份额字段未注明单位"])
    domestic = tables.get(("黄金ETF份额.xlsx", "份额净值及资产规模"))
    funds = [("华安", "518880"), ("博时", "159937"), ("易方达", "159934"),
             ("国泰", "518800"), ("华夏", "518850"), ("工银", "518660"), ("前海开源", "159812")]
    asset_columns = []
    for fund, code in funds:
        prefix = f"{fund}{code}\n"
        asset_column = prefix + "总资产规模（亿元，净资产口径）"
        asset_columns.append(asset_column)
        b.columns("etf", "黄金ETF份额.xlsx", "份额净值及资产规模", "日度", [
            (f"domestic_{code}_shares", f"{fund}{code} 份额", prefix + "份额（万份）", "万份"),
            (f"domestic_{code}_nav", f"{fund}{code} 单位净值", prefix + "单位净值（元/份）", "元/份"),
            (f"domestic_{code}_assets", f"{fund}{code} 资产规模", asset_column, "亿元"),
        ], fund=fund + code)
    b.add("etf", "domestic_etf_total_assets", "境内 7 只黄金 ETF 总资产规模", "亿元", "日度",
          "黄金ETF份额.xlsx", "份额净值及资产规模",
          values=strict_sum(domestic.frame, asset_columns) if domestic else None,
          warnings=["仅覆盖表中 7 只基金；任一基金当日规模缺失时合计为空"],
          calculation="同日七只基金原始资产规模之和", component_columns=asset_columns)
    for sheet, frequency, suffix in [("周度数据", "周度", "weekly"), ("月度数据", "月度", "monthly")]:
        flow = tables.get(("全球黄金ETF流量.xlsx", sheet))
        for region_id, region in [("north_america", "北美"), ("europe", "欧洲"), ("asia", "亚洲"), ("other", "其他")]:
            b.columns("etf", "全球黄金ETF流量.xlsx", sheet, frequency, [
                (f"global_etf_{suffix}_{region_id}_tonnes", f"全球 ETF {region}净流量", region + "（吨）", "吨"),
                (f"global_etf_{suffix}_{region_id}_usd", f"全球 ETF {region}资金流", region + "资金流（美元）", "美元"),
            ], region=region)
        for metric, unit, columns in [
            ("tonnes", "吨", [region + "（吨）" for region in ("北美", "欧洲", "亚洲", "其他")]),
            ("usd", "美元", [region + "资金流（美元）" for region in ("北美", "欧洲", "亚洲", "其他")]),
        ]:
            b.add("etf", f"global_etf_{suffix}_total_{metric}", f"全球黄金 ETF {frequency}净流量合计", unit,
                  frequency, "全球黄金ETF流量.xlsx", sheet,
                  values=strict_sum(flow.frame, columns) if flow else None,
                  calculation="四地区同观察期合计，组成项缺失则合计为空", component_columns=columns)
        b.add("etf", f"gold_reference_{suffix}", "ETF 流量表内金价参考", "美元（计价基准未提供）",
              frequency, "全球黄金ETF流量.xlsx", sheet, column="金价（美元）",
              warnings=["原始表未提供每盎司等计价基准和定价口径；不得用作日度现货价格"],
              missing_fields=["price_basis"])
    b.columns("central-bank", "央行购金.xlsx", "央行黄金储备", "月度", [
        ("central_bank_reserves", "央行黄金储备", "储量（吨）", "吨"),
        ("central_bank_reserve_value", "央行黄金储备市值", "市值（亿美元）", "亿美元"),
    ], warnings=["工作表未明确国家或机构名称，不据文件名认定为中国或全球汇总"], missing_fields=["institution"])
    countries = tables.get(("全球央行购金.csv", None))
    country_columns = list(countries.frame.columns.drop("时间")) if countries and "时间" in countries.frame else []
    for country in country_columns:
        slug = re.sub(r"[^a-z0-9]+", "_", country.lower()).strip("_")
        suffix = hashlib.sha1(country.encode("utf-8")).hexdigest()[:8]
        b.add("central-bank", f"central_bank_country_{slug}_{suffix}", f"{country} 月度购金（原始值）",
              "未提供", "月度", "全球央行购金.csv", column=country,
              warnings=["原始表未注明单位；空值表示缺失或未披露。区域汇总和不同口径列不相加"],
              missing_fields=["unit"], country=country, entity_type="区域汇总" if country == "Euro Area" else "原始实体列")
    b.add("central-bank", "global_central_bank_net_purchases", "全球央行月度净购金", "未确认", "月度",
          "全球央行购金.csv", values=[None] * len(countries.frame) if countries else None,
          warnings=["数据暂缺：未提供全球总计与单位，且含 Euro Area、Turkey* 与 Turkey 等可能重叠口径，不能直接按列相加"],
          missing_fields=["global_total", "unit", "aggregation_scope"])
    futures = tables.get(("黄金期货.csv", None))
    required = ["时间", "合约", "持仓量（吨）", "交易量（吨）"]
    aggregate = pd.DataFrame(columns=["时间", "持仓量（吨）", "交易量（吨）"])
    leading = pd.DataFrame(columns=["时间", "主力合约"])
    ties = 0
    if futures and all(column in futures.frame for column in required):
        frame = futures.frame.copy()
        frame["时间"] = parse_dates(frame["时间"])
        frame = frame.dropna(subset=["时间"])
        totals, main = [], []
        for date, group in frame.groupby("时间", sort=True):
            row = {"时间": date}
            duplicate_contracts = group["合约"].isna().any() or group["合约"].duplicated().any()
            for column in ("持仓量（吨）", "交易量（吨）"):
                values = pd.to_numeric(group[column], errors="coerce")
                row[column] = None if duplicate_contracts or values.isna().any() else values.sum()
            totals.append(row)
            volume = pd.to_numeric(group["交易量（吨）"], errors="coerce")
            winners = group.loc[volume == volume.max(), "合约"].dropna().astype(str).tolist()
            ties += int(len(winners) > 1)
            main.append({"时间": date, "主力合约": "、".join(sorted(winners)) if winners and not volume.isna().any() and not duplicate_contracts else None})
        if totals:
            aggregate, leading = pd.DataFrame(totals), pd.DataFrame(main)
    for key, name, column in [("futures_volume", "黄金期货总成交量", "交易量（吨）"), ("futures_open_interest", "黄金期货总持仓量", "持仓量（吨）")]:
        b.add("futures", key, name, "吨", "日度", "黄金期货.csv", column=column,
              frame=aggregate, warnings=["按日期汇总当日表内合约；任一组成项缺失或合约重复时当日合计为空"],
              calculation="原始表内同日期合约求和")
    b.add("futures", "futures_main_contract", "黄金期货主力合约", "合约代码", "日度", "黄金期货.csv",
          column="主力合约", frame=leading,
          warnings=[f"按当日成交量最高确定主力；{ties} 个日期成交量并列时返回全部并列合约；不以持仓量替代成交量"])
    return b.groups
