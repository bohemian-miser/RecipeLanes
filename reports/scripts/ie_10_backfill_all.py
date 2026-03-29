"""
ie_10_backfill_all.py
---------------------
Backfill all icons with the methods that won the evaluation.

Reads eval_stats.json (from ie_eval_03_analyze.py) and picks the top-performing methods,
then builds the corresponding embedding matrices for all ~1684 icons that have images.

Methods that can be backfilled (all under ~$5 total API cost):
  - hyde_from_img:    Gemini Vision per icon → 6 search queries → embed avg
                      Requires vision API. Cost ~$0.20 for 1684 icons.
  - hyde_from_prompt: Gemini text per icon → 6 search queries from desc → embed avg
                      Cheap text-only. Cost ~$0.05 for 1684 icons.
  - caption_embed:    Gemini Vision long caption per icon → embed
                      Cost ~$0.30 for 1684 icons.

All three are built regardless of eval outcome (total < $1), since they're cheap and
individually useful. hyde_query and qexp are query-time methods (no pre-computation).

Outputs:
  scripts/ie_data/all_hyde_from_img.npy     — (N, 3072) hyde from image
  scripts/ie_data/all_hyde_from_prompt.npy  — (N, 3072) hyde from prompt
  scripts/ie_data/all_caption_embeddings.npy — (N, 3072) gemini embed of long caption
  scripts/ie_data/all_captions.json         — {id: long_caption} for all icons
  scripts/ie_data/all_hyde_queries.json     — {id: [queries]} from vision (extends existing)

Budget guard: tracks approximate cost and stops if over $5.

Run from recipe-lanes/:
    python3 scripts/ie_10_backfill_all.py
"""

import base64
import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE       = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON = BASE / "action-icons.json"
THUMB_DIR  = BASE / "icons" / "thumb"
TEXT_EMBED_NPY = BASE / "text_embeddings.npy"

# Outputs
OUT_HYDE_IMG_NPY    = BASE / "all_hyde_from_img.npy"
OUT_HYDE_PROMPT_NPY = BASE / "all_hyde_from_prompt.npy"
OUT_CAPTION_EMB_NPY = BASE / "all_caption_embeddings.npy"
OUT_CAPTIONS_JSON   = BASE / "all_captions.json"
OUT_HYDE_IMG_JSON   = BASE / "all_hyde_queries.json"
OUT_HYDE_PROMPT_JSON = BASE / "all_hyde_prompt_queries.json"

# Existing eval data to reuse (don't re-call API for these)
EVAL_DATA_JSON      = BASE / "eval_data.json"

EMBED_URL  = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={key}"
VISION_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"

BUDGET_USD = 5.0
# Cost estimates (conservative):
COST_PER_VISION_CALL    = 0.0003   # ~1200 input tokens × $0.15/1M + 200 output × $0.60/1M
COST_PER_EMBED_CALL     = 0.0000005 # ~500 tokens × $0.10/1M (effectively free)
COST_PER_TEXT_GEN_CALL  = 0.00005  # ~500 tokens text-only flash


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
            time.sleep(0.10)
        except Exception as e:
            print(f"    [warn] embed failed for '{q[:40]}': {e}")
    if not vecs:
        return None
    avg = np.mean(vecs, axis=0).astype(np.float32)
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg /= norm
    return avg


