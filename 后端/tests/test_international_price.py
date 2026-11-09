"""真实工作簿的来源、独立日期合并、同日匹配和缺失隔离检查；不写源文件。"""
import unittest
from dataclasses import replace

import pandas as pd

from config import DATA_DIR
from data_loader import load_tables
from indicators import Builder
from price import add_price_indicators, SOURCE as DOMESTIC_SOURCE
from international_price import add_international_price_indicators, add_treasury_yield_indicators, SOURCE, SHEET, VOLATILITY_SOURCE, TREASURY_SOURCE


class InternationalPriceData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, _, _ = load_tables(DATA_DIR)

    def build(self, tables=None):
        builder = Builder(self.tables if tables is None else tables)
        add_price_indicators(builder)
        add_international_price_indicators(builder)
        add_treasury_yield_indicators(builder)
        return {i['metadata']['indicator_id']: i for i in builder.groups['price']}

    def test_source_units_and_all_history(self):
        items = self.build()
        raw = self.tables[(SOURCE, SHEET)].frame.sort_values('日期')
        for key, column, unit in [('london_gold_spot', '伦敦金现（美元/金衡盎司）', '美元/金衡盎司'), ('usdcnh', '美元兑离岸人民币（CNH/美元）', 'CNH/美元')]:
            item = items[key]
            self.assertEqual(len(item['history']), len(raw))
            self.assertEqual(item['metadata']['unit'], unit)
            for point, (_, row) in zip(item['history'], raw.iterrows()):
                self.assertEqual(point['observation_date'], row['日期'].strftime('%Y-%m-%d'))
                self.assertIsNone(point['release_date'])
                if pd.isna(row[column]): self.assertIsNone(point['value'])
                else: self.assertAlmostEqual(point['value'], row[column])
            self.assertEqual(item['latest']['value'], raw.iloc[-1][column])
            self.assertAlmostEqual(item['latest']['change_pct'], (raw.iloc[-1][column] / raw.iloc[-2][column] - 1) * 100)

    def test_gold_etf_volatility_index_preserves_source_observations(self):
        item = self.build()['gold_etf_volatility_index']
        raw = self.tables[(VOLATILITY_SOURCE, None)].frame.sort_values('时间')
        self.assertEqual(item['metadata']['unit'], '%')
        self.assertEqual(item['metadata']['frequency'], '日度')
        self.assertEqual(item['metadata']['index_symbol'], 'GVZ')
        self.assertEqual(item['metadata']['source_reference'], 'https://www.cboe.com/us/indices/dashboard/gvz/')
        self.assertEqual(item['latest']['change_unit'], '百分点')
        self.assertEqual(len(item['history']), len(raw))
        for point, (_, row) in zip(item['history'], raw.iterrows()):
            self.assertEqual(point['observation_date'], row['时间'])
            if pd.isna(row['波动率']): self.assertIsNone(point['value'])
            else: self.assertAlmostEqual(point['value'], row['波动率'])

    def test_treasury_yield_series_preserve_fred_source_values_and_gaps(self):
        items = self.build()
        raw = self.tables[(TREASURY_SOURCE, '日频美债收益率')].frame.sort_values('时间')
        columns = {
            'ust_10y_yield': ('10年美债收益率', '%', 'DGS10'),
            'ust_2y_yield': ('2年美债收益率', '%', 'DGS2'),
            'ust_10y_2y_spread': ('10年－2年期限利差', '百分点', 'T10Y2Y'),
            'ust_10y_real_yield': ('10年实际利率', '%', 'DFII10'),
            'ust_10y_breakeven_inflation': ('10年盈亏平衡通胀率（BEI）', '%', 'T10YIE'),
        }
        for indicator_id, (column, unit, series_id) in columns.items():
            item = items[indicator_id]
            self.assertEqual(item['metadata']['unit'], unit)
            self.assertEqual(item['metadata']['series_id'], series_id)
            self.assertEqual(item['metadata']['source_reference'], f'https://fred.stlouisfed.org/series/{series_id}')
            self.assertEqual(len(item['history']), len(raw))
            for point, (_, row) in zip(item['history'], raw.iterrows()):
                self.assertEqual(point['observation_date'], row['时间'].strftime('%Y-%m-%d'))
                if pd.isna(row[column]): self.assertIsNone(point['value'])
                else: self.assertAlmostEqual(point['value'], row[column])

    def test_independent_join_and_conversion(self):
        item = self.build()['gold_domestic_spread']
        domestic = self.tables[(DOMESTIC_SOURCE, None)].frame[['时间', '收盘价（元/克）']].rename(columns={'时间': '日期', '收盘价（元/克）': '价格'})
        domestic['日期'] = pd.to_datetime(domestic['日期'], format='mixed', errors='coerce')
        overseas = self.tables[(SOURCE, SHEET)].frame
        merged = domestic.merge(overseas, on='日期', how='inner')
        eligible = merged.dropna()
        expected = (eligible['价格'] - eligible['伦敦金现（美元/金衡盎司）'] * eligible['美元兑离岸人民币（CNH/美元）'] / 31.1034768)
        actual = {p['observation_date']: p['value'] for p in item['history'] if p['value'] is not None}
        self.assertEqual(len(actual), len(eligible))
        for d, value in zip(eligible['日期'], expected): self.assertAlmostEqual(actual[d.strftime('%Y-%m-%d')], value, places=9)
        self.assertNotIn('cutoff_date', item['metadata'])
        self.assertEqual(item['metadata']['observation_time'], '15:30')
        self.assertEqual(item['metadata']['unit'], '元/克')
        self.assertLess(item['metadata']['valid_count'], item['metadata']['record_count'])
        self.assertTrue(any(v < 0 for v in actual.values()), '真实负价差不得被过滤')

    def test_latest_same_date_is_included_without_calendar_cutoff(self):
        items = self.build()
        spread = items['gold_domestic_spread']
        day = items['london_gold_spot']['latest']['observation_date']
        inputs = [items[key] for key in ('au_td_close', 'london_gold_spot', 'usdcnh')]
        values = [next((p['value'] for p in i['history'] if p['observation_date'] == day), None) for i in inputs]
        expected = values[0] - values[1] * values[2] / 31.1034768
        self.assertEqual(spread['latest']['observation_date'], day)
        self.assertAlmostEqual(spread['latest']['value'], expected)
        # 同一批真实价格的计算不依赖系统日历；补充一个源日期缺项不会借用相邻日期。
        frame = self.tables[(SOURCE, SHEET)].frame.copy()
        latest_date = frame['日期'].max()
        frame = frame.loc[frame['日期'] != latest_date]
        tables = dict(self.tables)
        tables[(SOURCE, SHEET)] = replace(tables[(SOURCE, SHEET)], frame=frame)
        missing = self.build(tables)['gold_domestic_spread']
        self.assertEqual(missing['latest']['observation_date'], day)
        self.assertIsNone(missing['latest']['value'])

    def test_missing_inputs_duplicates_and_no_latest_fallback(self):
        frame = self.tables[(SOURCE, SHEET)].frame.copy()
        frame.loc[frame['日期'].idxmax(), '美元兑离岸人民币（CNH/美元）'] = float('nan')
        tables = dict(self.tables)
        tables[(SOURCE, SHEET)] = replace(tables[(SOURCE, SHEET)], frame=frame)
        items = self.build(tables)
        self.assertIsNone(items['usdcnh']['latest']['value'])
        self.assertIsNone(items['gold_domestic_spread']['latest']['value'])
        self.assertIsNotNone(items['gold_domestic_spread']['latest_available']['value'])
        frame = pd.concat([frame, frame.iloc[[-2]]], ignore_index=True)
        tables[(SOURCE, SHEET)] = replace(tables[(SOURCE, SHEET)], frame=frame)
        items = self.build(tables)
        duplicate = frame.iloc[-1]['日期'].strftime('%Y-%m-%d')
        self.assertIsNone(next(p['value'] for p in items['gold_domestic_spread']['history'] if p['observation_date'] == duplicate))
        frame = frame.drop(columns=['美元兑离岸人民币（CNH/美元）'])
        tables[(SOURCE, SHEET)] = replace(tables[(SOURCE, SHEET)], frame=frame)
        items = self.build(tables)
        self.assertEqual(items['gold_domestic_spread']['metadata']['valid_count'], 0)
        self.assertIsNotNone(items['london_gold_spot']['latest']['value'])


if __name__ == '__main__': unittest.main()
