"""
ie_caption_sample_gemini.py
----------------------------
Run Gemini Vision captioning on the same 10 sample icons used in ie_caption_sample.py.
Saves results to ie_data/caption_sample_gemini.json for comparison with BLIP results.

Run from recipe-lanes/:
    python3 scripts/ie_caption_sample_gemini.py
"""

import base64
import json
import os
import time
import urllib.request
from pathlib import Path

_IE_DATA = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
THUMB_DIR = _IE_DATA / "icons" / "thumb"
OUTPUT_PATH = _IE_DATA / "caption_sample_gemini.json"
GEMINI_MODEL = "gemini-2.5-flash"

SELECTED_ICONS = [
    {"id": "032b5859", "desc": "Sliced Chicken Pot Pie"},
    {"id": "7c99edb8", "desc": "Oven Preheating"},
    {"id": "73e91d5d", "desc": "Beef Wellington Wrapped In Pastry"},
    {"id": "0cb610d0", "desc": "Shredded Chicken"},
    {"id": "e1c59db0", "desc": "Layer Of Cream Mixture Over Biscuits"},
    {"id": "55e6f74e", "desc": "Shepherd's Pie Assembled In Baking Dish"},
    {"id": "34022d7a", "desc": "Fried Golden Brown Chicken Pieces On A Wire Rack Or Paper Towel-lined Plate"},
    {"id": "e8865b59", "desc": "Golden Brown Baked Apple Pie In Pie Plate"},
    {"id": "d339c1e6", "desc": "Garnished Crispy Rice Salad"},
    {"id": "60fd5256", "desc": "Pot With Clearer Broth"},
]

PROMPT = (
    "Describe this food/recipe icon in 1-2 sentences. Focus on: what food or cooking "
    "action is shown, key visual details (colours, textures, shapes, ingredients visible). "
    "Be specific and concrete. Reply with the description only."
)


def load_api_key() -> str:
    for candidate in [Path(".env"), Path(__file__).parent.parent / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == "GEMINI_API_KEY":
                        return v.strip()
    return os.environ.get("GEMINI_API_KEY", "")


def caption_image(image_path: Path, api_key: str) -> str:
    image_bytes = image_path.read_bytes()
    image_b64 = base64.b64encode(image_bytes).decode()

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
    )
    body = json.dumps({
        "contents": [{
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": "image/png", "data": image_b64}},
            ]
        }]
    }).encode()

    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    return d["candidates"][0]["content"]["parts"][0]["text"].strip()


def main():
    api_key = load_api_key()
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in .env")
        return

    results = []
    total_caption_time = 0.0
    t_start = time.time()

    for icon in SELECTED_ICONS:
        icon_id = icon["id"]
        orig_desc = icon["desc"]
        thumb_path = THUMB_DIR / f"{icon_id}.png"

        if not thumb_path.exists():
            print(f"[MISSING] {icon_id}")
            results.append({"id": icon_id, "original_desc": orig_desc, "caption": "ERROR: thumbnail not found", "caption_time_s": None})
            continue

        t1 = time.time()
        try:
            caption = caption_image(thumb_path, api_key)
        except Exception as e:
            caption = f"ERROR: {e}"
        elapsed = time.time() - t1
        total_caption_time += elapsed

        print(f"ID:       {icon_id}")
        print(f"Original: {orig_desc}")
        print(f"Caption:  {caption}")
        print(f"Time:     {elapsed:.2f}s")
        print()

        results.append({"id": icon_id, "original_desc": orig_desc, "caption": caption, "caption_time_s": round(elapsed, 3)})
        time.sleep(0.3)  # stay within free-tier rate limits

    total_time = time.time() - t_start
    output = {
        "model": GEMINI_MODEL,
        "total_caption_time_s": round(total_caption_time, 1),
        "total_time_s": round(total_time, 1),
        "results": results,
    }
    OUTPUT_PATH.write_text(json.dumps(output, indent=2))
    print(f"Results saved to {OUTPUT_PATH}")
    print(f"Total: {total_time:.1f}s  (captioning: {total_caption_time:.1f}s)")


if __name__ == "__main__":
    main()
