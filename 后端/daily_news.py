"""日报数据就绪后采集昨日以来资讯；页面只读，原文只在内存处理。"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen
import hashlib
import json
import re
import sqlite3
import time
import xml.etree.ElementTree as ET

from config import LOCAL_TIMEZONE, PROJECT_ROOT
from daily_report import report_data_ready

# 只使用可直接取得的公开RSS；单一可靠来源即可收录，不把转载当作独立核验。
SOURCES = (
    {"id": "chinanews-finance", "name": "中国新闻网·财经", "url": "https://www.chinanews.com.cn/rss/finance.xml", "hosts": ("www.chinanews.com.cn", "www.chinanews.com"), "kind": "media"},
    {"id": "chinanews-world", "name": "中国新闻网·国际", "url": "https://www.chinanews.com.cn/rss/world.xml", "hosts": ("www.chinanews.com.cn", "www.chinanews.com"), "kind": "media"},
    {"id": "fed-press", "name": "美联储·新闻发布", "url": "https://www.federalreserve.gov/feeds/press_all.xml", "hosts": ("www.federalreserve.gov",), "kind": "official"},
    {"id": "fed-speeches", "name": "美联储·官员讲话", "url": "https://www.federalreserve.gov/feeds/speeches.xml", "hosts": ("www.federalreserve.gov",), "kind": "official"},
    {"id": "fed-research", "name": "美联储·研究", "url": "https://www.federalreserve.gov/feeds/feds_notes.xml", "hosts": ("www.federalreserve.gov",), "kind": "official"},
)
CATEGORIES = (
    ("黄金与投资需求", r"黄金|金价|购金|持金|贵金属|gold\b|bullion|gold-backed", "关注黄金投资需求、实物供需及交易条件；报道中的价格与持仓以其观察时点为准。"),
    ("央行与利率", r"美联储|央行|联储|利率|降息|加息|货币政策|FOMC|monetary policy|interest rate|federal funds|inflation|employment|macroeconom", "关注政策预期、实际利率与持有黄金的机会成本；官员讲话和研究观点不等于新的政策决定。"),
    ("宏观与汇率", r"通胀|CPI|PCE|非农|失业率|GDP|美元|人民币汇率|人民币中间价|外汇储备|国民经济|经济运行|社会消费品零售|固定资产投资|规模以上工业|关税|就业数据|原油生产|consumer price|payroll|unemployment|gross domestic|tariff", "关注通胀、增长及美元定价环境；单项数据不能直接解释当日金价涨跌。"),
    ("地缘与金融风险", r"制裁|军事|导弹|停火|战争|冲突|霍尔木兹|油轮|袭击|金融危机|主权债务|银行倒闭|违约|sanction|ceasefire|conflict|strait|default", "关注避险需求、能源通胀与流动性变化；单方表态按其声明呈现，不视为已独立证实的事件结果。"),
)


def clean_text(raw):
    raw = re.sub(r"<(script|style)\b[^>]*>[\s\S]*?</\1>", "", raw or "", flags=re.I)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", raw))).strip()


def classify(title):
    if re.search(r"疑似|传闻|爆料|可能袭击|促销|珠宝品牌|首饰品牌|将于|下周关注|下周展望", title):
        return None
    return next(((name, watchpoint) for name, pattern, watchpoint in CATEGORIES if re.search(pattern, title, re.I)), None)


def batch_window(cutoff):
    cutoff = cutoff.astimezone(LOCAL_TIMEZONE)
    start = (cutoff - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, cutoff


def published_time(raw):
    """仅接收真正带时间和时区的RSS发布日期，不把抓取日补成发布日期。"""
    try:
        result = parsedate_to_datetime(raw)
    except (ValueError, TypeError, IndexError):
        try:
            result = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return None
    return result.astimezone(LOCAL_TIMEZONE) if result.tzinfo is not None else None


def source_url(raw, source):
    try:
        parsed = urlparse(raw.strip())
        valid = parsed.scheme == "https" and parsed.hostname in source["hosts"] and not parsed.username and not parsed.password and parsed.port in (None, 443)
    except ValueError:
        return None
    if not valid:
        return None
    return urlunparse(parsed._replace(fragment="", query=""))


def excerpt(text, title):
    if not text or text == title:
        return title, "title"
    # 只展示原文短摘录，不重写数字，也不将半句接成新结论。
    parts = re.split(r"(?<=[。！？])", text)
    result = ""
    for part in parts:
        if len(result) + len(part) > 280:
            break
        result += part
        if len(result) >= 100:
            break
    return (result.strip(), "excerpt") if result.strip() else (title, "title")


def parse_feed(raw, source, start, end):
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("unsupported_xml")
    root = ET.fromstring(raw)
    entries = root.findall(".//item")
    if not entries and root.tag.rsplit("}", 1)[-1] != "rss":
        raise ValueError("unsupported_feed")
    output = []
    for item in entries[:100]:
        title = clean_text(item.findtext("title"))[:240]
        category = classify(title)
        observed = published_time(item.findtext("pubDate"))
        url = source_url(item.findtext("link", ""), source)
        if not category or observed is None or not start <= observed < end or not url:
            continue
        summary, summary_kind = excerpt(clean_text(item.findtext("description")), title)
        output.append({
            "id": hashlib.sha256(url.encode()).hexdigest()[:20], "category": category[0],
            "title": title, "published_at": observed.isoformat(timespec="seconds"),
            "event_at": None, "time_precision": "publication", "observation_period": None,
            "fact": summary, "summary_kind": summary_kind, "watchpoint": category[1],
            "verification": "official_source" if source["kind"] == "official" else "single_reliable_source",
            "sources": [{"id": source["id"], "institution": source["name"], "url": url}],
        })
    return output


def fetch_feed(source):
    request = Request(source["url"], headers={"User-Agent": "GoldDashboard/1.0 (public RSS reader)", "Accept": "application/rss+xml,application/xml,text/xml"})
    with urlopen(request, timeout=12) as response:
        if urlparse(response.geturl()).hostname not in source["hosts"]:
            raise ValueError("unexpected_redirect")
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000:
        raise ValueError("feed_too_large")
    return raw


def collect_news(cutoff, fetch=fetch_feed):
    start, end = batch_window(cutoff)
    events, failed, succeeded = [], [], []
    def read(source):
        return parse_feed(fetch(source), source, start, end)
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = [(source, pool.submit(read, source)) for source in SOURCES]
        for source, job in jobs:
            try:
                events.extend(job.result())
                succeeded.append(source["id"])
            except Exception:
                failed.append(source["name"])
    unique, titles = {}, set()
    for event in sorted(events, key=lambda event: event["published_at"], reverse=True):
        key = re.sub(r"[\W_]", "", event["title"]).lower()
        if event["id"] not in unique and key not in titles:
            unique[event["id"]] = event
            titles.add(key)
    return {
        "schema_version": 1, "report_date": end.date().isoformat(), "timezone": "Asia/Shanghai",
        "window_start": start.isoformat(timespec="seconds"), "window_end": end.isoformat(timespec="seconds"),
        "generated_at": datetime.now(LOCAL_TIMEZONE).isoformat(timespec="seconds"),
        "status": "failed" if not succeeded else "ready" if unique else "empty",
        "coverage": "partial", "missing_sources": failed, "successful_sources": succeeded,
        "events": list(unique.values())[:16], "summary_mode": "source_excerpt",
        "coverage_note": "按已接入来源筛选昨日以来的新发布，不代表全市场完整覆盖；允许单一可靠来源，事实为原文短摘录，关注点为固定研究路径。",
    }


class NewsCache:
    def __init__(self, path=None):
        self.path = Path(path) if path else PROJECT_ROOT / ".tools" / "daily-news.sqlite3"

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("CREATE TABLE IF NOT EXISTS news (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started REAL NOT NULL, bundle TEXT)")
            with db:
                yield db
        finally:
            db.close()

    def read(self):
        with self.connect() as db:
            latest = db.execute("SELECT day,bundle,started FROM news ORDER BY day DESC LIMIT 1").fetchone()
            saved = db.execute("SELECT bundle FROM news WHERE bundle IS NOT NULL AND json_extract(bundle,'$.status') IN ('ready','empty') ORDER BY day DESC LIMIT 1").fetchone()
        if not latest:
            return {"status": "not_ready", "events": []}
        current = json.loads(latest[1]) if latest[1] else {"status": "updating", "events": []}
        if current["status"] in ("ready", "empty"):
            return current
        if saved:
            return {**json.loads(saved[0]), "update_status": current["status"], "attempt_date": latest[0], "stale": True}
        return current

    def update(self, cutoff, collect=collect_news, edition="latest"):
        day = cutoff.astimezone(LOCAL_TIMEZONE).date().isoformat()
        key = day + "|" + edition
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT attempts,started,bundle FROM news WHERE day=?", (key,)).fetchone()
            if row:
                saved = json.loads(row[2]) if row[2] else {}
                if saved.get("status") in ("ready", "empty") or row[0] >= 2 or row[1] > time.time() - 120:
                    return
                if saved.get("window_end"):
                    cutoff = datetime.fromisoformat(saved["window_end"])
            attempts = row[0] + 1 if row else 1
            start, end = batch_window(cutoff)
            pending = {"status": "updating", "report_date": day, "window_start": start.isoformat(), "window_end": end.isoformat(), "events": []}
            db.execute("INSERT INTO news VALUES (?,?,?,?) ON CONFLICT(day) DO UPDATE SET attempts=excluded.attempts,started=excluded.started,bundle=excluded.bundle", (key, attempts, time.time(), json.dumps(pending)))
        try:
            bundle = collect(cutoff)
            bundle["data_observation_date"] = edition
        except Exception:
            bundle = {**pending, "status": "failed"}
        with self.connect() as db:
            db.execute("UPDATE news SET bundle=?,started=0 WHERE day=?", (json.dumps(bundle, ensure_ascii=False), key))


class DailyNewsService:
    def __init__(self, cache=None):
        self.cache = cache or NewsCache()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="daily-news")
        self.lock, self.job = Lock(), None

    def prepare(self, cutoff, edition):
        self.cache.update(cutoff, edition=edition)
        result = self.cache.read()
        if result.get("status") == "failed" or result.get("update_status") == "failed":
            time.sleep(2)
            self.cache.update(cutoff, edition=edition)

    def prewarm(self, state):
        if not report_data_ready(state):
            return
        with self.lock:
            if self.job and not self.job.done():
                return
            edition = next(row["history"][-1]["observation_date"] for row in state["groups"]["price"] if row["metadata"]["indicator_id"] == "au_td_close")
            cutoff = datetime.fromisoformat(state["meta"]["loaded_at"])
            self.job = self.pool.submit(self.prepare, cutoff, edition)

    def read(self):
        try:
            return self.cache.read()
        except (OSError, sqlite3.Error, ValueError):
            return {"status": "failed", "events": []}


def public_news(policy, cache=None):
    allowed = set(policy.get("daily_news_public_sources", []))
    if not allowed:
        return {"status": "withheld", "events": [], "publication_scope": "public_only"}
    news = (cache or NewsCache()).read()
    return {**news, "events": [event for event in news["events"] if all(source["id"] in allowed for source in event["sources"])], "publication_scope": "public_only"}


news_service = DailyNewsService()
