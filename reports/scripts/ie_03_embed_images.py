"""
ie_03_embed_images.py
---------------------
Create 128×128 display thumbnails from raw downloaded icons, and generate
pixel-based image embeddings (or CLIP embeddings if torch + transformers
are available).

Run from recipe-lanes/ with:
    python3 scripts/ie_03_embed_images.py

Inputs:
  scripts/ie_data/action-icons.json          — array of {idx, id, desc, count, iconUrl, rawFile}
  scripts/ie_data/icons/raw/{id}.png         — raw PNGs downloaded by step 01

Outputs:
  scripts/ie_data/icons/thumb/{id}.png       — 128×128 RGBA PNG thumbnails
  scripts/ie_data/image_embed_cache.json     — {id: [float, ...]} (4096-dim pixel vector,
                                               or 768-dim if SigLIP2 is used)
  scripts/ie_data/image_embeddings.npy       — float32 shape (N, embed_dim), row i = item i
  scripts/ie_data/image_embed_method.txt     — notes which method was used (pixel or SigLIP2)
"""

import json
import os
import sys

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Paths — ie_data lives in recipe-lanes/scripts/ie_data (not moved with this script)
# ---------------------------------------------------------------------------
SCRIPTS_DIR      = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'recipe-lanes', 'scripts')
IE_DATA_DIR      = os.path.join(SCRIPTS_DIR, 'ie_data')
ICONS_DIR        = os.path.join(IE_DATA_DIR, 'icons')
RAW_DIR          = os.path.join(ICONS_DIR, 'raw')
THUMB_DIR        = os.path.join(ICONS_DIR, 'thumb')
ACTION_ICONS_JSON = os.path.join(IE_DATA_DIR, 'action-icons.json')
EMBED_CACHE_JSON  = os.path.join(IE_DATA_DIR, 'image_embed_cache.json')
EMBEDDINGS_NPY    = os.path.join(IE_DATA_DIR, 'image_embeddings.npy')
METHOD_TXT        = os.path.join(IE_DATA_DIR, 'image_embed_method.txt')

THUMB_SIZE  = 128
PIXEL_SIZE  = 32          # 32×32 → 4096-dim vector
PIXEL_DIM   = PIXEL_SIZE * PIXEL_SIZE * 4   # RGBA: 32*32*4 = 4096
PRINT_EVERY = 100

# ---------------------------------------------------------------------------
# Attempt to load SigLIP2
# ---------------------------------------------------------------------------
USE_CLIP       = False
CLIP_DIM       = 768
clip_model     = None
clip_processor = None
clip_device    = 'cpu'

try:
    import torch
    from transformers import AutoModel, AutoProcessor

    print('torch and transformers found — attempting to load SigLIP2 model...')
    clip_model     = AutoModel.from_pretrained('google/siglip2-base-patch16-224')
    clip_processor = AutoProcessor.from_pretrained('google/siglip2-base-patch16-224')
    clip_model.eval()
    clip_device = 'cuda' if torch.cuda.is_available() else 'cpu'
    clip_model  = clip_model.to(clip_device)
    USE_CLIP = True
    print(f'SigLIP2 loaded successfully — running on: {clip_device}')
except ImportError:
    print('torch / transformers not available — using pixel embeddings (4096-dim).')
except Exception as e:
    print(f'SigLIP2 load failed ({e}) — falling back to pixel embeddings.')


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_pixel_embed(img: Image.Image) -> np.ndarray:
    """Resize to 32×32 RGBA, flatten to 4096 floats, divide by 255, L2-normalise."""
    small = img.resize((PIXEL_SIZE, PIXEL_SIZE), Image.LANCZOS)
    arr   = np.array(small, dtype=np.float32).flatten() / 255.0   # shape (4096,)
    norm  = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm
    return arr


def make_clip_embed(img: Image.Image) -> np.ndarray:
    """Return a 768-dim SigLIP2 image embedding (L2-normalised)."""
    import torch  # already confirmed importable at this point
    img_rgb = img.convert('RGB')
    inputs = clip_processor(images=img_rgb, return_tensors='pt').to(clip_device)
    with torch.no_grad():
        out = clip_model.get_image_features(**inputs)
        # SigLIP2 get_image_features returns BaseModelOutputWithPooling, not a raw tensor
        if isinstance(out, torch.Tensor):
            image_features = out
        else:
            image_features = out.pooler_output
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    return image_features.cpu().numpy()[0]  # shape (768,)


def embed_dim() -> int:
    return CLIP_DIM if USE_CLIP else PIXEL_DIM


