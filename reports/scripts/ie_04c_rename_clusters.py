"""
ie_04c_rename_clusters.py
--------------------------
Re-name all text-embedding clusters in viz_data.json using Gemini.
Useful if the original naming run failed (e.g. wrong model name / 404 errors).
Updates clusters.k{N}.names in-place without re-running UMAP or k-means.

Run from recipe-lanes/:
    python3 scripts/ie_04c_rename_clusters.py
"""

import json
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
GEMINI_MODEL = 'gemini-2.5-flash'


def load_api_key() -> str:
    for candidate in [Path('.env'), Path(__file__).parent.parent / '.env']:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if '=' in line and not line.strip().startswith('#'):
                    k, _, v = line.partition('=')
                    if k.strip() == 'GEMINI_API_KEY':
                        return v.strip()
    import os
    return os.environ.get('GEMINI_API_KEY', '')


def name_cluster(k: int, cid: int, descs: list, api_key: str) -> str:
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}'
    sample = '\n'.join(f'- {d}' for d in descs[:8])
    prompt = (
        f'These are action node descriptions from a recipe app, all belonging to the same visual cluster:\n'
        f'{sample}\n\n'
        f'Give this cluster a short, descriptive name (2-5 words, title case). Reply with the name only.'
    )
    body = json.dumps({'contents': [{'parts': [{'text': prompt}]}]}).encode()
    req = urllib.request.Request(
        url, data=body, headers={'Content-Type': 'application/json'}, method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
        return d['candidates'][0]['content']['parts'][0]['text'].strip()
    except Exception as e:
        print(f'  [warn] k={k} cluster={cid}: {e}')
        return f'Cluster {cid + 1}'


def main():
    api_key = load_api_key()
    if not api_key:
        print('ERROR: GEMINI_API_KEY not found in .env')
        return

    items = json.loads((BASE / 'action-icons.json').read_text())
    viz_path = BASE / 'viz_data.json'
    viz = json.loads(viz_path.read_text())

    for k_key in viz['clusters']:
        k = int(k_key[1:])
        labels_list = viz['clusters'][k_key]['labels']
        print(f'Naming k={k}...')

        cluster_descs: dict[int, list] = defaultdict(list)
        for item, lbl in zip(items[:len(labels_list)], labels_list):
            cluster_descs[lbl].append(item['desc'])

        names = {}
        for cid in range(k):
            name = name_cluster(k, cid, cluster_descs[cid], api_key)
            names[str(cid)] = name
            print(f'  [{cid}] {name}')
            time.sleep(0.2)

        viz['clusters'][k_key]['names'] = names

    print('\nWriting updated viz_data.json...')
    viz_path.write_text(json.dumps(viz))
    print(f'Done: {viz_path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
