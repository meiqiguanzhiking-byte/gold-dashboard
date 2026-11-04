"""按合约核对全部CSV报价，避免同日多合约被误判为重复日期。"""
import unittest
from dataclasses import replace

import pandas as pd

from config import DATA_DIR
from data_loader import load_tables
from indicators import Builder
from international_futures import SOURCE, PRODUCTS, add_international_futures


class InternationalFuturesData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, _, _ = load_tables(DATA_DIR)

    def build(self, frame=None):
        tables = dict(self.tables)
        if frame is not None:
            tables[(SOURCE, None)] = replace(tables[(SOURCE, None)], frame=frame)
        builder = Builder(tables)
        add_international_futures(builder)
        return builder.groups['price']

    def test_every_contract_and_price_matches_raw_csv(self):
        raw = self.tables[(SOURCE, None)].frame
        items = self.build()
        self.assertEqual(len(items), len(raw.groupby(['合约', '到期期限'])) * 2)
        for item in items:
            m = item['metadata']
            spec = next(spec for spec in PRODUCTS if spec[0] == m['futures_product'])
            self.assertEqual(m['unit'], spec[3])
            rows = raw.loc[(raw['合约'] == m['source_contract']) & (raw['到期期限'] == m['contract_expiry'])].sort_values('日期')
            self.assertEqual(len(rows), len(item['history']))
            for point, (_, row) in zip(item['history'], rows.iterrows()):
                self.assertEqual(point['observation_date'], row['日期'])
                if pd.isna(row[spec[2]]):
                    self.assertIsNone(point['value'])
                else:
                    self.assertEqual(point['value'], row[spec[2]])
            self.assertEqual(m['source'], SOURCE)
            self.assertEqual(m['observation_time'], '15:00')
            self.assertEqual(m['observation_timezone'], 'Asia/Shanghai')

    def test_conflict_and_missing_price_stay_in_own_contract(self):
        raw = self.tables[(SOURCE, None)].frame.copy()
        target_index = raw.dropna(subset=['黄金期货价格', 'USDCNH期货价格']).index[0]
        target = raw.loc[target_index]
        duplicate = pd.concat([raw, raw.loc[[target_index]]], ignore_index=True)
        items = self.build(duplicate)
        for item in items:
            point = next((p for p in item['history'] if p['observation_date'] == target['日期']), None)
            if point:
                self.assertEqual(point['value'] is None, item['metadata']['source_contract'] == target['合约'])
        raw.loc[target_index, '黄金期货价格'] = float('nan')
        items = self.build(raw)
        target_items = [i for i in items if i['metadata']['source_contract'] == target['合约']]
        for item in target_items:
            point = next(p for p in item['history'] if p['observation_date'] == target['日期'])
            self.assertEqual(point['value'], None if item['metadata']['futures_product'] == 'comex' else target['USDCNH期货价格'])


if __name__ == '__main__':
    unittest.main()