# ---------------------------------------------------------------------------
# Ensure output directories exist
# ---------------------------------------------------------------------------
os.makedirs(THUMB_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Load action-icons.json
# ---------------------------------------------------------------------------
if not os.path.exists(ACTION_ICONS_JSON):
    print(f'ERROR: {ACTION_ICONS_JSON} not found. Run ie_01 first.')
    sys.exit(1)

with open(ACTION_ICONS_JSON, 'r') as f:
    items = json.load(f)

print(f'Loaded {len(items)} items from action-icons.json')
n_with_raw = sum(1 for it in items if it.get('rawFile'))
print(f'  Items with rawFile set: {n_with_raw}')

# ---------------------------------------------------------------------------
# Load existing embed cache
# ---------------------------------------------------------------------------
if os.path.exists(EMBED_CACHE_JSON):
    with open(EMBED_CACHE_JSON, 'r') as f:
        embed_cache: dict = json.load(f)
    print(f'Loaded image embed cache: {len(embed_cache)} entries')
else:
    embed_cache = {}
    print('No existing image embed cache — starting fresh.')

# ---------------------------------------------------------------------------
# Process each item: thumbnails + embeddings
# ---------------------------------------------------------------------------
processed = 0
skipped_thumb = 0
skipped_embed = 0
zeros_embed   = 0

for i, item in enumerate(items):
    item_id  = item.get('id', str(i))
    raw_file = item.get('rawFile')

    raw_path   = os.path.join(RAW_DIR,   f'{item_id}.png') if raw_file else None
    thumb_path = os.path.join(THUMB_DIR, f'{item_id}.png')

    has_raw = raw_path is not None and os.path.exists(raw_path)

    # -- Thumbnail ----------------------------------------------------------
    if has_raw:
        if os.path.exists(thumb_path):
            skipped_thumb += 1
        else:
            try:
                img = Image.open(raw_path).convert('RGBA')
                thumb = img.resize((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
                thumb.save(thumb_path)
            except Exception as e:
                print(f'  [WARN] Thumbnail failed for {item_id}: {e}')
                has_raw = False   # treat as missing for embedding too

    # -- Embedding ----------------------------------------------------------
    if item_id in embed_cache:
        skipped_embed += 1
    else:
        if has_raw:
            try:
                img = Image.open(raw_path).convert('RGBA')
                if USE_CLIP:
                    vec = make_clip_embed(img)
                else:
                    vec = make_pixel_embed(img)
                embed_cache[item_id] = vec.tolist()
            except Exception as e:
                print(f'  [WARN] Embed failed for {item_id}: {e}')
                embed_cache[item_id] = np.zeros(embed_dim(), dtype=np.float32).tolist()
                zeros_embed += 1
        else:
            embed_cache[item_id] = np.zeros(embed_dim(), dtype=np.float32).tolist()
            zeros_embed += 1

    processed += 1
    if processed % PRINT_EVERY == 0:
        print(f'  Processed {processed}/{len(items)} items ...')

print(f'\nDone processing {processed} items.')
print(f'  Thumbnails skipped (already existed): {skipped_thumb}')
print(f'  Embeddings skipped (already in cache): {skipped_embed}')
print(f'  Zero-vector embeddings (no raw file): {zeros_embed}')

# ---------------------------------------------------------------------------
# Save embed cache
# ---------------------------------------------------------------------------
with open(EMBED_CACHE_JSON, 'w') as f:
    json.dump(embed_cache, f)
print(f'Embed cache saved to {EMBED_CACHE_JSON} ({len(embed_cache)} entries)')

# ---------------------------------------------------------------------------
# Build image_embeddings.npy aligned to action-icons.json order
# ---------------------------------------------------------------------------
dim = embed_dim()
rows = []
for item in items:
    item_id = item.get('id', '')
    if item_id in embed_cache:
        vec = np.array(embed_cache[item_id], dtype=np.float32)
    else:
        vec = np.zeros(dim, dtype=np.float32)
    rows.append(vec)

image_embeddings = np.array(rows, dtype=np.float32)
np.save(EMBEDDINGS_NPY, image_embeddings)
print(f'Saved image_embeddings.npy — shape: {image_embeddings.shape}')

# ---------------------------------------------------------------------------
# Write method note
# ---------------------------------------------------------------------------
method_str = (
    f'SigLIP2 (google/siglip2-base-patch16-224, device={clip_device}) — 768-dim vectors'
    if USE_CLIP else
    f'Pixel (32x32 RGBA flatten + L2-normalise) — {PIXEL_DIM}-dim vectors'
)
with open(METHOD_TXT, 'w') as f:
    f.write(method_str + '\n')
print(f'Method: {method_str}')
print(f'Method note saved to {METHOD_TXT}')
