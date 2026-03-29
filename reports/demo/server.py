#!/home/dog/venvs/recipeviz/bin/python3
"""
Icon Retrieval Research Server
-------------------------------
Matrix comparison tool for evaluating icon retrieval combinations.

Three grids compare all (query-side representation) × (icon-side index) combinations:
  Grid 1 — Gemini Text Embedding Space (768→3072 dim)
  Grid 2 — BM25 / Keyword
  Grid 3 — SigLIP2 Image Space (768 dim)

Usage:
    cd reports/demo
    python3 server.py

Then open http://localhost:5050 in your browser.

Requires: flask, numpy, rank-bm25, transformers (all in ~/venvs/recipeviz)
API key:  GEMINI_API_KEY in ../../recipe-lanes/.env or environment
"""

import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

import numpy as np
from flask import Flask, jsonify, request, send_file

# ---------------------------------------------------------------------------
# Paths — resolve relative to this file, pointing into recipe-lanes/scripts/ie_data
# ---------------------------------------------------------------------------
DEMO_DIR  = Path(__file__).parent
REPO_ROOT = DEMO_DIR.parent.parent / "recipe-lanes"
DATA_DIR  = REPO_ROOT / "scripts" / "ie_data"
THUMB_DIR = DATA_DIR / "icons" / "thumb"

ICONS_JSON      = DATA_DIR / "action-icons.json"
TEXT_EMBED_NPY  = DATA_DIR / "text_embeddings.npy"
HYDE_IMG_NPY    = DATA_DIR / "all_hyde_from_img.npy"
HYDE_PROMPT_NPY = DATA_DIR / "all_hyde_from_prompt.npy"
CAPTION_EMB_NPY = DATA_DIR / "all_caption_embeddings.npy"
IMAGE_EMB_NPY   = DATA_DIR / "image_embeddings.npy"
CAPTIONS_JSON   = DATA_DIR / "all_captions.json"

GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)
GEMINI_GEN_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)

SIGLIP_MODEL_ID = "google/siglip2-base-patch16-224"

TOP_K = 30  # default hits for modal; top-1 shown in cell

# The original prompt template used to generate all icons in this library.
# All query-side prompts should be aware of this style context so generated
# terms/queries match what the icons actually look like.
ICON_STYLE_CONTEXT = (
    'Icons in this library are 64x64 pixel art style, colorful, clean outlines, '
    'white background, suitable for a recipe card infographic or game inventory. '
    'Each icon depicts a single cooking action, ingredient, or kitchen item.'
)

# ---------------------------------------------------------------------------
# API key
# ---------------------------------------------------------------------------
def load_api_key() -> str:
    for candidate in [
        DEMO_DIR / ".env",
        REPO_ROOT / ".env",
        REPO_ROOT.parent / ".env",
    ]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == "GEMINI_API_KEY":
                        return v.strip()
    return os.environ.get("GEMINI_API_KEY", "")


# ---------------------------------------------------------------------------
# Load data on startup
# ---------------------------------------------------------------------------
print("Loading icon data...")
icons: list[dict] = json.loads(ICONS_JSON.read_text())
captions_map: dict[str, str] = {}
if CAPTIONS_JSON.exists():
    captions_map = json.loads(CAPTIONS_JSON.read_text())
print(f"  {len(icons)} icons loaded")

# Pre-computed icon-side query texts (for display in the UI)
hyde_queries_map: dict[str, list[str]] = {}       # icon id → 6 queries (from image)
hyde_prompt_queries_map: dict[str, list[str]] = {} # icon id → 6 queries (from prompt)
for fname, target in [
    ("all_hyde_queries.json",        hyde_queries_map),
    ("all_hyde_prompt_queries.json", hyde_prompt_queries_map),
]:
    p = DATA_DIR / fname
    if p.exists():
        target.update(json.loads(p.read_text()))
print(f"  icon-side query maps: {len(hyde_queries_map)} img-hyde, {len(hyde_prompt_queries_map)} prompt-hyde")

print("Loading embedding matrices...")
text_emb    = np.load(str(TEXT_EMBED_NPY)).astype(np.float32)
hyde_img_emb = np.load(str(HYDE_IMG_NPY)).astype(np.float32)
hyde_pmt_emb = np.load(str(HYDE_PROMPT_NPY)).astype(np.float32)
caption_emb = np.load(str(CAPTION_EMB_NPY)).astype(np.float32)
image_emb   = np.load(str(IMAGE_EMB_NPY)).astype(np.float32)

# L2-normalise all matrices so dot-product == cosine similarity
def _l2norm_rows(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return m / norms

text_emb    = _l2norm_rows(text_emb)
hyde_img_emb = _l2norm_rows(hyde_img_emb)
hyde_pmt_emb = _l2norm_rows(hyde_pmt_emb)
caption_emb = _l2norm_rows(caption_emb)
image_emb   = _l2norm_rows(image_emb)

print(f"  text_emb:    {text_emb.shape}")
print(f"  hyde_img:    {hyde_img_emb.shape}")
print(f"  hyde_pmt:    {hyde_pmt_emb.shape}")
print(f"  caption_emb: {caption_emb.shape}")
print(f"  image_emb:   {image_emb.shape}")

id_to_idx = {icon["id"]: i for i, icon in enumerate(icons)}

n_hyde_computed = int(np.sum(~np.all(np.isclose(hyde_img_emb, text_emb), axis=1)))
n_cap_computed  = int(np.sum(~np.all(np.isclose(caption_emb, text_emb), axis=1)))
print(f"  hyde_from_img backfill: {n_hyde_computed}/{len(icons)}")
print(f"  caption backfill:       {n_cap_computed}/{len(icons)}")

# ---------------------------------------------------------------------------
# BM25 setup
# ---------------------------------------------------------------------------
try:
    from rank_bm25 import BM25Okapi

    def _tokenize(text: str) -> list[str]:
        return text.lower().replace("-", " ").split()

    desc_corpus = [_tokenize(ic["desc"]) for ic in icons]
    cap_corpus  = [_tokenize(captions_map.get(ic["id"], ic["desc"])) for ic in icons]
    bm25_desc   = BM25Okapi(desc_corpus)
    bm25_cap    = BM25Okapi(cap_corpus)
    BM25_AVAILABLE = True
    print("  BM25 indices built")
except Exception:
    import traceback
    traceback.print_exc()
    BM25_AVAILABLE = False
    print("  BM25 not available (pip install rank-bm25)")

# ---------------------------------------------------------------------------
# SigLIP2 — lazy-loaded on first use
# ---------------------------------------------------------------------------
_siglip_lock      = threading.Lock()
_siglip_processor = None
_siglip_model     = None
_siglip_loading   = False
SIGLIP_AVAILABLE  = False   # set True after load

def _ensure_siglip():
    """Load SigLIP2 text encoder on first call (thread-safe)."""
    global _siglip_processor, _siglip_model, _siglip_loading, SIGLIP_AVAILABLE
    with _siglip_lock:
        if _siglip_model is not None:
            return True
        if _siglip_loading:
            return False
        _siglip_loading = True

    print("  Loading SigLIP2 model (first use)…")
    try:
        import torch
        from transformers import AutoProcessor, AutoModel
        proc  = AutoProcessor.from_pretrained(SIGLIP_MODEL_ID)
        model = AutoModel.from_pretrained(SIGLIP_MODEL_ID)
        model.eval()
        with _siglip_lock:
            _siglip_processor = proc
            _siglip_model     = model
            SIGLIP_AVAILABLE  = True
        print("  SigLIP2 loaded OK")
        return True
    except Exception as e:
        import traceback
        print(f"  SigLIP2 load failed: {e}")
        traceback.print_exc()
        with _siglip_lock:
            _siglip_loading = False
        return False


def siglip_text_embed(text: str) -> Optional[np.ndarray]:
    """Encode a text string with SigLIP2 text encoder. Returns L2-normalised vector."""
    if not _ensure_siglip():
        return None
    import torch
    inputs = _siglip_processor(text=[text], return_tensors="pt", padding=True)
    with torch.no_grad():
        out = _siglip_model.get_text_features(**inputs)
    vec = out.pooler_output[0].cpu().numpy().astype(np.float32)
    nrm = np.linalg.norm(vec)
    return vec / nrm if nrm > 0 else vec


def siglip_text_embed_avg(texts: list[str]) -> Optional[np.ndarray]:
    """Average SigLIP2 text embeddings for multiple strings (avg-then-search)."""
    vecs = [siglip_text_embed(t) for t in texts]
    vecs = [v for v in vecs if v is not None]
    if not vecs:
        return None
    avg = np.mean(vecs, axis=0).astype(np.float32)
    nrm = np.linalg.norm(avg)
    return avg / nrm if nrm > 0 else avg


def siglip_multi_search(texts: list[str], matrix: np.ndarray, k: int,
                        mode: str = "avg") -> tuple[list[int], list[float], list[dict]]:
    """
    Search-then-combine: embed each text separately, search, then avg or max scores.
    Returns (top_k_indices, combined_scores, per_query_breakdown).
    per_query_breakdown[i] = {"query": text, "score": float} for the i-th top result.

    mode="avg" — average cosine scores across all queries per icon
    mode="max" — take the best (max) cosine score across all queries per icon
    """
    vecs = [(t, siglip_text_embed(t)) for t in texts]
    vecs = [(t, v) for t, v in vecs if v is not None]
    if not vecs:
        return [], [], []

    # score_matrix: shape (n_queries, n_icons)
    score_matrix = np.stack([matrix @ v for _, v in vecs])  # (Q, N)

    if mode == "avg":
        combined = np.mean(score_matrix, axis=0)
    else:  # max
        combined = np.max(score_matrix, axis=0)

    top_idx = list(np.argsort(-combined)[:k])
    top_scores = [float(combined[i]) for i in top_idx]

    # Per-query score breakdown for each top icon
    per_query = []
    for icon_idx in top_idx:
        per_query.append([
            {"query": t, "score": round(float(score_matrix[qi, icon_idx]), 4)}
            for qi, (t, _) in enumerate(vecs)
        ])

    return top_idx, top_scores, per_query


API_KEY = load_api_key()
if API_KEY:
    print(f"  Gemini API key loaded ({API_KEY[:8]}…)")
else:
    print("  WARNING: No Gemini API key — Gemini query-time methods disabled")


# ---------------------------------------------------------------------------
# Gemini helpers
# ---------------------------------------------------------------------------
def gemini_embed(text: str, task: str = "RETRIEVAL_QUERY") -> np.ndarray:
    url = GEMINI_EMBED_URL.format(key=API_KEY)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": task,
    }).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    vec = np.array(d["embedding"]["values"], dtype=np.float32)
    nrm = np.linalg.norm(vec)
    return vec / nrm if nrm > 0 else vec


