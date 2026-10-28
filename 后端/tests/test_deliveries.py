"""黄金交割：逐格核对真实源表，缺值/零值及异常记录不写磁盘。"""
import unittest
from dataclasses import replace

import pandas as pd

from config import DATA_DIR
from data_loader import Table
from deliveries import SOURCE, build_deliveries


class DeliveryData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frames = pd.read_excel(DATA_DIR / SOURCE, sheet_name=None)
        cls.tables = {(SOURCE, name): Table(SOURCE, name, frame, None) for name, frame in frames.items()}

    def test_all_cells_match_source_and_blank_months_not_selected(self):
        data = build_deliveries(self.tables)
        self.assertEqual(data['unit'], '吨')
        self.assertIsNone(data['release_date'])
        for symbol, product in data['contracts'].items():
            frame = self.tables[(SOURCE, symbol)].frame
            self.assertEqual(product['warnings'], [])
            self.assertEqual(len(product['accounts']), len(frame) // 2)
            self.assertEqual(len({a['institution'] for a in product['accounts']}), len(product['accounts']))
            for account in product['accounts']:
                self.assertRegex(account['institution'], r'\[[CH]\]$')
                for side, code in [('issued', 'I'), ('stopped', 'S')]:
                    source = frame[(frame.iloc[:, 0] == account['institution']) & (frame['I/S'] == code)].iloc[0, 2:]
                    self.assertEqual(account[side], [None if pd.isna(value) else value for value in source])
            actual = [str(month)[:7] for month in frame.columns[2:] if frame[month].notna().any()]
            self.assertEqual(product['available_months'], actual)
            self.assertEqual(product['coverage_end'], actual[-1])

    def test_missing_sheet_and_duplicate_direction_do_not_guess(self):
        self.assertEqual(build_deliveries({})['contracts']['MGC']['accounts'], [])
        table = self.tables[(SOURCE, 'GC')]
        frame = pd.concat([table.frame, table.frame.iloc[[0]]], ignore_index=True)
        data = build_deliveries({**self.tables, (SOURCE, 'GC'): replace(table, frame=frame)})
        first = data['contracts']['GC']['accounts'][0]
        self.assertTrue(all(value is None for value in first['issued']))
        self.assertEqual(first['stopped'], build_deliveries(self.tables)['contracts']['GC']['accounts'][0]['stopped'])

    def test_changed_header_withholds_instead_of_mislabeling(self):
        table = self.tables[(SOURCE, 'GC')]
        frame = table.frame.rename(columns={'I/S': 'changed'})
        data = build_deliveries({(SOURCE, 'GC'): replace(table, frame=frame)})
        self.assertEqual(data['contracts']['GC']['accounts'], [])
        self.assertTrue(data['contracts']['GC']['warnings'])


if __name__ == '__main__':
    unittest.main()
