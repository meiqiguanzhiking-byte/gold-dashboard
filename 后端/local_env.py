"""读取本机后端配置；不执行脚本、不展开变量、不覆盖显式进程环境变量。"""
import os
from pathlib import Path

REPORT_KEYS = frozenset({"GOLD_REPORT_AI_URL", "GOLD_REPORT_AI_MODEL", "GOLD_REPORT_AI_KEY",
                         "GOLD_REPORT_AI_TIMEOUT", "GOLD_REPORT_AI_MAX_TOKENS", "GOLD_REPORT_NODE"})


def load_backend_env(path=None, environ=None):
    path = Path(path) if path is not None else Path(__file__).resolve().with_name(".env")
    environ = os.environ if environ is None else environ
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError):
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key not in REPORT_KEYS:
            continue
        if len(value) >= 2 and value[0] in ("'", '"') and value[-1] == value[0]:
            value = value[1:-1]
        # 密钥中的#、=等字符原样保留；本机配置不进入日志和任何API响应。
        environ.setdefault(key, value)
