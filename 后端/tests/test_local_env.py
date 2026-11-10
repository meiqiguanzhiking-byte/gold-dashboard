import tempfile
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from local_env import load_backend_env


class LocalEnvironmentTests(unittest.TestCase):
    def test_persistent_config_special_characters_and_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text('# comment\nGOLD_REPORT_AI_URL=https://example.invalid/chat/completions\n'
                            'GOLD_REPORT_AI_MODEL="example-model"\nGOLD_REPORT_AI_KEY="example#key=value"\n'
                            'HOME=must-not-change\n', encoding="utf-8-sig")
            env = {"GOLD_REPORT_AI_MODEL": "explicit-model", "HOME": "original"}
            load_backend_env(path, env)
            self.assertEqual(env["GOLD_REPORT_AI_KEY"], "example#key=value")
            self.assertEqual(env["GOLD_REPORT_AI_MODEL"], "explicit-model")
            self.assertEqual(env["HOME"], "original")
            self.assertEqual(env["GOLD_REPORT_AI_URL"], "https://example.invalid/chat/completions")

    def test_missing_file_is_optional(self):
        env = {}
        with tempfile.TemporaryDirectory() as directory:
            load_backend_env(Path(directory) / "not-present", env)
        self.assertEqual(env, {})

    def test_deepseek_without_key_does_not_send_data(self):
        from daily_report import chat_completion
        with patch.dict("os.environ", {"GOLD_REPORT_AI_URL": "https://api.deepseek.com/chat/completions",
                                      "GOLD_REPORT_AI_MODEL": "deepseek-chat", "GOLD_REPORT_AI_KEY": ""}):
            with patch("daily_report.urlopen") as request:
                with self.assertRaisesRegex(RuntimeError, "not_configured"):
                    chat_completion([])
                request.assert_not_called()

    def test_token_and_input_limits_without_paid_request(self):
        from daily_report import chat_completion, MAX_INPUT_CHARS, MAX_TOTAL_TOKENS
        with patch.dict("os.environ", {"GOLD_REPORT_AI_URL": "http://127.0.0.1:1/chat/completions",
                                      "GOLD_REPORT_AI_MODEL": "test", "GOLD_REPORT_AI_MAX_TOKENS": "99999"}):
            with patch("daily_report.urlopen") as request:
                request.return_value.__enter__.return_value.read.return_value = json.dumps({
                    "choices": [{"finish_reason": "stop", "message": {"content": '{}'}}]}).encode()
                chat_completion([{"role": "user", "content": "test"}])
                payload = json.loads(request.call_args.args[0].data)
                input_budget = len('test'.encode()) + 64 + 256
                self.assertEqual(payload["max_tokens"] + input_budget, MAX_TOTAL_TOKENS)
                # 即便显式取消旧的输出上限，也不能绕过合计15000。
                chat_completion([{"role": "user", "content": "test"}], output_limit=None)
                self.assertEqual(json.loads(request.call_args.args[0].data)["max_tokens"] + input_budget, MAX_TOTAL_TOKENS)
            with patch("daily_report.urlopen") as request:
                with self.assertRaisesRegex(ValueError, "input_budget_exceeded"):
                    chat_completion([{"role": "user", "content": "字" * (MAX_INPUT_CHARS + 1)}])
                request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
