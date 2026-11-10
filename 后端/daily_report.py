"""同源规则底稿 + 本地Chat Completions润色；事实保护、严格校验、失败闭合。"""
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
import sqlite3
import time
import hashlib
import json
import os
import re
import subprocess
from threading import Lock
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from config import LOCAL_TIMEZONE, PROJECT_ROOT
from data_loader import now_iso

VERSION = "daily-ai-locked-v3"
MAX_DAILY_ATTEMPTS = 5
MAX_TOTAL_TOKENS = 15000
MAX_OUTPUT_TOKENS = MAX_TOTAL_TOKENS
MAX_INPUT_CHARS = 24000
DEFAULT_THRESHOLDS = {"spread": 0, "price": 1, "volatility": 1, "rates": 1, "shares": 0.2, "volume": 5, "position": 0.2}
TOKEN = re.compile(r"⟦[INDUS]\d{4}⟧")
NUMBER = re.compile(r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")
UNIT = re.compile(r"美元/盎司|元/克|个百分点|基点|万份|份|吨|%")
DIRECTION = re.compile(r"上涨|下跌|升水|贴水|上移|下移|扩大|收窄|上升|下降|增强|减弱|增加|减少|持平")
FIELDS = ("value", "previousValue", "date", "previousDate", "change", "percent", "unit", "frequency")


def rule_report(groups, thresholds=None, report_date=None):
    """调用前端纯JS模板，避免Python另写一份指标计算和筛选。"""
    value = {"groups": groups, "thresholds": thresholds or {},
             "reportDate": report_date or datetime.now(LOCAL_TIMEZONE).date().isoformat()}
    result = subprocess.run([os.environ.get("GOLD_REPORT_NODE", "node"), str(PROJECT_ROOT / "前端" / "report-bridge.mjs")],
                            input=json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8",
                            capture_output=True, timeout=25, check=True,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return json.loads(result.stdout)


def split_facts(rule):
    """只在普通文本的句号处分句，不能将小数点或富文本标记拆开。"""
    facts = []
    for paragraph, segments in enumerate(rule["richParagraphs"]):
        pending = []
        for token in segments:
            if token["type"] != "text":
                pending.append(token)
                continue
            parts = token["text"].split("。")
            for index, part in enumerate(parts):
                if part:
                    pending.append({"type": "text", "text": part})
                if index < len(parts) - 1 and pending:
                    facts.append({"segments": pending, "source_paragraph": paragraph})
                    pending = []
        if pending:
            facts.append({"segments": pending, "source_paragraph": paragraph})
    return facts


def protect(rule, catalog):
    mapping, facts = {}, []

    def save(kind, text, **extra):
        key = f"⟦{kind}{len(mapping):04d}⟧"
        mapping[key] = {"text": text, **extra}
        return key

    def protect_text(text):
        # 日期整体保护；数值与紧随其后的单位整体保护，防止换单位或换正负号。
        pattern = r"\d{4}-\d{2}-\d{2}|(?<!\d)\d{2}-\d{2}(?!\d)|" + NUMBER.pattern + r"(?:美元/盎司|元/克|个百分点|基点|万份|份|吨|%)?|" + UNIT.pattern + "|" + DIRECTION.pattern
        def replace(match):
            value = match.group()
            kind = "D" if re.fullmatch(r"(?:\d{4}-)?\d{2}-\d{2}", value) else "N" if NUMBER.match(value) else "U" if UNIT.fullmatch(value) else "S"
            return save(kind, value, type="text")
        return re.sub(pattern, replace, text)

    for index, source in enumerate(split_facts(rule)):
        parts, ids = [], []
        for token in source["segments"]:
            if token["type"] == "indicator":
                ids.append(token["id"])
                parts.append(save("I", token["text"], type="indicator", id=token["id"]))
            elif token["type"] == "value":
                parts.append(save("N", token["text"], type="value"))
            else:
                parts.append(protect_text(token["text"]))
        text = "".join(parts)
        # 只精简AI编辑底稿中的重复解释提醒；规则原文和全部事实保护符均保留。
        for reminder in ("，体现成交规模变化，不代表资金净流出", "，体现成交规模变化，不代表资金净流入",
                         "，净额由多头变化减空头变化形成，不代表今日交易流量",
                         "，仅凭总量无法判断加多、加空或平仓的具体来源",
                         "，不指向未来涨跌方向", "，但不能直接认定为当天金价变化的原因"):
            text = text.replace(reminder, "")
        group = 0 if source["source_paragraph"] == 0 else 1
        if source["source_paragraph"] == 2 and any(catalog.get(id, {}).get("group") in ("rates", "volatility") or id == "ust_10y_real_yield" for id in ids):
            group = 2
        facts.append({"id": f"F{index:03d}", "paragraph": group, "source": text, "indicator_ids": ids})
    conclusions = ["黄金市场最新观察", "黄金行情、价差与配置变化"]
    first_sentence = rule["paragraphs"][0].split("。")[0]
    if not NUMBER.search(first_sentence) and len(first_sentence) <= 40 and first_sentence:
        conclusions.insert(0, first_sentence)
    return {"facts": facts, "mapping": mapping, "titles": conclusions}


def restore(text, mapping):
    return TOKEN.sub(lambda match: mapping[match.group()]["text"], text)


def rich_text(text, mapping):
    result, cursor = [], 0
    for match in TOKEN.finditer(text):
        if match.start() > cursor:
            result.append({"type": "text", "text": text[cursor:match.start()]})
        result.append(mapping[match.group()])
        cursor = match.end()
    if cursor < len(text):
        result.append({"type": "text", "text": text[cursor:]})
    return result


def validate(candidate, protected, rule):
    """逐事实、逐保护项和恢复后双重校验，校验不通过绝不发布模型输出。"""
    if not isinstance(candidate, dict) or set(candidate) != {"title", "paragraphs"}:
        raise ValueError("output_schema")
    title = candidate["title"]
    if not isinstance(title, str) or not 4 <= len(title) <= 60 or NUMBER.search(title) or re.search(r"[<>\n⟦⟧]", title):
        raise ValueError("unsupported_title")
    paragraphs = candidate["paragraphs"]
    if not isinstance(paragraphs, list) or len(paragraphs) != 3 or any(not isinstance(p, list) or not p for p in paragraphs):
        raise ValueError("three_paragraphs_required")
    expected = {f["id"]: f for f in protected["facts"]}
    seen, strings, rich = [], [], []
    for index, paragraph in enumerate(paragraphs):
        texts, tokens = [], []
        for entry in paragraph:
            if not isinstance(entry, dict) or set(entry) != {"fact_id", "text"}:
                raise ValueError("fact_schema")
            fact = expected.get(entry["fact_id"])
            text = entry["text"]
            if not fact or fact["paragraph"] != index or not isinstance(text, str) or not text.strip() or len(text) > 4000:
                raise ValueError("fact_modified_or_wrong_paragraph")
            # 允许完全改写语句，事实保护项仍必须属于原条目且恰好使用一次。
            source_tokens, written_tokens = TOKEN.findall(fact["source"]), TOKEN.findall(text)
            if Counter(source_tokens) != Counter(written_tokens):
                raise ValueError("fact_placeholder_missing_or_swapped")
            # 指标—数值槽位和观察日—比较日分别保持原顺序，避免把前值写成现值。
            for kinds in ("INU", "D"):
                if [key for key in source_tokens if key[1] in kinds] != [key for key in written_tokens if key[1] in kinds]:
                    raise ValueError("fact_value_or_date_order_changed")
            if re.search(r"[<>⟦⟧]", TOKEN.sub("", text)):
                raise ValueError("unexpected_markup_or_placeholder")
            plain_text = TOKEN.sub("", text)
            plain_source = TOKEN.sub("", fact["source"])
            for phrase in ("建议", "买入", "卖出", "目标价", "风险评级", "必然", "必涨", "必跌"):
                if plain_text.count(phrase) > plain_source.count(phrase):
                    raise ValueError("unsupported_advice_or_prediction")
            for name in {v["text"] for v in protected["mapping"].values() if v["type"] == "indicator"}:
                if plain_text.count(name) > plain_source.count(name):
                    raise ValueError("unprotected_indicator_added")
            seen.append(fact["id"])
            text = text.strip()
            if text[-1] not in "。；，！？":
                text += "。"
            texts.append(text)
            tokens.extend(rich_text(text, protected["mapping"]))
        strings.append("".join(texts))
        rich.append(tokens)
    if Counter(seen) != Counter(list(expected)):
        raise ValueError("facts_missing_or_duplicate")
    body = "".join(strings)
    if Counter(TOKEN.findall(body)) != Counter(list(protected["mapping"])):
        raise ValueError("placeholder_missing_or_duplicate")
    restored = [restore(p, protected["mapping"]) for p in strings]
    original, output = "".join(rule["paragraphs"]), "".join(restored)
    # 原始方向由逐事实S占位符保护；此处只执行本地规则，不调用模型审校。
    for regex in (NUMBER, UNIT):
        if Counter(regex.findall(original)) != Counter(regex.findall(output)):
            raise ValueError("number_or_unit_modified")
    source_names = Counter(t["text"] for p in rule["richParagraphs"] for t in p if t["type"] == "indicator")
    output_names = Counter(t["text"] for p in rich for t in p if t["type"] == "indicator")
    if source_names != output_names or TOKEN.search(output):
        raise ValueError("indicator_modified")
    if any(phrase in title for phrase in ("建议", "买入", "卖出", "目标价", "风险评级", "必然", "必涨", "必跌")):
        raise ValueError("unsupported_title_claim")
    return {**rule, "title": title, "paragraphs": restored, "richParagraphs": rich,
            "titles": ["行情变化", "价差及资金仓位", "波动率与利率等指标含义"]}


SYSTEM = """你是为资管机构管理层撰写黄金市场日报的编辑。请把生硬的数值底稿写成有主线、衔接自然的中文市场短评，真正重写语言，不是换几个近义词或逐项报数。
正文约1000至1500字，以实际信息量为准，不为凑篇幅增加事实或套话。
风格：标题用简短一句概括输入支持的市场现象；每段先说最重要的现象，再用关键数据展开，使用自然的转折、并列和承接。可以使用“本期金价走高”“内外走势分化”等数据支持的概括。标题不能凭空加入配置、情绪或资金流向；没有ETF事实就不谈ETF配置，没有此前下跌的证据就不用“反弹”“回升”。避免“由…变为…变化…”句式反复堆叠，避免重复解释筛选机制、占位符或校验流程；不照抄规则版，不写操作说明。
请真正改变句子结构：把括号里的日期融入叙述，用“升至”“降至”“较上一观察期”“与之同时”等表达承接事实，避免每句都先报指标再接“变化…，对应…，体现…”。不要只在原句前加“方面”“从最新观察看”。每段形成一条有数据支持的叙述主线，避免连续罗列数据行。
句式示意（方括号只是说明，不可原样输出）：把“[指标]（[观察日]较[比较日]）由[前值]变为[现值]，变化[差额]（[幅度]），处于近[年数]年[分位]，交易活跃度[方向]”改成“[指标]在[观察日]由[比较日]的[前值]降至[现值]，较前期变动[差额]（[幅度]），位于近[年数]年[分位]分位，交易活跃度随之[方向]”。升降须据事实决定；在保留数值保护符原顺序的范围内，主动变化句式。
删除原稿中重复的读者提醒，例如“不代表资金净流入/流出”“不能直接认定为当天金价原因”“不指向未来涨跌方向”“仅凭总量无法判断加多、加空或平仓”“净额由多头变化减空头变化形成”；这些是你应遵守的解释边界，不是需要向领导逐项宣读的内容。保持所有保护符，用正面表达说明数据含义；如提醒中有保护符，则融入合规叙述，不能直接删掉。不要新增数值、单位或未保护的指标全称来总结。
结构：第一段讲国内外黄金现货和期货行情；第二段串联国内外价差、ETF配置、成交与仓位；第三段结合波动率、利率说明数据可能反映的含义。句子可以重新组织、使用长短句、调整同段事实顺序，省去不承载事实的模板套话，但不能添加输入之外的信息。
输出JSON且仅含title和paragraphs。title自由撰写4至40字，不带数字或日期，只概括有依据的现象。paragraphs是三组非空数组。每个数组项仅含fact_id和text，text是你重写的一个叙述片段，使用自然标点；每组片段直接拼接成为一段正文。每个fact必须恰好一次，放入其paragraph指定的组，段内可重新排序，片段间可用逗号衔接。
数字、日期、单位、指标名称和方向已替换为保护符。请先通过protected_values理解其含义，输出时使用原保护符，不输出对应的原始数字、日期和名称。每个fact的source中的所有保护符必须在该fact的text中恰好一次；不得挪用其他fact的保护符。I/N/U（指标/数值/单位）之间的原相对次序必须保留，日期D之间的相对次序也保留；S方向符可在同一事实内合理换位，但不能改变它描述的对象、否定关系和含义。可以改变保护符周围的全部语言，不受任何预设句式限制。
即使多个事实的日期相同，也必须分别保留各自D保护符，不可用“同日”“同步”替代。输出前逐项检查每个fact的保护符与source一致，不能因精简文字遗漏任何一个。
不得调换现值、前值、变动值和百分比的角色；不得重新计算；不得把国内外价差写成国内期货相对现货升贴水；不同日期必须明确，周度数据不能称今日交易。所有缺失使用“数据暂缺”，不回退旧值。
历史波动率上升只能说明价格波动加大，不能预测未来涨跌；ETF份额/持金量变化只解释配置需求，不等同现金净流入；成交量只说明活跃度；总持仓不能判断加多、加空或平仓，除非有多空分项；实际利率变化只提供持金机会成本背景，不认定为当天金价变化的原因。
不得增加外部原因、买卖建议、目标价、风险评级或确定因果。相关背景最多使用“可能与”“同时出现”“从数据看”，且输入必须提供对应依据。不能仿写参考文章中的纳指、油价、流动性需求等未提供事实。只输出标题和三段正文的JSON，不输出分析过程。"""


def parse_model_json(content):
    if not isinstance(content, str):
        raise ValueError("invalid_model_content")
    text = content.strip()
    fence = re.fullmatch(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", text)
    if fence:
        text = fence.group(1).strip()
    # 只接受一份完整JSON；不从说明或思考过程里猜测截取内容。
    return json.loads(text)


def chat_completion(messages, *, output_limit="configured", telemetry=None):
    endpoint = os.environ.get("GOLD_REPORT_AI_URL", "").strip()
    model = os.environ.get("GOLD_REPORT_AI_MODEL", "").strip()
    if not endpoint or not model:
        raise RuntimeError("not_configured")
    parsed = urlparse(endpoint)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError("invalid_config")
    if parsed.hostname == "api.deepseek.com" and not os.environ.get("GOLD_REPORT_AI_KEY", "").strip():
        raise RuntimeError("not_configured")
    timeout = min(120, max(1, float(os.environ.get("GOLD_REPORT_AI_TIMEOUT", "20"))))
    headers = {"Content-Type": "application/json"}
    if os.environ.get("GOLD_REPORT_AI_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["GOLD_REPORT_AI_KEY"]
    payload = {"model": model, "temperature": 0, "stream": False,
               "response_format": {"type": "json_object"},
               "messages": messages}
    # 用UTF-8字节数作保守输入token预算（不是实际token数），另留消息封装余量。
    # 先扣输入再给输出分配额度，禁止通过诊断参数绕过合计上限。
    input_budget = sum(len(message["content"].encode("utf-8")) + 64 for message in messages) + 256
    remaining = MAX_TOTAL_TOKENS - input_budget
    if remaining < 256:
        raise ValueError("input_budget_exceeded")
    requested = int(os.environ.get("GOLD_REPORT_AI_MAX_TOKENS", str(MAX_OUTPUT_TOKENS))) if output_limit == "configured" else MAX_OUTPUT_TOKENS if output_limit is None else int(output_limit)
    payload["max_tokens"] = min(MAX_OUTPUT_TOKENS, max(256, requested), remaining)
    if sum(len(message["content"]) for message in messages) > MAX_INPUT_CHARS:
        raise ValueError("input_budget_exceeded")
    if parsed.hostname == "api.deepseek.com":
        # DeepSeek Flash默认推理会消耗输出额度；本任务只编辑输入事实。
        payload["thinking"] = {"type": "disabled"}
    with urlopen(Request(endpoint, data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"), headers=headers), timeout=timeout) as response:
        raw = response.read(256_001)
    if len(raw) > 256_000:
        raise ValueError("output_too_large")
    response_body = json.loads(raw)
    choice = response_body["choices"][0]
    if telemetry is not None:
        telemetry({"usage": response_body.get("usage", {}), "finish_reason": choice.get("finish_reason"),
                   "requested_max_tokens": payload.get("max_tokens"), "input_token_budget": input_budget,
                   "total_token_limit": MAX_TOTAL_TOKENS, "model": response_body.get("model", model)})
    if response_body.get("usage", {}).get("total_tokens", 0) > MAX_TOTAL_TOKENS:
        raise ValueError("total_token_budget_exceeded")
    if choice.get("finish_reason") == "length":
        raise ValueError("model_output_truncated")
    return parse_model_json(choice["message"]["content"])


def structured_indicators(rule):
    return [{"id": id, "name": row["label"], **{field: row.get(field) for field in FIELDS}}
            for id, row in rule["targets"].items()]


COMPACT_SYSTEM = """你是资管机构黄金日报编辑。将输入facts改写为自然流畅的中文市场短评，结论先行，再用数字支撑，避免逐项机械报数与重复免责声明。正文约1000至1500字；信息不足不凑字数。
只输出JSON：title及paragraphs。标题4至40字，不含数字；paragraphs为三个非空数组，每项仅fact_id和text。三段依次讲行情、价差及ETF/成交/仓位、波动率与利率含义。每个fact恰好出现一次，放入它指定的paragraph组，同组可换序。
facts中的⟦I/N/D/U/Sxxxx⟧为指标、数值、日期、单位、方向保护符，含义见protected_values。每个fact的所有保护符在其text中各用一次，不能借用别的fact或用原文数值替换。I/N/U相对顺序不变，D相对顺序不变，现值、前值、变动值角色不变。相同日期仍逐项保留D，不用同日替代。输出前自行检查保护符完整性。保护符周围语言可自由重写，省去不承载事实的套话。
标题、概括、方向、解释只能来自输入事实。国内外价差不能写成期货相对现货升贴水，部分期限升贴水不能笼统概括全部；日期频率不同不可称同步今日变化，缺失写数据暂缺。不要重新计算或引入外部原因，不写无历史依据的反弹、连续涨跌、新高新低。
波动率上升仅说明波动加大，不能预测涨跌；ETF份额/持金量仅说明配置需求，不等于现金净流入；成交量仅说明活跃度；总持仓不可判断加多加空平仓，多空来源只能依据明确分项；实际利率仅提供持金机会成本背景，不能认定是当天行情原因。禁止编造因果、买卖建议、目标价、风险评级或分析过程。"""


def call_model(protected, rule, previous_error=None, telemetry=None):
    # 每次尝试只有一次付费请求，无第二次模型审校。
    return chat_completion([{"role": "system", "content": COMPACT_SYSTEM}, {"role": "user", "content": json.dumps({
        "report_date": rule["reportDate"], "observation_dates": rule["observationDates"],
        "structured_indicators": [{key: row[key] for key in ("id", "name", "date", "previousDate", "value", "previousValue", "unit")} for row in structured_indicators(rule)],
        "facts": [{key: fact[key] for key in ("id", "paragraph", "source")} for fact in protected["facts"]],
        "protected_values": {key: value["text"] for key, value in protected["mapping"].items()},
        "previous_validation_error": previous_error,
        "reminder": "完整保留日期和数值保护符；自行检查，不能用同日省略日期。"}, ensure_ascii=False, separators=(",", ":"))}], telemetry=telemetry)


def rule_bundle(source, source_version=None, reason=None):
    rule = source["rule"]
    value = {"schema_version": 1, "version": VERSION, "source_version": source_version,
             "report_date": rule["reportDate"], "observation_dates": rule["observationDates"],
             "thresholds": source["thresholds"], "rule": rule, "ai": None,
             "status": "rule", "validation": "not_run", "generated_at": now_iso()}
    if reason:
        value["fallback_reason"] = reason
    return value


def fact_fingerprint(rule):
    # 不含加载时间、报告日、提示词版本、模型配置；实际日报事实未变就复用。
    facts = {key: rule[key] for key in ("paragraphs", "richParagraphs", "targets")}
    return hashlib.sha256(json.dumps(facts, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def observation_edition(rule):
    # 仅主要价格观察日推进才开启新一期；周频/月频指标各自保留原日期。
    return max(re.findall(r"\d{4}-\d{2}-\d{2}", rule.get("observationDates", "")), default="missing")


def generate_once(source, source_version=None, previous_error=None):
    result = rule_bundle(source, source_version)
    metrics = []
    try:
        protected = protect(source["rule"], source["catalog"])
        candidate = call_model(protected, source["rule"], previous_error, telemetry=metrics.append)
        result["ai"] = validate(candidate, protected, source["rule"])
        result.update(status="ai", validation="passed")
    except Exception as error:
        reason = "not_configured" if isinstance(error, RuntimeError) and str(error) == "not_configured" else "validation_failed" if isinstance(error, (ValueError, KeyError, TypeError)) else "model_unavailable"
        result.update(fallback_reason=reason, validation="failed" if reason == "validation_failed" else "not_run",
                      _error=str(error) if isinstance(error, ValueError) else reason)
    result["generated_at"] = now_iso()
    if metrics:
        result["model_usage"] = metrics[-1]
    return result


class DailyReportCache:
    """先持久记录每日尝试额度再请求；成功锁定，失败最多重试至每日上限。"""
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else PROJECT_ROOT / ".tools" / "daily-report.sqlite3"

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.execute("CREATE TABLE IF NOT EXISTS reports (report_day TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, bundle TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, started REAL NOT NULL DEFAULT 0)")
            with db:
                yield db
        finally:
            db.close()

    def seed(self, bundle):
        """迁移已经付费生成的日报；不调用接口，不覆盖已有额度记录。"""
        if bundle.get("status") != "ai" or bundle.get("validation") != "passed" or not bundle.get("ai"):
            raise ValueError("invalid_saved_report")
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO reports VALUES (?, ?, ?, 1, 0)", (
                bundle["report_date"], fact_fingerprint(bundle["rule"]), json.dumps(bundle, ensure_ascii=False)))

    @staticmethod
    def response(saved, source, source_version):
        result = json.loads(saved) if isinstance(saved, str) else dict(saved)
        # 正文原生成日期不改写；响应批次与本次请求匹配。
        result.update(source_version=source_version, report_date=source["rule"]["reportDate"],
                      rule=source["rule"], version=VERSION, cache_hit=True,
                      ai_matches_current=not result.get("ai") or fact_fingerprint(result["rule"]) == fact_fingerprint(source["rule"]))
        return result

    def get(self, source, source_version=None, allow_generation=False, reuse_daily_saved=False):
        fingerprint = fact_fingerprint(source["rule"])
        day = source["rule"]["reportDate"]
        edition = observation_edition(source["rule"])
        storage_key = day + "|" + edition
        previous_error = None
        while True:
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT fingerprint, attempts, started, bundle FROM reports WHERE report_day=?", (storage_key,)).fetchone()
                # 兼容原来的自然日记录，原有成功稿及已消耗额度均保留。
                legacy = db.execute("SELECT fingerprint, attempts, started, bundle FROM reports WHERE report_day=?", (day,)).fetchone()
                row_key = storage_key
                if not row and legacy and observation_edition(json.loads(legacy[3])["rule"]) == edition:
                    row, row_key = legacy, day
                # 动态看板全天可查看已保存稿；公开导出仍要求事实完全匹配。
                if row and reuse_daily_saved and json.loads(row[3]).get("status") == "ai":
                    return self.response(row[3], source, source_version)
                same = db.execute("SELECT report_day, bundle FROM reports WHERE fingerprint=? ORDER BY report_day DESC LIMIT 1", (fingerprint,)).fetchone()
                if same:
                    saved = json.loads(same[1])
                    if saved.get("status") == "ai" or (same[0] in (day, storage_key) and not allow_generation):
                        return self.response(saved, source, source_version)
                if not allow_generation:
                    return rule_bundle(source, source_version, "no_saved_report")
                used, active = db.execute("SELECT COALESCE(SUM(attempts),0), COALESCE(MAX(started),0) FROM reports WHERE report_day=? OR report_day LIKE ?", (day, day + "|%" )).fetchone()
                if used >= MAX_DAILY_ATTEMPTS or active > time.time() - 180:
                    return self.response(row[3], source, source_version) if row and row[0] == fingerprint else rule_bundle(source, source_version, "daily_limit")
                if row:
                    if json.loads(row[3]).get("status") == "ai":
                        return rule_bundle(source, source_version, "daily_limit")
                    if row[1] >= MAX_DAILY_ATTEMPTS or row[2] > time.time() - 180:
                        return self.response(row[3], source, source_version) if row[0] == fingerprint else rule_bundle(source, source_version, "daily_limit")
                    attempt = row[1] + 1
                else:
                    attempt = 1
                reservation = rule_bundle(source, source_version, "attempt_locked")
                reservation["model_attempts"] = attempt
                db.execute("INSERT INTO reports VALUES (?, ?, ?, ?, ?) ON CONFLICT(report_day) DO UPDATE SET fingerprint=excluded.fingerprint, bundle=excluded.bundle, attempts=excluded.attempts, started=excluded.started", (
                    row_key, fingerprint, json.dumps(reservation, ensure_ascii=False), attempt, time.time()))
            # 占用记录已提交才允许发请求；超时/崩溃也消耗一次额度。
            result = generate_once(source, source_version, previous_error)
            previous_error = result.pop("_error", None)
            result["model_attempts"] = attempt
            with self.connect() as db:
                db.execute("UPDATE reports SET bundle=?, started=0 WHERE report_day=? AND fingerprint=?", (
                    json.dumps(result, ensure_ascii=False), row_key, fingerprint))
            if result["status"] == "ai" or used + 1 >= MAX_DAILY_ATTEMPTS or result.get("fallback_reason") == "not_configured" or previous_error == "input_budget_exceeded":
                return result
            time.sleep(1)


persistent_reports = DailyReportCache()


def report_data_ready(state):
    meta = state["meta"]
    if meta.get("read_errors") or meta.get("status", "ok") != "ok":
        return False
    required = {"au_td_close", "london_gold_spot", "usdcnh", "gold_domestic_spread",
                "gold_futures_spread", "gold_futures_secondary_spread", "gold_futures_daily_quotes"}
    prices = {row["metadata"]["indicator_id"]: row["history"][-1]
              for row in state["groups"].get("price", []) if row.get("history")
              and row["metadata"]["indicator_id"] in required}
    return required <= prices.keys() and all(row["value"] is not None for row in prices.values()) and len({row["observation_date"] for row in prices.values()}) == 1


def make_bundle(groups, thresholds=None, report_date=None, source_version=None, *, allow_generation=False, cache=None, reuse_daily_saved=False):
    # AI固定使用每日默认阈值生成一稿；自定义阈值仅重算规则版。
    source = rule_report(groups, thresholds, report_date)
    if source["thresholds"] != DEFAULT_THRESHOLDS:
        return rule_bundle(source, source_version, "threshold_changed")
    try:
        return (cache or persistent_reports).get(source, source_version, allow_generation, reuse_daily_saved)
    except (OSError, sqlite3.Error, ValueError, TypeError):
        # 持久化不可用时不绕过额度保护，更不能直接请求模型。
        return rule_bundle(source, source_version, "cache_unavailable")


class ReportService:
    def __init__(self):
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="daily-report")
        self.jobs = OrderedDict()
        self.lock = Lock()

    def submit(self, state, thresholds=None, *, allow_generation=False):
        date = datetime.now(LOCAL_TIMEZONE).date().isoformat()
        cache_thresholds = {key: value for key, value in (thresholds or {}).items() if value != DEFAULT_THRESHOLDS.get(key)}
        key = hashlib.sha256(json.dumps([state["meta"]["loaded_at"], date, cache_thresholds, allow_generation], sort_keys=True).encode()).hexdigest()
        with self.lock:
            generation_key = hashlib.sha256(json.dumps([state["meta"]["loaded_at"], date, {}, True], sort_keys=True).encode()).hexdigest()
            if not allow_generation and not cache_thresholds and generation_key in self.jobs:
                return self.jobs[generation_key]
            if key not in self.jobs:
                # 有界队列，滑块快速调整不会无限占用后端线程或模型队列。
                if sum(not job.done() for job in self.jobs.values()) >= 4:
                    raise RuntimeError("report_busy")
                self.jobs[key] = self.pool.submit(make_bundle, state["groups"], thresholds, date, state["meta"]["loaded_at"], allow_generation=allow_generation, reuse_daily_saved=True)
                while len(self.jobs) > 12:
                    stale = next((k for k, job in self.jobs.items() if job.done()), None)
                    if stale is None:
                        break
                    del self.jobs[stale]
            return self.jobs[key]

    def prewarm(self, state):
        try:
            # 文件更新中/读取失败时不花费额度生成一份残缺日报，仍可读取已存稿。
            self.submit(state, allow_generation=report_data_ready(state))
        except RuntimeError:
            pass


report_service = ReportService()
