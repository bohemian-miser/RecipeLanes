# Cell 1 — Install dependencies
# Run this once; restart the kernel after if installing fresh

# Cell 2 — Config
import os

# ---------------------------------------------------------------
# Paths — adjust if running from a different working directory
# or upload these files to Colab and update accordingly.
# ---------------------------------------------------------------

# When running locally from recipe-lanes/ directory:
_SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '')

# Detect if we're in Colab
try:
    import google.colab  # type: ignore
    _IN_COLAB = True
    # On Colab: upload action-icon-data.json and .action-embeddings-cache.json
    # then set these paths to wherever you uploaded them.
    DATA_PATH             = 'action-icon-data.json'
    TEXT_EMBED_CACHE_PATH = '.action-embeddings-cache.json'
    IMAGE_EMBED_CACHE_PATH = '.action-image-embeddings-cache.npy'
    OUTPUT_HTML           = 'action_icon_explorer.html'
except ImportError:
    _IN_COLAB = False
    # Local paths relative to the recipe-lanes/ project root
    DATA_PATH             = 'scripts/action-icon-data.json'
    TEXT_EMBED_CACHE_PATH = 'scripts/.action-embeddings-cache.json'
    IMAGE_EMBED_CACHE_PATH = 'scripts/.action-image-embeddings-cache.npy'
    OUTPUT_HTML           = 'scripts/action_icon_explorer.html'

# Gemini API key — only needed if text embedding cache has missing entries
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

print(f'Running in Colab: {_IN_COLAB}')
print(f'DATA_PATH:             {DATA_PATH}')
print(f'TEXT_EMBED_CACHE_PATH: {TEXT_EMBED_CACHE_PATH}')
print(f'OUTPUT_HTML:           {OUTPUT_HTML}')
print(f'GEMINI_API_KEY set:    {bool(GEMINI_API_KEY)}')

# Cell 3 — Load action-icon data
import json

with open(DATA_PATH, 'r') as f:
    raw_data = json.load(f)

# raw_data is a list of {desc: str, count: int, iconUrl: str | null}
print(f'Total unique descriptions: {len(raw_data)}')

n_with_icon = sum(1 for item in raw_data if item.get('iconUrl'))
n_no_icon   = len(raw_data) - n_with_icon
print(f'  With iconUrl:  {n_with_icon}')
print(f'  Without icon:  {n_no_icon}')

total_count = sum(item.get('count', 1) for item in raw_data)
print(f'Total action node occurrences: {total_count}')

# If the dataset is very large, cap at top-2000 by count for performance
MAX_ITEMS = 2500
if len(raw_data) > MAX_ITEMS:
    print(f'\nDataset has {len(raw_data)} items — sampling top {MAX_ITEMS - 500} by count for performance.')
    raw_data = sorted(raw_data, key=lambda x: x.get('count', 1), reverse=True)[:MAX_ITEMS - 500]
    print(f'Retained {len(raw_data)} items.')

# Convenience lists
descriptions = [item['desc']     for item in raw_data]
counts       = [item.get('count', 1) for item in raw_data]
icon_urls    = [item.get('iconUrl')  for item in raw_data]

print(f'\nSample entries:')
for item in raw_data[:5]:
    print(f'  count={item["count"]:>4}  url={str(item.get("iconUrl",""))[:60]}  desc={item["desc"][:60]}')

# Cell 4 — Text embeddings (Gemini gemini-embedding-001, cached)
import numpy as np
import requests as req_lib

# ------------------------------------------------------------------
# Load the pre-computed TypeScript embedding cache.
# The cache is a JSON object: { "<description>": [float, ...], ... }
# Each vector has 3072 dimensions (gemini-embedding-001 output_dimensionality).
# ------------------------------------------------------------------

try:
    with open(TEXT_EMBED_CACHE_PATH, 'r') as f:
        text_embed_cache: dict = json.load(f)
    print(f'Loaded text embedding cache: {len(text_embed_cache)} entries')
except FileNotFoundError:
    print('WARNING: Text embedding cache not found. All embeddings will be fetched from Gemini API.')
    text_embed_cache = {}


