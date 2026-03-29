"""
ie_eval_02_search.py
---------------------
Run all search methods for each icon × query_type combination in eval_data.json.
Records the rank of the correct icon for each method.

Requires:
  - eval_data.json       (ie_eval_01_generate.py)
  - eval_hyde_from_img.npy    (ie_08_build_eval_hyde.py)
  - eval_hyde_from_prompt.npy (ie_08_build_eval_hyde.py)

Search methods:
  plain_embed       — Gemini embed query → vs text_embeddings (desc)
  bm25_desc         — BM25 on descriptions
  siglip2           — SigLIP2 text-encode query → vs image_embeddings
  hyde_from_prompt  — Gemini embed query → vs hyde_from_prompt matrix (LLM queries from desc)
  hyde_from_img     — Gemini embed query → vs hyde_from_img matrix (Gemini Vision queries from image)
  qexp_plain        — expand query → embed avg → vs text_embeddings
  qexp_hyde_img     — expand query → embed avg → vs hyde_from_img matrix
  bm25_caption      — BM25 on Gemini Vision long_captions
  caption_embed     — Gemini embed query → vs caption_embeddings (embed of long_caption)
  siglip2_caption   — SigLIP2 avg of expanded terms → vs siglip_caption_embeddings
  hyde_query        — LLM generates hypothetical icon desc from query → embed → vs text_embeddings

Outputs:
  scripts/ie_data/eval_results.json
  scripts/ie_data/eval_caption_embeddings.npy
  scripts/ie_data/eval_caption_siglip_embeddings.npy

Run from recipe-lanes/:
    python3 scripts/ie_eval_02_search.py
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
TEXT_EMBED_NPY = BASE / "text_embeddings.npy"
IMAGE_EMBED_NPY = BASE / "image_embeddings.npy"
HYDE_FROM_IMG_NPY    = BASE / "eval_hyde_from_img.npy"
HYDE_FROM_PROMPT_NPY = BASE / "eval_hyde_from_prompt.npy"
OUT_RESULTS = BASE / "eval_results.json"
OUT_CAPTION_EMBED = BASE / "eval_caption_embeddings.npy"
OUT_CAPTION_SIGLIP = BASE / "eval_caption_siglip_embeddings.npy"

GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)
GEMINI_GEN_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)
SIGLIP_MODEL_ID = "google/siglip2-base-patch16-224"
QUERY_TYPES = ["query_1", "query_2", "blip_unconditional", "blip_conditional"]
SEARCH_METHODS = [
    "plain_embed",
    "bm25_desc",
    "siglip2",
    "hyde_from_prompt",
    "hyde_from_img",
    "qexp_plain",
    "qexp_hyde_img",
    "bm25_caption",
    "caption_embed",
    "siglip2_caption",
    "hyde_query",
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
# Gemini LLM expand query
# ---------------------------------------------------------------------------

EXPAND_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)


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
# BM25 search
# ---------------------------------------------------------------------------

def build_bm25_index(corpus: list[str]):
    from rank_bm25 import BM25Okapi
    tokenized = [doc.lower().split() for doc in corpus]
    return BM25Okapi(tokenized)


def bm25_rank(query: str, bm25_index, target_idx: int) -> int:
    scores = bm25_index.get_scores(query.lower().split())
    ranked = np.argsort(-scores)
    positions = np.where(ranked == target_idx)[0]
    if len(positions) == 0:
        return NOT_FOUND_RANK
    return int(positions[0]) + 1  # 1-indexed


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
# SigLIP2 text encoding
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
        if isinstance(out, dict) or hasattr(out, "pooler_output"):
            features = out.pooler_output if hasattr(out, "pooler_output") else out["pooler_output"]
        else:
            features = out
        features = features / features.norm(dim=-1, keepdim=True)
    return features.cpu().numpy()[0].astype(np.float32)


def siglip_embed_texts_avg(texts: list[str], model, processor, device: str) -> np.ndarray:
    """Embed multiple texts and return their normalized average."""
    import torch
    vecs = []
    for t in texts:
        vecs.append(siglip_embed_text(t, model, processor, device))
    arr = np.stack(vecs, axis=0)
    avg = arr.mean(axis=0)
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg /= norm
    return avg.astype(np.float32)


# ---------------------------------------------------------------------------
# Pre-compute caption embeddings (Gemini + SigLIP2)
# ---------------------------------------------------------------------------

def precompute_caption_embeddings(
    eval_icons: list[dict],
    id_to_idx: dict,
    base_text_emb: np.ndarray,
    base_image_emb: np.ndarray,
    api_key: str,
    siglip_model, siglip_processor, siglip_device: str,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build eval_caption_embeddings and eval_caption_siglip_embeddings.
    - Load from file if already computed and shapes match.
    - Otherwise compute fresh.
    """
    caption_emb = base_text_emb.copy()
    siglip_caption_emb = base_image_emb.copy()

    caption_already = OUT_CAPTION_EMBED.exists()
    siglip_already = OUT_CAPTION_SIGLIP.exists()

    if caption_already:
        loaded = np.load(str(OUT_CAPTION_EMBED))
        if loaded.shape == base_text_emb.shape:
            print(f"Loaded caption embeddings from {OUT_CAPTION_EMBED}")
            caption_emb = loaded
            caption_already = True
        else:
            print(f"Shape mismatch in {OUT_CAPTION_EMBED}, recomputing")
            caption_already = False

    if siglip_already:
        loaded = np.load(str(OUT_CAPTION_SIGLIP))
        if loaded.shape == base_image_emb.shape:
            print(f"Loaded SigLIP caption embeddings from {OUT_CAPTION_SIGLIP}")
            siglip_caption_emb = loaded
            siglip_already = True
        else:
            print(f"Shape mismatch in {OUT_CAPTION_SIGLIP}, recomputing")
            siglip_already = False

    if caption_already and siglip_already:
        return caption_emb, siglip_caption_emb

    print(f"Pre-computing caption embeddings for {len(eval_icons)} icons...")
    for n, icon in enumerate(eval_icons):
        icon_id = icon["id"]
        caption = icon.get("long_caption", "")
        if not caption:
            continue
        row_idx = id_to_idx.get(icon_id)
        if row_idx is None:
            continue

        if not caption_already:
            try:
                vec = gemini_embed(caption, api_key, task_type="RETRIEVAL_DOCUMENT")
                caption_emb[row_idx] = vec
                time.sleep(0.15)
            except Exception as e:
                print(f"  [warn] Gemini embed failed for {icon_id}: {e}")

        if not siglip_already:
            try:
                vec = siglip_embed_text(caption, siglip_model, siglip_processor, siglip_device)
                siglip_caption_emb[row_idx] = vec
            except Exception as e:
                print(f"  [warn] SigLIP embed failed for {icon_id}: {e}")

        if (n + 1) % 10 == 0:
            print(f"  {n+1}/{len(eval_icons)} caption embeddings done")

    if not caption_already:
        np.save(str(OUT_CAPTION_EMBED), caption_emb)
        print(f"Saved {OUT_CAPTION_EMBED}")

    if not siglip_already:
        np.save(str(OUT_CAPTION_SIGLIP), siglip_caption_emb)
        print(f"Saved {OUT_CAPTION_SIGLIP}")

    return caption_emb, siglip_caption_emb


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------

