"""
ie_eval_01_generate.py
-----------------------
Generate evaluation data for 100 random icons with images.

For each icon:
  - One Gemini Vision call returning 6 fields as JSON (query_1, query_2, long_caption,
    tags, hyde_queries, one_liner)
  - Two BLIP captions (unconditional and conditional)

Saves incrementally to scripts/ie_data/eval_data.json every 10 icons.

Run from recipe-lanes/:
    python3 scripts/ie_eval_01_generate.py
"""

import base64
import json
import os
import random
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON = BASE / "action-icons.json"
THUMB_DIR = BASE / "icons" / "thumb"
OUTPUT_PATH = BASE / "eval_data.json"

GEMINI_MODEL = "gemini-2.5-flash"
BLIP_MODEL_NAME = "Salesforce/blip-image-captioning-base"

NUM_ICONS = 100
SEED = 42
CHECKPOINT_EVERY = 10


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
# Gemini Vision call
# ---------------------------------------------------------------------------

GEMINI_PROMPT = (
    'This is a recipe app icon. Return a JSON object with exactly these 6 fields:\n'
    '- query_1: a natural search query someone might type to find this icon (10-20 words, describe what you see)\n'
    '- query_2: a different search query from another angle (10-20 words, focus on different aspects)\n'
    '- long_caption: detailed 2-3 sentence visual description for indexing (mention colors, shapes, ingredients, cooking method)\n'
    '- tags: array of 8 keyword tags\n'
    '- hyde_queries: array of 6 short search terms (2-5 words each) varying from broad to specific\n'
    '- one_liner: 3-5 word description\n'
    'Return only the JSON object, no other text.'
)


