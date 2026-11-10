"""真实规则底稿 + 本地Chat Completions协议测试替身；不将测试文案导出。"""
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
import tempfile
from concurrent.futures import ThreadPoolExecutor
import time
import unittest
from unittest.mock import patch

from daily_report import DailyReportCache, MAX_DAILY_ATTEMPTS, make_bundle, protect, rule_report, validate
from public_report import build_public_report

ROOT = Path(__file__).resolve().parents[2]


class ModelHandler(BaseHTTPRequestHandler):
    mode = "ok"
    calls = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        source = json.loads(body["messages"][-1]["content"])
        if "validation_error" in source:
            source = json.loads(body["messages"][1]["content"])
        type(self).calls.append(source)
        if "source_facts" in source:
            if self.mode == "review_unavailable":
                self.send_error(503)
                return
            candidate = {"passed": self.mode != "semantic_invalid", "issues": ["unsupported_claim"] if self.mode == "semantic_invalid" else []}
            self.respond(candidate)
            return
        if self.mode == "unavailable":
            self.send_error(503)
            return
        if self.mode == "timeout":
            time.sleep(1.5)
        paragraphs = [[] for _ in range(3)]
        for fact in source["facts"]:
            paragraphs[fact["paragraph"]].append({"fact_id": fact["id"], "text": '从最新观察看，' + fact["source"]})
        candidate = {"title": "黄金行情与配置动向", "paragraphs": paragraphs}
        if self.mode == "invalid":
            candidate["paragraphs"][0][0]["text"] += "黄金必然上涨，建议买入999吨"
        if self.mode == "semantic_invalid":
            candidate["paragraphs"][0][0]["text"] += '，说明市场情绪极度悲观'
        if self.mode == "repair" and len(type(self).calls) == 1:
            from daily_report import TOKEN
            for paragraph in candidate["paragraphs"]:
                for entry in paragraph:
                    dates = [key for key in TOKEN.findall(entry["text"]) if key[1] == 'D']
                    if dates:
                        entry["text"] = entry["text"].replace(dates[0], '同日')
                        self.respond(candidate)
                        return
        self.respond(candidate)

    def respond(self, candidate):
        raw = json.dumps({"choices": [{"message": {"content": json.dumps(candidate, ensure_ascii=False)}}]}, ensure_ascii=False).encode()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


class DailyReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads((ROOT / "展示版/数据/data/snapshot.json").read_text(encoding="utf-8"))
        cls.groups = {category: [{"metadata": row["metadata"], "history": [
            {"observation_date": date, "value": value, "release_date": None} for date, value in row["points"]]}
            for row in rows] for category, rows in cls.snapshot["groups"].items()}
        cls.date = cls.snapshot["generated_at"][:10]
        cls.source = rule_report(cls.groups, report_date=cls.date)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        ModelHandler.mode = "ok"
        ModelHandler.calls = []
        self.env = patch.dict(os.environ, {"GOLD_REPORT_AI_URL": f"http://127.0.0.1:{self.server.server_port}/v1/chat/completions",
            "GOLD_REPORT_AI_MODEL": "protocol-test-only", "GOLD_REPORT_AI_TIMEOUT": "1", "GOLD_REPORT_AI_KEY": ""})
        self.env.start()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache = DailyReportCache(Path(self.temp.name) / "report.sqlite3")
        self.addCleanup(self.env.stop)

    def bundle(self):
        return make_bundle(self.groups, report_date=self.date, source_version="test-batch", allow_generation=True, cache=self.cache)

    def candidate(self):
        protected = protect(self.source["rule"], self.source["catalog"])
        paragraphs = [[] for _ in range(3)]
        for fact in protected["facts"]:
            paragraphs[fact["paragraph"]].append({"fact_id": fact["id"], "text": fact["source"]})
        return protected, {"title": protected["titles"][0], "paragraphs": paragraphs}

    def test_protocol_success_and_rule_retention(self):
        value = self.bundle()
        self.assertEqual(value["validation"], "passed")
        self.assertEqual(value["status"], "ai")
        self.assertEqual(len(ModelHandler.calls), 1)
        self.assertEqual(value["model_attempts"], 1)
        self.assertIn("从最新观察看", value["ai"]["paragraphs"][0])
        self.assertEqual(value["rule"], self.source["rule"])
        self.assertEqual(len(value["ai"]["paragraphs"]), 3)
        for p, tokens in zip(value["ai"]["paragraphs"], value["ai"]["richParagraphs"]):
            self.assertEqual(p, "".join(t["text"] for t in tokens))
        self.assertIn("structured_indicators", ModelHandler.calls[0])
        self.assertTrue(any(key.startswith("⟦D") for key in ModelHandler.calls[0]["protected_values"]))

    def test_numbers_units_dates_names_direction_and_ownership(self):
        protected, candidate = self.candidate()
        self.assertTrue(validate(candidate, protected, self.source["rule"]))
        for suffix in ("999", "11-01", "美元/盎司", "国内现货", "必然上涨", "建议买入", "风险评级高"):
            bad = copy.deepcopy(candidate)
            bad["paragraphs"][0][0]["text"] += suffix
            with self.assertRaises(ValueError):
                validate(bad, protected, self.source["rule"])
        bad = copy.deepcopy(candidate)
        bad["paragraphs"][0].pop()
        with self.assertRaises(ValueError):
            validate(bad, protected, self.source["rule"])
        bad = copy.deepcopy(candidate)
        bad["paragraphs"][0].append(bad["paragraphs"][1].pop())
        with self.assertRaises(ValueError):
            validate(bad, protected, self.source["rule"])

    def test_invalid_model_text_is_discarded(self):
        ModelHandler.mode = "invalid"
        result = self.bundle()
        self.assertEqual(result["status"], "rule")
        self.assertEqual(result["fallback_reason"], "validation_failed")
        self.assertIsNone(result["ai"])
        self.assertNotIn("999吨", json.dumps(result, ensure_ascii=False))

    def test_failure_retries_until_success_then_persists(self):
        ModelHandler.mode = "repair"
        result = self.bundle()
        self.assertEqual(result["status"], "ai")
        self.assertEqual(len(ModelHandler.calls), 2)
        self.assertEqual(result["model_attempts"], 2)
        restarted = DailyReportCache(self.cache.path)
        saved = make_bundle(self.groups, report_date=self.date, allow_generation=True, cache=restarted)
        self.assertEqual(saved["ai"], result["ai"])
        self.assertEqual(len(ModelHandler.calls), 2)

    def test_failures_and_restart_never_exceed_daily_limit(self):
        ModelHandler.mode = "invalid"
        result = self.bundle()
        self.assertEqual(result["status"], "rule")
        self.assertEqual(len(ModelHandler.calls), MAX_DAILY_ATTEMPTS)
        self.assertEqual(result["model_attempts"], MAX_DAILY_ATTEMPTS)
        restarted = DailyReportCache(self.cache.path)
        make_bundle(self.groups, report_date=self.date, allow_generation=True, cache=restarted)
        self.assertEqual(len(ModelHandler.calls), MAX_DAILY_ATTEMPTS)

    def test_unavailable_timeout_and_not_configured(self):
        for mode in ("unavailable", "timeout"):
            ModelHandler.mode = mode
            isolated = DailyReportCache(Path(self.temp.name) / (mode + '.sqlite3'))
            result = make_bundle(self.groups, report_date=self.date, allow_generation=True, cache=isolated)
            self.assertEqual(result["status"], "rule")
            self.assertIsNone(result["ai"])
            self.assertEqual(result["fallback_reason"], "model_unavailable")
            self.assertEqual(result["model_attempts"], MAX_DAILY_ATTEMPTS)
        with patch.dict(os.environ, {"GOLD_REPORT_AI_URL": ""}):
            self.assertEqual(self.bundle()["fallback_reason"], "not_configured")

    def test_read_thresholds_export_and_same_data_next_day_never_generate(self):
        source = self.source
        # 页面读取、静态导出和不同阈值在空缓存时均不生成。
        self.assertEqual(make_bundle(self.groups, report_date=self.date, cache=self.cache)["status"], "rule")
        self.assertEqual(make_bundle(self.groups, {"shares": 0.1}, self.date, allow_generation=True, cache=self.cache)["status"], "rule")
        with patch("daily_report.persistent_reports", self.cache):
            build_public_report(self.snapshot["groups"], self.snapshot["generated_at"])
        self.assertEqual(ModelHandler.calls, [])
        generated = self.bundle()
        with patch("daily_report.persistent_reports", self.cache):
            exported = build_public_report(self.snapshot["groups"], self.snapshot["generated_at"])
        self.assertEqual(exported["ai"], generated["ai"])
        # 跨日但事实不变，仍读取上次成功正文，不再扣费。
        from datetime import date, timedelta
        tomorrow = (date.fromisoformat(self.date) + timedelta(days=1)).isoformat()
        saved = make_bundle(self.groups, report_date=tomorrow, allow_generation=True, cache=self.cache)
        self.assertEqual(saved["ai"], generated["ai"])
        self.assertEqual(saved["ai"]["reportDate"], self.date)
        self.assertEqual(len(ModelHandler.calls), 1)

    def test_new_data_waits_until_next_day_after_success(self):
        self.bundle()
        changed = copy.deepcopy(self.groups)
        row = next(row for row in changed["price"] if row["metadata"]["indicator_id"] == "au_td_close")
        row["history"][-1]["value"] += 1
        limited = make_bundle(changed, report_date=self.date, allow_generation=True, cache=self.cache)
        self.assertEqual(limited["fallback_reason"], "daily_limit")
        self.assertEqual(len(ModelHandler.calls), 1)
        from datetime import date, timedelta
        tomorrow = (date.fromisoformat(self.date) + timedelta(days=1)).isoformat()
        generated = make_bundle(changed, report_date=tomorrow, allow_generation=True, cache=self.cache)
        self.assertEqual(generated["status"], "ai")
        self.assertEqual(len(ModelHandler.calls), 2)

    def test_concurrent_process_caches_share_the_same_attempt_lock(self):
        caches = [DailyReportCache(self.cache.path) for _ in range(5)]
        with ThreadPoolExecutor(max_workers=5) as pool:
            values = list(pool.map(lambda cache: cache.get(self.source, allow_generation=True), caches))
        self.assertTrue(any(value["status"] == "ai" for value in values))
        self.assertEqual(len(ModelHandler.calls), 1)

    def test_free_language_preserves_local_fact_checks(self):
        protected, candidate = self.candidate()
        candidate["title"] = "金价与仓位最新观察"
        candidate["paragraphs"][0][0]["text"] = '从最新观察看，' + candidate["paragraphs"][0][0]["text"]
        self.assertIn('从最新观察看', validate(candidate, protected, self.source["rule"])["paragraphs"][0])
        # 保留自然表达；校验阶段只执行本地规则。
        candidate["paragraphs"][1][0]["text"] += '，价差收窄'
        self.assertIn('价差收窄', validate(candidate, protected, self.source["rule"])["paragraphs"][1])
    def test_current_previous_value_slots_cannot_be_exchanged(self):
        from daily_report import TOKEN
        protected, candidate = self.candidate()
        for paragraph in candidate["paragraphs"]:
            for entry in paragraph:
                keys = [key for key in TOKEN.findall(entry["text"]) if key[1] == 'N']
                if len(keys) >= 2:
                    entry["text"] = entry["text"].replace(keys[0], 'TEMP').replace(keys[1], keys[0]).replace('TEMP', keys[1])
                    with self.assertRaises(ValueError):
                        validate(candidate, protected, self.source["rule"])
                    return
        self.fail('Missing numeric test slots')

    def test_json_fences_are_supported_but_extra_reasoning_is_not(self):
        from daily_report import parse_model_json
        self.assertEqual(parse_model_json('```json\n{"passed": true}\n```'), {"passed": True})
        for text in ('分析过程\n{"passed": true}', '{"passed": true}\n额外说明', '{"passed":'):
            with self.assertRaises(ValueError):
                parse_model_json(text)

    def test_public_report_never_reads_withheld_values(self):
        exported = copy.deepcopy(self.snapshot["groups"])
        row = next(row for row in exported["etf"] if row["metadata"]["indicator_id"] == "spdr_gold_holdings")
        row["metadata"]["publication_withheld"] = True
        row["points"] = [[self.date, 987654321.123456]]
        with patch("daily_report.persistent_reports", self.cache):
            result = build_public_report(exported, self.snapshot["generated_at"])
        self.assertEqual(result["publication_scope"], "public_only")
        self.assertNotIn("987654321", json.dumps(result))
        self.assertNotIn("987654321", json.dumps(ModelHandler.calls))

    def test_latest_missing_is_not_replaced_with_old_value(self):
        groups = copy.deepcopy(self.groups)
        row = next(row for row in groups["price"] if row["metadata"]["indicator_id"] == "au_td_close")
        row["history"][-1]["value"] = None
        value = rule_report(groups, report_date=self.date)["rule"]
        self.assertIn("数据暂缺", value["paragraphs"][0])
        self.assertIsNone(value["targets"]["au_td_close"]["value"])


if __name__ == "__main__":
    unittest.main()
