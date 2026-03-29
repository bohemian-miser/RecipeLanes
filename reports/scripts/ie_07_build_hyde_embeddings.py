"""
ie_07_build_hyde_embeddings.py
-------------------------------
Pre-compute Gemini text embeddings for HyDE queries and save as hyde_embeddings.npy.
For icons with HyDE queries (from hyde_queries.json or caption_sample_hyde.json),
embeds each query, averages, and substitutes that row in the embeddings matrix.
Icons without HyDE queries keep their original text embedding.

Output: scripts/ie_data/hyde_embeddings.npy — same shape as text_embeddings.npy,
        scripts/ie_data/hyde_ids.json         — list of icon IDs that have HyDE embeddings

Run from recipe-lanes/:
    python3 scripts/ie_07_build_hyde_embeddings.py
"""

import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON       = BASE / "action-icons.json"
TEXT_EMBED_NPY   = BASE / "text_embeddings.npy"
HYDE_QUERIES_JSON = BASE / "hyde_queries.json"
SAMPLE_HYDE_JSON  = BASE / "caption_sample_hyde.json"
OUT_NPY           = BASE / "hyde_embeddings.npy"
OUT_IDS_JSON      = BASE / "hyde_ids.json"

EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={key}"


def load_api_key() -> str:
    for candidate in [Path(".env"), Path(__file__).parent.parent / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == "GEMINI_API_KEY":
                        return v.strip()
    return os.environ.get("GEMINI_API_KEY", "")


def embed_text(text: str, api_key: str) -> np.ndarray:
    url = EMBED_URL.format(key=api_key)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    vec = np.array(d["embedding"]["values"], dtype=np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    print("Loading base text embeddings...")
    base_emb = np.load(str(TEXT_EMBED_NPY)).astype(np.float32)
    print(f"  shape: {base_emb.shape}")

    items = json.loads(ICONS_JSON.read_text())
    id_to_idx = {item["id"]: i for i, item in enumerate(items)}

    # Collect all HyDE query data
    hyde_data: dict[str, list[str]] = {}

    if HYDE_QUERIES_JSON.exists():
        raw = json.loads(HYDE_QUERIES_JSON.read_text())
        for iid, val in raw.items():
            queries = val.get("queries", [])
            if queries:
                hyde_data[iid] = queries
        print(f"Loaded {len(hyde_data)} icons from hyde_queries.json")

    if SAMPLE_HYDE_JSON.exists():
        sample = json.loads(SAMPLE_HYDE_JSON.read_text())
        added = 0
        for entry in sample.get("results", []):
            iid = entry["id"]
            queries = entry.get("queries", [])
            if queries and iid not in hyde_data:
                hyde_data[iid] = queries
                added += 1
        print(f"Added {added} icons from caption_sample_hyde.json (total: {len(hyde_data)})")

    # Start from copy of base embeddings
    hyde_emb = base_emb.copy()
    updated_ids = []

    print(f"\nEmbedding queries for {len(hyde_data)} icons...")
    for n, (iid, queries) in enumerate(hyde_data.items()):
        if iid not in id_to_idx:
            print(f"  [{n+1}/{len(hyde_data)}] {iid} — not in items, skipping")
            continue
        row_idx = id_to_idx[iid]

        vecs = []
        for q in queries:
            try:
                vecs.append(embed_text(q, api_key))
                time.sleep(0.15)
            except Exception as e:
                print(f"  [warn] embed failed for '{q}': {e}")

        if not vecs:
            continue

        avg = np.mean(vecs, axis=0).astype(np.float32)
        norm = np.linalg.norm(avg)
        if norm > 0:
            avg /= norm
        hyde_emb[row_idx] = avg
        updated_ids.append(iid)
        print(f"  [{n+1}/{len(hyde_data)}] {iid} — updated ({len(vecs)}/{len(queries)} queries embedded)")

    print(f"\nSaving hyde_embeddings.npy — shape {hyde_emb.shape}, {len(updated_ids)} rows updated...")
    np.save(str(OUT_NPY), hyde_emb)
    OUT_IDS_JSON.write_text(json.dumps(updated_ids))
    print(f"Done. Files written:")
    print(f"  {OUT_NPY}  ({OUT_NPY.stat().st_size // 1024} KB)")
    print(f"  {OUT_IDS_JSON}")


if __name__ == "__main__":
    main()
