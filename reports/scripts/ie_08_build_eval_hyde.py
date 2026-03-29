"""
ie_08_build_eval_hyde.py
------------------------
Pre-compute two hyde embedding matrices for the 100 eval icons:

  1. hyde_from_img    — uses hyde_queries already in eval_data.json (generated from image by Gemini Vision)
  2. hyde_from_prompt — calls Gemini text to generate 6 search queries from the text description,
                        then embeds and averages (no image API calls, very cheap)

Each output is a full (N, 3072) float32 matrix where only the eval-icon rows are replaced;
all other rows fall back to text_embeddings.npy.

Outputs:
  scripts/ie_data/eval_hyde_from_img.npy
  scripts/ie_data/eval_hyde_from_prompt.npy
  scripts/ie_data/eval_hyde_from_prompt_queries.json   — the generated queries (for inspection)

Run from recipe-lanes/:
    python3 scripts/ie_08_build_eval_hyde.py
"""

import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON        = BASE / "action-icons.json"
TEXT_EMBED_NPY    = BASE / "text_embeddings.npy"
EVAL_DATA_JSON    = BASE / "eval_data.json"
OUT_IMG_NPY       = BASE / "eval_hyde_from_img.npy"
OUT_PROMPT_NPY    = BASE / "eval_hyde_from_prompt.npy"
OUT_PROMPT_QUERIES = BASE / "eval_hyde_from_prompt_queries.json"

EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={key}"
GEN_URL   = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"


def load_api_key() -> str:
    for candidate in [Path(".env"), Path(__file__).parent.parent / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == "GEMINI_API_KEY":
                        return v.strip()
    return os.environ.get("GEMINI_API_KEY", "")


def embed_text(text: str, api_key: str, task: str = "RETRIEVAL_DOCUMENT") -> np.ndarray:
    url = EMBED_URL.format(key=api_key)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": task,
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    vec = np.array(d["embedding"]["values"], dtype=np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


def embed_queries_avg(queries: list[str], api_key: str) -> np.ndarray | None:
    vecs = []
    for q in queries:
        try:
            vecs.append(embed_text(q, api_key))
            time.sleep(0.12)
        except Exception as e:
            print(f"    [warn] embed failed for '{q[:40]}': {e}")
    if not vecs:
        return None
    avg = np.mean(vecs, axis=0).astype(np.float32)
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg /= norm
    return avg


def generate_prompt_queries(desc: str, api_key: str) -> list[str]:
    """Ask Gemini to generate 6 search queries from a text description."""
    prompt = (
        f'Generate 6 short search queries (2-5 words each) that someone might type '
        f'to find a recipe app icon described as: "{desc}". '
        f'Vary from broad to specific. Return a JSON array of 6 strings only.'
    )
    url = GEN_URL.format(key=api_key)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    result = json.loads(raw)
    if isinstance(result, list):
        return [str(q) for q in result[:6]]
    return []


def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    print("Loading base embeddings...")
    base_emb = np.load(str(TEXT_EMBED_NPY)).astype(np.float32)
    print(f"  shape: {base_emb.shape}")

    icons = json.loads(ICONS_JSON.read_text())
    id_to_idx = {it["id"]: i for i, it in enumerate(icons)}

    eval_data = json.loads(EVAL_DATA_JSON.read_text())
    eval_icons = eval_data["icons"]
    print(f"Eval icons: {len(eval_icons)}")

    # Load existing generated prompt queries if any (for resuming)
    prompt_queries_map: dict[str, list[str]] = {}
    if OUT_PROMPT_QUERIES.exists():
        prompt_queries_map = json.loads(OUT_PROMPT_QUERIES.read_text())
        print(f"Loaded {len(prompt_queries_map)} existing prompt query sets")

    img_emb    = base_emb.copy()
    prompt_emb = base_emb.copy()

    # Load existing npy files if present (for partial resume on embeddings)
    if OUT_IMG_NPY.exists():
        loaded = np.load(str(OUT_IMG_NPY)).astype(np.float32)
        if loaded.shape == base_emb.shape:
            img_emb = loaded
            print(f"Loaded existing {OUT_IMG_NPY}")
    if OUT_PROMPT_NPY.exists():
        loaded = np.load(str(OUT_PROMPT_NPY)).astype(np.float32)
        if loaded.shape == base_emb.shape:
            prompt_emb = loaded
            print(f"Loaded existing {OUT_PROMPT_NPY}")

    img_updated    = []
    prompt_updated = []

    for n, icon in enumerate(eval_icons):
        iid  = icon["id"]
        desc = icon["desc"]
        idx  = id_to_idx.get(iid)
        if idx is None:
            print(f"  [{n+1}] {iid} not in id_to_idx, skipping")
            continue

        print(f"[{n+1}/{len(eval_icons)}] {iid} — {desc}")

        # ── hyde_from_img ──────────────────────────────────────────────────
        img_queries = icon.get("hyde_queries", [])
        if img_queries:
            avg = embed_queries_avg(img_queries, api_key)
            if avg is not None:
                img_emb[idx] = avg
                img_updated.append(iid)
                print(f"  hyde_from_img: {len(img_queries)} queries embedded")
        else:
            print(f"  hyde_from_img: no queries in eval_data, skipping")

        # ── hyde_from_prompt ───────────────────────────────────────────────
        if iid not in prompt_queries_map:
            try:
                pq = generate_prompt_queries(desc, api_key)
                prompt_queries_map[iid] = pq
                time.sleep(0.3)
                print(f"  hyde_from_prompt generated: {pq}")
            except Exception as e:
                print(f"  [warn] prompt query gen failed: {e}")
                prompt_queries_map[iid] = []
        else:
            print(f"  hyde_from_prompt: loaded from cache ({len(prompt_queries_map[iid])} queries)")

        pq = prompt_queries_map.get(iid, [])
        if pq:
            avg = embed_queries_avg(pq, api_key)
            if avg is not None:
                prompt_emb[idx] = avg
                prompt_updated.append(iid)
                print(f"  hyde_from_prompt: embedded")

        # Save checkpoint every 10 icons
        if (n + 1) % 10 == 0:
            np.save(str(OUT_IMG_NPY), img_emb)
            np.save(str(OUT_PROMPT_NPY), prompt_emb)
            OUT_PROMPT_QUERIES.write_text(json.dumps(prompt_queries_map, indent=2))
            print(f"  [checkpoint] saved at {n+1}/{len(eval_icons)}")

    # Final save
    np.save(str(OUT_IMG_NPY), img_emb)
    np.save(str(OUT_PROMPT_NPY), prompt_emb)
    OUT_PROMPT_QUERIES.write_text(json.dumps(prompt_queries_map, indent=2))

    print(f"\nDone.")
    print(f"  hyde_from_img   updated: {len(img_updated)} icons → {OUT_IMG_NPY}")
    print(f"  hyde_from_prompt updated: {len(prompt_updated)} icons → {OUT_PROMPT_NPY}")


if __name__ == "__main__":
    main()
