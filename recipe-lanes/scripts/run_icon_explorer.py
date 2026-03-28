"""
Action icon explorer — icons as plot nodes, UMAP 2D layout.

Usage (from recipe-lanes/):
    python3 scripts/run_icon_explorer.py [--no-clip]

Generates: scripts/action-icon-explorer.html

Two tabs:
  Text  — gemini-embedding-001 UMAP  (always runs, uses cached embeddings)
  Image — CLIP vit-base-patch32 UMAP (requires torch + transformers)

Icons are rendered as actual nodes on the canvas (loaded from Firebase Storage
URLs at view time), not encoded into the HTML. File stays small.
"""

import json, os, sys, math
import numpy as np

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
DATA_PATH        = os.path.join(SCRIPTS, 'action-icon-data.json')
TEXT_CACHE_PATH  = os.path.join(SCRIPTS, '.action-embeddings-cache.json')
IMG_CACHE_PATH   = os.path.join(SCRIPTS, '.action-image-embeddings-cache.npy')
OUTPUT_HTML      = os.path.join(SCRIPTS, 'action-icon-explorer.html')
NO_CLIP          = '--no-clip' in sys.argv

# ── 1. Load data ──────────────────────────────────────────────────────────────

print('Loading data...')
with open(DATA_PATH) as f:
    items = json.load(f)

items = sorted(items, key=lambda x: x['count'], reverse=True)[:2000]
descs     = [i['desc']    for i in items]
counts    = [i['count']   for i in items]
icon_urls = [i['iconUrl'] for i in items]
N = len(descs)
n_with = sum(1 for u in icon_urls if u)
print(f'{N} items. {n_with} with icon URLs.')

# ── 2. Text embeddings (from cache) ──────────────────────────────────────────

print('Loading text embedding cache...')
with open(TEXT_CACHE_PATH) as f:
    tcache = json.load(f)

text_embs = np.array([tcache[d] for d in descs if d in tcache], dtype=np.float32)
valid = [d in tcache for d in descs]
descs     = [d for d, v in zip(descs,     valid) if v]
counts    = [c for c, v in zip(counts,    valid) if v]
icon_urls = [u for u, v in zip(icon_urls, valid) if v]
N = len(descs)
print(f'Text embeddings: {text_embs.shape}')

# ── 3. Image embeddings (CLIP) ────────────────────────────────────────────────

image_embs = None
clip_error = None
embed_method = None