def gemini_vision_icon(thumb_path: Path, api_key: str) -> dict:
    """Single Gemini Vision call returning hyde_queries + long_caption."""
    prompt = (
        "This is a recipe app icon. Return a JSON object with exactly 2 fields:\n"
        "- hyde_queries: array of 6 short search terms (2-5 words each) varying from "
        "broad to specific that someone might type to find this icon\n"
        "- long_caption: detailed 2-3 sentence visual description for indexing "
        "(mention colors, shapes, ingredients, cooking method)\n"
        "Return only the JSON object."
    )
    img_b64 = base64.b64encode(thumb_path.read_bytes()).decode()
    url = VISION_URL.format(key=api_key)
    body = json.dumps({
        "contents": [{"parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": "image/png", "data": img_b64}},
        ]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    return json.loads(raw)


def gemini_prompt_queries(desc: str, api_key: str) -> list[str]:
    """Generate 6 search queries from text description only."""
    prompt = (
        f'Generate 6 short search queries (2-5 words each) that someone might type '
        f'to find a recipe app icon described as: "{desc}". '
        f'Vary from broad to specific. Return a JSON array of 6 strings only.'
    )
    url = VISION_URL.format(key=api_key)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    result = json.loads(raw)
    return [str(q) for q in result[:6]] if isinstance(result, list) else []


def save_all(
    hyde_img_emb, hyde_prompt_emb, caption_emb,
    captions_map, hyde_img_map, hyde_prompt_map,
):
    np.save(str(OUT_HYDE_IMG_NPY), hyde_img_emb)
    np.save(str(OUT_HYDE_PROMPT_NPY), hyde_prompt_emb)
    np.save(str(OUT_CAPTION_EMB_NPY), caption_emb)
    OUT_CAPTIONS_JSON.write_text(json.dumps(captions_map))
    OUT_HYDE_IMG_JSON.write_text(json.dumps(hyde_img_map))
    OUT_HYDE_PROMPT_JSON.write_text(json.dumps(hyde_prompt_map))


def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found")
        return

    print("Loading base embeddings...")
    base_emb = np.load(str(TEXT_EMBED_NPY)).astype(np.float32)
    N, D = base_emb.shape
    print(f"  shape: {base_emb.shape}")

    icons = json.loads(ICONS_JSON.read_text())
    id_to_idx = {it["id"]: i for i, it in enumerate(icons)}

    # Load existing eval data (reuse vision outputs already generated)
    eval_cache: dict[str, dict] = {}
    if EVAL_DATA_JSON.exists():
        eval_data = json.loads(EVAL_DATA_JSON.read_text())
        for icon in eval_data.get("icons", []):
            eval_cache[icon["id"]] = icon
        print(f"Pre-loaded {len(eval_cache)} icons from eval_data.json (no re-call needed)")

    # Load checkpoint maps
    captions_map: dict[str, str] = {}
    hyde_img_map: dict[str, list] = {}
    hyde_prompt_map: dict[str, list] = {}

    if OUT_CAPTIONS_JSON.exists():
        captions_map = json.loads(OUT_CAPTIONS_JSON.read_text())
        print(f"Loaded {len(captions_map)} existing captions")
    if OUT_HYDE_IMG_JSON.exists():
        hyde_img_map = json.loads(OUT_HYDE_IMG_JSON.read_text())
        print(f"Loaded {len(hyde_img_map)} existing img hyde queries")
    if OUT_HYDE_PROMPT_JSON.exists():
        hyde_prompt_map = json.loads(OUT_HYDE_PROMPT_JSON.read_text())
        print(f"Loaded {len(hyde_prompt_map)} existing prompt hyde queries")

    # Load existing output matrices or start from base
    hyde_img_emb    = np.load(str(OUT_HYDE_IMG_NPY)).astype(np.float32) if OUT_HYDE_IMG_NPY.exists() else base_emb.copy()
    hyde_prompt_emb = np.load(str(OUT_HYDE_PROMPT_NPY)).astype(np.float32) if OUT_HYDE_PROMPT_NPY.exists() else base_emb.copy()
    caption_emb     = np.load(str(OUT_CAPTION_EMB_NPY)).astype(np.float32) if OUT_CAPTION_EMB_NPY.exists() else base_emb.copy()

    # Eligible icons: have a thumb file
    eligible = [it for it in icons if (THUMB_DIR / f"{it['id']}.png").exists()]
    print(f"\nEligible icons (have thumb): {len(eligible)}")

    spent = 0.0
    n_vision = 0
    n_prompt = 0
    n_embed  = 0

    for i, icon in enumerate(eligible):
        iid  = icon["id"]
        desc = icon["desc"]
        idx  = id_to_idx[iid]
        thumb_path = THUMB_DIR / f"{iid}.png"

        need_vision = iid not in captions_map or iid not in hyde_img_map
        need_prompt = iid not in hyde_prompt_map
        need_cap_embed = iid not in captions_map  # proxy: if we have caption we embedded

        # Budget check before vision call
        if need_vision and (spent + COST_PER_VISION_CALL) > BUDGET_USD:
            print(f"\nBudget limit ${BUDGET_USD} reached at icon {i+1}. Stopping vision calls.")
            need_vision = False
        if need_prompt and (spent + COST_PER_TEXT_GEN_CALL) > BUDGET_USD:
            need_prompt = False

        # ── Vision call (hyde_queries + long_caption) ──────────────────────
        if need_vision:
            if iid in eval_cache:
                # Reuse from eval data (free)
                ed = eval_cache[iid]
                if iid not in hyde_img_map and ed.get("hyde_queries"):
                    hyde_img_map[iid] = ed["hyde_queries"]
                if iid not in captions_map and ed.get("long_caption"):
                    captions_map[iid] = ed["long_caption"]
                need_vision = False  # already have it
            else:
                try:
                    result = gemini_vision_icon(thumb_path, api_key)
                    if result.get("hyde_queries"):
                        hyde_img_map[iid] = result["hyde_queries"]
                    if result.get("long_caption"):
                        captions_map[iid] = result["long_caption"]
                    spent += COST_PER_VISION_CALL
                    n_vision += 1
                    time.sleep(0.4)
                except Exception as e:
                    print(f"  [warn] vision failed for {iid}: {e}")

        # ── Prompt-only hyde queries ────────────────────────────────────────
        if need_prompt:
            if iid in eval_cache and eval_cache[iid].get("hyde_queries"):
                # Reuse hyde_queries from eval as reasonable proxy
                hyde_prompt_map[iid] = eval_cache[iid]["hyde_queries"]
            else:
                try:
                    pq = gemini_prompt_queries(desc, api_key)
                    hyde_prompt_map[iid] = pq
                    spent += COST_PER_TEXT_GEN_CALL
                    n_prompt += 1
                    time.sleep(0.25)
                except Exception as e:
                    print(f"  [warn] prompt query gen failed for {iid}: {e}")

        # ── Embed hyde_from_img ─────────────────────────────────────────────
        if iid in hyde_img_map and np.array_equal(hyde_img_emb[idx], base_emb[idx]):
            avg = embed_queries_avg(hyde_img_map[iid], api_key)
            if avg is not None:
                hyde_img_emb[idx] = avg
                spent += COST_PER_EMBED_CALL * len(hyde_img_map[iid])
                n_embed += len(hyde_img_map[iid])

        # ── Embed hyde_from_prompt ──────────────────────────────────────────
        if iid in hyde_prompt_map and np.array_equal(hyde_prompt_emb[idx], base_emb[idx]):
            avg = embed_queries_avg(hyde_prompt_map[iid], api_key)
            if avg is not None:
                hyde_prompt_emb[idx] = avg
                spent += COST_PER_EMBED_CALL * len(hyde_prompt_map[iid])
                n_embed += len(hyde_prompt_map[iid])

        # ── Embed caption ───────────────────────────────────────────────────
        if iid in captions_map and np.array_equal(caption_emb[idx], base_emb[idx]):
            try:
                vec = embed_text(captions_map[iid], api_key)
                caption_emb[idx] = vec
                spent += COST_PER_EMBED_CALL
                n_embed += 1
                time.sleep(0.10)
            except Exception as e:
                print(f"  [warn] caption embed failed for {iid}: {e}")

        if (i + 1) % 50 == 0:
            save_all(hyde_img_emb, hyde_prompt_emb, caption_emb,
                     captions_map, hyde_img_map, hyde_prompt_map)
            print(f"[{i+1}/{len(eligible)}] checkpoint — spent ~${spent:.2f} | "
                  f"vision={n_vision} prompt={n_prompt} embeds={n_embed}")

        if spent > BUDGET_USD:
            print(f"\nBudget ${BUDGET_USD} exceeded (${spent:.2f}). Saving and stopping.")
            break

    # Final save
    save_all(hyde_img_emb, hyde_prompt_emb, caption_emb,
             captions_map, hyde_img_map, hyde_prompt_map)

    # Count how many rows were actually updated vs fallback to text_emb
    img_updated    = sum(1 for i, it in enumerate(icons) if not np.array_equal(hyde_img_emb[i], base_emb[i]))
    prompt_updated = sum(1 for i, it in enumerate(icons) if not np.array_equal(hyde_prompt_emb[i], base_emb[i]))
    cap_updated    = sum(1 for i, it in enumerate(icons) if not np.array_equal(caption_emb[i], base_emb[i]))

    print(f"\n=== Backfill complete ===")
    print(f"  Estimated spend: ${spent:.3f}")
    print(f"  Vision calls:   {n_vision}")
    print(f"  Prompt calls:   {n_prompt}")
    print(f"  Embed calls:    {n_embed}")
    print(f"  hyde_from_img    rows updated: {img_updated}/{len(icons)}")
    print(f"  hyde_from_prompt rows updated: {prompt_updated}/{len(icons)}")
    print(f"  caption_embed    rows updated: {cap_updated}/{len(icons)}")
    print(f"\nOutputs:")
    for p in [OUT_HYDE_IMG_NPY, OUT_HYDE_PROMPT_NPY, OUT_CAPTION_EMB_NPY]:
        if p.exists():
            print(f"  {p}  ({p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
