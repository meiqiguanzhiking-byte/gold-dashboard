import unittest
from unittest.mock import Mock

from daily_refresh import DailySourceMonitor
from daily_report import report_data_ready


class DailyRefreshTests(unittest.TestCase):
    def test_stable_files_trigger_once_and_errors_wait(self):
        signature = Mock(return_value=('old',))
        store, reports = Mock(), Mock()
        store.reload.return_value = {"status": "ok", "read_errors": []}
        monitor = DailySourceMonitor(store, reports, signature)
        self.assertFalse(monitor.check())
        signature.return_value = ('new',)
        self.assertFalse(monitor.check())
        self.assertFalse(monitor.check())
        self.assertTrue(monitor.check())
        reports.prewarm.assert_called_once_with(store.snapshot)
        self.assertFalse(monitor.check())
        signature.return_value = ('updating',)
        self.assertFalse(monitor.check())
        signature.return_value = ('final',)
        self.assertFalse(monitor.check())
        store.reload.return_value = {"status": "degraded", "read_errors": ['file']}
        self.assertFalse(monitor.check())
        self.assertFalse(monitor.check())
        self.assertEqual(reports.prewarm.call_count, 1)
        store.reload.return_value = {"status": "ok", "read_errors": []}
        self.assertFalse(monitor.check())
        self.assertTrue(monitor.check())
        self.assertEqual(reports.prewarm.call_count, 2)

    def test_prices_must_be_complete_and_have_same_observation_day(self):
        ids = ['au_td_close', 'london_gold_spot', 'usdcnh', 'gold_domestic_spread',
               'gold_futures_spread', 'gold_futures_secondary_spread', 'gold_futures_daily_quotes']
        rows = [{"metadata": {"indicator_id": id}, "history": [{"observation_date": "2026-11-10", "value": 1}]} for id in ids]
        state = {"groups": {"price": rows}, "meta": {"status": "ok", "read_errors": []}}
        self.assertTrue(report_data_ready(state))
        rows[-1]['history'][-1]['observation_date'] = '2026-11-09'
        self.assertFalse(report_data_ready(state))
        rows[-1]['history'][-1]['observation_date'] = '2026-11-10'
        rows[-1]['history'][-1]['value'] = None
        self.assertFalse(report_data_ready(state))
