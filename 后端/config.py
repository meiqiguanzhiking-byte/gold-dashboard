"""本地数据路径与服务设置；真实数据目录只在此处配置。"""
from datetime import timedelta, timezone
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# 默认沿用项目旁的数据目录；其他机器可通过环境变量指定，无须写入本机绝对路径。
DATA_DIR = Path(os.environ.get("GOLD_DATA_DIR") or PROJECT_ROOT.parent / "数据构建" / "数据更新" / "全量数据")
LOCAL_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Shanghai")
ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"]
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "gb18030", "gbk")
# 健康度提示阈值，不代表来源承诺的发布日期。
LAG_DAYS = {"日度": 7, "周度": 21, "月度": 75}
