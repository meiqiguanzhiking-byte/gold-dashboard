"""以真实WGC原件独立核验单位、范围、覆盖和缺失隔离；不写源文件。"""
import json
import math
import unittest
from dataclasses import replace
from pathlib import Path

from central_banks import add_central_bank_changes, read_reported_months, SCOPE_FILE
from config import DATA_DIR, CENTRAL_BANK_CHANGES_FILE
from data_loader import load_tables
from indicators import Builder


class CentralBankChanges(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, _, _ = load_tables(DATA_DIR)
        cls.reported, _ = read_reported_months(CENTRAL_BANK_CHANGES_FILE)
        cls.scope = json.loads(SCOPE_FILE.read_text(encoding='utf-8'))

    def build(self, tables=None, evidence=CENTRAL_BANK_CHANGES_FILE):
        b = Builder(self.tables if tables is None else tables)
        add_central_bank_changes(b, evidence)
        return {i['metadata']['indicator_id']: i for i in b.groups['central-bank']}

    def test_all_months_against_original_reports(self):
        items = self.build()
        ids = ['global_central_bank_' + suffix for suffix in ('gross_purchases', 'gross_sales', 'net_purchases', 'reporting_count')]
        maps = [{p['observation_date']: p['value'] for p in items[key]['history']} for key in ids]
        for month, values in self.reported.items():
            included = [values[c] for c in self.scope['included_entities'] if values[c] is not None]
            purchases = math.fsum(v for v in included if v > 0)
            sales = math.fsum(v for v in included if v < 0)
            self.assertAlmostEqual(maps[0][month], purchases)
            self.assertAlmostEqual(maps[1][month], sales)
            self.assertAlmostEqual(maps[2][month], purchases + sales)
            self.assertEqual(maps[3][month], len(included))
        self.assertEqual(items[ids[2]]['metadata']['unit'], '吨')
        self.assertEqual(len(items[ids[2]]['history']), len(self.reported))
        latest = max(self.reported)
        country_items = [i for i in items.values() if i['metadata'].get('aggregation_included')]
        self.assertEqual(sum(i['latest']['value'] is not None for i in country_items), maps[3][latest])
        self.assertTrue(any(i['latest']['value'] == 0 for i in country_items), '原表真实0应计为有报告值')
        self.assertTrue(any(i['latest']['value'] is None for i in country_items), '原表空白不得继承CSV补零')

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

    def test_unverifiable_month_and_missing_evidence_stay_null(self):
        tables = dict(self.tables)
        table = tables[('全球央行购金.csv', None)]
        frame = table.frame.copy()
        # 仅在内存去除真实字段，模拟一次来源结构变化；不能得出部分范围的伪总量。
        frame = frame.drop(columns=['Turkey'])
        tables[('全球央行购金.csv', None)] = replace(table, frame=frame)
        item = self.build(tables)['global_central_bank_net_purchases']
        self.assertTrue(all(p['value'] is None for p in item['history']))
        unavailable = self.build(evidence=Path(__file__).with_name('missing-source.xlsx'))
        for suffix in ('net_purchases', 'reporting_count'):
            self.assertIsNone(unavailable['global_central_bank_' + suffix]['latest']['value'])


if __name__ == '__main__':
    unittest.main()
