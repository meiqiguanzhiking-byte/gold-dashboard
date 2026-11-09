"""用真实工作簿验证新增映射；边界情形只在内存删减源记录。"""
import unittest
from dataclasses import replace
import json
import os
from urllib.request import urlopen

import pandas as pd

from config import DATA_DIR
from data_loader import load_tables, parse_dates
from indicators import Builder
from price import add_price_indicators, SOURCE

BASE = os.environ.get('GOLD_API_URL', 'http://127.0.0.1:8000').rstrip('/')


class PriceData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, _, _ = load_tables(DATA_DIR)
        cls.frame = cls.tables[(SOURCE, None)].frame
        with urlopen(BASE + '/api/price', timeout=30) as response:
            cls.response = json.load(response)
        cls.items = {i['metadata']['indicator_id']: i for i in cls.response['indicators']}

    def test_source_values_units_and_changes(self):
        for key, column, factor in [('au_td_close', '收盘价（元/克）', 1)]:
            item = self.items[key]
            rows = self.frame.assign(_date=pd.to_datetime(self.frame['时间'])).sort_values('_date').drop_duplicates('_date', keep=False)
            self.assertEqual(len(item['history']), len(rows))
            for point, (_, raw) in zip(item['history'], rows.iterrows()):
                self.assertEqual(point['observation_date'], raw['_date'].strftime('%Y-%m-%d'))
                self.assertIsNone(point['release_date'])
                if pd.isna(raw[column]): self.assertIsNone(point['value'])
                else: self.assertAlmostEqual(point['value'], raw[column] * factor, places=10)
            self.assertEqual(item['metadata']['unit'], '元/克')
            self.assertAlmostEqual(item['latest']['change'], (rows.iloc[-1][column] - rows.iloc[-2][column]) * factor)
            self.assertEqual(item['latest']['change_unit'], '元/克')
            self.assertIsNone(item['latest']['release_date'])
            self.assertEqual(item['metadata']['loaded_at'], self.response['loaded_at'])
            self.assertNotEqual(item['metadata']['updated_at'], self.response['loaded_at'])
            if factor == 1:
                self.assertAlmostEqual(item['latest']['change_pct'], (rows.iloc[-1][column] / rows.iloc[-2][column] - 1) * 100)
        for key, window in [('gold_hv20', 20), ('gold_hv60', 60)]:
            item = self.items[key]
            ordered = self.frame.assign(_date=pd.to_datetime(self.frame['时间'])).sort_values('_date').drop_duplicates('_date', keep=False)
            prices = pd.to_numeric(ordered['收盘价（元/克）'], errors='coerce')
            expected = prices.apply(lambda value: __import__('math').log(value) if pd.notna(value) and value > 0 else float('nan')).diff().rolling(window, min_periods=window).std(ddof=1) * (252 ** 0.5) * 100
            valid_prices = ordered
            self.assertEqual(len(item['history']), len(valid_prices))
            for point, value in zip(item['history'], expected):
                if pd.isna(value): self.assertIsNone(point['value'])
                else: self.assertAlmostEqual(point['value'], value, places=9)
            self.assertEqual(item['metadata']['unit'], '%')
        with urlopen(BASE + '/api/meta', timeout=30) as response: meta = json.load(response)
        self.assertTrue(set(self.items).issubset({m['indicator_id'] for m in meta['indicators']}))

    def test_latest_missing_and_field_isolation(self):
        frame = self.frame.copy()
        latest_date = parse_dates(frame['时间']).max()
        frame.loc[parse_dates(frame['时间']).eq(latest_date), '收盘价（元/克）'] = float('nan')
        tables = dict(self.tables)
        tables[(SOURCE, None)] = replace(self.tables[(SOURCE, None)], frame=frame)
        builder = Builder(tables)
        add_price_indicators(builder)
        items = {i['metadata']['indicator_id']: i for i in builder.groups['price']}
        self.assertIsNone(items['au_td_close']['latest']['value'])
        self.assertIsNone(items['gold_hv20']['latest']['value'])
        self.assertIsNone(items['gold_hv60']['latest']['value'])
        self.assertIsNotNone(items['gold_hv20']['latest_available']['value'])

    def test_filter_keeps_upstream_values(self):
        with urlopen(BASE + '/api/price?start_date=2026-10-01', timeout=30) as response: filtered = json.load(response)
        for item in filtered['indicators']:
            original = self.items[item['metadata']['indicator_id']]
            self.assertEqual(item['history'], [p for p in original['history'] if p['observation_date'] >= '2026-10-01'])
            self.assertEqual(item['latest'], original['latest'])


if __name__ == '__main__': unittest.main()
