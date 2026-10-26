"""用真实工作簿验证新增映射；边界情形只在内存删减源记录。"""
import unittest
from dataclasses import replace
import json
from urllib.request import urlopen

import pandas as pd

from config import DATA_DIR
from data_loader import load_tables
from indicators import Builder
from price import add_price_indicators, SOURCE, SHEET


class PriceData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, _, _ = load_tables(DATA_DIR)
        cls.frame = cls.tables[(SOURCE, SHEET)].frame
        with urlopen('http://127.0.0.1:8000/api/price', timeout=30) as response:
            cls.response = json.load(response)
        cls.items = {i['metadata']['indicator_id']: i for i in cls.response['indicators']}

    def test_source_values_units_and_changes(self):
        for key, column, factor in [('gold_price_anchor', '价格', 1), ('gold_hv20', '20日年化历史波动率', 100), ('gold_hv60', '60日年化历史波动率', 100)]:
            item = self.items[key]
            rows = self.frame.sort_values('时间')
            self.assertEqual(len(item['history']), len(rows))
            for point, (_, raw) in zip(item['history'], rows.iterrows()):
                self.assertEqual(point['observation_date'], raw['时间'].strftime('%Y-%m-%d'))
                self.assertIsNone(point['release_date'])
                if pd.isna(raw[column]): self.assertIsNone(point['value'])
                else: self.assertAlmostEqual(point['value'], raw[column] * factor, places=10)
            self.assertEqual(item['metadata']['unit'], '元/克' if factor == 1 else '%')
            self.assertAlmostEqual(item['latest']['change'], (rows.iloc[-1][column] - rows.iloc[-2][column]) * factor)
            self.assertEqual(item['latest']['change_unit'], '元/克' if factor == 1 else '个百分点')
            self.assertIsNone(item['latest']['release_date'])
            self.assertEqual(item['metadata']['loaded_at'], self.response['loaded_at'])
            self.assertNotEqual(item['metadata']['updated_at'], self.response['loaded_at'])
            if factor == 1:
                self.assertAlmostEqual(item['latest']['change_pct'], (rows.iloc[-1][column] / rows.iloc[-2][column] - 1) * 100)
            else:
                self.assertIsNone(item['latest']['change_pct'])
                self.assertTrue(all(p['value'] is None for p in item['history'][:20 if key == 'gold_hv20' else 60]))
        with urlopen('http://127.0.0.1:8000/api/meta', timeout=30) as response: meta = json.load(response)
        self.assertTrue(set(self.items).issubset({m['indicator_id'] for m in meta['indicators']}))

    def test_latest_missing_and_field_isolation(self):
        frame = self.frame.copy()
        frame.loc[frame['时间'].idxmax(), '20日年化历史波动率'] = float('nan')
        frame = frame.drop(columns=['60日年化历史波动率'])
        tables = dict(self.tables)
        tables[(SOURCE, SHEET)] = replace(self.tables[(SOURCE, SHEET)], frame=frame)
        builder = Builder(tables)
        add_price_indicators(builder)
        items = {i['metadata']['indicator_id']: i for i in builder.groups['price']}
        self.assertIsNone(items['gold_hv20']['latest']['value'])
        self.assertIsNone(items['gold_hv20']['latest']['change'])
        self.assertIsNotNone(items['gold_hv20']['latest_available']['value'])
        self.assertIsNone(items['gold_hv60']['latest']['value'])
        self.assertIsNotNone(items['gold_price_anchor']['latest']['value'])
        self.assertEqual(items['gold_hv20']['latest']['observation_date'], items['gold_price_anchor']['latest']['observation_date'])

    def test_filter_keeps_upstream_values(self):
        with urlopen('http://127.0.0.1:8000/api/price?start_date=2026-10-01', timeout=30) as response: filtered = json.load(response)
        for item in filtered['indicators']:
            original = self.items[item['metadata']['indicator_id']]
            self.assertEqual(item['history'], [p for p in original['history'] if p['observation_date'] >= '2026-10-01'])
            self.assertEqual(item['latest'], original['latest'])


if __name__ == '__main__': unittest.main()