def fetch_gemini_embedding(text: str, api_key: str) -> list:
    """Fetch a single embedding from the Gemini Embedding API."""
    url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={api_key}'
    payload = {
        'model': 'models/gemini-embedding-001',
        'content': {'parts': [{'text': text}]}
    }
    resp = req_lib.post(url, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()['embedding']['values']


# Identify any descriptions not yet cached
missing = [desc for desc in descriptions if desc not in text_embed_cache]
print(f'Descriptions missing from cache: {len(missing)}')

if missing:
    if not GEMINI_API_KEY:
        print('ERROR: Missing descriptions require GEMINI_API_KEY. Set the environment variable and re-run.')
        print('Proceeding with zeros for missing entries (results will be inaccurate).')
        for desc in missing:
            text_embed_cache[desc] = [0.0] * 3072
    else:
        from tqdm.auto import tqdm
        print(f'Fetching {len(missing)} embeddings from Gemini API...')
        for desc in tqdm(missing):
            try:
                text_embed_cache[desc] = fetch_gemini_embedding(desc, GEMINI_API_KEY)
            except Exception as e:
                print(f'  Failed for "{desc[:40]}": {e}')
                text_embed_cache[desc] = [0.0] * 3072
        # Persist updated cache
        with open(TEXT_EMBED_CACHE_PATH, 'w') as f:
            json.dump(text_embed_cache, f)
        print('Updated cache saved.')

# Build the numpy matrix — shape (N, 3072)
text_embeddings = np.array([text_embed_cache[desc] for desc in descriptions], dtype=np.float32)
print(f'\ntext_embeddings shape: {text_embeddings.shape}')

# Cell 5 — Image embeddings via CLIP (openai/clip-vit-base-patch32)
#
# For items WITH an iconUrl: download PNG, resize to 224x224, encode via CLIP image encoder.
# For items WITHOUT an iconUrl: encode the description text via CLIP text encoder as fallback.
# Results cached to IMAGE_EMBED_CACHE_PATH (.npy dict keyed by iconUrl).

import torch
import numpy as np
from PIL import Image
from io import BytesIO
import requests as req_lib
from tqdm.auto import tqdm
from transformers import CLIPProcessor, CLIPModel

print('Loading CLIP model (openai/clip-vit-base-patch32)...')
clip_model     = CLIPModel.from_pretrained('openai/clip-vit-base-patch32')
clip_processor = CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
clip_model.eval()
device = 'cuda' if torch.cuda.is_available() else 'cpu'
clip_model = clip_model.to(device)
print(f'CLIP running on: {device}')

# ------------------------------------------------------------------
# Load existing image embedding cache (keyed by iconUrl string).
# We use a regular Python dict serialised via np.save with allow_pickle.
# ------------------------------------------------------------------
try:
    img_cache_dict: dict = np.load(IMAGE_EMBED_CACHE_PATH, allow_pickle=True).item()
    print(f'Loaded image embedding cache: {len(img_cache_dict)} entries')
except (FileNotFoundError, ValueError):
    img_cache_dict = {}
    print('No existing image embedding cache — starting fresh.')


def download_image(url: str, timeout: int = 15) -> Image.Image | None:
    """Download an image from a URL and return a PIL Image, or None on failure."""
    try:
        resp = req_lib.get(url, timeout=timeout)
        resp.raise_for_status()
        return Image.open(BytesIO(resp.content)).convert('RGB')
    except Exception as e:
        print(f'  Image download failed for {url[:60]}: {e}')
        return None


@torch.no_grad()
def clip_image_embed(pil_img: Image.Image) -> np.ndarray:
    """Return a 512-dim CLIP image embedding (L2-normalised) for a PIL image."""
    inputs = clip_processor(images=pil_img.resize((224, 224)), return_tensors='pt').to(device)
    feats  = clip_model.get_image_features(**inputs)
    feats  = feats / feats.norm(dim=-1, keepdim=True)
    return feats.cpu().numpy()[0]


@torch.no_grad()
def clip_text_embed(text: str) -> np.ndarray:
    """Return a 512-dim CLIP text embedding (L2-normalised) for a string."""
    inputs = clip_processor(text=[text], return_tensors='pt', padding=True, truncation=True).to(device)
    feats  = clip_model.get_text_features(**inputs)
    feats  = feats / feats.norm(dim=-1, keepdim=True)
    return feats.cpu().numpy()[0]


# ------------------------------------------------------------------
# Build embeddings for every item, using the cache where possible.
# Cache key for image items: the iconUrl string.
# Cache key for text-fallback items: '__text__' + description.
# ------------------------------------------------------------------
image_embeddings_list = []
cache_updated = False

for desc, url in tqdm(zip(descriptions, icon_urls), total=len(descriptions), desc='CLIP embeddings'):
    if url:
        cache_key = url
        if cache_key not in img_cache_dict:
            pil_img = download_image(url)
            if pil_img is not None:
                img_cache_dict[cache_key] = clip_image_embed(pil_img)
            else:
                # Image download failed — fall back to text
                img_cache_dict[cache_key] = clip_text_embed(desc)
            cache_updated = True
        image_embeddings_list.append(img_cache_dict[cache_key])
    else:
        cache_key = '__text__' + desc
        if cache_key not in img_cache_dict:
            img_cache_dict[cache_key] = clip_text_embed(desc)
            cache_updated = True
        image_embeddings_list.append(img_cache_dict[cache_key])

if cache_updated:
    np.save(IMAGE_EMBED_CACHE_PATH, img_cache_dict)
    print(f'Image embedding cache updated and saved to {IMAGE_EMBED_CACHE_PATH}')

image_embeddings = np.array(image_embeddings_list, dtype=np.float32)
print(f'\nimage_embeddings shape: {image_embeddings.shape}')

# Cell 6 — UMAP dimensionality reduction (2D projections)
import umap

print('Fitting UMAP on text embeddings (cosine, n_neighbors=15)...')
reducer_text = umap.UMAP(
    n_components=2,
    n_neighbors=15,
    min_dist=0.1,
    metric='cosine',
    random_state=42
)
text_2d = reducer_text.fit_transform(text_embeddings)
print(f'text_2d shape: {text_2d.shape}')

print('Fitting UMAP on image embeddings (cosine, n_neighbors=15)...')
reducer_img = umap.UMAP(
    n_components=2,
    n_neighbors=15,
    min_dist=0.1,
    metric='cosine',
    random_state=42
)
img_2d = reducer_img.fit_transform(image_embeddings)
print(f'img_2d shape:  {img_2d.shape}')

# Cell 7 — K-means clustering (k=25) on text embeddings for colour coding
from sklearn.cluster import KMeans

K = 25
print(f'Running KMeans with k={K} on text embeddings...')
kmeans = KMeans(n_clusters=K, random_state=42, n_init='auto')
cluster_labels = kmeans.fit_predict(text_embeddings)
print(f'cluster_labels shape: {cluster_labels.shape}')

# Show rough cluster sizes
from collections import Counter
cluster_counts = Counter(cluster_labels.tolist())
print('\nCluster sizes (cluster_id: n_items):')
for cid, cnt in sorted(cluster_counts.items()):
    print(f'  Cluster {cid:>2}: {cnt:>4} items')

# Cell 8 — Build interactive Plotly HTML with tab switcher
#
# Each scatter point represents one unique action description.
# Marker colour = cluster id, marker size ∝ log(count).
# Hover shows: description, count, and the icon image (base64 inline).

import base64
import math
import numpy as np
import requests as req_lib
import plotly.graph_objects as go
from io import BytesIO
from PIL import Image
from tqdm.auto import tqdm

# ------------------------------------------------------------------
# Pre-fetch and base64-encode all available icon images.
# This can take a while depending on how many icons there are.
# ------------------------------------------------------------------
print('Pre-fetching icon images for hover tooltips...')

def fetch_icon_b64(url: str, thumb_size: int = 80) -> str:
    """Download icon, thumbnail it, and return as base64 PNG data URI string."""
    try:
        resp = req_lib.get(url, timeout=15)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert('RGBA')
        img.thumbnail((thumb_size, thumb_size), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format='PNG')
        b64 = base64.b64encode(buf.getvalue()).decode('ascii')
        return f'<img src="data:image/png;base64,{b64}" width="{thumb_size}">'
    except Exception:
        return ''  # No image on failure

# Cache b64 images in memory (keyed by url)
b64_cache: dict[str, str] = {}
unique_urls = list({u for u in icon_urls if u})
for url in tqdm(unique_urls, desc='Fetching icon thumbnails'):
    b64_cache[url] = fetch_icon_b64(url)

# Build customdata array: [description, count, img_html_or_empty]
custom_data = [
    [desc, cnt, b64_cache.get(url, '') if url else '']
    for desc, cnt, url in zip(descriptions, counts, icon_urls)
]

print(f'Done. Icons fetched: {sum(1 for v in b64_cache.values() if v)}/{len(unique_urls)}')


# ------------------------------------------------------------------
# Marker sizing: log scale, clamped between 4 and 16
# ------------------------------------------------------------------
def size_from_count(cnt: int, min_size: float = 4.0, max_size: float = 16.0) -> float:
    log_cnt = math.log1p(cnt)  # log(1 + count) so count=0 → 0
    return min_size + log_cnt  # grows with log; we'll normalise below

raw_sizes = np.array([size_from_count(c) for c in counts], dtype=float)
# Normalise to [4, 16]
s_min, s_max = raw_sizes.min(), raw_sizes.max()
if s_max > s_min:
    marker_sizes = 4.0 + 12.0 * (raw_sizes - s_min) / (s_max - s_min)
else:
    marker_sizes = np.full_like(raw_sizes, 8.0)


# ------------------------------------------------------------------
# Qualitative colour scale — 25 distinct colours
# We use Plotly's D3 palette cycled as needed.
# ------------------------------------------------------------------
QUALITATIVE_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
    '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5',
    '#393b79', '#637939', '#8c6d31', '#843c39', '#7b4173',
]
point_colors = [QUALITATIVE_COLORS[int(lbl) % len(QUALITATIVE_COLORS)] for lbl in cluster_labels]


