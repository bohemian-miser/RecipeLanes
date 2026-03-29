"""
ie_eval_02b_patch.py
--------------------
Patch eval_results.json to add 5 missing cross-product method combinations:
  - qexp_hyde_prompt       : expanded query avg vs hyde_from_prompt matrix
  - hyde_query_hyde_prompt : hyde_query vector vs hyde_from_prompt matrix
  - qexp_caption           : expanded query avg vs caption_embed matrix
  - hyde_query_caption     : hyde_query vector vs caption_embed matrix
  - hyde_query_hyde_img    : hyde_query vector vs hyde_from_img matrix

Run from recipe-lanes/:
    python3 scripts/ie_eval_02b_patch.py
"""

import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON = BASE / "action-icons.json"
EVAL_DATA_JSON = BASE / "eval_data.json"
HYDE_FROM_IMG_NPY    = BASE / "eval_hyde_from_img.npy"
HYDE_FROM_PROMPT_NPY = BASE / "eval_hyde_from_prompt.npy"
CAPTION_EMBED_NPY    = BASE / "eval_caption_embeddings.npy"
OUT_RESULTS = BASE / "eval_results.json"

GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)
GEMINI_GEN_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)
EXPAND_URL = GEMINI_GEN_URL

NEW_METHODS = [
    "qexp_hyde_prompt",
    "hyde_query_hyde_prompt",
    "qexp_caption",
    "hyde_query_caption",
    "hyde_query_hyde_img",
]

NOT_FOUND_RANK = 9999


# ---------------------------------------------------------------------------
# API key
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    for candidate in [Path(".env"), Path(__file__).parent.parent / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == "GEMINI_API_KEY":
                        return v.strip()
    return os.environ.get("GEMINI_API_KEY", "")


# ---------------------------------------------------------------------------
# Gemini embedding
# ---------------------------------------------------------------------------

def gemini_embed(text: str, api_key: str, task_type: str = "RETRIEVAL_QUERY") -> np.ndarray:
    url = GEMINI_EMBED_URL.format(key=api_key)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": task_type,
    }).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    vec = np.array(d["embedding"]["values"], dtype=np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


# ---------------------------------------------------------------------------
# Gemini LLM functions
# ---------------------------------------------------------------------------

def gemini_expand_query(query: str, api_key: str) -> list[str]:
    """Expand query to 6 search terms using Gemini."""
    prompt = (
        f'Expand this recipe icon search query into 6 alternative search terms '
        f'(2-5 words each, varying from broad to specific). '
        f'Query: "{query}"\n'
        f'Return a JSON array of 6 strings only, no other text.'
    )
    url = EXPAND_URL.format(key=api_key)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    result = json.loads(raw)
    if isinstance(result, list):
        return result[:6]
    return []


def gemini_hyde_query(query: str, api_key: str) -> str:
    """Classic HyDE: generate a hypothetical icon description that answers this search query."""
    prompt = (
        f'A user is searching a recipe app icon library for: "{query}"\n'
        f'Write a short 2-3 sentence description of what the ideal icon would look like '
        f'(what it depicts visually, what action or ingredient it represents). '
        f'Write only the description, no other text.'
    )
    url = GEMINI_GEN_URL.format(key=api_key)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
    }).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    return d["candidates"][0]["content"]["parts"][0]["text"].strip()


# ---------------------------------------------------------------------------
# Cosine similarity search
# ---------------------------------------------------------------------------