def gemini_vision_call(image_path: Path, api_key: str) -> dict:
    image_bytes = image_path.read_bytes()
    image_b64 = base64.b64encode(image_bytes).decode()

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
    )
    body = json.dumps({
        "contents": [{
            "parts": [
                {"text": GEMINI_PROMPT},
                {"inline_data": {"mime_type": "image/png", "data": image_b64}},
            ]
        }],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()

    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    raw = d["candidates"][0]["content"]["parts"][0]["text"].strip()
    return json.loads(raw)


# ---------------------------------------------------------------------------
# BLIP captioning
# ---------------------------------------------------------------------------

def load_blip():
    from transformers import BlipProcessor, BlipForConditionalGeneration
    import torch

    print(f"Loading BLIP model: {BLIP_MODEL_NAME}")
    t0 = time.time()
    processor = BlipProcessor.from_pretrained(BLIP_MODEL_NAME)
    model = BlipForConditionalGeneration.from_pretrained(BLIP_MODEL_NAME)
    model.eval()
    print(f"BLIP loaded in {time.time() - t0:.1f}s")
    return processor, model


def blip_caption(image_path: Path, processor, model, prompt: str | None = None) -> str:
    import torch
    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    if prompt:
        inputs = processor(image, text=prompt, return_tensors="pt")
    else:
        inputs = processor(image, return_tensors="pt")
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=60)
    caption = processor.decode(out[0], skip_special_tokens=True)
    # If conditional, strip the prompt prefix from the output
    if prompt and caption.startswith(prompt):
        caption = caption[len(prompt):].strip()
    return caption


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------

def load_checkpoint() -> dict:
    """Load existing eval_data.json if present, return as {id: icon_data}."""
    if OUTPUT_PATH.exists():
        data = json.loads(OUTPUT_PATH.read_text())
        icons = data.get("icons", [])
        print(f"[checkpoint] Loaded {len(icons)} existing icons from {OUTPUT_PATH}")
        return {icon["id"]: icon for icon in icons}
    return {}


def save_checkpoint(done_map: dict, selected_ids: list):
    """Save current progress to eval_data.json in selection order."""
    icons_list = [done_map[iid] for iid in selected_ids if iid in done_map]
    OUTPUT_PATH.write_text(json.dumps({"icons": icons_list}, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in .env")
        return

    # Load icons list
    icons = json.loads(ICONS_JSON.read_text())
    print(f"Loaded {len(icons)} icons")

    # Filter to eligible: iconUrl not null AND thumb exists
    eligible = [
        icon for icon in icons
        if icon.get("iconUrl") and (THUMB_DIR / f"{icon['id']}.png").exists()
    ]
    print(f"Eligible icons (iconUrl + thumb): {len(eligible)}")

    # Pick 100 random icons deterministically
    rng = random.Random(SEED)
    selected = rng.sample(eligible, NUM_ICONS)
    selected_ids = [icon["id"] for icon in selected]
    print(f"Selected {len(selected)} icons (seed={SEED})")

    # Load checkpoint
    done_map = load_checkpoint()
    already_done = sum(1 for iid in selected_ids if iid in done_map)
    print(f"Already processed: {already_done}/{NUM_ICONS}")

    # Load BLIP (needed for all icons not yet done)
    remaining = [s for s in selected if s["id"] not in done_map]
    blip_processor = blip_model = None
    if remaining:
        blip_processor, blip_model = load_blip()

    # Process icons
    since_checkpoint = 0
    total = len(selected)

    for i, icon in enumerate(selected):
        icon_id = icon["id"]
        if icon_id in done_map:
            print(f"[{i+1}/{total}] {icon_id} — skipping (already done)")
            continue

        thumb_path = THUMB_DIR / f"{icon_id}.png"
        print(f"[{i+1}/{total}] {icon_id} — {icon['desc']}")

        # --- Gemini Vision ---
        t1 = time.time()
        try:
            gemini_data = gemini_vision_call(thumb_path, api_key)
        except Exception as e:
            print(f"  [ERROR] Gemini Vision failed: {e}")
            gemini_data = {
                "query_1": f"ERROR: {e}",
                "query_2": "",
                "long_caption": "",
                "tags": [],
                "hyde_queries": [],
                "one_liner": "",
            }
        gemini_elapsed = time.time() - t1
        print(f"  Gemini: {gemini_elapsed:.1f}s | query_1: {gemini_data.get('query_1', '')[:60]}")

        # --- BLIP unconditional ---
        t2 = time.time()
        try:
            blip_unconditional = blip_caption(thumb_path, blip_processor, blip_model, prompt=None)
        except Exception as e:
            blip_unconditional = f"ERROR: {e}"
        print(f"  BLIP unconditional: {blip_unconditional[:60]}")

        # --- BLIP conditional ---
        try:
            blip_conditional = blip_caption(
                thumb_path, blip_processor, blip_model,
                prompt="a photo of food showing"
            )
        except Exception as e:
            blip_conditional = f"ERROR: {e}"
        blip_elapsed = time.time() - t2
        print(f"  BLIP conditional:   {blip_conditional[:60]} ({blip_elapsed:.1f}s)")

        # --- Store result ---
        done_map[icon_id] = {
            "id": icon_id,
            "desc": icon["desc"],
            "query_1": gemini_data.get("query_1", ""),
            "query_2": gemini_data.get("query_2", ""),
            "long_caption": gemini_data.get("long_caption", ""),
            "tags": gemini_data.get("tags", []),
            "hyde_queries": gemini_data.get("hyde_queries", []),
            "one_liner": gemini_data.get("one_liner", ""),
            "blip_unconditional": blip_unconditional,
            "blip_conditional": blip_conditional,
        }

        since_checkpoint += 1

        # Checkpoint every N icons
        if since_checkpoint >= CHECKPOINT_EVERY:
            save_checkpoint(done_map, selected_ids)
            print(f"  [checkpoint] Saved {len(done_map)} icons to {OUTPUT_PATH}")
            since_checkpoint = 0

        # Rate limit between Gemini Vision calls
        time.sleep(0.5)

    # Final save
    save_checkpoint(done_map, selected_ids)
    final_count = sum(1 for iid in selected_ids if iid in done_map)
    print(f"\nDone. {final_count}/{NUM_ICONS} icons written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