# ------------------------------------------------------------------
# Helper: build one Plotly scatter figure
# ------------------------------------------------------------------
def make_scatter(xy: np.ndarray, title: str) -> go.Figure:
    scatter = go.Scatter(
        x=xy[:, 0],
        y=xy[:, 1],
        mode='markers',
        marker=dict(
            size=marker_sizes.tolist(),
            color=point_colors,
            opacity=0.8,
            line=dict(width=0.3, color='white'),
        ),
        customdata=custom_data,
        hovertemplate=(
            '<b>%{customdata[0]}</b><br>'
            'Count: %{customdata[1]}<br>'
            '%{customdata[2]}'
            '<extra></extra>'
        ),
        text=[d[:60] for d in descriptions],  # fallback text
    )

    fig = go.Figure(data=[scatter])
    fig.update_layout(
        title=dict(text=title, font=dict(size=16)),
        xaxis=dict(title='UMAP-1', showgrid=False, zeroline=False),
        yaxis=dict(title='UMAP-2', showgrid=False, zeroline=False),
        hovermode='closest',
        plot_bgcolor='#1a1a2e',
        paper_bgcolor='#16213e',
        font=dict(color='white'),
        width=1100,
        height=750,
        margin=dict(l=40, r=40, t=60, b=40),
    )
    return fig


