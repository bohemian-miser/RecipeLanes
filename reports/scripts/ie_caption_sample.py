"""
BLIP captioning sample on 10 recipe action node icons.
Uses Salesforce/blip-image-captioning-base (fast, small).
"""

import json
import time
import os

# Selected icon IDs and descriptions
SELECTED_ICONS = [
    # The chicken pot pie icon (our key test case)
    {"id": "032b5859", "desc": "Sliced Chicken Pot Pie"},
    # 9 diverse icons across different food types / actions
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

_IE_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'recipe-lanes', 'scripts', 'ie_data')
THUMB_DIR = os.path.join(_IE_DATA, "icons", "thumb")
OUTPUT_PATH = os.path.join(_IE_DATA, "caption_sample_blip.json")

MODEL_NAME = "Salesforce/blip-image-captioning-base"


def main():
    print(f"Loading model: {MODEL_NAME}")
    t0 = time.time()

    from transformers import BlipProcessor, BlipForConditionalGeneration
    from PIL import Image
    import torch

    processor = BlipProcessor.from_pretrained(MODEL_NAME)
    model = BlipForConditionalGeneration.from_pretrained(MODEL_NAME)
    model.eval()

    load_time = time.time() - t0
    print(f"Model loaded in {load_time:.1f}s\n")

    results = []
    total_caption_time = 0.0

    for icon in SELECTED_ICONS:
        icon_id = icon["id"]
        orig_desc = icon["desc"]
        thumb_path = os.path.join(THUMB_DIR, f"{icon_id}.png")

        if not os.path.exists(thumb_path):
            print(f"[MISSING] {icon_id} — {orig_desc}")
            results.append({
                "id": icon_id,
                "original_desc": orig_desc,
                "caption": "ERROR: thumbnail not found",
                "caption_time_s": None,
            })
            continue

        image = Image.open(thumb_path).convert("RGB")

        t1 = time.time()
        inputs = processor(image, return_tensors="pt")
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=50)
        caption = processor.decode(out[0], skip_special_tokens=True)
        elapsed = time.time() - t1
        total_caption_time += elapsed

        print(f"ID:       {icon_id}")
        print(f"Original: {orig_desc}")
        print(f"Caption:  {caption}")
        print(f"Time:     {elapsed:.2f}s")
        print()

        results.append({
            "id": icon_id,
            "original_desc": orig_desc,
            "caption": caption,
            "caption_time_s": round(elapsed, 3),
        })

    total_time = time.time() - t0
    summary = {
        "model": MODEL_NAME,
        "model_load_time_s": round(load_time, 1),
        "total_caption_time_s": round(total_caption_time, 1),
        "total_time_s": round(total_time, 1),
        "results": results,
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"Results saved to {OUTPUT_PATH}")
    print(f"Total time: {total_time:.1f}s  (model load: {load_time:.1f}s, captioning: {total_caption_time:.1f}s)")


if __name__ == "__main__":
    main()
