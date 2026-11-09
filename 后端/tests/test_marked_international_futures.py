import json
import unittest

import pandas as pd

from data_loader import Table
from indicators import Builder
from international_futures import MAIN_SOURCE, QUOTE_SOURCE, add_marked_main_futures


class MarkedInternationalFutures(unittest.TestCase):
    def build(self, missing=False):
        dates = ['2026-01-01', '2026-01-02', '2026-01-03']
        # 使用奇数月主力，确保按主力表标识而非最近偶数月重选。
        main = pd.DataFrame({'日期': dates, '主力合约': ['au2603', 'au2604', 'au2606'],
                             'COMEX期货主力价格': [100, 112, 108],
                             'USDCNH期货主力价格': [7, 7.2, 7.1]})
        quotes = pd.DataFrame({'日期': dates[1:], '合约': ['au2603', 'au2604'],
                               '黄金期货价格': [None if missing else 102, 113],
                               'USDCNH期货价格': [7.1, 7.2]})
        tables = {(source, None): Table(source, None, frame, None)
                  for source, frame in [(MAIN_SOURCE, main), (QUOTE_SOURCE, quotes)]}
        b = Builder(tables)
        add_marked_main_futures(b)
        return {i['metadata']['main_futures_product']: [json.loads(p['value']) for p in i['history']]
                for i in b.groups['price']}

    def test_positive_negative_gaps_and_latest_anchor(self):
        rows = self.build()['comex']
        self.assertEqual([r['contract'] for r in rows], ['au2603', 'au2604', 'au2606'])
        self.assertEqual([r['raw_value'] for r in rows], [100, 112, 108])
        self.assertEqual([r['adjusted_value'] for r in rows], [105, 107, 108])
        self.assertEqual([r['adjustment'] for r in rows], [5, -5, 0])
        self.assertEqual(rows[1]['rollover']['gap'], 10)
        self.assertEqual(rows[2]['rollover']['gap'], -5)

    def test_fx_uses_own_roll_gaps(self):
        rows = self.build()['sgx_usdcnh']
        for row, expected in zip(rows, [7, 7.1, 7.1]):
            self.assertAlmostEqual(row['adjusted_value'], expected)

    def test_missing_overlap_does_not_invent_adjustment(self):
        rows = self.build(missing=True)['comex']
        self.assertIsNone(rows[0]['adjusted_value'])
        self.assertEqual(rows[0]['raw_value'], 100)
        self.assertEqual(rows[-1]['adjusted_value'], 108)


if __name__ == '__main__':
    unittest.main()
