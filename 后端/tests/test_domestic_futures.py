"""逐条核对正式CSV及换约边界，不写数据副本。"""
import unittest

import pandas as pd

from config import DATA_DIR
from data_loader import Table
from domestic_futures import (DOMESTIC_SOURCE, OVERSEAS_SOURCE, GRAMS_PER_TROY_OUNCE,
                              add_domestic_futures, continuous_futures_rows)
from indicators import Builder


class DomesticFuturesData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.domestic = pd.read_csv(DATA_DIR / DOMESTIC_SOURCE)
        cls.overseas = pd.read_csv(DATA_DIR / OVERSEAS_SOURCE)
        cls.rows = continuous_futures_rows(cls.domestic, cls.overseas)

    def test_all_selected_prices_and_spreads_match_same_date_and_contract(self):
        local = self.domestic.set_index(["时间", "合约", "交割月份"])
        foreign = self.overseas.set_index(["日期", "合约", "到期期限"])
        self.assertTrue(self.rows)
        for row in self.rows:
            self.assertEqual(row["时间"] >= self.rows[0]["时间"], True)
            if row["contract"] is None:
                self.assertIsNone(row["close"])
                self.assertIsNone(row["spread"])
                continue
            key = (row["时间"], row["contract"], row["expiry"])
            self.assertEqual(row["close"], local.loc[key, "收盘价（元/克）"] if key in local.index else None)
            if key not in foreign.index:
                self.assertIsNone(row["spread"])
                continue
            gold = foreign.loc[key, "黄金期货价格"]
            fx = foreign.loc[key, "USDCNH期货价格"]
            if row["close"] is None:
                self.assertIsNone(row["spread"])
            else:
                self.assertAlmostEqual(row["spread"], row["close"] - gold * fx / GRAMS_PER_TROY_OUNCE, places=10)
        self.assertEqual(self.rows[-1]["时间"], self.domestic["时间"].max())

    def test_rollover_holds_through_last_joint_quote_and_never_returns_to_old_contract(self):
        joint = self.domestic.merge(self.overseas, left_on=["时间", "合约", "交割月份"], right_on=["日期", "合约", "到期期限"])
        last = joint.groupby(["合约", "交割月份"])["时间"].max().to_dict()
        previous = None
        for row in self.rows:
            if not row["contract"]:
                continue
            self.assertLessEqual(row["时间"], last[(row["contract"], row["expiry"])])
            if previous and row["contract"] != previous["contract"]:
                self.assertGreater(row["expiry"], previous["expiry"])
                self.assertEqual(previous["时间"], last[(previous["contract"], previous["expiry"])])
                self.assertEqual(row["rollover_from"], previous["contract"])
            previous = row

    def test_missing_or_duplicate_inputs_do_not_select_another_month_or_fill_values(self):
        row = next(r for i, r in enumerate(self.rows[1:-1], 1) if r["spread"] is not None
                   and self.rows[i - 1]["contract"] == r["contract"] == self.rows[i + 1]["contract"])
        mask = (self.overseas["日期"] == row["时间"]) & (self.overseas["合约"] == row["contract"])
        for column in ["黄金期货价格", "USDCNH期货价格"]:
            damaged = self.overseas.copy()
            damaged.loc[mask, column] = float("nan")
            point = next(p for p in continuous_futures_rows(self.domestic, damaged) if p["时间"] == row["时间"])
            self.assertEqual(point["contract"], row["contract"])
            self.assertEqual(point["close"], row["close"])
            self.assertIsNone(point["spread"])
        duplicated = pd.concat([self.overseas, self.overseas.loc[mask]], ignore_index=True)
        point = next(p for p in continuous_futures_rows(self.domestic, duplicated) if p["时间"] == row["时间"])
        self.assertEqual(point["contract"], row["contract"])
        self.assertIsNone(point["spread"])
        local_mask = (self.domestic["时间"] == row["时间"]) & (self.domestic["合约"] == row["contract"])
        duplicated = pd.concat([self.domestic, self.domestic.loc[local_mask]], ignore_index=True)
        point = next(p for p in continuous_futures_rows(duplicated, self.overseas) if p["时间"] == row["时间"])
        self.assertEqual(point["contract"], row["contract"])
        self.assertIsNone(point["close"])
        self.assertIsNone(point["spread"])

    def test_no_shared_contract_or_missing_source_produces_explicit_missing_indicators(self):
        self.assertEqual(continuous_futures_rows(self.domestic, self.overseas.iloc[:0]), [])
        tables = {(DOMESTIC_SOURCE, None): Table(DOMESTIC_SOURCE, None, self.domestic, None)}
        builder = Builder(tables)
        add_domestic_futures(builder)
        self.assertEqual(len(builder.groups["price"]), 3)
        for item in builder.groups["price"]:
            self.assertEqual(item["history"], [])
            self.assertEqual(item["metadata"]["status"], "数据缺失")
            self.assertIsNone(item["metadata"]["release_date"])
            self.assertIn(OVERSEAS_SOURCE, item["metadata"]["input_sources"])


if __name__ == "__main__":
    unittest.main()
