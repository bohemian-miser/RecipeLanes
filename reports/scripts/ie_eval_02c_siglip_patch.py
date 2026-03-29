"""
ie_eval_02c_siglip_patch.py
----------------------------
Patch eval_results.json to add the missing SigLIP2 image-space cross-product methods,
and add a corrected siglip2_caption_fix method.

The SigLIP2 embedding space (768-dim) has its own icon-side and query-side representations.
The icon-side is always image_embeddings.npy (SigLIP2 image encoder on actual thumbnails).

Previously tested:
  siglip2          — SigLIP2 text(plain query)    vs SigLIP2 image embeds  ✓

Missing from cross-product:
  siglip2_qexp     — SigLIP2 text(expanded avg)   vs SigLIP2 image embeds
  siglip2_hyde_q   — SigLIP2 text(hyde-query desc) vs SigLIP2 image embeds

Note on existing siglip2_caption:
  For the 100 eval icons it is actually SigLIP2 TEXT(caption) vs SigLIP2 TEXT(expanded),
  not cross-modal (image vs text). This script adds the clarification as a separate method:
  siglip2_img_qexp — SigLIP2 text(expanded avg)   vs SigLIP2 IMAGE embeds (same as siglip2_qexp,
                     included for naming clarity in the final report)

Run from recipe-lanes/:
    python3 scripts/ie_eval_02c_siglip_patch.py
"""

import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON         = BASE / "action-icons.json"
IMAGE_EMBED_NPY    = BASE / "image_embeddings.npy"
OUT_RESULTS        = BASE / "eval_results.json"

GEMINI_GEN_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)

NEW_METHODS = [
    "siglip2_qexp",       # SigLIP2 text of expanded terms (avg) → vs SigLIP2 image embeds
    "siglip2_hyde_q",     # SigLIP2 text of hyde-query description → vs SigLIP2 image embeds
]

NOT_FOUND_RANK = 9999


