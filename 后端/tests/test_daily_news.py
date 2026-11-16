from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from daily_news import SOURCES, NewsCache, batch_window, collect_news, parse_feed, public_news, published_time


class DailyNewsTests(unittest.TestCase):
    def setUp(self):
        self.cutoff = datetime.fromisoformat('2026-11-16T17:00:00+08:00')
        self.source = SOURCES[0]

    def feed(self, date='Mon, 16 Nov 2026 08:00:00 +0800', link='https://www.chinanews.com.cn/cj/2026/11-16/test.shtml'):
        return f'<rss><channel><item><title>黄金投资需求变化</title><pubDate>{date}</pubDate><link>{link}</link><description>某机构表示，黄金配置需求有所变化。这是来源表态。</description></item></channel></rss>'.encode()

    def test_window_timezone_missing_time_and_untrusted_link(self):
        start, end = batch_window(self.cutoff)
        self.assertEqual(start.isoformat(), '2026-11-15T00:00:00+08:00')
        self.assertEqual(published_time('Sun, 15 Nov 2026 19:00:00 -0500').date(), self.cutoff.date())
        self.assertIsNone(published_time('2026-11-16'))
        for raw in [self.feed('Fri, 13 Nov 2026 08:00:00 +0800'), self.feed('Mon, 16 Nov 2026 17:00:00 +0800'), self.feed(link='https://untrusted.invalid/news'), self.feed('unknown')]:
            self.assertEqual(parse_feed(raw, self.source, start, end), [])
        event = parse_feed(self.feed(), self.source, start, end)[0]
        self.assertIsNone(event['event_at'])
        self.assertEqual(event['verification'], 'single_reliable_source')

    def test_partial_coverage_deduplication_and_failure(self):
        def fetch(source):
            if source['kind'] == 'official':
                raise OSError('unavailable')
            return self.feed()
        bundle = collect_news(self.cutoff, fetch)
        self.assertEqual(bundle['status'], 'ready')
        self.assertEqual(len(bundle['events']), 1)
        self.assertEqual(len(bundle['missing_sources']), 3)
        self.assertEqual(collect_news(self.cutoff, Mock(side_effect=OSError()))['status'], 'failed')

    def test_saved_result_no_duplicate_fetch_new_edition_and_failed_day(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = NewsCache(Path(directory) / 'news.sqlite3')
            collector = Mock(return_value={'status': 'ready', 'report_date': '2026-11-16', 'events': []})
            cache.update(self.cutoff, collector, '2026-11-13')
            cache.update(self.cutoff, collector, '2026-11-13')
            collector.assert_called_once()
            cache.update(self.cutoff, collector, '2026-11-16')
            self.assertEqual(collector.call_count, 2)
            cache.update(datetime.fromisoformat('2026-11-17T17:00:00+08:00'), Mock(side_effect=OSError()))
            self.assertTrue(cache.read()['stale'])
            self.assertEqual(cache.read()['report_date'], '2026-11-16')
            self.assertEqual(public_news({}, cache)['status'], 'withheld')
            self.assertEqual(public_news({}, cache)['events'], [])

    def test_failed_retry_keeps_original_cutoff_and_stops_after_two(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = NewsCache(Path(directory) / 'news.sqlite3')
            collector = Mock(side_effect=OSError())
            cache.update(self.cutoff, collector)
            cache.update(datetime.fromisoformat('2026-11-16T18:00:00+08:00'), collector)
            cache.update(datetime.fromisoformat('2026-11-16T19:00:00+08:00'), collector)
            self.assertEqual(collector.call_count, 2)
            self.assertEqual(collector.call_args.args[0], self.cutoff)


if __name__ == '__main__':
    unittest.main()
