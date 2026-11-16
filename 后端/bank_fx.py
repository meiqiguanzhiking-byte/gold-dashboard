"""银行结售汇原始横表转月度序列；保留原币种、原单位和原始差额。"""
import re
from datetime import datetime

import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils.datetime import from_excel

SOURCE = "银行结售汇.xlsx"
SHEETS = {"cny": ("以人民币计价（月度）", "亿元人民币"), "usd": ("以美元计价（月度）", "亿美元")}
BANK_PATHS = [[], ["银行自身"], ["银行代客"], ["银行代客", "经常项目"],
              ["银行代客", "经常项目", "货物贸易"], ["银行代客", "经常项目", "服务贸易"],
              ["银行代客", "经常项目", "收益和经常转移"], ["银行代客", "资本与金融项目"],
              ["银行代客", "资本与金融项目", "直接投资"], ["银行代客", "资本与金融项目", "证券投资"]]
GROUP_NAMES = {"banks": "银行汇总", "forward": "远期结售汇", "outstanding": "本期末远期结售汇累计未到期额",
               "options": "未到期期权Delta净敞口"}


def specs():
    result = []
    for leg, start in (("结汇", 5), ("售汇", 15), ("差额", 25)):
        for index, path in enumerate(BANK_PATHS):
            result.append((f"banks_{index}_{start}", start + index, "banks", path, leg))
    for suffix, row, group, path, leg in [
        ("forward_settle", 35, "forward", ["签约额"], "结汇"),
        ("forward_sell", 36, "forward", ["签约额"], "售汇"),
        ("forward_net", 37, "forward", ["签约额"], "差额"),
        ("forward_close", 38, "forward", ["平仓额"], "差额"),
        ("forward_roll", 39, "forward", ["展期额"], "差额"),
        ("outstanding_settle", 40, "outstanding", [], "结汇"),
        ("outstanding_sell", 41, "outstanding", [], "售汇"),
        ("outstanding_net", 42, "outstanding", [], "差额"),
        ("options_delta", 43, "options", [], "净敞口"),
    ]:
        result.append((suffix, row, group, path, leg))
    return result


def read_bank_fx_workbook(path):
    """仅读取实际日期列，避开源文件美元表末尾的空白格式列。"""
    frames = {}
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        for sheet, _ in SHEETS.values():
            ws = workbook[sheet]
            header = next(ws.iter_rows(min_row=4, max_row=4, values_only=True))
            date_columns = []
            for index, value in enumerate(header[2:], 2):
                date = (from_excel(value, workbook.epoch) if isinstance(value, (float, int))
                        and 20000 < value < 100000 else value)
                if isinstance(date, datetime):
                    date_columns.append((index, date.strftime("%Y-%m")))
            if not date_columns:
                raise ValueError(f"{sheet}缺少可识别的月份表头")
            rows = list(ws.iter_rows(min_row=1, max_row=43, max_col=max(i for i, _ in date_columns) + 1,
                                     values_only=True))
            expected_unit = SHEETS["cny" if "人民币" in sheet else "usd"][1]
            if expected_unit not in str(rows[2][0]):
                raise ValueError(f"{sheet}单位与配置不符")
            for _, row, group, path_parts, leg in specs():
                label = re.sub(r"\s", "", str(rows[row - 1][0] or ""))
                label = re.sub(r"^其中[:：]?|^[一二三四五六七八]+、|^[（(][一二]+[）)]|^\d+(?:\.\d+)?\.?", "", label)
                expected = path_parts[-1] if group == "banks" and path_parts else leg if group == "banks" else None
                if expected and label != expected:
                    raise ValueError(f"{sheet}第{row}行分类发生变化：{label}")
                if group != "banks" and str(rows[row - 1][1] or "") != (leg if leg != "净敞口" else ""):
                    raise ValueError(f"{sheet}第{row}行结售汇标识发生变化")
            data = {"日期": [date for _, date in date_columns]}
            for suffix, row, *_ in specs():
                data[suffix] = [rows[row - 1][index] for index, _ in date_columns]
            frames[sheet] = pd.DataFrame(data)
    finally:
        workbook.close()
    return frames


def add_bank_fx_indicators(builder):
    for currency, (sheet, unit) in SHEETS.items():
        table = builder.tables.get((SOURCE, sheet))
        frame = table.frame if table else pd.DataFrame(columns=["日期"])
        for suffix, row, group, path, leg in specs():
            values = pd.to_numeric(frame[suffix], errors="coerce") if suffix in frame else pd.Series(dtype=float)
            values = values.replace([float("inf"), -float("inf")], float("nan"))
            builder.add("price", f"bank_fx_{currency}_{suffix}", " · ".join([GROUP_NAMES[group], *path, leg]),
                        unit, "月度", SOURCE, sheet, column=suffix, frame=frame, values=values,
                        bank_fx_currency=currency, bank_fx_group=group, bank_fx_path=path, bank_fx_leg=leg,
                        source_row=row, display_digits=2, input_sources=[SOURCE],
                        method="读取原表月度金额；差额直接采用原表，不由显示值重算；缺失不补零。",
                        warnings=["各级合计与其中项不重复相加；售汇向下绘制仅为展示，原始金额保持不变。"])