def cosine_rank(query_vec: np.ndarray, embeddings: np.ndarray, target_idx: int) -> int:
    sims = embeddings @ query_vec  # assumes both L2-normalised
    ranked = np.argsort(-sims)
    positions = np.where(ranked == target_idx)[0]
    if len(positions) == 0:
        return NOT_FOUND_RANK
    return int(positions[0]) + 1  # 1-indexed


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    # Load eval results
    if not OUT_RESULTS.exists():
        print(f"ERROR: {OUT_RESULTS} not found. Run ie_eval_02_search.py first.")
        return
    data = json.loads(OUT_RESULTS.read_text())
    results = data["results"]
    print(f"Loaded {len(results)} result entries")

    # Check which entries need patching
    needs_patch = [r for r in results if any(m not in r["ranks"] for m in NEW_METHODS)]
    print(f"Entries needing patch: {len(needs_patch)}")
    if not needs_patch:
        print("All entries already have the 5 new methods. Nothing to do.")
        return

    # Load embedding matrices
    print("Loading embedding matrices...")
    hyde_from_prompt = np.load(str(HYDE_FROM_PROMPT_NPY)).astype(np.float32)
    hyde_from_img    = np.load(str(HYDE_FROM_IMG_NPY)).astype(np.float32)
    caption_emb      = np.load(str(CAPTION_EMBED_NPY)).astype(np.float32)
    print(f"  hyde_from_prompt: {hyde_from_prompt.shape}")
    print(f"  hyde_from_img:    {hyde_from_img.shape}")
    print(f"  caption_emb:      {caption_emb.shape}")

    # Build id -> row index map
    icons_list = json.loads(ICONS_JSON.read_text())
    id_to_idx = {icon["id"]: i for i, icon in enumerate(icons_list)}
    print(f"Built id_to_idx for {len(id_to_idx)} icons")

    # Caches keyed by query_text
    embed_cache: dict[str, np.ndarray] = {}       # query_text -> gemini embedding (RETRIEVAL_QUERY)
    expand_cache: dict[str, list[str]] = {}        # query_text -> expanded terms
    exp_avg_cache: dict[str, np.ndarray] = {}      # query_text -> avg of expanded term embeddings
    hyde_query_vec_cache: dict[str, np.ndarray] = {}  # query_text -> hyde_query embedding

    since_checkpoint = 0
    total = len(results)

    for entry_n, entry in enumerate(results):
        # Check if this entry needs any of the 5 new methods
        missing = [m for m in NEW_METHODS if m not in entry["ranks"]]
        if not missing:
            continue

        query_text = entry.get("query_text", "")
        icon_id = entry["id"]
        target_idx = id_to_idx.get(icon_id)

        if entry_n % 20 == 0 or missing:
            print(f"[{entry_n+1}/{total}] {icon_id} / {entry['query_type']}: missing={missing}")

        if not query_text or target_idx is None:
            for m in missing:
                entry["ranks"][m] = NOT_FOUND_RANK
            since_checkpoint += 1
            continue

        # Determine which intermediate vectors are needed
        need_exp_avg = any(m in missing for m in ["qexp_hyde_prompt", "qexp_caption"])
        need_hyde_query_vec = any(m in missing for m in [
            "hyde_query_hyde_prompt", "hyde_query_caption", "hyde_query_hyde_img"
        ])

        # --- Compute exp_avg if needed ---
        if need_exp_avg and query_text not in exp_avg_cache:
            # Get expanded terms
            if query_text not in expand_cache:
                try:
                    expanded = gemini_expand_query(query_text, api_key)
                    expand_cache[query_text] = expanded
                    time.sleep(0.1)
                except Exception as e:
                    print(f"  [warn] query expand failed: {e}")
                    expand_cache[query_text] = [query_text]

            expanded_terms = expand_cache[query_text]

            # Embed each expanded term (with caching)
            exp_vecs = []
            for term in expanded_terms:
                if term not in embed_cache:
                    try:
                        embed_cache[term] = gemini_embed(term, api_key)
                        time.sleep(0.05)
                    except Exception as e:
                        print(f"  [warn] embed expanded term failed: {e}")
                        embed_cache[term] = None
                if embed_cache[term] is not None:
                    exp_vecs.append(embed_cache[term])

            if exp_vecs:
                avg = np.stack(exp_vecs, axis=0).mean(axis=0)
                norm = np.linalg.norm(avg)
                if norm > 0:
                    avg /= norm
                exp_avg_cache[query_text] = avg.astype(np.float32)
            else:
                # Fallback: use plain query embedding
                if query_text not in embed_cache:
                    try:
                        embed_cache[query_text] = gemini_embed(query_text, api_key)
                        time.sleep(0.1)
                    except Exception as e:
                        print(f"  [warn] plain embed failed: {e}")
                        embed_cache[query_text] = np.zeros(hyde_from_prompt.shape[1], dtype=np.float32)
                exp_avg_cache[query_text] = embed_cache[query_text]

        # --- Compute hyde_query_vec if needed ---
        if need_hyde_query_vec and query_text not in hyde_query_vec_cache:
            try:
                hyp_desc = gemini_hyde_query(query_text, api_key)
                hyde_query_vec_cache[query_text] = gemini_embed(
                    hyp_desc, api_key, task_type="RETRIEVAL_DOCUMENT"
                )
                time.sleep(0.1)
            except Exception as e:
                print(f"  [warn] hyde_query failed: {e}")
                # Fallback: use plain query embedding
                if query_text not in embed_cache:
                    try:
                        embed_cache[query_text] = gemini_embed(query_text, api_key)
                        time.sleep(0.1)
                    except Exception as ee:
                        print(f"  [warn] plain embed fallback failed: {ee}")
                        embed_cache[query_text] = np.zeros(hyde_from_prompt.shape[1], dtype=np.float32)
                hyde_query_vec_cache[query_text] = embed_cache[query_text]

        # --- Compute the 5 new ranks ---
        for m in missing:
            if m == "qexp_hyde_prompt":
                vec = exp_avg_cache.get(query_text)
                entry["ranks"][m] = cosine_rank(vec, hyde_from_prompt, target_idx) if vec is not None else NOT_FOUND_RANK

            elif m == "hyde_query_hyde_prompt":
                vec = hyde_query_vec_cache.get(query_text)
                entry["ranks"][m] = cosine_rank(vec, hyde_from_prompt, target_idx) if vec is not None else NOT_FOUND_RANK

            elif m == "qexp_caption":
                vec = exp_avg_cache.get(query_text)
                entry["ranks"][m] = cosine_rank(vec, caption_emb, target_idx) if vec is not None else NOT_FOUND_RANK

            elif m == "hyde_query_caption":
                vec = hyde_query_vec_cache.get(query_text)
                entry["ranks"][m] = cosine_rank(vec, caption_emb, target_idx) if vec is not None else NOT_FOUND_RANK

            elif m == "hyde_query_hyde_img":
                vec = hyde_query_vec_cache.get(query_text)
                entry["ranks"][m] = cosine_rank(vec, hyde_from_img, target_idx) if vec is not None else NOT_FOUND_RANK

        since_checkpoint += 1

        # Checkpoint every 20 patched entries
        if since_checkpoint >= 20:
            OUT_RESULTS.write_text(json.dumps({"results": results}, indent=2))
            print(f"  [checkpoint] Saved at entry {entry_n+1}/{total}")
            since_checkpoint = 0

    # Final save
    OUT_RESULTS.write_text(json.dumps({"results": results}, indent=2))
    print(f"\nDone. Patched results written to {OUT_RESULTS}")

    # Verify
    sample = results[0]["ranks"]
    print(f"New methods in first entry: {[m for m in NEW_METHODS if m in sample]}")


if __name__ == "__main__":
    main()
