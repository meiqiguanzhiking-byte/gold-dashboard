"""长短双锚研报：合并月表的ETF样本内复现，只读、逐月匹配、不补值。"""
from functools import lru_cache
import math
from pathlib import Path

import numpy as np
import pandas as pd

SOURCE = Path(__file__).resolve().parents[1] / '研报复现/国泰君安期货_黄金_长短双锚/数据/黄金长短双锚_月度合并数据.xlsx'
HAC_LAGS = 4  # 复现设定：Bartlett核、4个月滞后；研报未说明该项。


def student_p(t, df):
    """双侧Student-t尾概率：角度变换后用Simpson积分，无新增依赖。"""
    lower = math.atan(abs(t) / math.sqrt(df))
    upper = math.pi / 2
    angles = np.linspace(lower, upper, 2049)
    log_scale = math.lgamma((df + 1) / 2) - math.lgamma(df / 2) - .5 * math.log(math.pi)
    values = np.exp(log_scale + (df - 1) * np.log(np.maximum(np.cos(angles), 1e-300)))
    integral = (upper - lower) / 2048 / 3 * (values[0] + values[-1] + 4 * values[1:-1:2].sum() + 2 * values[2:-1:2].sum())
    return min(1., float(2 * integral))


def get_etf_replication():
    return _calculate(SOURCE.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def _calculate(source_version):
    frame = pd.read_excel(SOURCE, sheet_name='月度合并数据')
    frame['month'] = pd.to_datetime(frame['日期（年月）']).dt.to_period('M')
    if frame['month'].duplicated().any():
        raise ValueError('合并表存在重复月份')
    frame = frame.set_index('month').sort_index()
    price = pd.to_numeric(frame['COMEX黄金（月均收盘价）'], errors='coerce')
    flow = pd.to_numeric(frame['全球黄金ETF流量'], errors='coerce')
    # 显式相邻月份查找，不能让缺月被shift跨越。
    same, pairs = [], []
    for month in pd.period_range('2003-02', '2026-09', freq='M'):
        p, f = price.get(month), flow.get(month)
        previous, following = price.get(month - 1), price.get(month + 1)
        if pd.notna(f) and pd.notna(p) and p > 0:
            if pd.notna(previous) and previous > 0:
                same.append({'month': str(month), 'flow': float(f), 'return': math.log(p / previous)})
            if pd.notna(following) and following > 0:
                pairs.append({'month': str(month), 'target_month': str(month + 1), 'flow': float(f),
                              'price': float(p), 'next_price': float(following), 'actual': math.log(following / p)})
    if len(pairs) < 60:
        raise ValueError('有效配对不足60个月')
    x = np.array([p['flow'] for p in pairs])
    y = np.array([p['actual'] for p in pairs])
    design = np.column_stack((np.ones(len(x)), x))
    coef = np.linalg.lstsq(design, y, rcond=None)[0]
    residual = y - design @ coef
    bread = np.linalg.inv(design.T @ design)
    ols_cov = bread * (residual @ residual) / (len(x) - 2)
    scores = design * residual[:, None]
    meat = scores.T @ scores
    for lag in range(1, HAC_LAGS + 1):
        cross = scores[lag:].T @ scores[:-lag]
        meat += (1 - lag / (HAC_LAGS + 1)) * (cross + cross.T)
    hac_cov = bread @ meat @ bread * len(x) / (len(x) - 2)
    coefficients = []
    for i, name in enumerate(['截距', 'ETF流量（吨）']):
        se, hse = math.sqrt(ols_cov[i, i]), math.sqrt(hac_cov[i, i])
        coefficients.append({'name': name, 'value': float(coef[i]), 'se': se,
                             't': float(coef[i] / se), 'p': student_p(coef[i] / se, len(x) - 2),
                             'hac_se': hse, 'hac_t': float(coef[i] / hse),
                             'hac_p': math.erfc(abs(coef[i] / hse) / math.sqrt(2))})
    def corr(a, b):
        result = float(np.corrcoef(a, b)[0, 1])
        return result if math.isfinite(result) else None
    same_map = {p['month']: p for p in same}
    rolling = []
    for i, point in enumerate(pairs):
        window = pairs[max(0, i - 59):i + 1]
        complete = len(window) == 60 and pd.Period(window[-1]['month'], freq='M') - pd.Period(window[0]['month'], freq='M') == pd.offsets.MonthEnd(59)
        sw = [same_map[p['month']] for p in window if p['month'] in same_map]
        rolling.append({'month': point['month'], 'leading': corr([p['flow'] for p in window], [p['actual'] for p in window]) if complete else None,
                        'contemporaneous': corr([p['flow'] for p in sw], [p['return'] for p in sw]) if complete and len(sw) == 60 else None})
    bins, edges = pd.qcut(x, 5, labels=False, retbins=True)
    groups = []
    for i in range(5):
        values = y[bins == i]
        groups.append({'name': f'Q{i + 1}', 'count': len(values), 'mean': float(values.mean()),
                       'median': float(np.median(values)), 'up_rate': float((values > 0).mean()),
                       'lower': float(edges[i]), 'upper': float(edges[i + 1])})
    for point in pairs:
        point['predicted'] = float(coef[0] + coef[1] * point['flow'])
        point['predicted_price'] = point['price'] * math.exp(point['predicted'])
        point['report_predicted'] = .00660 + .000164 * point['flow']
        point['source_row'] = int(frame.index.get_loc(pd.Period(point['month'], freq='M'))) + 2
    return {'sample': {'start': pairs[0]['month'], 'end': pairs[-1]['month'], 'target_end': pairs[-1]['target_month'],
                       'count': len(pairs), 'same_count': len(same)},
            'coefficients': coefficients, 'r2': float(1 - residual @ residual / ((y - y.mean()) @ (y - y.mean()))),
            'ic': corr(x, y), 'same_ic': corr([p['flow'] for p in same], [p['return'] for p in same]),
            'rolling': rolling, 'groups': groups, 'spread': groups[-1]['mean'] - groups[0]['mean'], 'pairs': pairs,
            'hac_lags': HAC_LAGS, 'source': {'file': SOURCE.name, 'sheet': '月度合并数据',
                'columns': ['日期（年月）', 'COMEX黄金（月均收盘价）', '全球黄金ETF流量'], 'version': str(source_version)},
            'same_note': '合并表始于2003-02，缺少2003-01金价；同期相关从2003-03起计算，不补值。'}
