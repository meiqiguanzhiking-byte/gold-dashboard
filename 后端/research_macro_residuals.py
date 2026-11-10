"""长期锚偏离率的样本内分布、持续性与后续变化；按自然月匹配。"""
import math

import numpy as np
import pandas as pd

HORIZONS = (1, 3, 6, 12)


def _change_regression(pairs, lags):
    if len(pairs) < 8:
        return None
    months, x, y = np.asarray(pairs, dtype=float).T
    design = np.column_stack((np.ones(len(x)), x))
    if np.linalg.matrix_rank(design) < 2:
        return None
    coef = np.linalg.lstsq(design, y, rcond=None)[0]
    error = y - design @ coef
    bread = np.linalg.inv(design.T @ design)
    # 未配对月份的得分置零，使HAC滞后仍按自然月计算，不压缩时间。
    scores = np.zeros((int(months[-1] - months[0]) + 1, 2))
    scores[(months - months[0]).astype(int)] = design * error[:, None]
    meat = scores.T @ scores
    for lag in range(1, min(lags, len(scores) - 1) + 1):
        cross = scores[lag:].T @ scores[:-lag]
        meat += (1 - lag / (lags + 1)) * (cross + cross.T)
    cov = bread @ meat @ bread * len(x) / (len(x) - 2)
    se = math.sqrt(max(0., float(cov[1, 1])))
    z = float(coef[1]) / se if se > 0 else None
    total = float((y - y.mean()) @ (y - y.mean()))
    return {'count': len(x), 'alpha': float(coef[0]), 'beta': float(coef[1]),
            'hac_se': se, 'hac_z': z, 'hac_p': math.erfc(abs(z) / math.sqrt(2)) if z is not None else None,
            'r2': float(1 - error @ error / total) if total > 0 else None, 'hac_lags': lags}


def analyze_deviations(points):
    values = {pd.Period(p['month'], freq='M').ordinal: p['deviation']
              for p in points if p['deviation'] is not None}
    if len(values) < 25:
        raise ValueError('偏离率分析至少需要25个有效月份')
    data = np.array(list(values.values()), dtype=float)
    quantiles = {str(q): float(np.quantile(data, q / 100)) for q in (5, 10, 20, 30, 50, 70, 80, 90, 95)}
    counts, edges = np.histogram(data, bins=20)
    std = float(data.std())
    distribution = {'count': len(data), 'mean': float(data.mean()), 'median': float(np.median(data)),
                    'min': float(data.min()), 'max': float(data.max()), 'std': std,
                    'skewness': float(np.mean(((data - data.mean()) / std) ** 3)) if std > 0 else None,
                    'quantiles': quantiles,
                    'bins': [{'lower': float(edges[i]), 'upper': float(edges[i + 1]), 'count': int(count)}
                             for i, count in enumerate(counts)]}
    autocorrelation = []
    for lag in range(1, 25):
        pairs = [(d, values[m + lag]) for m, d in values.items() if m + lag in values]
        a, b = np.asarray(pairs, dtype=float).T if pairs else (np.array([]), np.array([]))
        corr = float(np.corrcoef(a, b)[0, 1]) if len(a) > 1 and a.std() > 0 and b.std() > 0 else None
        autocorrelation.append({'lag': lag, 'value': corr, 'count': len(pairs)})
    regressions = []
    for h, report_beta in zip(HORIZONS, (-.042, -.163, -.275, -.563)):
        pairs = [(m, d, values[m + h] - d) for m, d in values.items() if m + h in values]
        # 多期目标重叠，带宽至少覆盖h−1个月；不是研报披露的参数。
        stats = _change_regression(pairs, max(4, h - 1))
        regressions.append({'horizon': h, 'report_beta': report_beta, 'stats': stats})
    groups = []
    for side, qs in [('low', (30, 20, 10, 5)), ('high', (70, 80, 90, 95))]:
        for q in qs:
            threshold = quantiles[str(q)]
            selected = [(m, d) for m, d in values.items() if (d <= threshold if side == 'low' else d >= threshold)]
            path = []
            for h in range(13):
                changes = [values[m + h] - d for m, d in selected if m + h in values]
                path.append({'horizon': h, 'count': len(changes),
                             'mean': float(np.mean(changes)) if changes else None,
                             'median': float(np.median(changes)) if changes else None})
            groups.append({'side': side, 'quantile': q, 'name': f'≤P{q}' if side == 'low' else f'≥P{q}',
                           'threshold': threshold, 'count': len(selected), 'path': path})
    return {'distribution': distribution, 'autocorrelation': autocorrelation,
            'regressions': regressions, 'groups': groups, 'horizons': list(HORIZONS)}