fig_text = make_scatter(text_2d, 'Action Icon Explorer — Text Embeddings (Gemini)')
fig_img  = make_scatter(img_2d,  'Action Icon Explorer — Image Embeddings (CLIP)')

# Export each figure as a self-contained HTML div (no full_html wrapper)
# The first figure includes the Plotly CDN JS; the second reuses it.
text_div = fig_text.to_html(full_html=False, include_plotlyjs='cdn')
img_div  = fig_img.to_html(full_html=False,  include_plotlyjs=False)


# ------------------------------------------------------------------
# Assemble combined HTML with a pure-CSS/JS tab switcher
# ------------------------------------------------------------------
combined_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Icon Explorer — RecipeLanes</title>
  <style>
    body {{ margin: 0; padding: 0; background: #16213e; font-family: sans-serif; }}
    #tab-bar {{ display: flex; gap: 4px; padding: 12px 16px 0; }}
    .tab-btn {{
      cursor: pointer;
      padding: 8px 20px;
      border: 1px solid #444;
      border-bottom: none;
      background: #0f3460;
      color: #aaa;
      border-radius: 6px 6px 0 0;
      font-size: 14px;
      transition: background 0.15s;
    }}
    .tab-btn.active {{ background: #e94560; color: white; font-weight: bold; }}
    .tab-btn:hover:not(.active) {{ background: #1a4a8a; color: #ddd; }}
    .tab-panel {{ display: none; padding: 0 16px 16px; }}
    .tab-panel.active {{ display: block; }}
    #info-bar {{
      padding: 6px 16px;
      color: #888;
      font-size: 12px;
    }}
  </style>
</head>
<body>
  <div id="tab-bar">
    <button class="tab-btn active" onclick="showTab('text', this)">Text Embeddings (Gemini)</button>
    <button class="tab-btn"        onclick="showTab('image', this)">Image Embeddings (CLIP)</button>
  </div>
  <div id="info-bar">
    {len(descriptions)} unique action descriptions &nbsp;|&nbsp;
    {n_with_icon} with icons &nbsp;|&nbsp;
    {n_no_icon} text-only &nbsp;|&nbsp;
    {K} clusters (K-means on text embeddings)
  </div>
  <div id="text"  class="tab-panel active">{text_div}</div>
  <div id="image" class="tab-panel">{img_div}</div>
  <script>
    function showTab(id, btn) {{
      document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      btn.classList.add('active');
    }}
  </script>
</body>
</html>
"""

with open(OUTPUT_HTML, 'w', encoding='utf-8') as fh:
    fh.write(combined_html)

print(f'\nSaved combined HTML to: {OUTPUT_HTML}')
print(f'File size: {os.path.getsize(OUTPUT_HTML) / 1024:.1f} KB')

# Show figures inline in the notebook as well
print('Done. Open the HTML file in your browser.')
# fig_text.show() / fig_img.show() — notebook only, skip when running as script