def gemini_gen(prompt: str, json_mode: bool = False) -> str:
    url = GEMINI_GEN_URL.format(key=API_KEY)
    payload: dict = {"contents": [{"parts": [{"text": prompt}]}]}
    if json_mode:
        payload["generationConfig"] = {"responseMimeType": "application/json"}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        d = json.loads(r.read())
    return d["candidates"][0]["content"]["parts"][0]["text"].strip()


def embed_texts_avg(texts: list[str], task: str = "RETRIEVAL_QUERY") -> np.ndarray:
    vecs = []
    for t in texts:
        try:
            vecs.append(gemini_embed(t, task))
            time.sleep(0.05)
        except Exception as e:
            print(f"    embed failed: {e}")
    if not vecs:
        return np.zeros(text_emb.shape[1], dtype=np.float32)
    avg = np.mean(vecs, axis=0).astype(np.float32)
    nrm = np.linalg.norm(avg)
    return avg / nrm if nrm > 0 else avg


def get_expanded_terms(query: str) -> list[str]:
    """Generate 6 alternative search terms for the query, aware of icon style."""
    prompt = (
        f'Context: {ICON_STYLE_CONTEXT}\n\n'
        f'Expand this recipe icon search query into 6 alternative search terms '
        f'(2-5 words each) that would help find the right icon. '
        f'Query: "{query}"\n'
        f'Return a JSON array of 6 strings only. Keep each term short and visual.'
    )
    try:
        return json.loads(gemini_gen(prompt, json_mode=True))[:6]
    except Exception:
        return [query]


def get_hyde_queries(query: str) -> list[str]:
    """
    HyDE (Hypothetical Document Embeddings) — query side.
    Generates 12 mixed-length queries covering short tags, medium phrases, and
    longer visual descriptions. These mirror what the icon-side hyde_img / hyde_prompt
    columns are indexed under, so they are embedded as RETRIEVAL_DOCUMENT and averaged.

    Mix: 4 short (1-3 words), 4 medium (4-6 words), 4 longer (7-12 words visual desc).
    """
    prompt = (
        f'Context: {ICON_STYLE_CONTEXT}\n\n'
        f'A user is searching this icon library for: "{query}"\n\n'
        f'Generate 12 hypothetical search queries for the matching icon, mixing lengths:\n'
        f'- 4 very short tags (1-3 words, e.g. "oven mitt", "red glove")\n'
        f'- 4 medium phrases (4-6 words, e.g. "red oven mitt icon", "cooking glove pixel art")\n'
        f'- 4 longer visual descriptions (7-12 words describing what the icon looks like, '
        f'e.g. "red oven mitt with white heart and flame on it")\n\n'
        f'Think: what would this icon actually look like? What would a developer search for?\n'
        f'Return a JSON array of exactly 12 strings, no other text.'
    )
    try:
        return json.loads(gemini_gen(prompt, json_mode=True))[:12]
    except Exception:
        return [query]


# ---------------------------------------------------------------------------
# Core search helpers
# ---------------------------------------------------------------------------
def cosine_topk(query_vec: np.ndarray, matrix: np.ndarray, k: int) -> tuple[list[int], list[float]]:
    """Return top-k indices and scores (cosine similarity)."""
    sims = matrix @ query_vec
    idx  = list(np.argsort(-sims)[:k])
    return idx, [float(sims[i]) for i in idx]


def bm25_topk(bm25_index, tokens: list[str], k: int) -> tuple[list[int], list[float]]:
    """Return top-k indices and normalised BM25 scores (0-1)."""
    scores = bm25_index.get_scores(tokens)
    top_i  = list(np.argsort(-scores)[:k])
    max_s  = float(scores[top_i[0]]) if top_i else 1.0
    norm_s = [float(scores[i]) / max_s if max_s > 0 else 0.0 for i in top_i]
    return top_i, norm_s


def fmt_results(indices: list[int], scores: list[float],
                per_query: list[list[dict]] | None = None) -> list[dict]:
    rows = []
    for i, idx in enumerate(indices):
        icon_id = icons[idx]["id"]
        rows.append({
            "rank":    i + 1,
            "idx":     int(idx),
            "id":      icon_id,
            "desc":    icons[idx]["desc"],
            "caption": captions_map.get(icon_id, ""),
            "score":   round(scores[i], 4),
            # Icon-side pre-computed query texts (shown in the detail modal)
            "hyde_img_queries":    hyde_queries_map.get(icon_id, []),
            "hyde_prompt_queries": hyde_prompt_queries_map.get(icon_id, []),
            # Per-query score breakdown (populated for multi-query search rows)
            "per_query_scores": per_query[i] if per_query else [],
        })
    return rows


# ---------------------------------------------------------------------------
# ── GRID DEFINITIONS ────────────────────────────────────────────────────────
# To add a new query-side row: add an entry to QUERY_ROWS for the right grid
# and implement its vector computation in compute_query_vectors().
#
# To add a new icon-side column: add an entry to ICON_COLS for the right grid
# and add the matrix reference in ICON_MATRICES.
# ---------------------------------------------------------------------------

# Grid 1 — Gemini text embedding space
GEMINI_QUERY_ROWS = [
    {"id": "plain",   "label": "plain",   "desc": "Raw query — RETRIEVAL_QUERY embed"},
    {"id": "qexp",    "label": "qexp",    "desc": "6 expanded terms — avg RETRIEVAL_QUERY embed"},
    {"id": "hyde_q",  "label": "hyde_q",  "desc": "12 mixed-length HyDE queries — avg RETRIEVAL_DOCUMENT embed"},
]
GEMINI_ICON_COLS = [
    {"id": "text_desc",   "label": "text_desc",    "desc": "Gemini embed of text description (RETRIEVAL_DOCUMENT)"},
    {"id": "hyde_img",    "label": "hyde_img",     "desc": "Avg embed of 6 Gemini Vision queries from the icon image"},
    {"id": "hyde_prompt", "label": "hyde_prompt",  "desc": "Avg embed of 6 queries from the text description"},
    {"id": "caption",     "label": "caption",      "desc": "Gemini embed of a detailed visual caption (Gemini Vision)"},
]
# Maps ICON_COL id → pre-loaded numpy matrix
GEMINI_ICON_MATRICES = {
    "text_desc":   text_emb,
    "hyde_img":    hyde_img_emb,
    "hyde_prompt": hyde_pmt_emb,
    "caption":     caption_emb,
}

# Grid 2 — BM25 / keyword
BM25_QUERY_ROWS = [
    {"id": "plain", "label": "plain", "desc": "Raw query tokens"},
    {"id": "qexp",  "label": "qexp",  "desc": "Expanded terms concatenated"},
]
BM25_ICON_COLS = [
    {"id": "bm25_desc",    "label": "bm25_desc",    "desc": "BM25 index over text descriptions"},
    {"id": "bm25_caption", "label": "bm25_caption", "desc": "BM25 index over visual captions"},
]

# Grid 3 — SigLIP2 image space
# Rows marked multi=True use search-then-combine (per-query scoring) rather than avg-then-search.
SIGLIP_QUERY_ROWS = [
    {"id": "siglip_plain",         "label": "plain",              "desc": "Raw query → SigLIP2 text → image_emb"},
    {"id": "siglip_qexp",          "label": "qexp (avg→search)",  "desc": "Avg of 12 expanded term vecs → image_emb"},
    {"id": "siglip_hyde_q",        "label": "hyde (avg→search)",  "desc": "Avg of 12 HyDE query vecs → image_emb"},
    {"id": "siglip_qexp_avg",      "label": "qexp (search→avg)",  "desc": "Search each expanded term, avg scores per icon",   "multi": True, "src": "_exp_terms",   "mode": "avg"},
    {"id": "siglip_qexp_max",      "label": "qexp (search→max)",  "desc": "Search each expanded term, max score per icon",    "multi": True, "src": "_exp_terms",   "mode": "max"},
    {"id": "siglip_hyde_avg",      "label": "hyde (search→avg)",  "desc": "Search each of 12 HyDE queries, avg scores",      "multi": True, "src": "_hyde_queries", "mode": "avg"},
    {"id": "siglip_hyde_max",      "label": "hyde (search→max)",  "desc": "Search each of 12 HyDE queries, max score",       "multi": True, "src": "_hyde_queries", "mode": "max"},
]
SIGLIP_ICON_COLS = [
    {"id": "siglip_img", "label": "siglip_img", "desc": "SigLIP2 image encoder on icon thumbnails"},
]


