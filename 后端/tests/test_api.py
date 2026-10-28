"""真实文件与本地 HTTP 接口的只读检查，无模拟数据或磁盘输出。"""
import json
import os
import unittest
from datetime import datetime
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

from config import DATA_DIR, LOCAL_TIMEZONE
from data_loader import load_tables, parse_dates
from central_banks import read_reported_months
from config import CENTRAL_BANK_CHANGES_FILE

BASE = os.environ.get("GOLD_API_URL", "http://127.0.0.1:8000").rstrip("/")


def request(path, method="GET", origin=None):
    headers = {"Origin": origin} if origin else {}
    with urlopen(Request(BASE + path, method=method, headers=headers), timeout=30) as response:
        body = response.read()
        def reject_constant(value):
            raise AssertionError(f"非标准 JSON 数字: {value}")
        return json.loads(body, parse_constant=reject_constant), response.headers


class RealDataAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, cls.files, cls.warnings = load_tables(DATA_DIR)
        cls.responses = {category: request("/api/" + category)[0] for category in
                         ("central-bank", "etf", "inventory", "futures", "cftc", "au-td", "price")}
        cls.items = {item["metadata"]["indicator_id"]: item for response in cls.responses.values() for item in response["indicators"]}

    def test_all_routes_and_schema(self):
        health, _ = request("/api/health")
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["read_errors"], [])
        self.assertEqual(len(self.items), sum(len(r["indicators"]) for r in self.responses.values()))
        for item in self.items.values():
            self.assertTrue({"metadata", "history", "latest", "warnings", "missing_fields"}.issubset(item))
            self.assertTrue({"indicator_id", "indicator_name", "unit", "frequency", "source", "updated_at", "status", "coverage_start", "coverage_end"}.issubset(item["metadata"]))
            self.assertIsNone(item["latest"]["release_date"])
            self.assertEqual(item["metadata"]["automation_status"], "未确认")
        docs, _ = request("/openapi.json")
        self.assertIn("post", docs["paths"]["/api/reload"])

    def test_cftc_raw_columns_and_units(self):
        frame = self.tables[("CFTC黄金非商业持仓量.csv", None)].frame
        for key, column in [("cftc_long", "非商业多头持仓（吨）"), ("cftc_short", "非商业空头持仓（吨）"), ("cftc_net_long", "非商业净多头持仓（吨）")]:
            item = self.items[key]
            self.assertEqual(item["metadata"]["unit"], "吨")
            self.assertEqual(item["metadata"]["frequency"], "周度")
            self.assertAlmostEqual(item["latest"]["value"], frame.iloc[-1][column])
        self.assertAlmostEqual(self.items["cftc_long"]["latest"]["value"] - self.items["cftc_short"]["latest"]["value"], self.items["cftc_net_long"]["latest"]["value"])

    def test_futures_aggregation_and_main_contract_all_dates(self):
        frame = self.tables[("黄金期货.csv", None)].frame.copy()
        frame["时间"] = parse_dates(frame["时间"])
        indexed = {key: {point["observation_date"]: point["value"] for point in self.items[key]["history"]} for key in ("futures_volume", "futures_open_interest", "futures_main_contract")}
        for date, group in frame.groupby("时间"):
            day = date.strftime("%Y-%m-%d")
            self.assertAlmostEqual(indexed["futures_volume"][day], group["交易量（吨）"].sum())
            self.assertAlmostEqual(indexed["futures_open_interest"][day], group["持仓量（吨）"].sum())
            winners = group.loc[group["交易量（吨）"] == group["交易量（吨）"].max(), "合约"].astype(str).tolist()
            self.assertEqual(indexed["futures_main_contract"][day], "、".join(sorted(winners)))

    def test_etf_totals_and_frequency(self):
        frame = self.tables[("黄金ETF份额.xlsx", "份额净值及资产规模")].frame
        columns = [c for c in frame if c.endswith("总资产规模（亿元，净资产口径）")]
        self.assertEqual(len(columns), 7)
        expected = frame[columns].sum(axis=1, min_count=7)
        actual = self.items["domestic_etf_total_assets"]["history"]
        self.assertEqual(len(actual), len(expected))
        for row, value in zip(actual, expected):
            if pd.isna(value):
                self.assertIsNone(row["value"])
            else:
                self.assertAlmostEqual(row["value"], value)
        share_columns = [c for c in frame if c.endswith("份额（万份）")]
        self.assertEqual(len(share_columns), 7)
        share_expected = frame[share_columns].sum(axis=1, min_count=7)
        for row, value in zip(self.items['domestic_etf_total_shares']['history'], share_expected):
            if pd.isna(value):
                self.assertIsNone(row['value'])
            else:
                self.assertAlmostEqual(row['value'], value)
        self.assertEqual(self.items['domestic_etf_total_shares']['metadata']['unit'], '万份')
        self.assertTrue(all(p['value'] is None for p in self.items['au_td_close']['history']))
        weekly = self.tables[("全球黄金ETF流量.xlsx", "周度数据")].frame
        self.assertAlmostEqual(self.items["global_etf_weekly_total_tonnes"]["latest"]["value"], weekly.iloc[-1][["北美（吨）", "欧洲（吨）", "亚洲（吨）", "其他（吨）"]].sum())
        weekly_response, _ = request("/api/etf?" + urlencode({"frequency": "周度", "include_history": "false"}))
        self.assertTrue(weekly_response["indicators"])
        self.assertTrue(all(item["metadata"]["frequency"] == "周度" and not item["history"] for item in weekly_response["indicators"]))

    def test_missing_and_limited_history(self):
        frame = self.tables[("全球央行购金.csv", None)].frame
        reported, _ = read_reported_months(CENTRAL_BANK_CHANGES_FILE)
        for item in self.responses["central-bank"]["indicators"]:
            country = item["metadata"].get("country")
            if not country:
                continue
            self.assertEqual(len(item["history"]), len(frame))
            for month, point in zip(frame['时间'], item["history"]):
                raw = reported[str(month)[:7]][country]
                if raw is None:
                    self.assertIsNone(point["value"])
                else:
                    self.assertEqual(point["value"], raw)
        self.assertIsNotNone(self.items["global_central_bank_net_purchases"]["latest"]["value"])
        self.assertEqual(self.items["gold_price_anchor"]["metadata"]["unit"], "元/克")
        for item in self.responses["inventory"]["indicators"]:
            if item["metadata"]["indicator_id"].startswith("comex_"):
                frame = self.tables[("COMEX金银库存.xlsx", "COMEX金银库存")].frame
                self.assertEqual(len(item["history"]), len(frame))
                if len(frame) > 1:
                    self.assertNotEqual(item["metadata"]["status"], "仅最新值")
        self.assertIn("短历史", self.items["cftc_trading_volume"]["metadata"]["statuses"])

    def test_metadata_file_timestamps_and_query_errors(self):
        meta, _ = request("/api/meta")
        self.assertEqual(len(meta["files"]), len(self.files))
        for item in meta["files"]:
            expected = datetime.fromtimestamp((DATA_DIR / item["source"]).stat().st_mtime, LOCAL_TIMEZONE).isoformat(timespec="seconds")
            self.assertEqual(item["updated_at"], expected)
        for path, status in [("/api/cftc?indicator_id=absent", 404), ("/api/etf?start_date=2026-10-22&end_date=2020-01-01", 422)]:
            with self.assertRaises(HTTPError) as error:
                request(path)
            self.assertEqual(error.exception.code, status)

    def test_comex_tonnes_all_fields_all_dates_and_reconciliation(self):
        frame = self.tables[("COMEX金银库存.xlsx", "COMEX金银库存")].frame.copy()
        frame["时间"] = parse_dates(frame["时间"])
        frame = frame.sort_values("时间")
        comex = [item for item in self.responses["inventory"]["indicators"] if item["metadata"]["indicator_id"].startswith("comex_")]
        self.assertEqual(len(comex), 7)
        for item in comex:
            meta = item["metadata"]
            self.assertEqual(meta["unit"], "吨")
            self.assertEqual(meta["sheet"], "COMEX金银库存")
            self.assertEqual(meta["frequency"], "日度")
            self.assertEqual(meta["valid_count"], len(frame))
            for point, (_, raw) in zip(item["history"], frame.iterrows()):
                self.assertEqual(point["observation_date"], raw["时间"].strftime("%Y-%m-%d"))
                self.assertAlmostEqual(point["value"], raw[meta["source_column"]])
            self.assertEqual(item["latest_available"], item["history"][-1])
        summary = self.responses["inventory"]["comex"]
        meta, _ = request("/api/meta")
        self.assertEqual(summary, meta["comex"])
        self.assertEqual(summary["raw_record_count"], len(frame))
        self.assertEqual(summary["duplicate_date_count"], 0)
        self.assertFalse(summary["definition"]["confirmed"])
        for metal, name in (("gold", "黄金"), ("silver", "白银")):
            self.assertEqual(summary["metals"][metal]["total_check_status"], "通过")
            for _, row in frame.iterrows():
                self.assertAlmostEqual(row[name + "注册库存（吨）"] + row[name + "合格库存（吨）"], row[name + "总库存（吨）"])
        self.assertNotIn("comex_silver_pledged", self.items)
        self.assertNotIn("comex_gold_unpledged", self.items)

    def test_cors_cache_and_reload(self):
        _, headers = request("/api/health", origin="http://localhost:5173")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://localhost:5173")
        before, _ = request("/api/health")
        again, _ = request("/api/health")
        self.assertEqual(before["loaded_at"], again["loaded_at"])
        result, _ = request("/api/reload", method="POST")
        self.assertEqual(result["status"], "ok")
        after, _ = request("/api/health")
        self.assertEqual(after["loaded_at"], result["loaded_at"])
        self.assertNotEqual(before["loaded_at"], after["loaded_at"])
        self.assertEqual(before["indicator_count"], after["indicator_count"])


if __name__ == "__main__":
    unittest.main()
