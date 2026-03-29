"""
rerank_server.py

LLM re-ranking demo server for RecipeLanes icon search.
Serves the HTML frontend and handles embedding + cosine-similarity + BM25 + CLIP + Gemini re-ranking.

Run with the recipeviz venv:
    ~/venvs/recipeviz/bin/python scripts/rerank_server.py
"""

import json
import math
import os
import re
import time
import urllib.request
import urllib.error
from collections import Counter
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
IE_DATA_DIR = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON          = IE_DATA_DIR / "action-icons.json"
EMBEDDINGS_NPY      = IE_DATA_DIR / "text_embeddings.npy"
IMAGE_EMBEDDINGS_NPY  = IE_DATA_DIR / "image_embeddings.npy"
HYDE_QUERIES_JSON     = IE_DATA_DIR / "hyde_queries.json"
HYDE_EMBEDDINGS_NPY   = IE_DATA_DIR / "hyde_embeddings.npy"
HYDE_IDS_JSON         = IE_DATA_DIR / "hyde_ids.json"
ENV_FILE = Path(__file__).parent.parent.parent / 'recipe-lanes' / ".env"

PORT  = 8767
TOP_K = 30

EMBED_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)
GENERATE_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)

# ---------------------------------------------------------------------------
# Startup: load data
# ---------------------------------------------------------------------------

def _read_env_file(path: Path) -> dict:
    result = {}
    if not path.exists():
        return result
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)', line)
        if m:
            key, val = m.group(1), m.group(2)
            val = re.sub(r'^(["\'])(.*)\1$', r'\2', val)
            result[key] = val
    return result


def load_api_key() -> str:
    try:
        from dotenv import load_dotenv
        for p in [ENV_FILE, SCRIPT_DIR / ".env", Path(".env")]:
            if p.exists():
                load_dotenv(str(p), override=False)
                break
    except ImportError:
        for p in [ENV_FILE, SCRIPT_DIR / ".env", Path(".env")]:
            env_vars = _read_env_file(p)
            if "GEMINI_API_KEY" in env_vars:
                os.environ.setdefault("GEMINI_API_KEY", env_vars["GEMINI_API_KEY"])
                break

    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY not found. Checked .env at repo root and GEMINI_API_KEY env var."
        )
    return key


print("Loading data...")
ITEMS: list = json.loads(ICONS_JSON.read_text())
EMBEDDINGS: np.ndarray = np.load(str(EMBEDDINGS_NPY))  # shape (N, 3072), float32

# Pre-normalise all embeddings for fast cosine similarity (dot product only)
norms = np.linalg.norm(EMBEDDINGS, axis=1, keepdims=True)
norms[norms == 0] = 1.0
EMBEDDINGS_NORM: np.ndarray = (EMBEDDINGS / norms).astype(np.float32)

API_KEY: str = load_api_key()
print(f"Loaded {len(ITEMS)} icons, embeddings shape={EMBEDDINGS.shape}")

# ---------------------------------------------------------------------------
# HyDE embeddings — pre-computed by ie_07_build_hyde_embeddings.py
# Same shape as text_embeddings.npy; rows for icons with HyDE queries
# have been replaced with avg(embed(query_i)) for their 6 search queries.
# ---------------------------------------------------------------------------

_ID_TO_IDX: dict[str, int] = {item["id"]: i for i, item in enumerate(ITEMS)}

HYDE_EMBEDDINGS_NORM: np.ndarray = EMBEDDINGS_NORM.copy()  # fallback = plain
HYDE_IDS: set[int] = set()

if HYDE_EMBEDDINGS_NPY.exists():
    raw_hyde = np.load(str(HYDE_EMBEDDINGS_NPY)).astype(np.float32)
    norms_h = np.linalg.norm(raw_hyde, axis=1, keepdims=True)
    norms_h[norms_h == 0] = 1.0
    HYDE_EMBEDDINGS_NORM = (raw_hyde / norms_h).astype(np.float32)
    if HYDE_IDS_JSON.exists():
        for iid in json.loads(HYDE_IDS_JSON.read_text()):
            if iid in _ID_TO_IDX:
                HYDE_IDS.add(_ID_TO_IDX[iid])
    print(f"HyDE embeddings loaded: {len(HYDE_IDS)} icons have HyDE rows.")
