"""
ie_hyde_demo.py
---------------
Demonstrates HyDE (Hypothetical Document Embedding) improving icon search.

The problem: "pastry segment with peas and carrots showing in the side"
does NOT find the Sliced Chicken Pot Pie icon in the top 30 using plain
text embeddings.

The hypothesis: embedding 6 HyDE search queries for each icon and averaging
them produces a richer embedding that DOES surface the chicken pot pie.

Run from recipe-lanes/:
    python3 scripts/ie_hyde_demo.py
"""

import json
import os
import re
import time
import urllib.request
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
IE_DATA_DIR = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_FILE = IE_DATA_DIR / "action-icons.json"
EMBEDDINGS_NPY = IE_DATA_DIR / "text_embeddings.npy"
HYDE_FILE = IE_DATA_DIR / "caption_sample_hyde.json"

EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)

SEARCH_QUERY = "pastry segment with peas and carrots showing in the side"
TARGET_ID = "032b5859"
TARGET_DESC = "Sliced Chicken Pot Pie"


# ---------------------------------------------------------------------------
# API key
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    def _parse_env(path: Path) -> dict:
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

    for candidate in [Path("recipe-lanes/.env"), Path(".env"),
                      SCRIPT_DIR.parent / ".env"]:
        env = _parse_env(candidate)
        if "GEMINI_API_KEY" in env:
            return env["GEMINI_API_KEY"]
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY not found in .env or environment")
    return key


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def embed_text(text: str, api_key: str, task_type: str = "RETRIEVAL_QUERY") -> np.ndarray:
    url = EMBED_URL.format(key=api_key)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": task_type,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return np.array(data["embedding"]["values"], dtype=np.float32)