if not NO_CLIP:
    # ── Try CLIP first ────────────────────────────────────────────────────────
    try:
        import torch
        from transformers import CLIPProcessor, CLIPModel
        from PIL import Image
        from io import BytesIO
        import urllib.request

        print('Loading CLIP model...')
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        model  = CLIPModel.from_pretrained('openai/clip-vit-base-patch32').to(device).eval()
        proc   = CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')
        print(f'CLIP on {device}.')
        embed_method = 'CLIP vit-base-patch32'

        try:
            raw = np.load(IMG_CACHE_PATH, allow_pickle=True).item()
            print(f'Loaded image cache: {len(raw)} entries')
        except Exception:
            raw = {}

        missing_urls = [u for u in set(u for u in icon_urls if u) if u not in raw]

        @torch.no_grad()
        def embed_image_clip(pil_img):
            inp = proc(images=pil_img, return_tensors='pt').to(device)
            v = model.get_image_features(**inp)
            return (v / v.norm(dim=-1, keepdim=True))[0].cpu().numpy()

        @torch.no_grad()
        def embed_text_clip(text):
            inp = proc(text=[text], return_tensors='pt', padding=True, truncation=True).to(device)
            v = model.get_text_features(**inp)
            return (v / v.norm(dim=-1, keepdim=True))[0].cpu().numpy()

        def fetch_img(url):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=15) as r:
                    return Image.open(BytesIO(r.read())).convert('RGB')
            except Exception:
                return None

        if missing_urls:
            print(f'Embedding {len(missing_urls)} new images via CLIP...')
            for i, url in enumerate(missing_urls):
                img = fetch_img(url)
                raw[url] = embed_image_clip(img) if img is not None else None
                if (i + 1) % 50 == 0:
                    sys.stdout.write(f'\r  {i+1}/{len(missing_urls)}')
                    sys.stdout.flush()
            print()
            np.save(IMG_CACHE_PATH, raw, allow_pickle=True)

        rows = []
        for d, u in zip(descs, icon_urls):
            if u and u in raw and raw[u] is not None:
                rows.append(raw[u])
            else:
                rows.append(embed_text_clip(d))
        image_embs = np.array(rows, dtype=np.float32)
        print(f'CLIP embeddings: {image_embs.shape}')

    except ImportError:
        print('torch not installed — using pixel embeddings instead.')

        # ── Pixel embedding fallback (no ML libs required) ────────────────────
        # Download each icon, resize to 32×32 RGBA, flatten + L2-normalise.
        # Captures colour, shape, and composition. Works surprisingly well for
        # clustering visually similar icons.
        from PIL import Image
        from io import BytesIO
        import urllib.request

        PIXEL_CACHE = IMG_CACHE_PATH.replace('.npy', '_pixel.npy')
        try:
            raw = np.load(PIXEL_CACHE, allow_pickle=True).item()
            print(f'Loaded pixel cache: {len(raw)} entries')
        except Exception:
            raw = {}

        SZ = 32
        missing_urls = [u for u in set(u for u in icon_urls if u) if u not in raw]

        def fetch_pixel_embed(url):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=15) as r:
                    img = Image.open(BytesIO(r.read())).convert('RGBA').resize((SZ, SZ), Image.LANCZOS)
                arr = np.array(img, dtype=np.float32).flatten() / 255.0
                n = np.linalg.norm(arr)
                return arr / n if n > 0 else arr
            except Exception:
                return None

        if missing_urls:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            print(f'Downloading {len(missing_urls)} icons for pixel embeddings (20 parallel)...')
            done = [0]
            with ThreadPoolExecutor(max_workers=20) as ex:
                futures = {ex.submit(fetch_pixel_embed, u): u for u in missing_urls}
                for fut in as_completed(futures):
                    raw[futures[fut]] = fut.result()
                    done[0] += 1
                    if done[0] % 100 == 0:
                        sys.stdout.write(f'\r  {done[0]}/{len(missing_urls)}')
                        sys.stdout.flush()
            print()
            np.save(PIXEL_CACHE, raw, allow_pickle=True)

        dim = SZ * SZ * 4
        rows = []
        for d, u in zip(descs, icon_urls):
            if u and u in raw and raw[u] is not None:
                rows.append(raw[u])
            else:
                # No icon: use a zero vector (will cluster separately)
                rows.append(np.zeros(dim, dtype=np.float32))
        image_embs = np.array(rows, dtype=np.float32)
        embed_method = f'Pixel 32×32 RGBA (no CLIP)'
        print(f'Pixel embeddings: {image_embs.shape}')

    except Exception as e:
        clip_error = str(e)
        print(f'Image embedding failed: {e}')
        import traceback; traceback.print_exc()

# ── 4. UMAP ───────────────────────────────────────────────────────────────────

import umap

print('UMAP on text embeddings...')
text_2d = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1,
                    metric='cosine', random_state=42).fit_transform(text_embs)

img_2d = None
if image_embs is not None:
    print('UMAP on image embeddings...')
    img_2d = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1,
                       metric='cosine', random_state=42).fit_transform(image_embs)

# ── 5. K-means cluster labels (for colour) ────────────────────────────────────

from sklearn.cluster import MiniBatchKMeans
K = 25
km = MiniBatchKMeans(n_clusters=K, random_state=42, n_init=5)
cluster_labels = km.fit_predict(text_embs).tolist()
print(f'K-means k={K} done.')

# ── 6. Serialise plot data for the HTML ───────────────────────────────────────

def coords_to_points(xy):
    return [{'x': float(xy[i, 0]), 'y': float(xy[i, 1])} for i in range(len(xy))]

plot_data = {
    'n': N,
    'descs':    descs,
    'counts':   counts,
    'iconUrls': icon_urls,
    'clusters': cluster_labels,
    'text':     coords_to_points(text_2d),
    'image':    coords_to_points(img_2d) if img_2d is not None else None,
    'clipError': clip_error,
    'k': K,
}

