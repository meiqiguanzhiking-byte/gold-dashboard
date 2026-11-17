"""冻结当前研报计算结果到静态快照；不发布工作簿或原研报。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / '后端'))

from research_etf import get_etf_replication
from research_macro import get_macro_replication
from research_dual_anchor import get_dual_anchor
from export_snapshot import validate_public


def export():
    output = ROOT / '展示版/数据/data/snapshot.json'
    snapshot = json.loads(output.read_text(encoding='utf-8'))
    models = {'etf-monthly': get_etf_replication(), 'macro-monthly': get_macro_replication(),
              'dual-anchor': get_dual_anchor()}
    versions = {model['source']['version'] for model in models.values()}
    if len(versions) != 1:
        raise ValueError('研报数据版本不一致')
    for model in models.values():
        model['source'].pop('version', None)
    snapshot['research'] = {'schema_version': 1, 'mode': 'frozen', 'models': models}
    validate_public(snapshot)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print('Frozen research models exported: ' + ', '.join(models))


if __name__ == '__main__':
    export()