else:
    print("No hyde_embeddings.npy found — HyDE column will use plain embeddings.")

# ---------------------------------------------------------------------------
# BM25 index (built at startup)
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> list[str]:
    """Lowercase and split on non-alphanumeric characters."""
    return re.findall(r'[a-z0-9]+', text.lower())


def _build_bm25_index(items: list) -> dict:
    """
    Build BM25 index over item descriptions.
    Returns a dict with all pre-computed data needed for scoring.
    k1=1.5, b=0.75
    """
    k1 = 1.5
    b  = 0.75

    corpus_tokens = [_tokenize(item.get("desc", "")) for item in items]
    N = len(corpus_tokens)
    avgdl = sum(len(toks) for toks in corpus_tokens) / max(N, 1)

    # Document frequency: how many docs contain each term
    df: dict[str, int] = {}
    for toks in corpus_tokens:
        for term in set(toks):
            df[term] = df.get(term, 0) + 1

    # IDF: log((N - df + 0.5) / (df + 0.5) + 1)  (Robertson-Sparck-Jones)
    idf: dict[str, float] = {}
    for term, freq in df.items():
        idf[term] = math.log((N - freq + 0.5) / (freq + 0.5) + 1.0)

    return {
        "corpus_tokens": corpus_tokens,
        "idf": idf,
        "avgdl": avgdl,
        "k1": k1,
        "b": b,
        "N": N,
    }


def bm25_search(query: str, index: dict, items: list, top_k: int = 30) -> list[dict]:
    """Score all documents against query with BM25. Returns top_k sorted results."""
    q_terms = _tokenize(query)
    if not q_terms:
        return []

    idf    = index["idf"]
    avgdl  = index["avgdl"]
    k1     = index["k1"]
    b      = index["b"]
    corpus = index["corpus_tokens"]

    scores = np.zeros(len(corpus), dtype=np.float32)

    for term in q_terms:
        if term not in idf:
            continue
        term_idf = idf[term]
        for doc_i, toks in enumerate(corpus):
            tf = toks.count(term)
            if tf == 0:
                continue
            dl = len(toks)
            denom = tf + k1 * (1.0 - b + b * dl / avgdl)
            scores[doc_i] += term_idf * (tf * (k1 + 1.0)) / denom

    top_indices = np.argpartition(scores, -top_k)[-top_k:]
    top_indices = top_indices[np.argsort(scores[top_indices])[::-1]]

    results = []
    for idx in top_indices:
        item = items[int(idx)]
        results.append({
            "idx":   int(idx),
            "id":    item.get("id", ""),
            "desc":  item.get("desc", ""),
            "count": item.get("count", 0),
            "score": float(scores[idx]),
        })
    return results


print("Building BM25 index...")
BM25_INDEX = _build_bm25_index(ITEMS)
print("BM25 index ready.")


# ---------------------------------------------------------------------------
# CLIP model (loaded at startup, graceful failure)
# ---------------------------------------------------------------------------

SIGLIP_MODEL = None
SIGLIP_PROC  = None
IMAGE_EMBEDDINGS_NORM: np.ndarray | None = None

try:
    print("Loading SigLIP2 model (google/siglip2-base-patch16-224)...")
    from transformers import AutoModel, AutoProcessor
    import torch

    SIGLIP_MODEL = AutoModel.from_pretrained("google/siglip2-base-patch16-224")
    SIGLIP_PROC  = AutoProcessor.from_pretrained("google/siglip2-base-patch16-224")
    SIGLIP_MODEL.eval()
    print("SigLIP2 model loaded.")

    print(f"Loading image embeddings from {IMAGE_EMBEDDINGS_NPY}...")
    img_emb = np.load(str(IMAGE_EMBEDDINGS_NPY)).astype(np.float32)  # (N, 768)
    IMAGE_EMBEDDINGS_NORM = img_emb  # already L2-normalised
    print(f"Image embeddings loaded: shape={img_emb.shape}")
except Exception as _err:
    print(f"WARNING: SigLIP2 load failed ({_err}). SigLIP2 column will be unavailable.")


