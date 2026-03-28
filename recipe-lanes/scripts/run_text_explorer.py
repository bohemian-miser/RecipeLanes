"""
Text-embedding-only explorer (no torch/CLIP required).
Reads the existing gemini-embedding-001 cache, runs UMAP, generates HTML.

Run from recipe-lanes/:
    python3 scripts/run_text_explorer.py
"""

import json, os, math, base64, sys
import numpy as np
from io import BytesIO

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
DATA_PATH       = os.path.join(SCRIPTS, 'action-icon-data.json')
EMBED_CACHE     = os.path.join(SCRIPTS, '.action-embeddings-cache.json')
OUTPUT_HTML     = os.path.join(SCRIPTS, 'action-icon-explorer.html')

# ── Load data ────────────────────────────────────────────────────────────────

print('Loading action-icon-data.json...')
with open(DATA_PATH) as f:
    items = json.load(f)

# Cap at top-2000 by count
items = sorted(items, key=lambda x: x['count'], reverse=True)[:2000]
descriptions = [i['desc']     for i in items]
counts       = [i['count']    for i in items]
icon_urls    = [i['iconUrl']  for i in items]
N = len(descriptions)
print(f'{N} items loaded. Icons: {sum(1 for u in icon_urls if u)} / {N}')

# ── Text embeddings ───────────────────────────────────────────────────────────

print('Loading embedding cache...')
with open(EMBED_CACHE) as f:
    cache = json.load(f)

missing = [d for d in descriptions if d not in cache]
if missing:
    print(f'{len(missing)} descriptions missing from cache.')
    key = os.environ.get('GEMINI_API_KEY', '')
    if not key:
        print('Set GEMINI_API_KEY to embed missing items; skipping them for now.')
    else:
        import urllib.request, urllib.error
        for desc in missing:
            body = json.dumps({'model':'models/gemini-embedding-001','content':{'parts':[{'text':desc}]}}).encode()
            req  = urllib.request.Request(
                f'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={key}',
                data=body, headers={'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    cache[desc] = json.load(r)['embedding']['values']
            except Exception as e:
                print(f'  Failed: {desc[:40]} — {e}')
        with open(EMBED_CACHE, 'w') as f:
            json.dump(cache, f)

text_embeddings = np.array([cache[d] for d in descriptions if d in cache], dtype=np.float32)
valid_mask = [d in cache for d in descriptions]
descriptions = [d for d, v in zip(descriptions, valid_mask) if v]
counts       = [c for c, v in zip(counts, valid_mask) if v]
icon_urls    = [u for u, v in zip(icon_urls, valid_mask) if v]
N = len(descriptions)
print(f'Embeddings: {text_embeddings.shape}')

# ── UMAP ──────────────────────────────────────────────────────────────────────

import umap
print('Running UMAP...')
reducer = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1, metric='cosine', random_state=42)
text_2d = reducer.fit_transform(text_embeddings)
print('UMAP done.')

# ── K-means (k=25) ────────────────────────────────────────────────────────────

from sklearn.cluster import MiniBatchKMeans
K = 25
print(f'K-means k={K}...')
km = MiniBatchKMeans(n_clusters=K, random_state=42, n_init=5)
cluster_labels = km.fit_predict(text_embeddings)
sizes = np.bincount(cluster_labels)
print(f'Cluster sizes: min={sizes.min()}, max={sizes.max()}, mean={sizes.mean():.1f}')

# ── Pre-fetch icon thumbnails ─────────────────────────────────────────────────

import urllib.request, urllib.error
from PIL import Image

THUMB = 80

def fetch_icon_b64(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
        img = Image.open(BytesIO(data)).convert('RGBA')
        img.thumbnail((THUMB, THUMB), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format='PNG')
        b64 = base64.b64encode(buf.getvalue()).decode('ascii')
        return f'<img src="data:image/png;base64,{b64}" width="{THUMB}">'
    except Exception:
        return ''

unique_urls = list({u for u in icon_urls if u})
print(f'Fetching {len(unique_urls)} icon thumbnails...')
b64_cache = {}
for i, url in enumerate(unique_urls):
    b64_cache[url] = fetch_icon_b64(url)
    if (i + 1) % 50 == 0:
        sys.stdout.write(f'\r  {i+1}/{len(unique_urls)}')
        sys.stdout.flush()
print(f'\r  Done. {sum(1 for v in b64_cache.values() if v)}/{len(unique_urls)} icons fetched.')

custom_data = [
    [desc, cnt, b64_cache.get(url, '') if url else '']
    for desc, cnt, url in zip(descriptions, counts, icon_urls)
]

# ── Plotly ────────────────────────────────────────────────────────────────────

import plotly.graph_objects as go

COLORS = [
    '#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd',
    '#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf',
    '#aec7e8','#ffbb78','#98df8a','#ff9896','#c5b0d5',
    '#c49c94','#f7b6d2','#c7c7c7','#dbdb8d','#9edae5',
    '#393b79','#637939','#8c6d31','#843c39','#7b4173',
]
point_colors = [COLORS[int(l) % len(COLORS)] for l in cluster_labels]

raw_sizes = np.log1p(np.array(counts, dtype=float))
s_min, s_max = raw_sizes.min(), raw_sizes.max()
marker_sizes = (4.0 + 12.0 * (raw_sizes - s_min) / (s_max - s_min + 1e-9)).tolist()

def make_fig(xy, title):
    fig = go.Figure(go.Scatter(
        x=xy[:, 0], y=xy[:, 1],
        mode='markers',
        marker=dict(size=marker_sizes, color=point_colors, opacity=0.85,
                    line=dict(width=0.3, color='white')),
        customdata=custom_data,
        hovertemplate='<b>%{customdata[0]}</b><br>Count: %{customdata[1]}<br>%{customdata[2]}<extra></extra>',
    ))
    fig.update_layout(
        title=dict(text=title, font=dict(size=16)),
        xaxis=dict(title='UMAP-1', showgrid=False, zeroline=False),
        yaxis=dict(title='UMAP-2', showgrid=False, zeroline=False),
        hovermode='closest',
        plot_bgcolor='#1a1a2e', paper_bgcolor='#16213e',
        font=dict(color='white'),
        width=1200, height=800,
        margin=dict(l=40, r=40, t=60, b=40),
    )
    return fig

fig_text = make_fig(text_2d, 'Action Icon Explorer — Text Embeddings (gemini-embedding-001)')
text_div = fig_text.to_html(full_html=False, include_plotlyjs='cdn')

n_with_icon = sum(1 for u in icon_urls if u)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Action Icon Explorer — RecipeLanes</title>
  <style>
    body {{ margin:0; padding:0; background:#16213e; font-family:sans-serif; }}
    #info {{ padding:10px 16px; color:#888; font-size:13px; }}
    #note {{ padding:6px 16px 0; color:#e94560; font-size:12px; }}
  </style>
</head>
<body>
  <div id="info">
    {N} unique action descriptions &nbsp;|&nbsp;
    {n_with_icon} with icons &nbsp;|&nbsp;
    {K} clusters (K-means on gemini-embedding-001)
    &nbsp;|&nbsp; <b>Text embeddings only</b> — re-run with torch/CLIP for image tab
  </div>
  {text_div}
</body>
</html>
"""

with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
    f.write(html)

size_kb = os.path.getsize(OUTPUT_HTML) // 1024
print(f'\nSaved: {OUTPUT_HTML} ({size_kb} KB)')
print('Open in your browser to explore.')