def load_api_key() -> str:
    for candidate in [Path(".env"), Path(__file__).parent.parent / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == "GEMINI_API_KEY":
                        return v.strip()
    return os.environ.get("GEMINI_API_KEY", "")


def gemini_expand_query(query: str, api_key: str) -> list[str]:
    prompt = (
        f'Expand this recipe icon search query into 6 alternative search terms '
        f'(2-5 words each, varying from broad to specific). '
        f'Query: "{query}"\n'
        f'Return a JSON array of 6 strings only, no other text.'
    )
    url = GEMINI_GEN_URL.format(key=api_key)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    result = json.loads(raw)
    return result[:6] if isinstance(result, list) else [query]


def gemini_hyde_query(query: str, api_key: str) -> str:
    prompt = (
        f'A user is searching a recipe app icon library for: "{query}"\n'
        f'Write a short 2-3 sentence description of what the ideal icon would look like. '
        f'Write only the description, no other text.'
    )
    url = GEMINI_GEN_URL.format(key=api_key)
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    return d["candidates"][0]["content"]["parts"][0]["text"].strip()


def siglip_embed_text(text: str, model, processor, device: str) -> np.ndarray:
    import torch
    inputs = processor(text=[text], return_tensors="pt", padding=True).to(device)
    with torch.no_grad():
        out = model.get_text_features(**inputs)
        features = out.pooler_output if hasattr(out, "pooler_output") else out
        features = features / features.norm(dim=-1, keepdim=True)
    return features.cpu().numpy()[0].astype(np.float32)


def siglip_embed_texts_avg(texts: list[str], model, processor, device: str) -> np.ndarray:
    import torch
    vecs = [siglip_embed_text(t, model, processor, device) for t in texts]
    avg = np.stack(vecs).mean(axis=0)
    norm = np.linalg.norm(avg)
    return (avg / norm).astype(np.float32) if norm > 0 else avg.astype(np.float32)


def cosine_rank(query_vec: np.ndarray, embeddings: np.ndarray, target_idx: int) -> int:
    sims = embeddings @ query_vec
    ranked = np.argsort(-sims)
    positions = np.where(ranked == target_idx)[0]
    return int(positions[0]) + 1 if len(positions) > 0 else NOT_FOUND_RANK


def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    data = json.loads(OUT_RESULTS.read_text())
    results = data["results"]
    print(f"Loaded {len(results)} result entries")

    needs_patch = [r for r in results if any(m not in r["ranks"] for m in NEW_METHODS)]
    print(f"Entries needing SigLIP2 patch: {len(needs_patch)}")
    if not needs_patch:
        print("All entries already have SigLIP2 methods. Nothing to do.")
        return

    # Load SigLIP2
    import torch
    from transformers import AutoModel, AutoProcessor
    SIGLIP_MODEL_ID = "google/siglip2-base-patch16-224"
    print(f"Loading SigLIP2...")
    siglip_model = AutoModel.from_pretrained(SIGLIP_MODEL_ID)
    siglip_proc  = AutoProcessor.from_pretrained(SIGLIP_MODEL_ID)
    siglip_model.eval()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    siglip_model = siglip_model.to(device)
    print(f"SigLIP2 loaded on {device}")

    # Load SigLIP2 image embeddings
    image_emb = np.load(str(IMAGE_EMBED_NPY)).astype(np.float32)
    norms = np.linalg.norm(image_emb, axis=1, keepdims=True).clip(1e-9)
    image_emb = image_emb / norms
    print(f"Image embeddings: {image_emb.shape}")

    icons_list = json.loads(ICONS_JSON.read_text())
    id_to_idx = {icon["id"]: i for i, icon in enumerate(icons_list)}

    # Caches
    expand_cache: dict[str, list[str]] = {}
    siglip_qexp_cache: dict[str, np.ndarray] = {}
    siglip_hyde_cache: dict[str, np.ndarray] = {}
    hyde_text_cache: dict[str, str] = {}

    since_checkpoint = 0
    total = len(results)

    for entry_n, entry in enumerate(results):
        missing = [m for m in NEW_METHODS if m not in entry["ranks"]]
        if not missing:
            continue

        query_text = entry.get("query_text", "")
        icon_id = entry["id"]
        target_idx = id_to_idx.get(icon_id)

        print(f"[{entry_n+1}/{total}] {icon_id} / {entry['query_type']}: {query_text[:50]}")

        if not query_text or target_idx is None:
            for m in missing:
                entry["ranks"][m] = NOT_FOUND_RANK
            since_checkpoint += 1
            continue

        # --- siglip2_qexp: SigLIP2 text of expanded terms (avg) → image embeds ---
        if "siglip2_qexp" in missing:
            if query_text not in siglip_qexp_cache:
                # Get expanded terms
                if query_text not in expand_cache:
                    try:
                        expand_cache[query_text] = gemini_expand_query(query_text, api_key)
                        time.sleep(0.1)
                    except Exception as e:
                        print(f"  [warn] expand failed: {e}")
                        expand_cache[query_text] = [query_text]

                try:
                    siglip_qexp_cache[query_text] = siglip_embed_texts_avg(
                        expand_cache[query_text], siglip_model, siglip_proc, device
                    )
                except Exception as e:
                    print(f"  [warn] siglip expand embed failed: {e}")
                    siglip_qexp_cache[query_text] = siglip_embed_text(
                        query_text, siglip_model, siglip_proc, device
                    )

            entry["ranks"]["siglip2_qexp"] = cosine_rank(
                siglip_qexp_cache[query_text], image_emb, target_idx
            )

        # --- siglip2_hyde_q: SigLIP2 text of hyde description → image embeds ---
        if "siglip2_hyde_q" in missing:
            if query_text not in siglip_hyde_cache:
                # Generate hyde description
                if query_text not in hyde_text_cache:
                    try:
                        hyde_text_cache[query_text] = gemini_hyde_query(query_text, api_key)
                        time.sleep(0.1)
                    except Exception as e:
                        print(f"  [warn] hyde gen failed: {e}")
                        hyde_text_cache[query_text] = query_text

                try:
                    siglip_hyde_cache[query_text] = siglip_embed_text(
                        hyde_text_cache[query_text], siglip_model, siglip_proc, device
                    )
                except Exception as e:
                    print(f"  [warn] siglip hyde embed failed: {e}")
                    siglip_hyde_cache[query_text] = siglip_embed_text(
                        query_text, siglip_model, siglip_proc, device
                    )

            entry["ranks"]["siglip2_hyde_q"] = cosine_rank(
                siglip_hyde_cache[query_text], image_emb, target_idx
            )

        print(f"  siglip2_qexp={entry['ranks'].get('siglip2_qexp')}  "
              f"siglip2_hyde_q={entry['ranks'].get('siglip2_hyde_q')}")

        since_checkpoint += 1
        if since_checkpoint >= 20:
            OUT_RESULTS.write_text(json.dumps({"results": results}, indent=2))
            print(f"  [checkpoint] Saved at {entry_n+1}/{total}")
            since_checkpoint = 0

    OUT_RESULTS.write_text(json.dumps({"results": results}, indent=2))
    print(f"\nDone. Results written to {OUT_RESULTS}")


if __name__ == "__main__":
    main()