# ---------------------------------------------------------------------------
# Query vector computation (called once per search; results cached per request)
# ---------------------------------------------------------------------------
def compute_query_vectors(query: str) -> dict:
    """
    Compute all query-side vectors needed for the three grids.
    Returns a dict keyed by logical row id.  Values are np.ndarray or None on error.
    Expensive API calls (qexp, hyde) are made here exactly once.
    """
    vectors: dict[str, Optional[np.ndarray]] = {}
    errors:  dict[str, str]                  = {}

    # ── Gemini rows ──────────────────────────────────────────────────────────
    if API_KEY:
        # plain
        try:
            vectors["plain"] = gemini_embed(query, task="RETRIEVAL_QUERY")
        except Exception as e:
            errors["plain"] = str(e)

        # qexp  (shared by Gemini + BM25 grids)
        try:
            exp_terms = get_expanded_terms(query)
            vectors["_exp_terms"] = exp_terms        # stash raw terms too
            vectors["qexp"] = embed_texts_avg(exp_terms, task="RETRIEVAL_QUERY")
        except Exception as e:
            errors["qexp"] = str(e)
            exp_terms = [query]
            vectors["_exp_terms"] = exp_terms

        # hyde_q — 6 hypothetical icon queries, embedded as RETRIEVAL_DOCUMENT, averaged
        # (mirrors the icon-side hyde_img and hyde_prompt columns exactly)
        try:
            hyde_qs = get_hyde_queries(query)
            vectors["_hyde_queries"] = hyde_qs        # stash text list for display
            vectors["hyde_q"] = embed_texts_avg(hyde_qs, task="RETRIEVAL_DOCUMENT")
        except Exception as e:
            errors["hyde_q"] = str(e)
    else:
        errors["plain"]  = "No API key"
        errors["qexp"]   = "No API key"
        errors["hyde_q"] = "No API key"
        exp_terms = [query]
        vectors["_exp_terms"] = exp_terms

    # ── SigLIP2 rows ─────────────────────────────────────────────────────────
    try:
        vectors["siglip_plain"] = siglip_text_embed(query)
    except Exception as e:
        errors["siglip_plain"] = str(e)

    try:
        exp_terms = vectors.get("_exp_terms", [query])
        vectors["siglip_qexp"] = siglip_text_embed_avg(exp_terms)
    except Exception as e:
        errors["siglip_qexp"] = str(e)

    try:
        # SigLIP2 HyDE: encode all 6 hypothetical queries and average
        hyde_qs = vectors.get("_hyde_queries") or get_hyde_queries(query)
        vectors["siglip_hyde_q"] = siglip_text_embed_avg(hyde_qs)
    except Exception as e:
        errors["siglip_hyde_q"] = str(e)

    return {"vectors": vectors, "errors": errors}


# ---------------------------------------------------------------------------
# Search dispatch
# ---------------------------------------------------------------------------
def run_cell(query: str, query_row_id: str, icon_col_id: str,
             vectors: dict, errors: dict, k: int) -> dict:
    """
    Run one matrix cell: (query_row_id) × (icon_col_id).
    Returns {"results": [...]} or {"error": "..."}.
    """

    # ── Gemini cells ──────────────────────────────────────────────────────────
    if icon_col_id in GEMINI_ICON_MATRICES and query_row_id in ("plain", "qexp", "hyde_q"):
        if query_row_id in errors:
            return {"error": errors[query_row_id]}
        qvec = vectors.get(query_row_id)
        if qvec is None:
            return {"error": "vector unavailable"}
        mat = GEMINI_ICON_MATRICES[icon_col_id]
        idx, scores = cosine_topk(qvec, mat, k)
        return {"results": fmt_results(idx, scores)}

    # ── BM25 cells ────────────────────────────────────────────────────────────
    if icon_col_id in ("bm25_desc", "bm25_caption"):
        if not BM25_AVAILABLE:
            return {"error": "BM25 not installed"}
        if query_row_id == "plain":
            tokens = _tokenize(query)
        elif query_row_id == "qexp":
            exp = vectors.get("_exp_terms", [query])
            tokens = _tokenize(" ".join(exp))
        else:
            return {"error": f"Unknown BM25 query row: {query_row_id}"}
        bm_index = bm25_desc if icon_col_id == "bm25_desc" else bm25_cap
        idx, scores = bm25_topk(bm_index, tokens, k)
        return {"results": fmt_results(idx, scores)}

    # ── SigLIP2 cells — avg-then-search (single vector) ──────────────────────
    if icon_col_id == "siglip_img" and query_row_id in ("siglip_plain", "siglip_qexp", "siglip_hyde_q"):
        if query_row_id in errors:
            return {"error": errors[query_row_id]}
        qvec = vectors.get(query_row_id)
        if qvec is None:
            return {"error": "SigLIP2 vector unavailable"}
        idx, scores = cosine_topk(qvec, image_emb, k)
        return {"results": fmt_results(idx, scores)}

    # ── SigLIP2 cells — search-then-combine (per-query scoring) ──────────────
    if icon_col_id == "siglip_img" and query_row_id in (
        "siglip_qexp_avg", "siglip_qexp_max", "siglip_hyde_avg", "siglip_hyde_max"
    ):
        # Find the row definition to get src and mode
        row_def = next((r for r in SIGLIP_QUERY_ROWS if r["id"] == query_row_id), None)
        if row_def is None:
            return {"error": f"Unknown row: {query_row_id}"}
        src_key = row_def["src"]    # "_exp_terms" or "_hyde_queries"
        mode    = row_def["mode"]   # "avg" or "max"
        texts   = vectors.get(src_key, [])
        if not texts:
            return {"error": f"No source texts for {src_key}"}
        idx, scores, per_query = siglip_multi_search(texts, image_emb, k, mode=mode)
        return {"results": fmt_results(idx, scores, per_query)}

    return {"error": f"Unknown combination: {query_row_id} × {icon_col_id}"}


# ---------------------------------------------------------------------------
# Recipe parsing (kept from original)
# ---------------------------------------------------------------------------
def parse_recipe_nodes(recipe_text: str) -> list[dict]:
    prompt = (
        "Extract all cooking action nodes from this recipe. Each node represents a step "
        "or ingredient that would be shown as an icon in a recipe visualization.\n\n"
        f"Recipe:\n{recipe_text}\n\n"
        "Return a JSON array of objects with:\n"
        "- name: short action/ingredient name (2-4 words)\n"
        "- description: 1-sentence visual description for icon search\n"
        "- query: concise search query to find the best icon (3-6 words)\n\n"
        "Return only the JSON array, no other text. Limit to 8 most important nodes."
    )
    try:
        raw = gemini_gen(prompt, json_mode=True)
        nodes = json.loads(raw)
        return nodes[:8] if isinstance(nodes, list) else []
    except Exception as e:
        return [{"error": str(e)}]


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)


@app.route("/")
def index():
    return DEMO_HTML


@app.route("/thumb/<icon_id>")
def thumb(icon_id: str):
    path = THUMB_DIR / f"{icon_id}.png"
    if path.exists():
        return send_file(str(path), mimetype="image/png")
    return "", 404


@app.route("/api/matrix", methods=["POST"])
def api_matrix():
    """
    Run the full matrix search for a query.
    Returns: { query, grid1, grid2, grid3, meta }
    Each grid: { rows, cols, cells: { "rowId:colId": {results|error} } }
    """
    data  = request.json or {}
    query = data.get("query", "").strip()
    k     = min(int(data.get("k", TOP_K)), TOP_K)

    if not query:
        return jsonify({"error": "query required"}), 400

    # Compute all query-side vectors (one pass, shared across grids)
    vc = compute_query_vectors(query)
    vectors = vc["vectors"]
    errors  = vc["errors"]

    def _run_grid(query_rows, icon_cols):
        cells = {}
        for row in query_rows:
            for col in icon_cols:
                key = f"{row['id']}:{col['id']}"
                cells[key] = run_cell(query, row["id"], col["id"], vectors, errors, k)
        return cells

    grid1_cells = _run_grid(GEMINI_QUERY_ROWS, GEMINI_ICON_COLS)
    grid2_cells = _run_grid(BM25_QUERY_ROWS,   BM25_ICON_COLS)
    grid3_cells = _run_grid(SIGLIP_QUERY_ROWS, SIGLIP_ICON_COLS)

    meta = {
        "exp_terms":   vectors.get("_exp_terms", []),
        "hyde_queries": vectors.get("_hyde_queries", []),
        "errors":      errors,
    }

    return jsonify({
        "query": query,
        "grid1": {"rows": GEMINI_QUERY_ROWS, "cols": GEMINI_ICON_COLS, "cells": grid1_cells},
        "grid2": {"rows": BM25_QUERY_ROWS,   "cols": BM25_ICON_COLS,   "cells": grid2_cells},
        "grid3": {"rows": SIGLIP_QUERY_ROWS, "cols": SIGLIP_ICON_COLS, "cells": grid3_cells},
        "meta":  meta,
    })


@app.route("/api/search", methods=["POST"])
def api_search():
    """Legacy single-method search endpoint (used by Single Query and Recipe tabs)."""
    data    = request.json or {}
    query   = data.get("query", "").strip()
    methods = data.get("methods", ["plain_embed"])
    k       = min(int(data.get("k", 8)), 20)

    if not query:
        return jsonify({"error": "query required"}), 400

    # Map legacy method ids → matrix cell calls
    METHOD_MAP = {
        "plain_embed":    ("plain",  "text_desc"),
        "hyde_from_img":  ("plain",  "hyde_img"),
        "hyde_from_prompt": ("plain", "hyde_prompt"),
        "caption_embed":  ("plain",  "caption"),
        "qexp_plain":     ("qexp",   "text_desc"),
        "qexp_hyde_img":  ("qexp",   "hyde_img"),
        "qexp_caption":   ("qexp",   "caption"),
        "hyde_query":     ("hyde_q", "text_desc"),
        "bm25_desc":      ("plain",  "bm25_desc"),
        "bm25_caption":   ("plain",  "bm25_caption"),
    }

    # Only compute vectors needed for selected methods
    vc      = compute_query_vectors(query)
    vectors = vc["vectors"]
    errors  = vc["errors"]

    results = {}
    for method in methods:
        pair = METHOD_MAP.get(method)
        if pair is None:
            results[method] = [{"error": f"Unknown method: {method}"}]
            continue
        row_id, col_id = pair
        cell = run_cell(query, row_id, col_id, vectors, errors, k)
        if "error" in cell:
            results[method] = [{"error": cell["error"]}]
        else:
            results[method] = cell["results"]

    return jsonify({"query": query, "results": results})


