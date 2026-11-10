"""月度ETF锚与宏观锚的样本内共振、背离分析。"""
from functools import lru_cache
import math

import numpy as np
import pandas as pd

from research_etf import SOURCE, get_etf_replication
from research_macro import get_macro_replication

STATES = {'bull': '看涨共振', 'bear': '看跌共振', 'low_bear': '长期看涨、ETF看跌',
          'high_bull': '长期看跌、ETF看涨', 'neutral': '中性'}
HORIZONS = (1, 3, 6, 12)


def classify(deviation, threshold, predicted):
    macro = 1 if deviation < threshold else -1 if deviation > 0 else 0
    etf = 1 if predicted > 0 else -1 if predicted < 0 else 0
    state = {(1, 1): 'bull', (-1, -1): 'bear', (1, -1): 'low_bear', (-1, 1): 'high_bull'}.get((macro, etf), 'neutral')
    return macro, etf, state


def return_stats(values, direction=1):
    a = np.asarray(values, dtype=float)
    n = len(a)
    return {'count': n, 'mean': float(a.mean()) if n else None,
            'median': float(np.median(a)) if n else None,
            'std': float(a.std(ddof=1)) if n > 1 else None,
            'p10': float(np.quantile(a, .1)) if n else None, 'p90': float(np.quantile(a, .9)) if n else None,
            'hit_rate': float(np.mean(a * direction > 0)) if n else None}


def build_events(signals):
    events = []
    for point in signals:
        if point['state'] not in ('low_bear', 'high_bull'):
            continue
        previous_month = str(pd.Period(point['month'], freq='M') - 1)
        if events and events[-1]['state'] == point['state'] and events[-1]['end'] == previous_month:
            events[-1]['end'] = point['month']
            events[-1]['duration'] += 1
        else:
            events.append({'state': point['state'], 'start': point['month'], 'end': point['month'],
                           'duration': 1, 'deviation': point['deviation']})
    return events


def get_dual_anchor():
    return _calculate(SOURCE.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def _calculate(source_version):
    etf, macro = get_etf_replication(), get_macro_replication()
    if etf['source']['version'] != str(source_version) or macro['source']['version'] != str(source_version):
        raise ValueError('数据版本已变化，请重试')
    threshold = macro['residual_analysis']['distribution']['quantiles']['30']
    macro_map = {p['month']: p for p in macro['points'] if p['deviation'] is not None}
    deviations = {pd.Period(m, freq='M').ordinal: p['deviation'] for m, p in macro_map.items()}
    signals = []
    for p in etf['pairs']:
        if p['month'] not in macro_map:
            continue
        d = macro_map[p['month']]['deviation']
        long, short, state = classify(d, threshold, p['predicted'])
        signals.append({'month': p['month'], 'target_month': p['target_month'], 'price': p['price'],
                        'log_price': math.log(p['price']), 'flow': p['flow'], 'predicted': p['predicted'],
                        'actual': p['actual'], 'deviation': d, 'macro': long, 'etf': short, 'state': state})
    if not signals:
        raise ValueError('没有可匹配的双锚月份')
    all_returns = [s['actual'] for s in signals]
    _, edges = np.histogram(all_returns, bins=20)
    def histogram(values):
        counts, _ = np.histogram(values, bins=edges)
        return [{'lower': float(edges[i]), 'upper': float(edges[i + 1]), 'count': int(c),
                 'share': float(c / len(values)) if values else None} for i, c in enumerate(counts)]
    resonance = []
    report = {'bull': {'count': 69, 'mean': .0084, 'median': .0035, 'hit_rate': .565},
              'bear': {'count': 10, 'mean': -.022, 'median': -.0154, 'hit_rate': .70}}
    for state, direction in [('bull', 1), ('bear', -1)]:
        returns = [s['actual'] for s in signals if s['state'] == state]
        resonance.append({'state': state, 'name': STATES[state], 'stats': return_stats(returns, direction),
                          'histogram': histogram(returns), 'report': report[state]})
    events = build_events(signals)
    divergence = []
    for state, repair_sign in [('low_bear', 1), ('high_bull', -1)]:
        selected = [e for e in events if e['state'] == state]
        path = []
        for h in range(13):
            changes = [deviations[pd.Period(e['start'], freq='M').ordinal + h] - e['deviation']
                       for e in selected if pd.Period(e['start'], freq='M').ordinal + h in deviations]
            a = np.asarray(changes, dtype=float)
            n = len(a)
            box, outliers = None, []
            if n:
                q1, median, q3 = np.quantile(a, [.25, .5, .75])
                iqr = q3 - q1
                inside = a[(a >= q1 - 1.5 * iqr) & (a <= q3 + 1.5 * iqr)]
                box = [float(inside.min()), float(q1), float(median), float(q3), float(inside.max())]
                outliers = [float(v) for v in a if v < q1 - 1.5 * iqr or v > q3 + 1.5 * iqr]
            path.append({'horizon': h, 'count': n, 'mean': float(a.mean()) if n else None,
                         'median': float(np.median(a)) if n else None,
                         'repair_rate': float(np.mean(a * repair_sign > 0)) if n else None,
                         'etf_rate': float(np.mean(a * repair_sign < 0)) if n else None,
                         'unchanged_rate': float(np.mean(a == 0)) if n else None,
                         'box': box, 'outliers': outliers})
        for e in selected:
            start = pd.Period(e['start'], freq='M').ordinal
            e['changes'] = {str(h): deviations[start + h] - e['deviation'] if start + h in deviations else None for h in HORIZONS}
        divergence.append({'state': state, 'name': STATES[state], 'event_count': len(selected),
                           'month_count': sum(s['state'] == state for s in signals),
                           'start_deviation_mean': float(np.mean([e['deviation'] for e in selected])) if selected else None,
                           'path': path, 'events': selected})
    return {'sample': {'start': signals[0]['month'], 'end': signals[-1]['month'], 'count': len(signals),
                       'return_end': signals[-1]['target_month'], 'deviation_end': macro['sample']['end']},
            'threshold': threshold, 'latest': signals[-1], 'signals': signals,
            'state_counts': [{'state': state, 'name': name, 'count': sum(s['state'] == state for s in signals)}
                             for state, name in STATES.items()],
            'baseline': {'stats': return_stats(all_returns), 'histogram': histogram(all_returns)},
            'resonance': resonance, 'divergence': divergence, 'horizons': list(HORIZONS),
            'source': {'file': SOURCE.name, 'version': str(source_version)}}
