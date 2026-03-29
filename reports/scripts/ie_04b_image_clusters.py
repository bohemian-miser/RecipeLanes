"""
ie_04b_image_clusters.py
------------------------
Re-run k-means clustering on image embeddings and name clusters via Gemini.
Adds/updates `clusters_image` in viz_data.json without re-running UMAP.

Run from recipe-lanes/:
    python3 scripts/ie_04b_image_clusters.py

Requires ie_03 (image_embeddings.npy) and ie_04 (viz_data.json) to have run first.
"""

import json
import time
import urllib.request
import numpy as np
from pathlib import Path
from sklearn.cluster import MiniBatchKMeans
from collections import defaultdict

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
K_VALUES = [10, 15, 20, 25, 30, 40]
GEMINI_MODEL = 'gemini-2.5-flash'

# ---------------------------------------------------------------------------
# Load API key from .env
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# LLM cluster naming
# ---------------------------------------------------------------------------

def name_cluster(k: int, cid: int, descs: list, api_key: str) -> str:
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}'
    sample = '\n'.join(f'- {d}' for d in descs[:8])
    prompt = (
        f'These recipe action node descriptions belong to one visual cluster '
        f'(grouped by SigLIP2 image similarity):\n{sample}\n\n'
        f'Give this cluster a short, descriptive name (2-5 words, title case). '
        f'Reply with the name only.'
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
        print(f'  [warn] naming failed k={k} cluster={cid}: {e}')
        return f'Cluster {cid + 1}'


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()
    if not api_key:
        print('ERROR: GEMINI_API_KEY not found in .env')
        return

    print('Loading image embeddings...')
    image_embeddings = np.load(str(BASE / 'image_embeddings.npy')).astype(np.float32)
    print(f'  shape: {image_embeddings.shape}')

    items = json.loads((BASE / 'action-icons.json').read_text())

    print(f'Running k-means for k values: {K_VALUES}')
    clusters_image = {}
    for k in K_VALUES:
        print(f'\n  k={k}...', end=' ', flush=True)
        km = MiniBatchKMeans(n_clusters=k, random_state=42, n_init=5)
        labels = km.fit_predict(image_embeddings).tolist()
        print('done, naming...')

        cluster_descs: dict[int, list] = defaultdict(list)
        for item, lbl in zip(items[:len(labels)], labels):
            cluster_descs[lbl].append(item['desc'])

        names = {}
        for cid in range(k):
            name = name_cluster(k, cid, cluster_descs[cid], api_key)
            names[str(cid)] = name
            print(f'    [{cid}] {name}')
            time.sleep(0.15)

        clusters_image[f'k{k}'] = {'labels': labels, 'names': names}

    print('\nUpdating viz_data.json with SigLIP2 image clusters...')
    viz_path = BASE / 'viz_data.json'
    viz = json.loads(viz_path.read_text())
    viz['clusters_image'] = clusters_image
    viz_path.write_text(json.dumps(viz))
    print(f'Done: {viz_path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
