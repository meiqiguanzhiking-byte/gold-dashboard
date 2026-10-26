"""真实工作簿的来源、独立日期合并、时区截止和缺失隔离检查；不写源文件。"""
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta

import pandas as pd

from config import DATA_DIR, LOCAL_TIMEZONE
from data_loader import load_tables
from indicators import Builder
from price import add_price_indicators, SOURCE as DOMESTIC_SOURCE, SHEET as DOMESTIC_SHEET
from international_price import add_international_price_indicators, SOURCE, SHEET


class InternationalPriceData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables, _, _ = load_tables(DATA_DIR)

    def build(self, tables=None, today=None):
        builder = Builder(self.tables if tables is None else tables)
        add_price_indicators(builder)
        add_international_price_indicators(builder, today=today)
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

    def test_independent_join_and_conversion(self):
        item = self.build()['gold_domestic_spread']
        domestic = self.tables[(DOMESTIC_SOURCE, DOMESTIC_SHEET)].frame[['时间', '价格']].rename(columns={'时间': '日期'})
        overseas = self.tables[(SOURCE, SHEET)].frame
        merged = domestic.merge(overseas, on='日期', how='inner')
        cutoff = datetime.now(LOCAL_TIMEZONE).date() - timedelta(days=1)
        eligible = merged[merged['日期'].dt.date <= cutoff].dropna()
        expected = (eligible['价格'] - eligible['伦敦金现（美元/金衡盎司）'] * eligible['美元兑离岸人民币（CNH/美元）'] / 31.1034768)
        actual = {p['observation_date']: p['value'] for p in item['history'] if p['value'] is not None}
        self.assertEqual(len(actual), len(eligible))
        for d, value in zip(eligible['日期'], expected): self.assertAlmostEqual(actual[d.strftime('%Y-%m-%d')], value, places=9)
        self.assertEqual(item['metadata']['cutoff_date'], cutoff.isoformat())
        self.assertTrue(all(p['observation_date'] <= cutoff.isoformat() for p in item['history']))
        self.assertEqual(item['metadata']['unit'], '元/克')
        self.assertLess(item['metadata']['valid_count'], item['metadata']['record_count'])
        self.assertTrue(any(v < 0 for v in actual.values()), '真实负价差不得被过滤')

    def test_today_is_excluded_and_next_day_included(self):
        normal = self.build()['gold_domestic_spread']
        day = date.fromisoformat(normal['latest_available']['observation_date'])
        excluded = self.build(today=day)['gold_domestic_spread']
        included = self.build(today=day + timedelta(days=1))['gold_domestic_spread']
        self.assertTrue(all(p['observation_date'] < day.isoformat() for p in excluded['history']))
        self.assertEqual(included['latest']['observation_date'], day.isoformat())
        self.assertIsNotNone(included['latest']['value'])

    def test_missing_inputs_duplicates_and_no_latest_fallback(self):
        frame = self.tables[(SOURCE, SHEET)].frame.copy()
        frame.loc[frame['日期'].idxmax(), '美元兑离岸人民币（CNH/美元）'] = float('nan')
        tables = dict(self.tables)
        tables[(SOURCE, SHEET)] = replace(tables[(SOURCE, SHEET)], frame=frame)
        next_day = frame['日期'].max().date() + timedelta(days=1)
        items = self.build(tables, today=next_day)
        self.assertIsNone(items['usdcnh']['latest']['value'])
        self.assertIsNone(items['gold_domestic_spread']['latest']['value'])
        self.assertIsNotNone(items['gold_domestic_spread']['latest_available']['value'])
        frame = pd.concat([frame, frame.iloc[[-2]]], ignore_index=True)
        tables[(SOURCE, SHEET)] = replace(tables[(SOURCE, SHEET)], frame=frame)
        items = self.build(tables, today=next_day)
        duplicate = frame.iloc[-1]['日期'].strftime('%Y-%m-%d')
        self.assertIsNone(next(p['value'] for p in items['gold_domestic_spread']['history'] if p['observation_date'] == duplicate))
        frame = frame.drop(columns=['美元兑离岸人民币（CNH/美元）'])
        tables[(SOURCE, SHEET)] = replace(tables[(SOURCE, SHEET)], frame=frame)
        items = self.build(tables)
        self.assertEqual(items['gold_domestic_spread']['metadata']['valid_count'], 0)
        self.assertIsNotNone(items['london_gold_spot']['latest']['value'])


if __name__ == '__main__': unittest.main()