@app.route("/api/parse", methods=["POST"])
def api_parse():
    data = request.json or {}
    recipe_text = data.get("text", "").strip()
    if not recipe_text:
        return jsonify({"error": "text required"}), 400
    if not API_KEY:
        return jsonify({"error": "No Gemini API key configured"}), 503
    nodes = parse_recipe_nodes(recipe_text)
    return jsonify({"nodes": nodes})


@app.route("/api/icon_search")
def api_icon_search():
    """
    GET /api/icon_search?q=<query>
    Case-insensitive substring search on icon descriptions + exact id lookup.
    Returns [{id, desc, idx}, ...] top 10.
    """
    q = request.args.get("q", "").strip().lower()
    if not q:
        return jsonify([])

    matches = []
    # Exact id match first
    if q in id_to_idx:
        idx = id_to_idx[q]
        matches.append({"id": icons[idx]["id"], "desc": icons[idx]["desc"], "idx": idx})

    # Substring match on description
    for i, icon in enumerate(icons):
        if icon["id"] == q:
            continue  # already added as exact match
        if q in icon["desc"].lower() or q in icon["id"].lower():
            matches.append({"id": icon["id"], "desc": icon["desc"], "idx": i})
        if len(matches) >= 10:
            break

    return jsonify(matches[:10])


@app.route("/api/icon_detail/<icon_id>")
def api_icon_detail(icon_id: str):
    """
    GET /api/icon_detail/<icon_id>
    Returns full data for one icon: desc, caption, hyde_img_queries, hyde_prompt_queries.
    """
    idx = id_to_idx.get(icon_id)
    if idx is None:
        return jsonify({"error": "not found"}), 404
    icon = icons[idx]
    return jsonify({
        "id":                  icon["id"],
        "desc":                icon["desc"],
        "idx":                 idx,
        "caption":             captions_map.get(icon["id"], ""),
        "hyde_img_queries":    hyde_queries_map.get(icon["id"], []),
        "hyde_prompt_queries": hyde_prompt_queries_map.get(icon["id"], []),
    })


@app.route("/api/status")
def api_status():
    return jsonify({
        "icons":               len(icons),
        "bm25_available":      BM25_AVAILABLE,
        "siglip_available":    SIGLIP_AVAILABLE,
        "api_key_configured":  bool(API_KEY),
        "hyde_img_backfill":   n_hyde_computed,
        "caption_backfill":    n_cap_computed,
    })


# ---------------------------------------------------------------------------
# Embedded HTML / CSS / JS
# ---------------------------------------------------------------------------
DEMO_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Icon Retrieval Matrix — RecipeLanes</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
       background: #0f0f11; color: #e8e8ed; min-height: 100vh; }
