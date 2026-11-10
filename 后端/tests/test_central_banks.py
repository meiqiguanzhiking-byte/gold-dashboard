"""以正式CSV独立核验全球央行汇总及零值口径；不写源文件。"""
import json
import math
import unittest
from dataclasses import replace
from pathlib import Path

import pandas as pd

from central_banks import add_central_bank_changes, SCOPE_FILE
from config import DATA_DIR
from data_loader import load_tables
from indicators import Builder


class CentralBankChanges(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, _, _ = load_tables(DATA_DIR)
        cls.scope = json.loads(SCOPE_FILE.read_text(encoding='utf-8'))

    def build(self, tables=None, evidence=None):
        b = Builder(self.tables if tables is None else tables)
        add_central_bank_changes(b, evidence)
        return {i['metadata']['indicator_id']: i for i in b.groups['central-bank']}

    def test_all_months_use_csv_and_zero_fill_included_entities(self):
        items = self.build()
        ids = ['global_central_bank_' + suffix for suffix in ('gross_purchases', 'gross_sales', 'net_purchases', 'reporting_count')]
        maps = [{p['observation_date']: p['value'] for p in items[key]['history']} for key in ids]
        csv = self.tables[('全球央行购金.csv', None)].frame.set_index('时间')
        for month, row in csv.iterrows():
            included = [float(row[c]) if c in csv.columns and math.isfinite(float(row[c])) else 0.0
                        for c in self.scope['included_entities']]
            purchases = math.fsum(v for v in included if v > 0)
            sales = math.fsum(v for v in included if v < 0)
            self.assertAlmostEqual(maps[0][month], purchases)
            self.assertAlmostEqual(maps[1][month], sales)
            self.assertAlmostEqual(maps[2][month], purchases + sales)
            self.assertEqual(maps[3][month], len(included))
        self.assertEqual(items[ids[2]]['metadata']['unit'], '吨')
        self.assertEqual(len(items[ids[2]]['history']), len(csv))
        latest = max(csv.index)
        country_items = [i for i in items.values() if i['metadata'].get('aggregation_included')]
        self.assertEqual(sum(i['latest']['value'] is not None for i in country_items), maps[3][latest])
        self.assertTrue(any(i['latest']['value'] == 0 for i in country_items), 'CSV空白按0显示')
        self.assertTrue(all(i['latest']['value'] is not None for i in country_items))

    def test_scope_is_explicit_and_excludes_overlaps(self):
        included = self.scope['included_entities']
        excluded = self.scope['excluded_entities']
        self.assertEqual(len(included), len(set(included)))
        self.assertIn('Turkey', included)
        self.assertNotIn('Turkey*', included)
        self.assertIn('Euro Area', excluded)
        self.assertIn('State Oil Fund of the Republic of Azerbaijan (SOFAZ)', excluded)
        columns = set(self.tables[('全球央行购金.csv', None)].frame) - {'时间'}
        self.assertEqual(columns, set(included) | set(excluded))
        self.assertFalse(set(included) & set(excluded))

    def test_missing_column_and_missing_evidence_use_csv_zero_fill(self):
        tables = dict(self.tables)
        table = tables[('全球央行购金.csv', None)]
        frame = table.frame.copy()
        original = self.build()['global_central_bank_net_purchases']
        before = self.tables[('全球央行购金.csv', None)].frame
        turkey = pd.to_numeric(before['Turkey'], errors='coerce').fillna(0.0)
        # 缺少整列的纳入机构按0处理，不会令全部月份失效。
        frame = frame.drop(columns=['Turkey'])
        tables[('全球央行购金.csv', None)] = replace(table, frame=frame)
        changed = self.build(tables)['global_central_bank_net_purchases']
        self.assertEqual(len(changed['history']), len(original['history']))
        for actual, expected, deduction in zip(changed['history'], original['history'], turkey):
            self.assertAlmostEqual(actual['value'], expected['value'] - deduction)
        unavailable = self.build(evidence=Path(__file__).with_name('missing-source.xlsx'))
        self.assertEqual(unavailable['global_central_bank_net_purchases']['history'], original['history'])
        self.assertEqual(unavailable['global_central_bank_reporting_count']['history'],
                         self.build()['global_central_bank_reporting_count']['history'])


if __name__ == '__main__':
    unittest.main()