def siglip_search(query: str, top_k: int = 30) -> list[dict] | None:
    """Encode query text with SigLIP2 and return top_k by cosine sim vs image embeddings."""
    if SIGLIP_MODEL is None or SIGLIP_PROC is None or IMAGE_EMBEDDINGS_NORM is None:
        return None

    import torch
    inputs = SIGLIP_PROC(text=[query], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        feats = SIGLIP_MODEL.get_text_features(**inputs)
        if not isinstance(feats, torch.Tensor):
            feats = feats.text_embeds if hasattr(feats, "text_embeds") else feats.pooler_output
        feats = feats / feats.norm(dim=-1, keepdim=True)
    query_vec = feats.cpu().numpy()[0]  # (768,)

    sims = IMAGE_EMBEDDINGS_NORM @ query_vec  # (N,)
    top_indices = np.argpartition(sims, -top_k)[-top_k:]
    top_indices = top_indices[np.argsort(sims[top_indices])[::-1]]

    results = []
    for idx in top_indices:
        item = ITEMS[int(idx)]
        results.append({
            "idx":        int(idx),
            "id":         item.get("id", ""),
            "desc":       item.get("desc", ""),
            "count":      item.get("count", 0),
            "similarity": float(sims[idx]),
        })
    return results


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def embed_query(text: str) -> np.ndarray:
    """Call Gemini to embed a text string. Returns float32 unit vector."""
    url = EMBED_URL_TEMPLATE.format(key=API_KEY)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    vec = np.array(data["embedding"]["values"], dtype=np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec


def expand_query(description: str) -> list[str]:
    """Ask Gemini to expand a search query into 6 short search terms."""
    prompt = (
        f'A user is searching a recipe app icon library with this query: "{description}"\n\n'
        f'Generate exactly 6 short search queries (2-5 words each) that would help find '
        f'the right recipe icon. Vary specificity from broad to specific. '
        f'Focus on food type, cooking method, and visual appearance.\n'
        f'Reply with a JSON array of strings only.'
    )
    url = GENERATE_URL_TEMPLATE.format(key=API_KEY)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        d = json.loads(resp.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    terms = json.loads(raw)
    return [t for t in terms if isinstance(t, str)][:6]


def query_expand_search(description: str, top_k: int = 30) -> tuple[list[dict], list[dict], list[str]]:
    """Expand query with LLM, embed each term, average.
    Returns (plain_results, hyde_results, terms) — both searches reuse the same avg vector."""
    terms = expand_query(description)
    vecs = [embed_query(t) for t in terms]
    avg = np.mean(vecs, axis=0).astype(np.float32)
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg /= norm

    def _top_k_from(matrix: np.ndarray) -> list[dict]:
        sims = matrix @ avg
        indices = np.argpartition(sims, -top_k)[-top_k:]
        indices = indices[np.argsort(sims[indices])[::-1]]
        return [{
            "idx": int(i),
            "id": ITEMS[int(i)].get("id", ""),
            "desc": ITEMS[int(i)].get("desc", ""),
            "count": ITEMS[int(i)].get("count", 0),
            "similarity": float(sims[i]),
        } for i in indices]

    return _top_k_from(EMBEDDINGS_NORM), _top_k_from(HYDE_EMBEDDINGS_NORM), terms


def build_rerank_prompt(description: str, candidates: list) -> str:
    """Build the LLM prompt for re-ranking candidates."""
    lines = [
        f'You are helping select the best icon for a recipe card step described as: "{description}"',
        "",
        "Below are 30 candidate icon descriptions (0-indexed). Your task is to re-rank them from most to least visually appropriate as an icon for this recipe step.",
        "",
        "Consider which icon would look most visually distinct and immediately recognisable on a small recipe card — not just which description is semantically closest.",
        "Prioritise icons that:",
        "  - Depict a clear, specific visual action or object that matches the step",
        "  - Would be recognisable at small sizes",
        "  - Are visually distinct from generic cooking icons",
        "",
        "Candidates:",
    ]
    for i, item in enumerate(candidates):
        lines.append(f"  {i}: {item['desc']}")
    lines += [
        "",
        "Return ONLY a JSON array of integers (0-based indices into the list above), ordered from most to least appropriate.",
        "Example format: [4, 11, 0, 23, ...]",
        "Include all 30 indices exactly once. Return nothing else — no explanation, no markdown, just the JSON array.",
    ]
    return "\n".join(lines)


def llm_rerank(description: str, candidates: list) -> tuple[list[int], str]:
    """
    Ask Gemini 2.5-flash to re-rank candidates.
    Returns (ordered_indices, prompt_used).
    ordered_indices are 0-based into candidates.
    Raises on hard failure; caller should catch and fall back.
    """
    prompt = build_rerank_prompt(description, candidates)
    url = GENERATE_URL_TEMPLATE.format(key=API_KEY)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())

    raw_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

    # Strip markdown code fences if present
    cleaned = raw_text
    if cleaned.startswith("```"):
        cleaned = re.sub(r'^```[a-z]*\n?', '', cleaned)
        cleaned = re.sub(r'\n?```$', '', cleaned)
        cleaned = cleaned.strip()

    indices = json.loads(cleaned)

    if not isinstance(indices, list):
        raise ValueError("LLM did not return a JSON array")

    # Coerce to ints, filter valid range, deduplicate while preserving order
    seen = set()
    result = []
    for v in indices:
        i = int(v)
        if 0 <= i < len(candidates) and i not in seen:
            result.append(i)
            seen.add(i)

    # Append any missing indices at the end (safety net)
    for i in range(len(candidates)):
        if i not in seen:
            result.append(i)

    return result, prompt


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")

    def _send_cors_preflight(self):
        self.send_response(204)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()

    def _send_json(self, status: int, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    # ---- routing ----

    def do_OPTIONS(self):
        self._send_cors_preflight()

    def do_GET(self):
        path = self.path.split("?")[0]

        # Root → serve the HTML
        if path in ("/", "/rerank-demo.html"):
            html_file = SCRIPT_DIR / "rerank-demo.html"
            if html_file.exists():
                self._send_file(html_file, "text/html; charset=utf-8")
            else:
                self._send_json(404, {"error": "rerank-demo.html not found"})
            return

        # Static files under /ie_data/icons/thumb/ (path-safe)
        if path.startswith("/ie_data/icons/thumb/"):
            # Resolve safely: strip prefix, reject any path traversal
            rel = path[len("/ie_data/icons/thumb/"):]
            if "/" in rel or "\\" in rel or ".." in rel:
                self.send_response(400)
                self.end_headers()
                return
            file_path = IE_DATA_DIR / "icons" / "thumb" / rel
            if file_path.exists() and file_path.suffix == ".png":
                self._send_file(file_path, "image/png")
            else:
                self.send_response(404)
                self.end_headers()
            return

        # Fallback: serve other static files under scripts/
        rel = path.lstrip("/")
        if rel:
            file_path = SCRIPT_DIR / rel
            # Prevent path traversal
            try:
                file_path.resolve().relative_to(SCRIPT_DIR.resolve())
            except ValueError:
                self.send_response(403)
                self.end_headers()
                return
            if file_path.exists() and file_path.is_file():
                ext = file_path.suffix.lower()
                ctype_map = {
                    ".html": "text/html; charset=utf-8",
                    ".js": "application/javascript",
                    ".css": "text/css",
                    ".json": "application/json",
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".svg": "image/svg+xml",
                }
                ctype = ctype_map.get(ext, "application/octet-stream")
                self._send_file(file_path, ctype)
                return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?")[0]

        if path == "/search":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                self._send_json(400, {"error": "Invalid JSON"})
                return

            description = (payload.get("description") or "").strip()
            if not description:
                self._send_json(400, {"error": "description is required"})
                return

            # Step 1: embed the query
            print(f"  Embedding query: {description!r}")
            t0 = time.monotonic()
            try:
                query_vec = embed_query(description)
            except Exception as exc:
                self._send_json(502, {"error": f"Embedding failed: {exc}"})
                return
            embed_ms = round((time.monotonic() - t0) * 1000)

            # Step 2: cosine similarity → top 30
            sims = EMBEDDINGS_NORM @ query_vec  # shape (N,)
            top_indices = np.argpartition(sims, -TOP_K)[-TOP_K:]
            top_indices = top_indices[np.argsort(sims[top_indices])[::-1]]

            before = []
            for rank_i, idx in enumerate(top_indices):
                item = ITEMS[int(idx)]
                before.append({
                    "idx": int(idx),
                    "id": item.get("id", ""),
                    "desc": item.get("desc", ""),
                    "count": item.get("count", 0),
                    "similarity": float(sims[idx]),
                })

            # Step 3: BM25 search
            print(f"  Running BM25 search...")
            t0 = time.monotonic()
            bm25_results = bm25_search(description, BM25_INDEX, ITEMS, TOP_K)
            bm25_ms = round((time.monotonic() - t0) * 1000)
            print(f"  BM25 done in {bm25_ms}ms.")

            # Step 4: SigLIP2 text→image search
            print(f"  Running SigLIP2 search...")
            t0 = time.monotonic()
            try:
                clip_results = siglip_search(description, TOP_K)
            except Exception as exc:
                print(f"  WARNING: SigLIP2 search failed ({exc})")
                clip_results = None
            clip_ms = round((time.monotonic() - t0) * 1000)
            print(f"  SigLIP2 done in {clip_ms}ms (result={'null' if clip_results is None else len(clip_results)}).")

            # Step 5: HyDE hybrid search
            print(f"  Running HyDE search...")
            t0 = time.monotonic()
            hyde_sims = HYDE_EMBEDDINGS_NORM @ query_vec
            hyde_top_indices = np.argpartition(hyde_sims, -TOP_K)[-TOP_K:]
            hyde_top_indices = hyde_top_indices[np.argsort(hyde_sims[hyde_top_indices])[::-1]]
            hyde_results = []
            for idx in hyde_top_indices:
                item = ITEMS[int(idx)]
                hyde_results.append({
                    "idx": int(idx),
                    "id": item.get("id", ""),
                    "desc": item.get("desc", ""),
                    "count": item.get("count", 0),
                    "similarity": float(hyde_sims[idx]),
                    "hyde": int(idx) in HYDE_IDS,
                })
            hyde_ms = round((time.monotonic() - t0) * 1000)
            print(f"  HyDE done in {hyde_ms}ms.")

            # Step 6: Query expansion search (plain + hyde — same LLM call, same avg vector)
            print(f"  Running query expansion search...")
            t0 = time.monotonic()
            expanded_terms = []
            qexp_results = []
            qexp_hyde_results = []
            try:
                qexp_results, qexp_hyde_results, expanded_terms = query_expand_search(description, TOP_K)
                print(f"  Expanded terms: {expanded_terms}")
            except Exception as exc:
                print(f"  WARNING: query expansion failed ({exc})")
            qexp_ms = round((time.monotonic() - t0) * 1000)
            print(f"  Query expand done in {qexp_ms}ms.")

            # Step 7: LLM re-ranking (always on embedding top-30)
            print(f"  Re-ranking {len(before)} candidates with Gemini...")
            t0 = time.monotonic()
            prompt_used = ""
            try:
                rerank_order, prompt_used = llm_rerank(description, before)
                after = []
                for new_rank, cand_idx in enumerate(rerank_order):
                    entry = dict(before[cand_idx])
                    entry["rank_before"] = cand_idx  # 0-based position in the before list
                    after.append(entry)
                print(f"  Re-ranking complete.")
            except Exception as exc:
                print(f"  WARNING: LLM re-ranking failed ({exc}), using embedding order as fallback.")
                after = [dict(item, rank_before=i) for i, item in enumerate(before)]
            llm_ms = round((time.monotonic() - t0) * 1000)

            self._send_json(200, {
                "query": description,
                "prompt": prompt_used,
                "timings": {
                    "embed_ms": embed_ms,
                    "bm25_ms":  bm25_ms,
                    "clip_ms":  clip_ms,
                    "hyde_ms":  hyde_ms,
                    "qexp_ms":  qexp_ms,
                    "llm_ms":   llm_ms,
                },
                "before":         before,
                "bm25":           bm25_results,
                "clip":           clip_results,
                "hyde":           hyde_results,
                "qexp":           qexp_results,
                "qexp_hyde":      qexp_hyde_results,
                "expanded_terms": expanded_terms,
                "after":          after,
            })
            return

        self._send_json(404, {"error": "Not found"})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    server = HTTPServer(("", PORT), Handler)
    print(f"\nRerank demo server running at http://localhost:{PORT}/")
    print("Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
