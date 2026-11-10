"""黄金长期宏观定价：只读合并月表，样本内OLS与HAC统计。"""
from functools import lru_cache
import math

import numpy as np
import pandas as pd

from research_etf import SOURCE, HAC_LAGS
from research_macro_residuals import analyze_deviations

PRICE = 'COMEX黄金（月均收盘价）'
INPUTS = [PRICE, 'DXY（月末）', 'VIX（月末）', '全球央行净购金']


def get_macro_replication():
    return _calculate(SOURCE.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def _calculate(source_version):
    frame = pd.read_excel(SOURCE, sheet_name='月度合并数据')
    frame['month'] = pd.to_datetime(frame['日期（年月）'], errors='raise').dt.to_period('M')
    if frame['month'].isna().any() or frame['month'].duplicated().any():
        raise ValueError('合并表月份缺失或重复')
    frame = frame.set_index('month').sort_index()
    if frame.empty:
        raise ValueError('合并表无数据')
    for column in INPUTS:
        frame[column] = pd.to_numeric(frame[column], errors='coerce').replace([np.inf, -np.inf], np.nan)
    # 使用真实自然月距离；缺失月份不会压缩趋势序列。
    frame['trend'] = frame.index.asi8 - frame.index[0].ordinal
    valid = frame[INPUTS].notna().all(axis=1) & (frame[INPUTS[:3]] > 0).all(axis=1)
    sample = frame.loc[valid]
    n, k = len(sample), 5
    if n <= max(k, HAC_LAGS):
        raise ValueError('长期模型有效月份不足')
    price = sample[PRICE].to_numpy(dtype=float)
    y = np.log(price)
    design = np.column_stack((np.ones(n), np.log(sample['DXY（月末）']),
                              np.log(sample['VIX（月末）']), sample['全球央行净购金'], sample['trend']))
    coef, _, rank, _ = np.linalg.lstsq(design, y, rcond=None)
    if rank != k:
        raise ValueError('长期模型解释变量存在完全共线性')
    fitted_log = design @ coef
    fitted = np.exp(fitted_log)
    residual = y - fitted_log
    bread = np.linalg.inv(design.T @ design)
    scores = design * residual[:, None]
    meat = scores.T @ scores
    for lag in range(1, HAC_LAGS + 1):
        cross = scores[lag:].T @ scores[:-lag]
        meat += (1 - lag / (HAC_LAGS + 1)) * (cross + cross.T)
    covariance = bread @ meat @ bread * n / (n - k)
    names = ['截距', 'ln(DXY)', 'ln(VIX)', '央行净购金（吨）', '时间趋势（月）']
    report = [16.488, -2.409, .108, .001326, .007864]
    coefficients = []
    for i, name in enumerate(names):
        se = math.sqrt(max(0., float(covariance[i, i])))
        z = float(coef[i]) / se if se > 0 else None
        coefficients.append({'name': name, 'value': float(coef[i]), 'hac_se': se, 'hac_z': z,
                             'hac_p': math.erfc(abs(z) / math.sqrt(2)) if z is not None else None,
                             'report': report[i]})
    r2 = float(1 - residual @ residual / ((y - y.mean()) @ (y - y.mean())))
    deviation = price / fitted - 1
    estimates = {str(month): {'theory': float(fitted[i]), 'deviation': float(deviation[i])}
                 for i, month in enumerate(sample.index)}
    points, excluded = [], []
    for month, row in frame.iterrows():
        point = {'month': str(month), 'actual': float(row[PRICE]) if pd.notna(row[PRICE]) and row[PRICE] > 0 else None,
                 'theory': None, 'deviation': None}
        if str(month) in estimates:
            point.update(estimates[str(month)])
        else:
            missing = [c for c in INPUTS if pd.isna(row[c]) or c in INPUTS[:3] and row[c] <= 0]
            excluded.append({'month': str(month), 'columns': missing})
        points.append(point)
    latest = {'month': str(sample.index[-1]), 'actual': float(price[-1]),
              'theory': float(fitted[-1]), 'deviation': float(deviation[-1]),
              'percentile': float(np.mean(deviation <= deviation[-1]))}
    return {'sample': {'start': str(sample.index[0]), 'end': str(sample.index[-1]), 'count': n,
                       'available_end': str(frame.index[-1]), 'excluded': excluded},
            'coefficients': coefficients, 'r2': r2, 'adjusted_r2': 1 - (1 - r2) * (n - 1) / (n - k),
            'mae': float(np.mean(np.abs(price - fitted))),
            'mape': float(np.mean(np.abs((price - fitted) / price))),
            'latest': latest, 'points': points, 'hac_lags': HAC_LAGS,
            'residual_analysis': analyze_deviations(points),
            'trend_origin': str(frame.index[0]),
            'source': {'file': SOURCE.name, 'sheet': '月度合并数据', 'columns': INPUTS, 'version': str(source_version)}}
