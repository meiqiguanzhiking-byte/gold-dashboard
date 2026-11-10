"""本地源文件稳定后自动刷新缓存并启动日报；不依赖浏览器打开。"""
import asyncio
from pathlib import Path

from config import DATA_DIR, CENTRAL_BANK_CHANGES_FILE


def source_signature(directory=DATA_DIR):
    directory = Path(directory)
    paths = [path for path in (directory.iterdir() if directory.is_dir() else []) if path.is_file()
             and not path.name.startswith("~$") and path.suffix.lower() in (".csv", ".xlsx")]
    if CENTRAL_BANK_CHANGES_FILE.is_file():
        paths.append(CENTRAL_BANK_CHANGES_FILE)
    return tuple(sorted((str(path), path.stat().st_size, path.stat().st_mtime_ns) for path in paths))


class DailySourceMonitor:
    def __init__(self, store, reports, signature=source_signature, stable_polls=2):
        self.store, self.reports, self.signature = store, reports, signature
        try:
            self.loaded = signature()
        except OSError:
            self.loaded = None
        self.pending = None
        self.stable = 0
        self.stable_polls = stable_polls

    def check(self):
        current = self.signature()
        if current == self.loaded:
            self.pending, self.stable = None, 0
            return False
        if current != self.pending:
            self.pending, self.stable = current, 0
            return False
        self.stable += 1
        if self.stable < self.stable_polls:
            return False
        # 与手动刷新共用store锁和同一数据检查/额度流程。
        meta = self.store.reload()
        if self.signature() != current or meta.get("read_errors") or meta.get("status") != "ok":
            self.stable = 0
            return False
        self.loaded, self.pending, self.stable = current, None, 0
        self.reports.prewarm(self.store.snapshot)
        return True

    async def run(self):
        while True:
            await asyncio.sleep(30)
            try:
                await asyncio.to_thread(self.check)
            except (OSError, ValueError, RuntimeError):
                # 文件暂时不可读/正在写入时，下轮再检查，不调用模型。
                self.stable = 0
