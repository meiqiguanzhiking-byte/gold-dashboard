"""逐条核对正式CSV及换约边界，不写数据副本。"""
import unittest
import json

import pandas as pd

from config import DATA_DIR
from data_loader import Table
from domestic_futures import (DOMESTIC_SOURCE, OVERSEAS_SOURCE, GRAMS_PER_TROY_OUNCE,
                              add_domestic_futures, continuous_futures_rows, spread_curve_rows)
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
            self.assertEqual(row["raw_close"], local.loc[key, "收盘价（元/克）"] if key in local.index else None)
            self.assertEqual(row["close"], row["raw_close"])
            self.assertEqual(int(row["expiry"][-2:]) % 2, 0)
            if key not in foreign.index:
                self.assertIsNone(row["spread"])
                continue
            gold = foreign.loc[key, "黄金期货价格"]
            fx = foreign.loc[key, "USDCNH期货价格"]
            if row["raw_close"] is None or pd.isna(gold) or pd.isna(fx):
                self.assertIsNone(row["spread"])
            else:
                self.assertAlmostEqual(row["spread"], row["raw_close"] - gold * fx / GRAMS_PER_TROY_OUNCE, places=10)
        self.assertEqual(self.rows[-1]["时间"], self.domestic["时间"].max())

    def test_nearest_even_contract_preserves_original_prices(self):
        last = self.domestic.groupby(["合约", "交割月份"])["时间"].max().to_dict()
        local = self.domestic.set_index(["时间", "合约", "交割月份"])
        previous = None
        for row in self.rows:
            if not row["contract"]:
                continue
            key = (row["contract"], row["expiry"])
            candidates = [expiry for (contract, expiry), end in last.items()
                          if int(expiry[-2:]) % 2 == 0 and expiry >= row["时间"][:7] and end >= row["时间"]
                          and (row["时间"], contract, expiry) in local.index]
            self.assertEqual(row["expiry"], min(candidates))
            if previous and row["contract"] != previous["contract"]:
                self.assertGreater(row["expiry"], previous["expiry"])
                boundary = last[(previous["contract"], previous["expiry"])]
                self.assertEqual(previous["时间"], boundary)
                self.assertEqual(row["rollover_from"], previous["contract"])
            self.assertEqual(row["close"], row["raw_close"])
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

    def test_missing_overseas_keeps_domestic_price_but_not_spread(self):
        rows = continuous_futures_rows(self.domestic, self.overseas.iloc[:0])
        self.assertEqual([r["close"] for r in rows], [r["close"] for r in self.rows])
        self.assertTrue(all(r["spread"] is None for r in rows))
        tables = {(DOMESTIC_SOURCE, None): Table(DOMESTIC_SOURCE, None, self.domestic, None)}
        builder = Builder(tables)
        add_domestic_futures(builder)
        self.assertEqual(len(builder.groups["price"]), 6)
        indicators = {item["metadata"]["indicator_id"]: item for item in builder.groups["price"]}
        self.assertIsNotNone(indicators["gold_futures_close"]["latest"]["value"])
        self.assertIsNone(indicators["gold_futures_spread"]["latest"]["value"])
        self.assertIsNone(indicators["gold_futures_secondary_spread"]["latest"]["value"])
        self.assertIsNone(builder.groups["price"][0]["metadata"]["release_date"])
        builder = Builder({})
        add_domestic_futures(builder)
        self.assertTrue(all(item["history"] == [] for item in builder.groups["price"]))

    def test_daily_quotes_preserve_all_contracts_and_same_contract_comparison(self):
        builder = Builder({(DOMESTIC_SOURCE, None): Table(DOMESTIC_SOURCE, None, self.domestic, None)})
        add_domestic_futures(builder)
        series = next(item for item in builder.groups["price"] if item["metadata"]["indicator_id"] == "gold_futures_daily_quotes")
        for point in series["history"][-30:]:
            detail = json.loads(point["value"])
            original = self.domestic[self.domestic["时间"] == point["observation_date"]]
            self.assertEqual({quote["contract"] for quote in detail["quotes"]}, set(original["合约"]))
            for quote in detail["quotes"]:
                current = original[original["合约"] == quote["contract"]]["收盘价（元/克）"].iloc[0]
                self.assertEqual(quote["close"], current if pd.notna(current) else None)
                previous = self.domestic[(self.domestic["时间"] == quote["previous_date"]) & (self.domestic["合约"] == quote["contract"])]["收盘价（元/克）"]
                self.assertEqual(quote["previous_close"], previous.iloc[0] if len(previous) and pd.notna(previous.iloc[0]) else None)

    def test_missing_prior_new_contract_quote_does_not_block_unadjusted_roll(self):
        switch = next(i for i, row in enumerate(self.rows) if row["rollover_from"])
        before, after = self.rows[switch - 1], self.rows[switch]
        damaged = self.domestic.copy()
        mask = (damaged["时间"] == before["时间"]) & (damaged["合约"] == after["contract"])
        damaged.loc[mask, "收盘价（元/克）"] = float("nan")
        rows = continuous_futures_rows(damaged, self.overseas)
        self.assertEqual(rows[0]["close"], rows[0]["raw_close"])
        self.assertEqual(rows[switch]["contract"], after["contract"])
        self.assertEqual(rows[switch]["close"], after["raw_close"])
        self.assertEqual(rows[switch]["spread"], after["spread"])

    def test_main_and_secondary_spreads_match_same_date_and_month_raw_quotes(self):
        rows = spread_curve_rows(self.domestic, self.overseas)
        local = self.domestic.set_index(["时间", "合约", "交割月份"])
        foreign = self.overseas.set_index(["日期", "合约", "到期期限"])
        self.assertEqual([row["时间"] for row in rows], sorted(self.overseas["日期"].unique()))
        self.assertTrue(any(row["main_raw_spread"] is None and row["secondary_raw_spread"] is not None for row in rows))
        for row in rows:
            for rank in ("main", "secondary"):
                contract = row[f"{rank}_contract"]
                if contract is None:
                    self.assertIsNone(row[f"{rank}_spread"])
                    continue
                expiry = row[f"{rank}_expiry"]
                self.assertEqual(int(expiry[-2:]) % 2, 0)
                key = (row["时间"], contract, expiry)
                raw = None
                if key in local.index and key in foreign.index:
                    domestic_price = local.loc[key, "收盘价（元/克）"]
                    gold = foreign.loc[key, "黄金期货价格"]
                    fx = foreign.loc[key, "USDCNH期货价格"]
                    if pd.notna(domestic_price) and pd.notna(gold) and pd.notna(fx):
                        raw = domestic_price - gold * fx / GRAMS_PER_TROY_OUNCE
                if raw is None:
                    self.assertIsNone(row[f"{rank}_raw_spread"])
                    self.assertIsNone(row[f"{rank}_spread"])
                else:
                    self.assertAlmostEqual(row[f"{rank}_raw_spread"], raw, places=10)
                    self.assertAlmostEqual(row[f"{rank}_spread"], raw, places=10)
            if row["main_expiry"] and row["secondary_expiry"]:
                self.assertLess(row["main_expiry"], row["secondary_expiry"])

    def test_right_join_keeps_foreign_only_date_null_without_date_shift(self):
        local = pd.DataFrame([
            ("2026-01-29", "au2602", "2026-02", 100),
            ("2026-01-30", "au2602", "2026-02", 102),
            ("2026-01-29", "au2604", "2026-04", 105),
            ("2026-01-30", "au2604", "2026-04", 108),
            ("2026-02-02", "au2604", "2026-04", 110),
            ("2026-01-29", "au2606", "2026-06", 109),
            ("2026-01-30", "au2606", "2026-06", 111),
            ("2026-02-02", "au2606", "2026-06", 113),
        ], columns=["时间", "合约", "交割月份", "收盘价（元/克）"])
        foreign = pd.DataFrame([
            (date, contract, expiry, GRAMS_PER_TROY_OUNCE, 1)
            for date in ("2026-01-29", "2026-01-30", "2026-02-02", "2026-02-03")
            for contract, expiry in (("au2602", "2026-02"), ("au2604", "2026-04"), ("au2606", "2026-06"))
        ], columns=["日期", "合约", "到期期限", "黄金期货价格", "USDCNH期货价格"])
        rows = spread_curve_rows(local, foreign)
        self.assertEqual([row["时间"] for row in rows], sorted(foreign["日期"].unique()))
        self.assertEqual((rows[1]["main_contract"], rows[1]["secondary_contract"]), ("au2602", "au2604"))
        self.assertEqual((rows[2]["main_contract"], rows[2]["secondary_contract"]), ("au2604", "au2606"))
        self.assertAlmostEqual(rows[2]["main_spread"], 109)
        self.assertAlmostEqual(rows[2]["secondary_spread"], 112)
        self.assertIsNone(rows[3]["main_spread"])
        self.assertIsNone(rows[3]["secondary_spread"])

    def test_secondary_roll_keeps_price_gap_and_has_no_overlap_dependency(self):
        local = pd.DataFrame([
            ("2026-01-01", "au2602", "2026-02", 100),
            ("2026-01-01", "au2604", "2026-04", 110),
            ("2026-01-01", "au2606", "2026-06", 120),
            ("2026-01-02", "au2604", "2026-04", 113),
            ("2026-01-02", "au2606", "2026-06", 125),
            ("2026-01-03", "au2604", "2026-04", 115),
            ("2026-01-03", "au2606", "2026-06", 130),
        ], columns=["时间", "合约", "交割月份", "收盘价（元/克）"])
        overseas = pd.DataFrame([
            (date, contract, expiry, GRAMS_PER_TROY_OUNCE, 1)
            for date in ("2026-01-01", "2026-01-02", "2026-01-03")
            for contract, expiry in (("au2602", "2026-02"), ("au2604", "2026-04"), ("au2606", "2026-06"))
        ], columns=["日期", "合约", "到期期限", "黄金期货价格", "USDCNH期货价格"])
        rows = spread_curve_rows(local, overseas)
        rollover = rows[1]
        self.assertEqual(rollover["secondary_rollover_from"], "au2604")
        self.assertEqual(rollover["secondary_contract"], "au2606")
        self.assertAlmostEqual(rollover["secondary_spread"], 124)
        prefix = spread_curve_rows(local[local["时间"] <= "2026-01-02"], overseas[overseas["日期"] <= "2026-01-02"])
        self.assertEqual(prefix, rows[:2], "增加未来报价不得改变已发生的选约及原始价差")

    def test_missing_quote_resumes_without_old_contract_overlap(self):
        local = pd.DataFrame([
            ("2026-01-01", "au2602", "2026-02", 100),
            ("2026-01-01", "au2604", "2026-04", 110),
            ("2026-01-02", "au2604", "2026-04", 113),
            ("2026-01-02", "au2606", "2026-06", 125),
            ("2026-01-03", "au2604", "2026-04", 115),
            ("2026-01-03", "au2606", "2026-06", 130),
            ("2026-01-04", "au2604", "2026-04", 117),
            ("2026-01-04", "au2606", "2026-06", 134),
        ], columns=["时间", "合约", "交割月份", "收盘价（元/克）"])
        overseas = pd.DataFrame([
            (date, contract, expiry, None if (date, contract) == ("2026-01-02", "au2606") else GRAMS_PER_TROY_OUNCE, 1)
            for date in ("2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04")
            for contract, expiry in (("au2602", "2026-02"), ("au2604", "2026-04"), ("au2606", "2026-06"))
        ], columns=["日期", "合约", "到期期限", "黄金期货价格", "USDCNH期货价格"])
        rows = spread_curve_rows(local, overseas)
        self.assertIsNone(rows[1]["secondary_spread"])
        self.assertAlmostEqual(rows[2]["secondary_spread"], 129)
        self.assertAlmostEqual(rows[3]["secondary_spread"], 133)
        for end in ("2026-01-02", "2026-01-03"):
            prefix = spread_curve_rows(local[local["时间"] <= end], overseas[overseas["日期"] <= end])
            self.assertEqual(prefix, [row for row in rows if row["时间"] <= end])


if __name__ == "__main__":
    unittest.main()
