"""
ie_eval_02c_patch_siglip.py
---------------------------
Patch eval_results.json to add 2 SigLIP2 cross-product methods:
  - siglip2_qexp   : SigLIP2 text of expanded query avg → vs SigLIP2 image embeddings
  - siglip2_hyde_q : SigLIP2 text of hyde description   → vs SigLIP2 image embeddings

These require:
  - SigLIP2 model (google/siglip2-base-patch16-224)
  - Gemini API (to generate expanded queries and hyde descriptions)
  - image_embeddings.npy (full 2000-icon SigLIP2 image embeddings)

Run from recipe-lanes/:
    python3 scripts/ie_eval_02c_patch_siglip.py
"""

import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON = BASE / "action-icons.json"
IMAGE_EMBED_NPY = BASE / "image_embeddings.npy"
OUT_RESULTS = BASE / "eval_results.json"

GEMINI_GEN_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)
EXPAND_URL = GEMINI_GEN_URL
GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)
SIGLIP_MODEL_ID = "google/siglip2-base-patch16-224"

NEW_METHODS = ["siglip2_qexp", "siglip2_hyde_q"]
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
# Gemini LLM helpers
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


def gemini_expand_query(query: str, api_key: str) -> list[str]:
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
# SigLIP2 helpers
# ---------------------------------------------------------------------------

def load_siglip_text_encoder():
    import torch
    from transformers import AutoModel, AutoProcessor
    print(f"Loading SigLIP2 text encoder: {SIGLIP_MODEL_ID}")
    t0 = time.time()
    model = AutoModel.from_pretrained(SIGLIP_MODEL_ID)
    processor = AutoProcessor.from_pretrained(SIGLIP_MODEL_ID)
    model.eval()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    print(f"SigLIP2 loaded in {time.time() - t0:.1f}s on {device}")
    return model, processor, device


def siglip_embed_text(text: str, model, processor, device: str) -> np.ndarray:
    import torch
    inputs = processor(text=[text], return_tensors="pt", padding=True).to(device)
    with torch.no_grad():
        out = model.get_text_features(**inputs)
        if hasattr(out, "pooler_output"):
            features = out.pooler_output
        else:
            features = out
        features = features / features.norm(dim=-1, keepdim=True)
    return features.cpu().numpy()[0].astype(np.float32)


def siglip_embed_texts_avg(texts: list[str], model, processor, device: str) -> np.ndarray:
    vecs = [siglip_embed_text(t, model, processor, device) for t in texts]
    arr = np.stack(vecs, axis=0)
    avg = arr.mean(axis=0)
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg /= norm
    return avg.astype(np.float32)


# ---------------------------------------------------------------------------
# Cosine rank
# ---------------------------------------------------------------------------

def cosine_rank(query_vec: np.ndarray, embeddings: np.ndarray, target_idx: int) -> int:
    sims = embeddings @ query_vec
    ranked = np.argsort(-sims)
    positions = np.where(ranked == target_idx)[0]
    if len(positions) == 0:
        return NOT_FOUND_RANK
    return int(positions[0]) + 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    # Load eval results
    data = json.loads(OUT_RESULTS.read_text())
    results = data["results"]
    print(f"Loaded {len(results)} result entries")

    needs_patch = [r for r in results if any(m not in r["ranks"] for m in NEW_METHODS)]
    print(f"Entries needing siglip patch: {len(needs_patch)}")
    if not needs_patch:
        print("All entries already have siglip2_qexp and siglip2_hyde_q. Nothing to do.")
        return

    # Load image embeddings
    print("Loading image embeddings...")
    image_emb = np.load(str(IMAGE_EMBED_NPY)).astype(np.float32)
    print(f"  image_emb: {image_emb.shape}")

    # Build id -> row index map
    icons_list = json.loads(ICONS_JSON.read_text())
    id_to_idx = {icon["id"]: i for i, icon in enumerate(icons_list)}

    # Load SigLIP2
    siglip_model, siglip_processor, siglip_device = load_siglip_text_encoder()

    # Caches keyed by query_text
    expand_cache: dict[str, list[str]] = {}
    siglip_qexp_cache: dict[str, np.ndarray] = {}  # query_text -> siglip avg of expanded terms
    siglip_hyde_cache: dict[str, np.ndarray] = {}  # query_text -> siglip of hyde description
    hyde_text_cache: dict[str, str] = {}            # query_text -> raw hyde description text

    since_checkpoint = 0
    total = len(results)

    for entry_n, entry in enumerate(results):
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

        need_qexp = "siglip2_qexp" in missing
        need_hyde_q = "siglip2_hyde_q" in missing

        # --- Compute siglip2_qexp: SigLIP2 avg of expanded terms ---
        if need_qexp and query_text not in siglip_qexp_cache:
            if query_text not in expand_cache:
                try:
                    expand_cache[query_text] = gemini_expand_query(query_text, api_key)
                    time.sleep(0.1)
                except Exception as e:
                    print(f"  [warn] expand failed: {e}")
                    expand_cache[query_text] = [query_text]

            expanded_terms = expand_cache[query_text]
            try:
                siglip_qexp_cache[query_text] = siglip_embed_texts_avg(
                    expanded_terms, siglip_model, siglip_processor, siglip_device
                )
            except Exception as e:
                print(f"  [warn] siglip expand embed failed: {e}")
                siglip_qexp_cache[query_text] = siglip_embed_text(
                    query_text, siglip_model, siglip_processor, siglip_device
                )

        # --- Compute siglip2_hyde_q: SigLIP2 of hyde description ---
        if need_hyde_q and query_text not in siglip_hyde_cache:
            if query_text not in hyde_text_cache:
                try:
                    hyde_text_cache[query_text] = gemini_hyde_query(query_text, api_key)
                    time.sleep(0.1)
                except Exception as e:
                    print(f"  [warn] hyde_query generation failed: {e}")
                    hyde_text_cache[query_text] = query_text

            hyde_desc = hyde_text_cache[query_text]
            try:
                siglip_hyde_cache[query_text] = siglip_embed_text(
                    hyde_desc, siglip_model, siglip_processor, siglip_device
                )
            except Exception as e:
                print(f"  [warn] siglip hyde embed failed: {e}")
                siglip_hyde_cache[query_text] = siglip_embed_text(
                    query_text, siglip_model, siglip_processor, siglip_device
                )

        # Compute ranks
        for m in missing:
            if m == "siglip2_qexp":
                vec = siglip_qexp_cache.get(query_text)
                entry["ranks"][m] = cosine_rank(vec, image_emb, target_idx) if vec is not None else NOT_FOUND_RANK
            elif m == "siglip2_hyde_q":
                vec = siglip_hyde_cache.get(query_text)
                entry["ranks"][m] = cosine_rank(vec, image_emb, target_idx) if vec is not None else NOT_FOUND_RANK

        since_checkpoint += 1

        if since_checkpoint >= 20:
            OUT_RESULTS.write_text(json.dumps({"results": results}, indent=2))
            print(f"  [checkpoint] Saved at entry {entry_n+1}/{total}")
            since_checkpoint = 0

    # Final save
    OUT_RESULTS.write_text(json.dumps({"results": results}, indent=2))
    print(f"\nDone. Results written to {OUT_RESULTS}")

    sample = results[0]["ranks"]
    print(f"New methods in first entry: {[m for m in NEW_METHODS if m in sample]}")


if __name__ == "__main__":
    main()