def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()

    # -----------------------------------------------------------------------
    # 1. Load HyDE queries
    # -----------------------------------------------------------------------
    print("=" * 70)
    print("LOADING DATA")
    print("=" * 70)

    hyde_data = json.loads(HYDE_FILE.read_text())
    hyde_results = hyde_data["results"]
    print(f"HyDE file: {len(hyde_results)} icons, model={hyde_data['model']}")

    # Show the queries for the chicken pot pie
    for item in hyde_results:
        if item["id"] == TARGET_ID:
            print(f"\n{TARGET_DESC} ({TARGET_ID}) HyDE queries:")
            for q in item["queries"]:
                print(f"  - {q}")
            break

    # -----------------------------------------------------------------------
    # 2. Embed all 6 HyDE queries per icon, average to one vector
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("EMBEDDING HYDE QUERIES (6 queries x 10 icons = 60 API calls)")
    print("=" * 70)

    hyde_embeddings: dict[str, np.ndarray] = {}  # id -> averaged embedding
    for item in hyde_results:
        icon_id = item["id"]
        queries = item["queries"]
        if not queries:
            print(f"  [{icon_id}] no queries, skipping")
            continue

        vecs = []
        for q in queries:
            vec = embed_text(q, api_key, task_type="RETRIEVAL_DOCUMENT")
            vecs.append(vec)
            time.sleep(0.05)  # light rate-limit buffer

        avg_vec = np.mean(np.stack(vecs), axis=0)
        hyde_embeddings[icon_id] = avg_vec
        print(f"  [{icon_id}] {item['original_desc'][:40]:<40} — {len(vecs)} queries averaged")

    print(f"\nHyDE embeddings computed for {len(hyde_embeddings)} icons.")

    # -----------------------------------------------------------------------
    # 3. Load full text embeddings and icon list
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("LOADING FULL EMBEDDINGS")
    print("=" * 70)

    icons = json.loads(ICONS_FILE.read_text())
    text_embs = np.load(str(EMBEDDINGS_NPY))
    print(f"Icons: {len(icons)}, Embeddings shape: {text_embs.shape}")

    # Build id -> index map
    id_to_idx = {icon["id"]: i for i, icon in enumerate(icons)}
    target_idx = id_to_idx.get(TARGET_ID)
    if target_idx is None:
        print(f"ERROR: target icon {TARGET_ID} not found in action-icons.json")
        return
    print(f"Target '{TARGET_DESC}' is at index {target_idx}")

    # -----------------------------------------------------------------------
    # 4a. Embed the search query
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("EMBEDDING SEARCH QUERY")
    print("=" * 70)
    print(f"Query: \"{SEARCH_QUERY}\"")

    query_vec = embed_text(SEARCH_QUERY, api_key, task_type="RETRIEVAL_QUERY")
    print("Query embedded.")

    # -----------------------------------------------------------------------
    # 4b. Search against FULL text embeddings
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("SEARCH 1: Full text_embeddings.npy (2000 icons, original descriptions)")
    print("=" * 70)

    # Normalize all vectors for batch cosine sim
    norms = np.linalg.norm(text_embs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    normed_text = text_embs / norms

    qn = query_vec / (np.linalg.norm(query_vec) or 1.0)
    sims_text = normed_text @ qn

    top10_text_idx = np.argsort(sims_text)[::-1][:10]
    print(f"\nTop 10 results (plain text embeddings):")
    print(f"  {'Rank':<5} {'Score':>7}  {'ID':<12} {'Description'}")
    print(f"  {'-'*5} {'-'*7}  {'-'*12} {'-'*40}")
    target_rank_text = None
    for rank, idx in enumerate(top10_text_idx, 1):
        icon = icons[idx]
        marker = " <-- CHICKEN POT PIE" if icon["id"] == TARGET_ID else ""
        print(f"  {rank:<5} {sims_text[idx]:>7.4f}  {icon['id']:<12} {icon['desc'][:50]}{marker}")
        if icon["id"] == TARGET_ID:
            target_rank_text = rank

    # Check rank of chicken pot pie in top 100
    top100_text_idx = np.argsort(sims_text)[::-1][:100]
    target_rank_full = None
    for rank, idx in enumerate(top100_text_idx, 1):
        if icons[idx]["id"] == TARGET_ID:
            target_rank_full = rank
            break

    target_sim_text = float(sims_text[target_idx])
    if target_rank_text:
        print(f"\n  -> Chicken Pot Pie: rank #{target_rank_text} (sim={target_sim_text:.4f})")
    elif target_rank_full:
        print(f"\n  -> Chicken Pot Pie NOT in top 10. Rank #{target_rank_full} in top 100 (sim={target_sim_text:.4f})")
    else:
        print(f"\n  -> Chicken Pot Pie NOT in top 100. (sim={target_sim_text:.4f}, rank={int(np.where(np.argsort(sims_text)[::-1] == target_idx)[0][0]) + 1})")

    # -----------------------------------------------------------------------
    # 4c. Cosine sim of query against chicken pot pie's HyDE embedding
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("SEARCH 2: HyDE embedding for chicken pot pie specifically")
    print("=" * 70)

    if TARGET_ID in hyde_embeddings:
        hyde_vec = hyde_embeddings[TARGET_ID]
        sim_hyde = cosine_sim(query_vec, hyde_vec)
        sim_original = target_sim_text
        print(f"  Original text embedding sim:  {sim_original:.4f}")
        print(f"  HyDE averaged embedding sim:  {sim_hyde:.4f}")
        improvement = sim_hyde - sim_original
        pct = (improvement / abs(sim_original) * 100) if sim_original != 0 else float("inf")
        print(f"  Delta:                        {improvement:+.4f}  ({pct:+.1f}%)")
    else:
        print(f"  ERROR: no HyDE embedding for {TARGET_ID}")

    # -----------------------------------------------------------------------
    # 4d. Hybrid search: replace HyDE icons in the full matrix
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("SEARCH 3: Hybrid — 2000 icons, HyDE embeddings for the 10 sample icons")
    print("=" * 70)

    hybrid_embs = text_embs.copy()
    replaced = []
    for icon_id, hvec in hyde_embeddings.items():
        if icon_id in id_to_idx:
            hybrid_embs[id_to_idx[icon_id]] = hvec
            replaced.append(icon_id)
    print(f"  Replaced {len(replaced)} icon embeddings with HyDE versions.")

    # Normalize and search
    norms_h = np.linalg.norm(hybrid_embs, axis=1, keepdims=True)
    norms_h[norms_h == 0] = 1.0
    normed_hybrid = hybrid_embs / norms_h
    sims_hybrid = normed_hybrid @ qn

    top10_hybrid_idx = np.argsort(sims_hybrid)[::-1][:10]
    print(f"\nTop 10 results (hybrid embeddings):")
    print(f"  {'Rank':<5} {'Score':>7}  {'ID':<12} {'Description'}")
    print(f"  {'-'*5} {'-'*7}  {'-'*12} {'-'*40}")
    target_rank_hybrid = None
    for rank, idx in enumerate(top10_hybrid_idx, 1):
        icon = icons[idx]
        marker = " <-- CHICKEN POT PIE" if icon["id"] == TARGET_ID else ""
        hyde_marker = " [HyDE]" if icon["id"] in hyde_embeddings else ""
        print(f"  {rank:<5} {sims_hybrid[idx]:>7.4f}  {icon['id']:<12} {icon['desc'][:50]}{marker}{hyde_marker}")
        if icon["id"] == TARGET_ID:
            target_rank_hybrid = rank

    # Check rank in top 100
    top100_hybrid_idx = np.argsort(sims_hybrid)[::-1][:100]
    target_rank_hybrid_100 = None
    for rank, idx in enumerate(top100_hybrid_idx, 1):
        if icons[idx]["id"] == TARGET_ID:
            target_rank_hybrid_100 = rank
            break

    target_sim_hybrid = float(sims_hybrid[target_idx])
    if target_rank_hybrid:
        print(f"\n  -> Chicken Pot Pie: rank #{target_rank_hybrid} (sim={target_sim_hybrid:.4f})")
    elif target_rank_hybrid_100:
        print(f"\n  -> Chicken Pot Pie NOT in top 10. Rank #{target_rank_hybrid_100} in top 100 (sim={target_sim_hybrid:.4f})")
    else:
        full_rank_hybrid = int(np.where(np.argsort(sims_hybrid)[::-1] == target_idx)[0][0]) + 1
        print(f"\n  -> Chicken Pot Pie NOT in top 100. (sim={target_sim_hybrid:.4f}, rank={full_rank_hybrid})")

    # -----------------------------------------------------------------------
    # 5. Summary comparison table
    # -----------------------------------------------------------------------
    print("\n" + "=" * 70)
    print("COMPARISON SUMMARY")
    print("=" * 70)
    print(f"\nQuery: \"{SEARCH_QUERY}\"")
    print(f"Target: {TARGET_DESC} ({TARGET_ID})\n")

    def rank_str(rank_top10, rank_top100, sim, all_sims, idx):
        if rank_top10:
            return f"#{rank_top10} in top 10"
        if rank_top100:
            return f"#{rank_top100} in top 100"
        full = int(np.where(np.argsort(all_sims)[::-1] == idx)[0][0]) + 1
        return f"#{full} overall"

    rank_plain = rank_str(target_rank_text, target_rank_full, target_sim_text, sims_text, target_idx)
    rank_hyb = rank_str(target_rank_hybrid, target_rank_hybrid_100, target_sim_hybrid, sims_hybrid, target_idx)

    print(f"  {'Approach':<40} {'Sim':>7}   Rank")
    print(f"  {'-'*40} {'-'*7}   {'-'*20}")
    print(f"  {'Plain text embeddings (2000 icons)':<40} {target_sim_text:>7.4f}   {rank_plain}")
    if TARGET_ID in hyde_embeddings:
        print(f"  {'HyDE embedding (chicken pot pie only)':<40} {sim_hyde:>7.4f}   (similarity only, no rank)")
    print(f"  {'Hybrid (HyDE for 10 sample icons)':<40} {target_sim_hybrid:>7.4f}   {rank_hyb}")

    print()
    if target_rank_hybrid and (not target_rank_text):
        print("  RESULT: HyDE WORKS — chicken pot pie surfaced in hybrid search!")
    elif target_rank_hybrid and target_rank_text:
        if target_rank_hybrid < target_rank_text:
            print(f"  RESULT: HyDE IMPROVED rank from #{target_rank_text} to #{target_rank_hybrid}")
        else:
            print(f"  RESULT: No rank improvement (#{target_rank_text} -> #{target_rank_hybrid})")
    else:
        print("  RESULT: Chicken pot pie still not in top 10 with hybrid approach.")
        print("  (But check the similarity delta above — it may still be closer.)")

    print()


if __name__ == "__main__":
    main()