def load_results_checkpoint() -> dict:
    """Returns {(id, query_type): result_dict}."""
    if OUT_RESULTS.exists():
        data = json.loads(OUT_RESULTS.read_text())
        results = data.get("results", [])
        print(f"[checkpoint] Loaded {len(results)} existing results")
        return {(r["id"], r["query_type"]): r for r in results}
    return {}


def save_results_checkpoint(done_map: dict, ordered_keys: list):
    results_list = [done_map[k] for k in ordered_keys if k in done_map]
    OUT_RESULTS.write_text(json.dumps({"results": results_list}, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    # Load eval data
    if not EVAL_DATA_JSON.exists():
        print(f"ERROR: {EVAL_DATA_JSON} not found. Run ie_eval_01_generate.py first.")
        return
    eval_data = json.loads(EVAL_DATA_JSON.read_text())
    eval_icons = eval_data["icons"]
    print(f"Loaded {len(eval_icons)} eval icons")

    # Load base embeddings
    print("Loading base embeddings...")
    text_emb  = np.load(str(TEXT_EMBED_NPY)).astype(np.float32)
    image_emb = np.load(str(IMAGE_EMBED_NPY)).astype(np.float32)
    print(f"  text_emb:  {text_emb.shape}")
    print(f"  image_emb: {image_emb.shape}")

    # Load eval-specific hyde matrices (built by ie_08_build_eval_hyde.py)
    if not HYDE_FROM_IMG_NPY.exists() or not HYDE_FROM_PROMPT_NPY.exists():
        print("ERROR: eval hyde matrices not found. Run ie_08_build_eval_hyde.py first.")
        return
    hyde_from_img    = np.load(str(HYDE_FROM_IMG_NPY)).astype(np.float32)
    hyde_from_prompt = np.load(str(HYDE_FROM_PROMPT_NPY)).astype(np.float32)
    print(f"  hyde_from_img:    {hyde_from_img.shape}")
    print(f"  hyde_from_prompt: {hyde_from_prompt.shape}")

    # Build id -> row index map
    icons_list = json.loads(ICONS_JSON.read_text())
    id_to_idx = {icon["id"]: i for i, icon in enumerate(icons_list)}
    print(f"Built id_to_idx for {len(id_to_idx)} icons")

    # Build BM25 index over original descriptions
    print("Building BM25 index over original descriptions...")
    all_descs = [icon["desc"] for icon in icons_list]
    bm25_desc_index = build_bm25_index(all_descs)

    # Build caption corpus: long_caption for eval icons, desc for others
    print("Building caption BM25 corpus...")
    eval_caption_map = {icon["id"]: icon.get("long_caption", "") for icon in eval_icons}
    caption_corpus = []
    for icon in icons_list:
        iid = icon["id"]
        if iid in eval_caption_map and eval_caption_map[iid]:
            caption_corpus.append(eval_caption_map[iid])
        else:
            caption_corpus.append(icon["desc"])
    bm25_caption_index = build_bm25_index(caption_corpus)

    # Load SigLIP2 text encoder
    siglip_model, siglip_processor, siglip_device = load_siglip_text_encoder()

    # Pre-compute caption embeddings
    caption_emb, siglip_caption_emb = precompute_caption_embeddings(
        eval_icons, id_to_idx,
        text_emb, image_emb,
        api_key,
        siglip_model, siglip_processor, siglip_device,
    )

    # Load results checkpoint
    done_map = load_results_checkpoint()

    # Build ordered list of all (id, query_type) keys
    ordered_keys = [
        (icon["id"], qt)
        for icon in eval_icons
        for qt in QUERY_TYPES
    ]

    # Caches to avoid redundant API calls within same icon
    # Maps icon_id -> {query_text -> expanded_terms}
    expand_cache: dict[str, list[str]] = {}      # query_text -> expanded terms
    embed_cache: dict[str, np.ndarray] = {}       # query_text -> gemini embedding
    siglip_cache: dict[str, np.ndarray] = {}      # query_text -> siglip embedding
    siglip_expand_cache: dict[str, np.ndarray] = {}  # query_text -> siglip avg of expanded
    hyde_query_cache: dict[str, np.ndarray] = {}  # query_text -> hyde-query embedding

    total_combos = len(eval_icons) * len(QUERY_TYPES)
    already_done = len(done_map)
    print(f"Total (icon × query_type): {total_combos}")
    print(f"Already done: {already_done}")

    since_checkpoint = 0

    for combo_n, (icon, qt) in enumerate(
        (icon, qt) for icon in eval_icons for qt in QUERY_TYPES
    ):
        icon_id = icon["id"]
        key = (icon_id, qt)

        if key in done_map:
            continue

        query_text = icon.get(qt, "")
        if not query_text:
            # Store as not-found for all methods
            done_map[key] = {
                "id": icon_id,
                "query_type": qt,
                "query_text": "",
                "ranks": {m: NOT_FOUND_RANK for m in SEARCH_METHODS},
            }
            since_checkpoint += 1
            continue

        target_idx = id_to_idx.get(icon_id)
        if target_idx is None:
            print(f"  [warn] {icon_id} not in id_to_idx, skipping")
            continue

        print(f"[{combo_n+1}/{total_combos}] {icon_id} / {qt}: {query_text[:60]}")

        ranks = {}

        # --- plain_embed: Gemini embed query → cosine vs text_emb ---
        if query_text not in embed_cache:
            try:
                embed_cache[query_text] = gemini_embed(query_text, api_key)
                time.sleep(0.1)
            except Exception as e:
                print(f"  [warn] Gemini embed failed: {e}")
                embed_cache[query_text] = np.zeros(text_emb.shape[1], dtype=np.float32)
        q_vec = embed_cache[query_text]
        ranks["plain_embed"] = cosine_rank(q_vec, text_emb, target_idx)

        # --- bm25_desc ---
        ranks["bm25_desc"] = bm25_rank(query_text, bm25_desc_index, target_idx)

        # --- siglip2: SigLIP2 text-encode query → cosine vs image_emb ---
        if query_text not in siglip_cache:
            try:
                siglip_cache[query_text] = siglip_embed_text(
                    query_text, siglip_model, siglip_processor, siglip_device
                )
            except Exception as e:
                print(f"  [warn] SigLIP embed failed: {e}")
                siglip_cache[query_text] = np.zeros(image_emb.shape[1], dtype=np.float32)
        sq_vec = siglip_cache[query_text]
        ranks["siglip2"] = cosine_rank(sq_vec, image_emb, target_idx)

        # --- hyde_from_prompt: Gemini embed query → cosine vs hyde_from_prompt matrix ---
        ranks["hyde_from_prompt"] = cosine_rank(q_vec, hyde_from_prompt, target_idx)

        # --- hyde_from_img: Gemini embed query → cosine vs hyde_from_img matrix ---
        ranks["hyde_from_img"] = cosine_rank(q_vec, hyde_from_img, target_idx)

        # --- qexp: expand query to 6 terms ---
        if query_text not in expand_cache:
            try:
                expanded = gemini_expand_query(query_text, api_key)
                expand_cache[query_text] = expanded
                time.sleep(0.1)
            except Exception as e:
                print(f"  [warn] query expand failed: {e}")
                expand_cache[query_text] = [query_text]
        expanded_terms = expand_cache[query_text]

        # Embed each expanded term and average
        exp_vecs = []
        for term in expanded_terms:
            if term not in embed_cache:
                try:
                    embed_cache[term] = gemini_embed(term, api_key)
                    time.sleep(0.05)
                except Exception as e:
                    print(f"  [warn] embed expanded term failed: {e}")
                    embed_cache[term] = np.zeros(text_emb.shape[1], dtype=np.float32)
            exp_vecs.append(embed_cache[term])

        if exp_vecs:
            exp_avg = np.stack(exp_vecs, axis=0).mean(axis=0)
            exp_norm = np.linalg.norm(exp_avg)
            if exp_norm > 0:
                exp_avg /= exp_norm
        else:
            exp_avg = q_vec

        # --- qexp_plain ---
        ranks["qexp_plain"] = cosine_rank(exp_avg, text_emb, target_idx)

        # --- qexp_hyde_img: expanded query vec vs hyde_from_img matrix ---
        ranks["qexp_hyde_img"] = cosine_rank(exp_avg, hyde_from_img, target_idx)

        # --- bm25_caption ---
        ranks["bm25_caption"] = bm25_rank(query_text, bm25_caption_index, target_idx)

        # --- caption_embed: Gemini embed query → cosine vs caption_emb ---
        ranks["caption_embed"] = cosine_rank(q_vec, caption_emb, target_idx)

        # --- siglip2_caption: SigLIP2 avg of expanded terms → cosine vs siglip_caption_emb ---
        if query_text not in siglip_expand_cache:
            try:
                siglip_expand_cache[query_text] = siglip_embed_texts_avg(
                    expanded_terms, siglip_model, siglip_processor, siglip_device
                )
            except Exception as e:
                print(f"  [warn] SigLIP expand embed failed: {e}")
                siglip_expand_cache[query_text] = sq_vec
        sq_exp_vec = siglip_expand_cache[query_text]
        ranks["siglip2_caption"] = cosine_rank(sq_exp_vec, siglip_caption_emb, target_idx)

        # --- hyde_query: LLM generates hypothetical icon description → embed → vs text_emb ---
        if query_text not in hyde_query_cache:
            try:
                hyp_desc = gemini_hyde_query(query_text, api_key)
                # Embed as RETRIEVAL_DOCUMENT (matches how text_embeddings.npy was built)
                hyde_query_cache[query_text] = gemini_embed(hyp_desc, api_key, task_type="RETRIEVAL_DOCUMENT")
                time.sleep(0.1)
            except Exception as e:
                print(f"  [warn] hyde_query failed: {e}")
                hyde_query_cache[query_text] = q_vec
        ranks["hyde_query"] = cosine_rank(hyde_query_cache[query_text], text_emb, target_idx)

        print(f"  ranks: {ranks}")

        done_map[key] = {
            "id": icon_id,
            "query_type": qt,
            "query_text": query_text,
            "ranks": ranks,
        }
        since_checkpoint += 1

        if since_checkpoint >= 10:
            save_results_checkpoint(done_map, ordered_keys)
            print(f"  [checkpoint] Saved {len(done_map)} results")
            since_checkpoint = 0

    # Final save
    save_results_checkpoint(done_map, ordered_keys)
    print(f"\nDone. {len(done_map)} results written to {OUT_RESULTS}")


if __name__ == "__main__":
    main()
