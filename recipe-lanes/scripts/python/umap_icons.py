"""
Compute 2D UMAP coordinates for all icon_index docs and write umap_x, umap_y back.

Usage:
    python scripts/umap_icons.py [--staging] [--dry-run]

Requires:
    pip install -r scripts/requirements-umap.txt
    prod-service-account.json or staging-service-account.json in recipe-lanes/
"""

import os
import sys
import argparse
import numpy as np
import firebase_admin
from firebase_admin import credentials, firestore

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--staging', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    env = 'staging' if args.staging else 'prod'
    here = os.path.dirname(os.path.abspath(__file__))
    sa_path = os.path.join(here, '..', '..', f'{env}-service-account.json')

    print(f'ENV:     {env}')
    print(f'MODE:    {"DRY RUN" if args.dry_run else "LIVE WRITE"}\n')

    cred = credentials.Certificate(sa_path)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    # Load all icon_index docs that have embedding_minilm
    print('Loading icon_index...')
    docs = db.collection('icon_index').stream()

    ids, names, embeddings = [], [], []
    skipped = 0
    for doc in docs:
        data = doc.to_dict()
        emb = data.get('embedding_minilm')
        if emb is None:
            skipped += 1
            continue
        vec = list(emb) if not isinstance(emb, list) else emb
        if len(vec) != 384:
            skipped += 1
            continue
        ids.append(doc.id)
        names.append(data.get('ingredient_name', doc.id))
        embeddings.append(vec)

    print(f'Loaded {len(ids)} icons ({skipped} skipped — no embedding_minilm)\n')
    if len(ids) < 10:
        print('Not enough docs to run UMAP.')
        sys.exit(1)

    # Run UMAP
    print('Running UMAP...')
    import umap
    reducer = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1, metric='cosine', random_state=42)
    coords = reducer.fit_transform(np.array(embeddings))
    print(f'UMAP done. Shape: {coords.shape}\n')

    if args.dry_run:
        print('DRY RUN — first 5 results:')
        for i in range(min(5, len(ids))):
            print(f'  {names[i]}: ({coords[i,0]:.4f}, {coords[i,1]:.4f})')
        return

    # Write back in batches of 500
    print(f'Writing umap_x/umap_y to {len(ids)} docs...')
    batch = db.batch()
    batch_count = 0
    written = 0
    BATCH_SIZE = 500

    for doc_id, x, y in zip(ids, coords[:, 0], coords[:, 1]):
        ref = db.collection('icon_index').document(doc_id)
        batch.update(ref, {'umap_x': float(x), 'umap_y': float(y)})
        batch_count += 1
        if batch_count >= BATCH_SIZE:
            batch.commit()
            written += batch_count
            print(f'  {written}/{len(ids)} written...')
            batch = db.batch()
            batch_count = 0

    if batch_count > 0:
        batch.commit()
        written += batch_count

    print(f'\nDone. {written} docs updated.')

if __name__ == '__main__':
    main()
