import unittest
from dataclasses import replace

import pandas as pd

from bank_fx import SOURCE, SHEETS, specs, read_bank_fx_workbook, add_bank_fx_indicators
from config import DATA_DIR
from data_loader import Table, describe_frame
from indicators import Builder


class BankFxData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frames = read_bank_fx_workbook(DATA_DIR / SOURCE)
        cls.tables = {(SOURCE, sheet): Table(SOURCE, sheet, frame, None) for sheet, frame in cls.frames.items()}

    def build(self, tables):
        builder = Builder(tables)
        add_bank_fx_indicators(builder)
        return {item['metadata']['indicator_id']: item for item in builder.groups['price']}

    def test_all_categories_and_original_values(self):
        items = self.build(self.tables)
        self.assertEqual(len(items), 78)
        for currency, (sheet, unit) in SHEETS.items():
            frame = self.frames[sheet]
            self.assertEqual(describe_frame(frame, sheet)['invalid_date_count'], 0)
            self.assertEqual(len(set(frame['日期'])), len(frame))
            for suffix, row, group, path, leg in specs():
                item = items[f'bank_fx_{currency}_{suffix}']
                self.assertEqual(item['metadata']['unit'], unit)
                self.assertEqual(item['metadata']['bank_fx_path'], path)
                self.assertEqual(item['metadata']['bank_fx_leg'], leg)
                for point, (date, value) in zip(item['history'], zip(frame['日期'], pd.to_numeric(frame[suffix], errors='coerce'))):
                    self.assertEqual(point['observation_date'], date)
                    if pd.isna(value):
                        self.assertIsNone(point['value'])
                    else:
                        self.assertEqual(point['value'], value)

    def test_missing_values_and_real_zero_stay_distinct(self):
        sheet = SHEETS['cny'][0]
        table = self.tables[(SOURCE, sheet)]
        frame = table.frame.copy()
        frame.loc[frame.index[-1], 'banks_0_5'] = float('nan')
        frame.loc[frame.index[-1], 'banks_0_15'] = 0
        tables = {**self.tables, (SOURCE, sheet): replace(table, frame=frame)}
        items = self.build(tables)
        self.assertIsNone(items['bank_fx_cny_banks_0_5']['latest']['value'])
        self.assertEqual(items['bank_fx_cny_banks_0_15']['latest']['value'], 0)
        self.assertIsNotNone(items['bank_fx_usd_banks_0_5']['latest']['value'])


if __name__ == '__main__':
    unittest.main()