header { padding: 16px 32px; border-bottom: 1px solid #2a2a30;
         display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
header h1 { font-size: 17px; font-weight: 600; color: #fff; }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 12px;
         background: #1e3a5f; color: #7ab3e0; }
.container { max-width: 1600px; margin: 0 auto; padding: 20px 28px; }

/* tabs */
.tabs { display: flex; gap: 1px; background: #2a2a30; border-radius: 8px;
        padding: 3px; margin-bottom: 20px; width: fit-content; }
.tab { padding: 7px 18px; border-radius: 6px; cursor: pointer; font-size: 13px;
       font-weight: 500; color: #888; user-select: none; }
.tab.active { background: #1e1e26; color: #e8e8ed; }
.tab-pane { display: none; }
.tab-pane.active { display: block; }

/* panel */
.panel { background: #18181c; border: 1px solid #2a2a30;
         border-radius: 10px; padding: 18px; margin-bottom: 18px; }
.panel h2 { font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase;
            letter-spacing: 0.08em; margin-bottom: 12px; }

/* form elements */
input[type=text] { background: #0f0f11; color: #e8e8ed; border: 1px solid #3a3a44;
                   border-radius: 6px; padding: 10px 14px; font-size: 15px;
                   font-family: inherit; width: 100%; }
input[type=text]:focus { outline: none; border-color: #5b8dd9; }
textarea { width: 100%; background: #0f0f11; color: #e8e8ed; border: 1px solid #3a3a44;
           border-radius: 6px; padding: 12px; font-size: 14px; resize: vertical;
           min-height: 100px; font-family: inherit; }
textarea:focus { outline: none; border-color: #5b8dd9; }

.btn { padding: 9px 20px; border-radius: 6px; border: none; cursor: pointer;
       font-size: 13px; font-weight: 600; transition: opacity 0.15s; white-space: nowrap; }
.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary { background: #5b8dd9; color: #fff; }
.btn-secondary { background: #2a2a35; color: #ccc; }

.row-flex { display: flex; gap: 10px; align-items: center; }

/* spinner */
.spinner { display: inline-block; width: 16px; height: 16px;
           border: 2px solid #444; border-top-color: #5b8dd9;
           border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }

/* status bar */
.status-bar { font-size: 12px; color: #555; margin-top: 10px; min-height: 18px; }
.status-bar span { margin-right: 12px; }
.status-ok   { color: #5a9; }
.status-warn { color: #b83; }
.status-err  { color: #e55; }

/* ── Matrix grid ─────────────────────────────────────────────────────────── */
.grid-section { margin-bottom: 32px; }
.grid-section h3 { font-size: 14px; font-weight: 600; color: #bbb;
                   margin-bottom: 14px; padding-bottom: 8px;
                   border-bottom: 1px solid #2a2a30; }

.matrix-wrap { overflow-x: auto; }
.matrix-table { border-collapse: collapse; font-size: 12px; }
.matrix-table th { color: #888; font-weight: 500; padding: 6px 8px;
                   text-align: center; white-space: nowrap; }
.matrix-table th.row-header { text-align: right; padding-right: 14px; color: #666; }
.col-label { font-size: 11px; color: #7ab3e0; font-weight: 600; letter-spacing: 0.04em; }
.col-sub   { font-size: 10px; color: #555; margin-top: 2px; max-width: 120px;
             white-space: normal; line-height: 1.3; }
.row-label { font-size: 11px; color: #a87bd4; font-weight: 600; text-align: right; }
.row-sub   { font-size: 10px; color: #555; margin-top: 1px; text-align: right; line-height: 1.3; }

/* matrix cell */
.mcell { padding: 4px; cursor: pointer; border: 2px solid transparent;
         border-radius: 6px; transition: border-color 0.15s; }
.mcell:hover { border-color: #5b8dd9 !important; }
.mcell-inner { width: 108px; min-height: 108px; border-radius: 5px; padding: 6px;
               display: flex; flex-direction: column; align-items: center;
               justify-content: flex-start; gap: 4px; position: relative; }
.mcell-inner img { width: 64px; height: 64px; border-radius: 4px;
                   object-fit: contain; background: rgba(255,255,255,0.04);
                   display: block; flex-shrink: 0; }
.mcell-name  { font-size: 10px; color: #ccc; text-align: center; line-height: 1.3;
               max-width: 96px; word-break: break-word; }
.mcell-score { font-size: 10px; font-weight: 600; color: #aaa; margin-top: 2px; }
.mcell-err   { font-size: 10px; color: #e55; text-align: center; padding: 4px; }

/* cell background colours by score */
.bg-good { background: #1a3a1a; }
.bg-mid  { background: #3a2e0a; }
.bg-bad  { background: #3a0a0a; }
.bg-na   { background: #1a1a1e; }

/* ── Modal ───────────────────────────────────────────────────────────────── */
.modal-overlay { display: none; position: fixed; inset: 0;
                 background: rgba(0,0,0,0.75); z-index: 100;
                 align-items: flex-start; justify-content: center; padding: 40px 20px; }
.modal-overlay.open { display: flex; }
.modal { background: #18181c; border: 1px solid #3a3a44; border-radius: 12px;
         width: 100%; max-width: 860px; max-height: 80vh; overflow: hidden;
         display: flex; flex-direction: column; }
.modal-head { padding: 14px 18px; border-bottom: 1px solid #2a2a30;
              display: flex; align-items: center; justify-content: space-between; }
.modal-head h4 { font-size: 13px; font-weight: 600; color: #e8e8ed; }
.modal-close { background: none; border: none; color: #888; font-size: 20px;
               cursor: pointer; padding: 0 4px; line-height: 1; }
.modal-close:hover { color: #e8e8ed; }
.modal-body { padding: 16px 18px; overflow-y: auto; flex: 1; }
.modal-meta { font-size: 12px; color: #666; margin-bottom: 14px; }
.top30-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
.top30-item { display: flex; flex-direction: column; align-items: center; gap: 4px;
              padding: 8px; border-radius: 6px; border: 1px solid #2a2a30;
              background: #111114; }
.top30-item img { width: 56px; height: 56px; object-fit: contain; border-radius: 3px;
                  background: rgba(255,255,255,0.04); }
.top30-item .t30-rank  { font-size: 10px; color: #555; }
.top30-item .t30-name  { font-size: 10px; color: #ccc; text-align: center;
                          line-height: 1.3; word-break: break-word; }
.top30-item .t30-score { font-size: 10px; font-weight: 600; color: #7ab3e0; }
.top30-item.rank-1 { border-color: #5a9; background: #0e1e16; }

/* meta info box */
.meta-box { background: #111114; border: 1px solid #2a2a30; border-radius: 8px;
            padding: 12px 16px; margin-bottom: 18px; font-size: 12px; color: #888; }
.meta-box strong { color: #bbb; }
.meta-row { display: flex; align-items: flex-start; gap: 10px; padding: 5px 0;
            border-bottom: 1px solid #1e1e26; }
.meta-row:last-child { border-bottom: none; }
.meta-label { flex: 0 0 220px; font-size: 11px; font-weight: 600; color: #666;
              padding-top: 3px; cursor: help; white-space: nowrap; overflow: hidden;
              text-overflow: ellipsis; }
.meta-value { flex: 1; display: flex; flex-wrap: wrap; gap: 2px; }
.meta-pill { display: inline-block; background: #1a2840; color: #7ab3e0; border-radius: 12px;
             padding: 2px 8px; margin: 1px 2px; font-size: 11px; }
/* icon-side query section in modal */
.icon-queries { margin-top: 12px; padding-top: 10px; border-top: 1px solid #2a2a30; }
.icon-queries-label { font-size: 10px; font-weight: 600; color: #555;
                      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
.icon-queries-pills { display: flex; flex-wrap: wrap; gap: 3px; }

/* collapsible how-to */
.howto { margin-top: 32px; }
.howto summary { cursor: pointer; font-size: 12px; color: #555; user-select: none;
                 padding: 6px 0; list-style: none; display: flex; align-items: center; gap: 6px; }
.howto summary::-webkit-details-marker { display: none; }
.howto summary::before { content: "▶"; font-size: 10px; transition: transform 0.15s; }
details[open] .howto summary::before { transform: rotate(90deg); }
.howto-body { margin-top: 10px; padding: 14px; background: #111114; border-radius: 8px;
              border: 1px solid #2a2a30; font-size: 12px; color: #888; line-height: 1.7; }
.howto-body code { background: #1e1e26; color: #a87bd4; padding: 1px 5px;
                   border-radius: 3px; font-size: 11px; }

/* legacy results grid */
.results-grid { display: grid; gap: 14px;
                grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
.method-card  { background: #18181c; border: 1px solid #2a2a30; border-radius: 10px;
                overflow: hidden; }
.method-header { padding: 9px 12px; background: #1e1e26; border-bottom: 1px solid #2a2a30;
                 font-size: 12px; font-weight: 600; color: #7ab3e0; }
.icon-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px;
            border-bottom: 1px solid #1e1e26; }
.icon-row:last-child { border-bottom: none; }
.icon-row .rank { font-size: 11px; color: #555; width: 16px; flex-shrink: 0; }
.icon-row img { width: 32px; height: 32px; border-radius: 3px;
                background: #2a2a30; flex-shrink: 0; }
.icon-row .desc { font-size: 11px; color: #ccc; line-height: 1.3; }

/* nodes strip */
.nodes-strip { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.node-pill { padding: 5px 12px; background: #1e1e26; border: 1px solid #3a3a44;
             border-radius: 20px; font-size: 12px; cursor: pointer; }
.node-pill:hover  { border-color: #5b8dd9; }
.node-pill.active { border-color: #5b8dd9; background: #1a2d45; color: #7ab3e0; }

.method-grid { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.method-chip { display: flex; align-items: center; gap: 5px; padding: 4px 10px;
               background: #1e1e26; border: 1px solid #3a3a44; border-radius: 20px;
               cursor: pointer; font-size: 11px; user-select: none; }
.method-chip.active { border-color: #5b8dd9; background: #1a2d45; color: #7ab3e0; }

.error { color: #e05; font-size: 12px; padding: 4px 0; }

/* ── Icon search bar ─────────────────────────────────────────────────────── */
.icon-search-wrap { position: relative; }
.icon-search-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
  background: #18181c; border: 1px solid #3a3a44; border-radius: 6px;
  margin-top: 2px; max-height: 220px; overflow-y: auto; box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
.icon-search-item { display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  cursor: pointer; font-size: 12px; color: #ccc; border-bottom: 1px solid #22222a; }
.icon-search-item:last-child { border-bottom: none; }
.icon-search-item:hover, .icon-search-item.selected { background: #1a2d45; color: #7ab3e0; }
.icon-search-item img { width: 28px; height: 28px; border-radius: 3px;
  background: rgba(255,255,255,0.04); object-fit: contain; flex-shrink: 0; }

/* rank badge overlay on matrix cells */
.rank-badge { position: absolute; top: 3px; right: 3px; font-size: 10px; font-weight: 700;
  padding: 1px 5px; border-radius: 8px; line-height: 1.4; pointer-events: none; z-index: 10; }
.rank-badge-hit  { background: #5b8dd9; color: #fff; }
.rank-badge-miss { background: #333; color: #666; }

/* ── Icon stats panel ────────────────────────────────────────────────────── */
#icon-stats-panel { display: none; margin-bottom: 18px; }
.icon-stats-inner { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.icon-stats-thumb { flex-shrink: 0; }
.icon-stats-thumb img { width: 80px; height: 80px; border-radius: 6px;
  background: rgba(255,255,255,0.04); object-fit: contain; border: 1px solid #3a3a44; }
.icon-stats-info { flex: 1; min-width: 200px; }
.icon-stats-name { font-size: 15px; font-weight: 600; color: #e8e8ed; margin-bottom: 4px; }
.icon-stats-id   { font-size: 11px; color: #555; margin-bottom: 8px; font-family: monospace; }
.icon-stats-caption { font-size: 12px; color: #888; font-style: italic;
  margin-bottom: 8px; line-height: 1.5; }
.icon-stats-section { margin-top: 8px; }
.icon-stats-section-label { font-size: 10px; font-weight: 600; color: #555;
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
.icon-stats-pills { display: flex; flex-wrap: wrap; gap: 3px; }
.icon-stats-rank-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
.icon-stats-rank-table th { color: #555; font-weight: 600; text-align: left;
  padding: 3px 8px 3px 0; border-bottom: 1px solid #2a2a30; }
.icon-stats-rank-table td { color: #bbb; padding: 3px 8px 3px 0; border-bottom: 1px solid #1a1a22; }
.rank-hit-cell  { color: #5b8dd9 !important; font-weight: 700; }
.rank-miss-cell { color: #444 !important; }
.icon-stats-dismiss { float: right; background: none; border: none; color: #555;
  font-size: 16px; cursor: pointer; padding: 0 4px; line-height: 1; margin-top: -2px; }
.icon-stats-dismiss:hover { color: #e8e8ed; }
</style>
</head>
<body>
<header>
  <h1>Icon Retrieval Matrix</h1>
  <span class="badge">RecipeLanes Research</span>
  <span id="status-badge" class="badge" style="background:#1e2e1e;color:#7ac07a;">Loading…</span>
</header>

<div class="container">

  <!-- Tab bar — Matrix is default (first) -->
  <div class="tabs">
    <div class="tab active"  onclick="switchTab('matrix')">Matrix</div>
    <div class="tab"         onclick="switchTab('single')">Single Query</div>
    <div class="tab"         onclick="switchTab('recipe')">Recipe → Nodes</div>
  </div>

  <!-- ══════════════════════════════════════════════════════════════════════
       TAB: Matrix
       ══════════════════════════════════════════════════════════════════════ -->
  <div id="tab-matrix" class="tab-pane active">

    <div class="panel">
      <h2>Search Query</h2>
      <div class="row-flex">
        <input type="text" id="matrix-query"
               placeholder="e.g. chop onion, stir fry, pastry with filling"
               onkeydown="if(event.key==='Enter') runMatrix()">
        <button class="btn btn-primary" id="matrix-btn" onclick="runMatrix()">Search</button>
      </div>
      <div class="status-bar" id="matrix-status"></div>
    </div>

    <div id="matrix-meta" style="display:none"></div>

    <!-- Icon finder bar -->
    <div class="panel" id="icon-finder-panel">
      <h2>Find Icon in Results</h2>
      <div class="row-flex">
        <div class="icon-search-wrap" style="flex:1">
          <input type="text" id="icon-search-input" placeholder="Type icon name or description…"
                 autocomplete="off"
                 oninput="onIconSearchInput(this.value)"
                 onkeydown="onIconSearchKey(event)">
          <div class="icon-search-dropdown" id="icon-search-dropdown" style="display:none"></div>
        </div>
        <button class="btn btn-secondary" onclick="clearIconSelection()" title="Clear selection">Clear</button>
      </div>
      <div style="font-size:11px;color:#555;margin-top:6px">
        Select an icon to see its rank in every matrix cell and a stats panel.
      </div>
    </div>

    <!-- Per-icon stats panel (shown when an icon is selected) -->
    <div id="icon-stats-panel" class="panel">
      <h2>
        Selected Icon
        <button class="icon-stats-dismiss" onclick="clearIconSelection()" title="Dismiss">×</button>
      </h2>
      <div class="icon-stats-inner" id="icon-stats-inner"></div>
    </div>

    <div id="matrix-grids"></div>

    <!-- How to extend -->
    <details class="howto">
      <summary class="howto">How to extend this tool</summary>
      <div class="howto-body">
        <p><strong>Add a new query-side row</strong> (e.g. a new Gemini query variant):</p>
        <ol style="padding-left:18px;margin:6px 0">
          <li>Append an entry to <code>GEMINI_QUERY_ROWS</code> (or the relevant grid list) in <code>server.py</code>.</li>
          <li>Compute the vector in <code>compute_query_vectors()</code> and store it in <code>vectors[your_id]</code>.</li>
          <li>Add a dispatch branch in <code>run_cell()</code> that handles your new row id.</li>
        </ol>
        <p style="margin-top:10px"><strong>Add a new icon-side column</strong> (e.g. a new embedding matrix):</p>
        <ol style="padding-left:18px;margin:6px 0">
          <li>Load the <code>.npy</code> matrix at startup and L2-normalise it with <code>_l2norm_rows()</code>.</li>
          <li>Append an entry to <code>GEMINI_ICON_COLS</code> (or the relevant list) and add it to <code>GEMINI_ICON_MATRICES</code>.</li>
        </ol>
        <p style="margin-top:10px"><strong>Add a whole new grid</strong>: define new <code>_QUERY_ROWS</code> and <code>_ICON_COLS</code> lists, add dispatch logic in <code>run_cell()</code>, and register the grid in <code>/api/matrix</code>. Then add a <code>renderGrid()</code> call in the JS below.</p>
      </div>
    </details>

  </div><!-- /tab-matrix -->

  <!-- ══════════════════════════════════════════════════════════════════════
       TAB: Single Query (legacy)
       ══════════════════════════════════════════════════════════════════════ -->
  <div id="tab-single" class="tab-pane">
    <div class="panel">
      <h2>Search Query</h2>
      <div class="row-flex">
        <input type="text" id="query-input" placeholder="e.g. pastry segment with peas and carrots"
               onkeydown="if(event.key==='Enter') runSingleSearch()">
        <button class="btn btn-primary" id="search-btn" onclick="runSingleSearch()">Search</button>
      </div>
      <div class="panel" style="background:#0f0f11;margin-top:12px;margin-bottom:0">
        <h2 style="margin-bottom:10px">Methods</h2>
        <div class="method-grid" id="method-chips"></div>
      </div>
    </div>
    <div id="single-results"></div>
  </div>

  <!-- ══════════════════════════════════════════════════════════════════════
       TAB: Recipe → Nodes (legacy)
       ══════════════════════════════════════════════════════════════════════ -->
  <div id="tab-recipe" class="tab-pane">
    <div class="panel">
      <h2>Recipe Text</h2>
      <textarea id="recipe-input" placeholder="Paste a recipe here — the LLM will extract action nodes and search for icons…"></textarea>
      <div style="display:flex;gap:10px;margin-top:10px;align-items:center">
        <button class="btn btn-primary" id="parse-btn" onclick="runRecipeParse()">Parse Recipe</button>
        <span id="parse-spinner" style="display:none"><span class="spinner"></span></span>
      </div>
    </div>
    <div id="nodes-section" style="display:none">
      <div class="panel">
        <h2>Extracted Nodes</h2>
        <div class="nodes-strip" id="nodes-strip"></div>
        <div class="panel" style="background:#0f0f11;margin-bottom:0">
          <h2 style="margin-bottom:10px">Methods</h2>
          <div class="method-grid" id="method-chips-recipe"></div>
        </div>
      </div>
      <div id="recipe-results"></div>
    </div>
  </div>

</div><!-- /container -->

<!-- ── Modal overlay ───────────────────────────────────────────────────── -->
<div class="modal-overlay" id="modal-overlay" onclick="closeModal(event)">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-head">
      <h4 id="modal-title">Top 30 Results</h4>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <p class="modal-meta" id="modal-meta"></p>
      <div class="top30-grid" id="modal-grid"></div>
    </div>
  </div>
</div>

<script>
// ── Tab switching ──────────────────────────────────────────────────────────
const TAB_NAMES = ['matrix', 'single', 'recipe'];
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('active', TAB_NAMES[i] === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openModal(title, meta, results, highlightId) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-meta').textContent  = meta;
  const grid = document.getElementById('modal-grid');
  grid.innerHTML = results.map((it, i) => {
    // Icon-side queries section
    let iconQueriesHtml = '';
    if (it.hyde_img_queries && it.hyde_img_queries.length) {
      iconQueriesHtml += `
        <div class="icon-queries">
          <div class="icon-queries-label">icon-side: hyde_img (from image)</div>
          <div class="icon-queries-pills">${it.hyde_img_queries.map(q =>
            `<span class="meta-pill" style="background:#1a2840;color:#7ab3e0;font-size:10px">${esc(q)}</span>`
          ).join('')}</div>
        </div>`;
    }
    if (it.hyde_prompt_queries && it.hyde_prompt_queries.length) {
      iconQueriesHtml += `
        <div class="icon-queries">
          <div class="icon-queries-label">icon-side: hyde_prompt (from text desc)</div>
          <div class="icon-queries-pills">${it.hyde_prompt_queries.map(q =>
            `<span class="meta-pill" style="background:#1a1a2a;color:#9090e0;font-size:10px">${esc(q)}</span>`
          ).join('')}</div>
        </div>`;
    }
    if (it.caption) {
      iconQueriesHtml += `
        <div class="icon-queries">
          <div class="icon-queries-label">icon-side: caption (Gemini Vision)</div>
          <div style="font-size:10px;color:#666;margin-top:3px;font-style:italic">${esc(it.caption)}</div>
        </div>`;
    }
    // Per-query score breakdown (search-then-combine rows)
    if (it.per_query_scores && it.per_query_scores.length) {
      const sorted = [...it.per_query_scores].sort((a, b) => b.score - a.score);
      iconQueriesHtml += `
        <div class="icon-queries">
          <div class="icon-queries-label">per-query scores (sorted best first)</div>
          <div style="margin-top:4px">
            ${sorted.map(pq => {
              const pct = Math.round(pq.score * 100);
              const col = pq.score >= 0.35 ? '#4a9' : pq.score >= 0.25 ? '#97a' : '#666';
              return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:10px">
                <span style="color:${col};font-weight:600;width:38px;flex-shrink:0">${pq.score.toFixed(3)}</span>
                <div style="flex:1;height:4px;background:#1e1e26;border-radius:2px">
                  <div style="width:${Math.min(100,pct*2)}%;height:100%;background:${col};border-radius:2px"></div>
                </div>
                <span style="color:#666;flex:3">${esc(pq.query)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }
    const isHighlighted = highlightId && it.id === highlightId;
    return `
    <div class="top30-item ${i === 0 ? 'rank-1' : ''} ${isHighlighted ? 'icon-highlight' : ''}"
         data-icon-id="${esc(it.id)}"
         style="width:100%;max-width:280px;${isHighlighted ? 'border-color:#f0a040;background:#2a1e08;' : ''}">
      <div style="display:flex;align-items:center;gap:8px;width:100%">
        <span class="t30-rank" style="width:28px">#${it.rank}</span>
        <img src="/thumb/${it.id}" alt="" loading="lazy" onerror="this.style.opacity=0.15" style="width:48px;height:48px">
        <div style="flex:1;min-width:0">
          <div class="t30-name" style="font-size:12px;font-weight:600;color:${isHighlighted ? '#f0a040' : '#ddd'}">${esc(it.desc)}</div>
          <div class="t30-score">${it.score.toFixed(3)}</div>
        </div>
      </div>
      ${iconQueriesHtml}
    </div>`;
  }).join('');
  // Switch grid to single-column list for richer display
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(260px, 1fr))';
  document.getElementById('modal-overlay').classList.add('open');
  // Scroll to highlighted icon if present
  if (highlightId) {
    requestAnimationFrame(() => {
      const el = grid.querySelector(`[data-icon-id="${CSS.escape(highlightId)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}
function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay'))
    document.getElementById('modal-overlay').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Utilities ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function cellBgClass(score) {
  if (score === null) return 'bg-na';
  if (score >= 0.7)   return 'bg-good';
  if (score >= 0.4)   return 'bg-mid';
  return 'bg-bad';
}

// ── Icon search / selection ────────────────────────────────────────────────
let selectedIcon     = null;   // {id, desc, idx, caption, hyde_img_queries, hyde_prompt_queries}
let lastMatrixData   = null;   // last result from /api/matrix
let iconSearchTimer  = null;
let dropdownItems    = [];
let dropdownCursor   = -1;

async function onIconSearchInput(val) {
  clearTimeout(iconSearchTimer);
  const dd = document.getElementById('icon-search-dropdown');
  if (!val.trim()) { dd.style.display = 'none'; dropdownItems = []; return; }
  iconSearchTimer = setTimeout(async () => {
    try {
      const r = await fetch('/api/icon_search?q=' + encodeURIComponent(val.trim()));
      dropdownItems = await r.json();
      renderDropdown();
    } catch(e) {}
  }, 180);
}

function renderDropdown() {
  const dd = document.getElementById('icon-search-dropdown');
  if (!dropdownItems.length) { dd.style.display = 'none'; return; }
  dropdownCursor = -1;
  dd.innerHTML = dropdownItems.map((it, i) => `
    <div class="icon-search-item" data-idx="${i}"
         onmousedown="selectIconFromDropdown(${i})">
      <img src="/thumb/${it.id}" alt="" onerror="this.style.opacity=0.1">
      <span>${esc(it.desc)}</span>
      <span style="color:#444;font-size:10px;margin-left:auto;font-family:monospace">${esc(it.id)}</span>
    </div>`).join('');
  dd.style.display = 'block';
}

function onIconSearchKey(e) {
  const dd = document.getElementById('icon-search-dropdown');
  if (dd.style.display === 'none') return;
  const items = dd.querySelectorAll('.icon-search-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    dropdownCursor = Math.min(dropdownCursor + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('selected', i === dropdownCursor));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    dropdownCursor = Math.max(dropdownCursor - 1, 0);
    items.forEach((el, i) => el.classList.toggle('selected', i === dropdownCursor));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const idx = dropdownCursor >= 0 ? dropdownCursor : 0;
    if (dropdownItems[idx]) selectIconFromDropdown(idx);
  } else if (e.key === 'Escape') {
    dd.style.display = 'none';
  }
}

async function selectIconFromDropdown(i) {
  const hit = dropdownItems[i];
  if (!hit) return;
  document.getElementById('icon-search-dropdown').style.display = 'none';
  document.getElementById('icon-search-input').value = hit.desc;
  // Fetch full detail
  try {
    const r = await fetch('/api/icon_detail/' + encodeURIComponent(hit.id));
    selectedIcon = await r.json();
  } catch(e) {
    selectedIcon = hit;
  }
  renderIconStats();
  applyRankBadges();
}

function clearIconSelection() {
  selectedIcon = null;
  document.getElementById('icon-search-input').value = '';
  document.getElementById('icon-search-dropdown').style.display = 'none';
  document.getElementById('icon-stats-panel').style.display = 'none';
  // Remove all rank badges
  document.querySelectorAll('.rank-badge').forEach(b => b.remove());
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.icon-search-wrap'))
    document.getElementById('icon-search-dropdown').style.display = 'none';
});

function renderIconStats() {
  if (!selectedIcon) return;
  const ic = selectedIcon;
  const panel = document.getElementById('icon-stats-panel');
  const inner = document.getElementById('icon-stats-inner');

  // Thumb + info
  let infoHtml = `
    <div class="icon-stats-thumb">
      <img src="/thumb/${ic.id}" alt="" onerror="this.style.opacity=0.1">
    </div>
    <div class="icon-stats-info">
      <div class="icon-stats-name">${esc(ic.desc)}</div>
      <div class="icon-stats-id">${esc(ic.id)}</div>`;

  if (ic.caption) {
    infoHtml += `<div class="icon-stats-caption">"${esc(ic.caption)}"</div>`;
  }

  if (ic.hyde_img_queries && ic.hyde_img_queries.length) {
    infoHtml += `<div class="icon-stats-section">
      <div class="icon-stats-section-label">Hyde queries (from image)</div>
      <div class="icon-stats-pills">${ic.hyde_img_queries.map(q =>
        `<span class="meta-pill" style="background:#1a2840;color:#7ab3e0;font-size:10px">${esc(q)}</span>`
      ).join('')}</div>
    </div>`;
  }

  if (ic.hyde_prompt_queries && ic.hyde_prompt_queries.length) {
    infoHtml += `<div class="icon-stats-section">
      <div class="icon-stats-section-label">Hyde queries (from prompt)</div>
      <div class="icon-stats-pills">${ic.hyde_prompt_queries.map(q =>
        `<span class="meta-pill" style="background:#1a1a2a;color:#9090e0;font-size:10px">${esc(q)}</span>`
      ).join('')}</div>
    </div>`;
  }

  // Rank table from lastMatrixData
  if (lastMatrixData) {
    infoHtml += buildRankTable(ic);
  }

  infoHtml += `</div>`;
  inner.innerHTML = infoHtml;
  panel.style.display = 'block';
}

function buildRankTable(ic) {
  if (!lastMatrixData) return '';
  const rows = [];
  for (const [gridKey, grid] of [['grid1', lastMatrixData.grid1], ['grid2', lastMatrixData.grid2], ['grid3', lastMatrixData.grid3]]) {
    for (const row of grid.rows) {
      for (const col of grid.cols) {
        const key  = `${row.id}:${col.id}`;
        const cell = grid.cells[key];
        if (!cell || cell.error) continue;
        const results = cell.results || [];
        const found   = results.find(r => r.id === ic.id);
        rows.push({
          method: `${row.label} × ${col.label}`,
          rank:   found ? found.rank : null,
          score:  found ? found.score : null,
        });
      }
    }
  }
  if (!rows.length) return '';
  const tableRows = rows.map(r => {
    const rankClass = r.rank ? 'rank-hit-cell' : 'rank-miss-cell';
    return `<tr>
      <td>${esc(r.method)}</td>
      <td class="${rankClass}">${r.rank ? '#' + r.rank : '–'}</td>
      <td class="${rankClass}">${r.score !== null ? r.score.toFixed(3) : '–'}</td>
    </tr>`;
  }).join('');
  return `<div class="icon-stats-section">
    <div class="icon-stats-section-label">Rank in current matrix results</div>
    <table class="icon-stats-rank-table">
      <thead><tr><th>Method</th><th>Rank</th><th>Score</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>`;
}

function applyRankBadges() {
  // Remove old badges
  document.querySelectorAll('.rank-badge').forEach(b => b.remove());
  if (!selectedIcon || !lastMatrixData) return;
  const targetId = selectedIcon.id;

  document.querySelectorAll('[data-cell-key]').forEach(cellEl => {
    const key    = cellEl.dataset.cellKey;
    const grid   = cellEl.dataset.cellGrid;
    const gd     = lastMatrixData[grid];
    if (!gd) return;
    const cell   = gd.cells[key];
    if (!cell || cell.error) return;
    const results = cell.results || [];
    const found   = results.find(r => r.id === targetId);

    const inner = cellEl.querySelector('.mcell-inner');
    if (!inner) return;
    // ensure relative positioning
    inner.style.position = 'relative';

    const badge = document.createElement('span');
    badge.className = found ? 'rank-badge rank-badge-hit' : 'rank-badge rank-badge-miss';
    badge.textContent = found ? '#' + found.rank : '–';
    inner.appendChild(badge);
  });
}

// ── Matrix tab ─────────────────────────────────────────────────────────────
async function runMatrix() {
  const query = document.getElementById('matrix-query').value.trim();
  if (!query) return;

  const btn = document.getElementById('matrix-btn');
  btn.disabled = true;
  btn.textContent = 'Searching…';
  document.getElementById('matrix-status').innerHTML =
    '<span class="spinner"></span> Computing query vectors and running all cells…';
  document.getElementById('matrix-grids').innerHTML = '';
  document.getElementById('matrix-meta').style.display = 'none';

  try {
    const resp = await fetch('/api/matrix', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ query, k: 30 })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    lastMatrixData = data;
    renderMatrixMeta(query, data.meta);
    const gridsEl = document.getElementById('matrix-grids');
    gridsEl.innerHTML = '';
    gridsEl.appendChild(renderGrid(
      'Grid 1 — Gemini Text Embedding Space (768 → 3072 dim)',
      data.grid1, query, 'grid1'));
    gridsEl.appendChild(renderGrid(
      'Grid 2 — BM25 / Keyword',
      data.grid2, query, 'grid2'));
    gridsEl.appendChild(renderGrid(
      'Grid 3 — SigLIP2 Image Space (768 dim)',
      data.grid3, query, 'grid3'));

    // Re-apply rank badges and refresh stats panel if an icon is selected
    if (selectedIcon) {
      applyRankBadges();
      renderIconStats();
    }

    const errCount = Object.keys(data.meta.errors || {}).length;
    document.getElementById('matrix-status').innerHTML =
      `<span class="status-ok">Done.</span>` +
      (errCount ? ` <span class="status-warn">${errCount} vector(s) failed — see cell errors.</span>` : '');
  } catch(e) {
    document.getElementById('matrix-status').innerHTML =
      `<span class="status-err">Error: ${esc(e.message)}</span>`;
  }

  btn.disabled = false;
  btn.textContent = 'Search';
}

function renderMatrixMeta(query, meta) {
  const box = document.getElementById('matrix-meta');

  const pill = (t, color) =>
    `<span class="meta-pill" style="${color ? 'background:'+color+';color:#fff' : ''}">${esc(t)}</span>`;

  let html = `<div class="meta-box">`;

  // Row 1: raw query (what the user typed)
  html += `
    <div class="meta-row">
      <span class="meta-label" title="The raw text entered by the user">plain query</span>
      <span class="meta-value">${pill(query, '#1a3040')}</span>
    </div>`;

  // Row 2: expanded terms (qexp row)
  if (meta.exp_terms && meta.exp_terms.length) {
    html += `
    <div class="meta-row">
      <span class="meta-label" title="6 alternative search terms generated by Gemini (icon-style aware). Embedded individually as RETRIEVAL_QUERY and averaged. Used by: qexp rows.">qexp — 6 expanded terms</span>
      <span class="meta-value">${meta.exp_terms.map(t => pill(t)).join('')}</span>
    </div>`;
  }

  // Row 3: HyDE queries (hyde_q row) — 12 mixed-length
  if (meta.hyde_queries && meta.hyde_queries.length) {
    const qs = meta.hyde_queries;
    // Show with subtle length grouping (first 4 short, next 4 medium, last 4 long)
    const groups = [
      {label: 'short', items: qs.slice(0, 4),  color: '#1a3a1a'},
      {label: 'med',   items: qs.slice(4, 8),  color: '#1a2e1a'},
      {label: 'long',  items: qs.slice(8, 12), color: '#1a261a'},
    ].filter(g => g.items.length);
    const pillsHtml = groups.map(g =>
      g.items.map(t => `<span class="meta-pill" title="${g.label}" style="background:${g.color};color:#7ac07a">${esc(t)}</span>`).join('')
    ).join('<span style="color:#333;margin:0 4px">·</span>');
    html += `
    <div class="meta-row">
      <span class="meta-label" title="12 mixed-length hypothetical icon queries (4 short / 4 medium / 4 long) — embedded as RETRIEVAL_DOCUMENT, averaged. Also used for SigLIP2 search-then-combine rows.">hyde_q — 12 hypothetical queries</span>
      <span class="meta-value">${pillsHtml}</span>
    </div>`;
  }

  // Errors
  const errs = Object.entries(meta.errors || {});
  if (errs.length) {
    html += `<div class="meta-row" style="margin-top:6px">
      <span class="meta-label" style="color:#e05">errors</span>
      <span class="meta-value" style="color:#e05">${errs.map(([k,v]) => `${k}: ${esc(v)}`).join(' · ')}</span>
    </div>`;
  }

  html += `</div>`;
  box.innerHTML = html;
  box.style.display = 'block';
}

function renderGrid(title, gridData, query, gridKey) {
  const section = document.createElement('div');
  section.className = 'grid-section';

  const h3 = document.createElement('h3');
  h3.textContent = title;
  section.appendChild(h3);

  const wrap = document.createElement('div');
  wrap.className = 'matrix-wrap';

  const table = document.createElement('table');
  table.className = 'matrix-table';

  // Header row
  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');
  // empty corner cell
  const corner = document.createElement('th');
  corner.className = 'row-header';
  hrow.appendChild(corner);

  gridData.cols.forEach(col => {
    const th = document.createElement('th');
    th.title = col.desc;
    th.innerHTML = `<div class="col-label">${esc(col.label)}</div><div class="col-sub">${esc(col.desc)}</div>`;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  // Body rows
  const tbody = document.createElement('tbody');
  gridData.rows.forEach(row => {
    const tr = document.createElement('tr');

    // Row header
    const rh = document.createElement('th');
    rh.className = 'row-header';
    rh.title = row.desc;
    rh.innerHTML = `<div class="row-label">${esc(row.label)}</div><div class="row-sub">${esc(row.desc)}</div>`;
    tr.appendChild(rh);

    gridData.cols.forEach(col => {
      const key  = `${row.id}:${col.id}`;
      const cell = gridData.cells[key];
      const td   = document.createElement('td');
      td.appendChild(buildCell(cell, row, col, query, key, gridKey));
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

function buildCell(cell, row, col, query, cellKey, gridKey) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mcell';
  if (cellKey)  wrapper.dataset.cellKey  = cellKey;
  if (gridKey)  wrapper.dataset.cellGrid = gridKey;

  if (!cell || cell.error) {
    wrapper.title = cell?.error || 'No data';
    const inner = document.createElement('div');
    inner.className = 'mcell-inner bg-na';
    inner.innerHTML = `<div class="mcell-err">${esc(cell?.error || 'N/A')}</div>`;
    wrapper.appendChild(inner);
    return wrapper;
  }

  const results = cell.results || [];
  const top1    = results[0];
  const score   = top1 ? top1.score : null;
  const bgClass = cellBgClass(score);

  const inner = document.createElement('div');
  inner.className = `mcell-inner ${bgClass}`;

  if (top1) {
    const img = document.createElement('img');
    img.src     = `/thumb/${top1.id}`;
    img.alt     = top1.desc;
    img.loading = 'lazy';
    img.onerror = function() { this.style.opacity = '0.15'; };
    inner.appendChild(img);

    const name = document.createElement('div');
    name.className = 'mcell-name';
    name.textContent = top1.desc.length > 40 ? top1.desc.slice(0, 38) + '…' : top1.desc;
    inner.appendChild(name);

    const sc = document.createElement('div');
    sc.className = 'mcell-score';
    sc.textContent = score !== null ? score.toFixed(3) : '';
    inner.appendChild(sc);
  } else {
    inner.innerHTML = `<div class="mcell-err">No results</div>`;
  }

  wrapper.title = `${row.label} × ${col.label}\nClick to see top 30`;
  wrapper.appendChild(inner);

  wrapper.addEventListener('click', () => {
    const title = `${row.label} × ${col.label}`;
    const meta  = `Query: "${query}" · ${results.length} results`;
    const highlightId = selectedIcon ? selectedIcon.id : null;
    openModal(title, meta, results, highlightId);
  });

  return wrapper;
}

// ── Legacy single-query tab ────────────────────────────────────────────────
const METHODS = [
  { id: "plain_embed",      label: "Plain Embed",    group: "static", desc: "RETRIEVAL_QUERY → text_emb" },
  { id: "hyde_from_img",    label: "HyDE (image)",   group: "static", desc: "query → hyde_img_emb" },
  { id: "hyde_from_prompt", label: "HyDE (prompt)",  group: "static", desc: "query → hyde_prompt_emb" },
  { id: "caption_embed",    label: "Caption Embed",  group: "static", desc: "query → caption_emb" },
  { id: "bm25_desc",        label: "BM25 Desc",      group: "static", desc: "keyword search on descriptions" },
  { id: "bm25_caption",     label: "BM25 Caption",   group: "static", desc: "keyword search on captions" },
  { id: "qexp_plain",       label: "Qexp Plain",     group: "api",    desc: "expand → avg → text_emb" },
  { id: "qexp_hyde_img",    label: "Qexp HyDE-img",  group: "api",    desc: "expand → avg → hyde_img_emb" },
  { id: "qexp_caption",     label: "Qexp Caption",   group: "api",    desc: "expand → avg → caption_emb" },
  { id: "hyde_query",       label: "HyDE Query",     group: "api",    desc: "gen hyp desc → doc_emb → text_emb" },
];
const DEFAULT_METHODS = ["plain_embed", "hyde_from_img", "caption_embed", "qexp_hyde_img"];
let selectedMethods = new Set(DEFAULT_METHODS);
let recipeNodes = [];
let activeNodeIdx = 0;

function buildMethodChips(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = METHODS.map(m => `
    <label class="method-chip ${selectedMethods.has(m.id) ? 'active' : ''}" title="${m.desc}">
      <input type="checkbox" style="display:none" ${selectedMethods.has(m.id) ? 'checked' : ''}
             onchange="toggleMethod('${m.id}', this.checked, '${containerId}')">
      ${m.group === 'api' ? '⚡ ' : ''}${m.label}
    </label>
  `).join('');
}
function toggleMethod(id, checked, cid) {
  if (checked) selectedMethods.add(id);
  else selectedMethods.delete(id);
  ['method-chips','method-chips-recipe'].filter(c => c !== cid).forEach(buildMethodChips);
}

async function runSingleSearch() {
  const query = document.getElementById('query-input').value.trim();
  if (!query) return;
  const btn = document.getElementById('search-btn');
  btn.disabled = true; btn.textContent = 'Searching…';
  const el = document.getElementById('single-results');
  el.innerHTML = '<div class="spinner" style="margin:20px auto;display:block"></div>';
  try {
    const resp = await fetch('/api/search', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ query, methods: [...selectedMethods], k: 8 })
    });
    const data = await resp.json();
    renderResultsGrid(data.results, el, query);
  } catch(e) { el.innerHTML = `<div class="error">Error: ${esc(e.message)}</div>`; }
  btn.disabled = false; btn.textContent = 'Search';
}

async function runRecipeParse() {
  const text = document.getElementById('recipe-input').value.trim();
  if (!text) return;
  const btn = document.getElementById('parse-btn');
  const sp  = document.getElementById('parse-spinner');
  btn.disabled = true; sp.style.display = 'inline';
  try {
    const resp = await fetch('/api/parse', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    recipeNodes = data.nodes;
    renderNodes();
    document.getElementById('nodes-section').style.display = 'block';
    if (recipeNodes.length) await searchForNode(0);
  } catch(e) { alert('Parse error: ' + e.message); }
  btn.disabled = false; sp.style.display = 'none';
}

function renderNodes() {
  document.getElementById('nodes-strip').innerHTML = recipeNodes.map((n, i) =>
    `<div class="node-pill ${i === activeNodeIdx ? 'active' : ''}"
          onclick="selectNode(${i})" title="${esc(n.description||'')}">${esc(n.name)}</div>`
  ).join('');
}
async function selectNode(i) { activeNodeIdx = i; renderNodes(); await searchForNode(i); }

async function searchForNode(i) {
  const node  = recipeNodes[i];
  const query = node.query || node.name;
  const el    = document.getElementById('recipe-results');
  el.innerHTML = `
    <div class="panel" style="margin-bottom:12px">
      <h2>Node: ${esc(node.name)}</h2>
      <div style="font-size:13px;color:#888;margin-top:4px">Query: <em>${esc(query)}</em></div>
      ${node.description ? `<div style="font-size:12px;color:#666;margin-top:2px">${esc(node.description)}</div>` : ''}
    </div>
    <div class="spinner" style="margin:20px auto;display:block"></div>`;
  try {
    const resp = await fetch('/api/search', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ query, methods: [...selectedMethods], k: 8 })
    });
    const data = await resp.json();
    const header = el.querySelector('.panel');
    const gridEl = document.createElement('div');
    renderResultsGrid(data.results, gridEl, query);
    el.innerHTML = '';
    el.appendChild(header);
    el.appendChild(gridEl);
  } catch(e) { el.innerHTML += `<div class="error">Error: ${esc(e.message)}</div>`; }
}

function renderResultsGrid(results, container, query) {
  const order = METHODS.filter(m => results[m.id]).map(m => m.id);
  container.innerHTML = `<div class="results-grid">${order.map(method => {
    const items = results[method];
    const info  = METHODS.find(m => m.id === method);
    if (!items || items[0]?.error) {
      return `<div class="method-card">
        <div class="method-header">${esc(info?.label || method)}</div>
        <div style="padding:10px;font-size:12px;color:#e05">${esc(items?.[0]?.error || 'No results')}</div>
      </div>`;
    }
    return `<div class="method-card">
      <div class="method-header" title="${esc(info?.desc||'')}">${esc(info?.label || method)}</div>
      ${items.map(it => `
        <div class="icon-row">
          <span class="rank">${it.rank}</span>
          <img src="/thumb/${it.id}" alt="" loading="lazy" onerror="this.style.opacity=0.2">
          <span class="desc">${esc(it.desc)}</span>
        </div>`).join('')}
    </div>`;
  }).join('')}</div>`;
}

// ── Status ─────────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    const badge = document.getElementById('status-badge');
    let txt = `${d.icons} icons`;
    if (!d.api_key_configured) { badge.style.background='#3e1e1e'; badge.style.color='#e07070'; txt += ' · NO API KEY'; }
    if (!d.bm25_available)    txt += ' · no BM25';
    if (!d.siglip_available)  txt += ' · SigLIP loading';
    badge.textContent = txt;
  } catch(e) {}
}

// ── Init ───────────────────────────────────────────────────────────────────
buildMethodChips('method-chips');
buildMethodChips('method-chips-recipe');
loadStatus();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"\nStarting server at http://localhost:{port}")
    print("Press Ctrl+C to stop.\n")
    app.run(host="0.0.0.0", port=port, debug=False)