data_json = json.dumps(plot_data, separators=(',', ':'))

# ── 7. HTML template ──────────────────────────────────────────────────────────

# 25 qualitative colours (one per cluster)
CLUSTER_COLORS = [
    '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
    '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
    '#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd',
    '#8c564b','#e377c2','#bcbd22','#17becf','#393b79',
    '#637939','#8c6d31','#843c39','#7b4173','#aec7e8',
]

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Action Icon Explorer — RecipeLanes</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: #12121f; font-family: system-ui, sans-serif; color: #ccc;
       display: flex; flex-direction: column; height: 100vh; overflow: hidden; }}
#header {{ padding: 8px 14px; display: flex; align-items: center; gap: 12px;
           background: #1a1a2e; border-bottom: 1px solid #333; flex-shrink: 0; }}
#header h1 {{ font-size: 14px; font-weight: 600; color: #eee; }}
.tab-btn {{ padding: 5px 14px; border: 1px solid #444; border-radius: 4px;
            background: transparent; color: #aaa; cursor: pointer; font-size: 13px; }}
.tab-btn.active {{ background: #e94560; border-color: #e94560; color: #fff; font-weight: 600; }}
.tab-btn:disabled {{ opacity: 0.4; cursor: not-allowed; }}
#info {{ font-size: 12px; color: #666; margin-left: auto; }}
#canvas-wrap {{ flex: 1; position: relative; overflow: hidden; }}
canvas {{ display: block; width: 100%; height: 100%; cursor: crosshair; }}
#tooltip {{
  position: absolute; pointer-events: none; display: none;
  background: rgba(18,18,31,0.95); border: 1px solid #444;
  border-radius: 6px; padding: 8px 10px; font-size: 12px; max-width: 260px;
  line-height: 1.5; z-index: 10;
}}
#tooltip .t-desc {{ font-weight: 600; color: #eee; word-break: break-word; }}
#tooltip .t-count {{ color: #888; }}
#tooltip .t-cluster {{ color: #aaa; font-size: 11px; }}
#clip-msg {{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
             background:#1a1a2e; border:1px solid #444; border-radius:8px;
             padding:20px 28px; text-align:center; font-size:13px; color:#888; display:none; }}
#clip-msg code {{ color:#e94560; font-size:12px; }}
</style>
</head>
<body>
<div id="header">
  <h1>Action Icon Explorer</h1>
  <button class="tab-btn active" id="btn-text"  onclick="switchTab('text')">Text Embeddings</button>
  <button class="tab-btn"        id="btn-image" onclick="switchTab('image')"
    {'' if img_2d is not None else 'disabled title="Image embeddings unavailable"'}
  >Image Embeddings ({embed_method or 'unavailable'})</button>
  <div id="info">{N} descriptions &nbsp;·&nbsp; {n_with} icons &nbsp;·&nbsp; k={K} clusters</div>
</div>
<div id="canvas-wrap">
  <canvas id="c"></canvas>
  <div id="tooltip">
    <div class="t-desc" id="tt-desc"></div>
    <div class="t-count" id="tt-count"></div>
    <div class="t-cluster" id="tt-cluster"></div>
  </div>
  <div id="clip-msg" id="clip-fallback">
    {"" if img_2d is not None else f'<b>CLIP not available</b><br><br><code>{clip_error or "torch/transformers not installed"}</code><br><br>Install torch + transformers and re-run.'}
  </div>
</div>
<script>
const DATA = {data_json};
const COLORS = {json.dumps(CLUSTER_COLORS)};

// ── Canvas setup ──────────────────────────────────────────────────────────────
const canvas  = document.getElementById('c');
const ctx     = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const ttDesc  = document.getElementById('tt-desc');
const ttCount = document.getElementById('tt-count');
const ttClust = document.getElementById('tt-cluster');
const clipMsg = document.getElementById('clip-msg');

let W, H;
function resize() {{
  const wrap = canvas.parentElement;
  W = canvas.width  = wrap.clientWidth;
  H = canvas.height = wrap.clientHeight;
  if (plot) {{ plot.initView(); plot.render(); }}
}}
window.addEventListener('resize', resize);

// ── Per-tab state ─────────────────────────────────────────────────────────────
let activeTab = 'text';
function switchTab(tab) {{
  if (tab === 'image' && !DATA.image) return;
  activeTab = tab;
  document.getElementById('btn-text').classList.toggle('active',  tab === 'text');
  document.getElementById('btn-image').classList.toggle('active', tab === 'image');
  clipMsg.style.display = (tab === 'image' && !DATA.image) ? 'block' : 'none';
  if (plot) {{ plot.switchData(tab === 'text' ? DATA.text : DATA.image); }}
}}

// ── Image cache ───────────────────────────────────────────────────────────────
const imgCache = {{}};
function getImg(url) {{
  if (!url) return null;
  if (imgCache[url]) return imgCache[url] === 'loading' ? null : imgCache[url];
  imgCache[url] = 'loading';
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload  = () => {{ imgCache[url] = img; }};
  img.onerror = () => {{ imgCache[url] = null; }};
  img.src = url;
  return null;
}}

// ── Plot class ────────────────────────────────────────────────────────────────
class Plot {{
  constructor(points) {{
    this.pts    = points;   // [{{x,y}}...]
    this.cx     = 0;        // world center
    this.cy     = 0;
    this.scale  = 1;        // pixels per world unit
    this.hover  = -1;
    this.drag   = null;     // {{sx, sy, cx, cy}}
    this.raf    = null;
    this.initView();
    this.setupEvents();
    this.schedRender();
  }}

  initView() {{
    const xs = this.pts.map(p => p.x), ys = this.pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    const pad = 1.12;
    this.scale = Math.min(W / ((maxX - minX) * pad), H / ((maxY - minY) * pad));
    this.render();
  }}

  switchData(pts) {{
    this.pts   = pts;
    this.hover = -1;
    this.initView();
  }}

  // world → screen
  tx(wx) {{ return W / 2 + (wx - this.cx) * this.scale; }}
  ty(wy) {{ return H / 2 + (wy - this.cy) * this.scale; }}
  // screen → world
  wx(sx) {{ return (sx - W / 2) / this.scale + this.cx; }}
  wy(sy) {{ return (sy - H / 2) / this.scale + this.cy; }}

  iconSize() {{
    // Base size ~22px, grows slightly with zoom, capped
    return Math.max(12, Math.min(64, 22 * Math.sqrt(this.scale / 30)));
  }}

  findHover(mx, my) {{
    const s = this.iconSize() / 2 + 4;
    let best = -1, bestD = s * s;
    for (let i = 0; i < this.pts.length; i++) {{
      const dx = this.tx(this.pts[i].x) - mx;
      const dy = this.ty(this.pts[i].y) - my;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestD) {{ bestD = d2; best = i; }}
    }}
    return best;
  }}

  render() {{
    ctx.clearRect(0, 0, W, H);
    const s = this.iconSize();
    const half = s / 2;

    for (let i = 0; i < this.pts.length; i++) {{
      const sx = this.tx(this.pts[i].x);
      const sy = this.ty(this.pts[i].y);
      if (sx < -s || sx > W+s || sy < -s || sy > H+s) continue; // cull

      const url = DATA.iconUrls[i];
      const img = url ? getImg(url) : null;
      const isHov = i === this.hover;

      if (img) {{
        if (isHov) {{
          ctx.shadowColor = '#fff';
          ctx.shadowBlur  = 8;
        }}
        ctx.drawImage(img, sx - half, sy - half, s, s);
        ctx.shadowBlur = 0;
      }} else {{
        // Fallback circle with cluster colour
        ctx.beginPath();
        ctx.arc(sx, sy, half * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[DATA.clusters[i] % COLORS.length];
        ctx.globalAlpha = isHov ? 1 : 0.75;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (isHov) {{
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }}
      }}
    }}
  }}

  schedRender() {{
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {{ this.raf = null; this.render(); }});
  }}

  setupEvents() {{
    canvas.addEventListener('wheel', e => {{
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
      // Zoom around mouse position
      const mx = e.offsetX, my = e.offsetY;
      this.cx = this.wx(mx) + (this.cx - this.wx(mx)) / factor;
      this.cy = this.wy(my) + (this.cy - this.wy(my)) / factor;
      this.scale *= factor;
      this.schedRender();
    }}, {{ passive: false }});

    canvas.addEventListener('mousedown', e => {{
      this.drag = {{ sx: e.offsetX, sy: e.offsetY, cx: this.cx, cy: this.cy }};
      canvas.style.cursor = 'grabbing';
    }});

    canvas.addEventListener('mousemove', e => {{
      if (this.drag) {{
        const dx = (e.offsetX - this.drag.sx) / this.scale;
        const dy = (e.offsetY - this.drag.sy) / this.scale;
        this.cx = this.drag.cx - dx;
        this.cy = this.drag.cy - dy;
        this.schedRender();
        return;
      }}
      const h = this.findHover(e.offsetX, e.offsetY);
      if (h !== this.hover) {{
        this.hover = h;
        this.schedRender();
      }}
      if (h >= 0) {{
        ttDesc.textContent  = DATA.descs[h];
        ttCount.textContent = `Count: ${{DATA.counts[h]}}`;
        ttClust.textContent = `Cluster ${{DATA.clusters[h] + 1}}`;
        let tx = e.clientX + 14, ty = e.clientY - 10;
        if (tx + 270 > window.innerWidth)  tx = e.clientX - 280;
        if (ty + 90  > window.innerHeight) ty = e.clientY - 90;
        tooltip.style.left    = tx + 'px';
        tooltip.style.top     = ty + 'px';
        tooltip.style.display = 'block';
      }} else {{
        tooltip.style.display = 'none';
      }}
    }});

    canvas.addEventListener('mouseup',    () => {{ this.drag = null; canvas.style.cursor = 'crosshair'; }});
    canvas.addEventListener('mouseleave', () => {{ this.drag = null; tooltip.style.display = 'none'; }});

    // Touch support
    let lastTouchDist = 0;
    canvas.addEventListener('touchstart', e => {{
      if (e.touches.length === 2) {{
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
      }} else {{
        const t = e.touches[0];
        this.drag = {{ sx: t.clientX, sy: t.clientY, cx: this.cx, cy: this.cy }};
      }}
    }}, {{ passive: true }});

    canvas.addEventListener('touchmove', e => {{
      e.preventDefault();
      if (e.touches.length === 2) {{
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / lastTouchDist;
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        this.cx = this.wx(mx) + (this.cx - this.wx(mx)) / factor;
        this.cy = this.wy(my) + (this.cy - this.wy(my)) / factor;
        this.scale *= factor;
        lastTouchDist = dist;
        this.schedRender();
      }} else if (this.drag) {{
        const t = e.touches[0];
        const ddx = (t.clientX - this.drag.sx) / this.scale;
        const ddy = (t.clientY - this.drag.sy) / this.scale;
        this.cx = this.drag.cx - ddx;
        this.cy = this.drag.cy - ddy;
        this.drag.sx = t.clientX; this.drag.sy = t.clientY;
        this.drag.cx = this.cx;   this.drag.cy = this.cy;
        this.schedRender();
      }}
    }}, {{ passive: false }});

    canvas.addEventListener('touchend', () => {{ this.drag = null; }});
  }}
}}

// ── Boot ──────────────────────────────────────────────────────────────────────
let plot = null;
resize();
plot = new Plot(DATA.text);

if (!DATA.image) {{
  document.getElementById('btn-image').setAttribute('title',
    DATA.clipError || 'CLIP not available — install torch + transformers and re-run');
}}

// Periodically re-render while images are loading
setInterval(() => {{ if (plot) plot.schedRender(); }}, 300);
</script>
</body>
</html>
"""

with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
    f.write(html)

size_kb = os.path.getsize(OUTPUT_HTML) // 1024
print(f'\nSaved: {OUTPUT_HTML} ({size_kb} KB)')
print('Open in your browser — icons load directly from Firebase Storage.')
