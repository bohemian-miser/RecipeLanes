"""
ie_06_hyde_queries.py
----------------------
Generate HyDE (Hypothetical Document Embedding) search queries for all icons
in the RecipeLanes dataset using Gemini Vision.

For each icon with an image, calls Gemini Vision to produce 6 short search queries
that a user might type to find that icon. Results are cached incrementally to
ie_data/hyde_queries.json so the script can be safely interrupted and resumed.

Run from recipe-lanes/:
    python3 scripts/ie_06_hyde_queries.py
"""

import base64
import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
SCRIPT_DIR   = Path(__file__).parent
DATA_DIR     = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON   = DATA_DIR / "action-icons.json"
THUMB_DIR    = DATA_DIR / "icons" / "thumb"
OUTPUT_PATH  = DATA_DIR / "hyde_queries.json"

GEMINI_MODEL = "gemini-2.5-flash"
SLEEP_BETWEEN = 0.5   # seconds — free tier is 10 RPM
SAVE_EVERY    = 50    # save cache every N items
PRINT_EVERY   = 25    # print progress every N items

VISION_PROMPT = (
    "This is a small pixel-art icon used in a recipe app to represent a cooking step or food item. "
    "List exactly 6 short search queries that a user might type into a recipe app to find this icon. "
    "The queries should vary in specificity — some broad, some specific. "
    "Focus on what the image visually shows (food type, cooking method, visual appearance). "
    "Reply with a JSON array of strings only, no other text."
)

DESC_ONLY_PROMPT_TEMPLATE = (
    "An icon in a recipe app is described as: \"{desc}\". "
    "List exactly 6 short search queries that a user might type into a recipe app to find this icon. "
    "The queries should vary in specificity — some broad, some specific. "
    "Focus on what the description implies visually (food type, cooking method, visual appearance). "
    "Reply with a JSON array of strings only, no other text."
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_api_key() -> str:
    for candidate in [Path(".env"), SCRIPT_DIR.parent / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == "GEMINI_API_KEY":
                        return v.strip()
    return os.environ.get("GEMINI_API_KEY", "")


def call_gemini(body: dict, api_key: str, timeout: int = 60) -> list[str]:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    return json.loads(raw)


def get_queries_vision(image_path: Path, api_key: str) -> list[str]:
    image_b64 = base64.b64encode(image_path.read_bytes()).decode()
    body = {
        "contents": [{
            "parts": [
                {"text": VISION_PROMPT},
                {"inline_data": {"mime_type": "image/png", "data": image_b64}},
            ]
        }],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    return call_gemini(body, api_key)


def get_queries_desc_only(desc: str, api_key: str) -> list[str]:
    prompt = DESC_ONLY_PROMPT_TEMPLATE.format(desc=desc)
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    return call_gemini(body, api_key)


def load_cache() -> dict:
    if OUTPUT_PATH.exists():
        try:
            return json.loads(OUTPUT_PATH.read_text())
        except Exception as e:
            print(f"[WARN] Could not load existing cache: {e}")
    return {}


def save_cache(cache: dict) -> None:
    OUTPUT_PATH.write_text(json.dumps(cache, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in .env or environment")
        return

    # Load all icons
    all_icons = json.loads(ICONS_JSON.read_text())
    icons_with_url = [x for x in all_icons if x.get("iconUrl")]
    print(f"Total icons: {len(all_icons)}")
    print(f"Icons with image (iconUrl != null): {len(icons_with_url)}")

    # Load existing cache
    cache = load_cache()
    already_done = len(cache)
    print(f"Already in cache: {already_done}")

    to_process = [x for x in icons_with_url if x["id"] not in cache]
    print(f"Remaining to process: {len(to_process)}")

    if not to_process:
        print("Nothing to do — all icons already processed.")
        return

    # Estimate time
    estimated_s = len(to_process) * (SLEEP_BETWEEN + 1.5)  # ~1.5s avg API latency
    print(f"Estimated completion time: ~{estimated_s / 60:.0f} min")
    print()

    t_run_start = time.time()
    processed_this_run = 0
    errors = 0
    unsaved_since_last = 0

    for i, icon in enumerate(to_process):
        icon_id  = icon["id"]
        desc     = icon.get("desc", "")
        thumb    = THUMB_DIR / f"{icon_id}.png"

        t0 = time.time()
        source = "vision"
        queries = []

        try:
            if thumb.exists():
                queries = get_queries_vision(thumb, api_key)
                source = "vision"
            else:
                print(f"  [no-thumb] {icon_id} — falling back to description-only")
                queries = get_queries_desc_only(desc, api_key)
                source = "desc_only"
        except urllib.error.HTTPError as e:
            body_text = e.read().decode(errors="replace") if hasattr(e, "read") else ""
            print(f"  [HTTP {e.code}] {icon_id}: {e.reason} — {body_text[:200]}")
            errors += 1
            # Back off on rate-limit errors
            if e.code in (429, 503):
                print("  [rate-limit] sleeping 30s …")
                time.sleep(30)
            time.sleep(SLEEP_BETWEEN)
            continue
        except Exception as e:
            print(f"  [ERROR] {icon_id}: {e}")
            errors += 1
            time.sleep(SLEEP_BETWEEN)
            continue

        elapsed = time.time() - t0

        cache[icon_id] = {"queries": queries, "source": source}
        processed_this_run += 1
        unsaved_since_last += 1

        # Progress print
        total_done = already_done + processed_this_run
        if processed_this_run % PRINT_EVERY == 0:
            pct = total_done / len(icons_with_url) * 100
            elapsed_run = time.time() - t_run_start
            rate = processed_this_run / elapsed_run  # items/sec
            remaining = len(to_process) - processed_this_run
            eta_s = remaining / rate if rate > 0 else 0
            print(
                f"[{total_done}/{len(icons_with_url)}] {pct:.1f}%  "
                f"errors={errors}  rate={rate:.2f}/s  ETA={eta_s/60:.1f}min"
            )
            print(f"  Last: {icon_id} ({source}, {elapsed:.2f}s): {queries[:2]} …")

        # Incremental save
        if unsaved_since_last >= SAVE_EVERY:
            save_cache(cache)
            unsaved_since_last = 0

        time.sleep(SLEEP_BETWEEN)

    # Final save
    save_cache(cache)

    total_elapsed = time.time() - t_run_start
    print()
    print("=" * 60)
    print(f"Done. Processed {processed_this_run} icons in {total_elapsed/60:.1f} min")
    print(f"Total in cache: {len(cache)}")
    print(f"Errors this run: {errors}")
    print(f"Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
