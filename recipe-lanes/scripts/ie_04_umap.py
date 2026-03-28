"""
ie_04_umap.py

Run UMAP on text and image embeddings, run k-means for multiple k values,
name clusters via Gemini, and assemble viz_data.json.

Run from recipe-lanes/:
    python3 scripts/ie_04_umap.py [--skip-naming]
"""

import argparse
import base64
import hashlib
import json
import os
import re
import time
import urllib.request
import urllib.error
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
IE_DATA_DIR = SCRIPT_DIR / "ie_data"
INPUT_FILE = IE_DATA_DIR / "action-icons.json"
TEXT_EMBED_FILE = IE_DATA_DIR / "text_embeddings.npy"
IMAGE_EMBED_FILE = IE_DATA_DIR / "image_embeddings.npy"
THUMB_DIR = IE_DATA_DIR / "icons" / "thumb"
CLUSTER_NAMES_CACHE_FILE = IE_DATA_DIR / "cluster_names_cache.json"
OUTPUT_FILE = IE_DATA_DIR / "viz_data.json"

K_VALUES = [10, 15, 20, 25, 30, 40]

GEMINI_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent?key={key}"
)

# ---------------------------------------------------------------------------
# Load API key (same pattern as ie_02_embed_text.py)
# ---------------------------------------------------------------------------

def _read_env_file(path: Path) -> dict:
    """Parse a .env file and return {KEY: value} dict (no shell substitution)."""
    result = {}
    if not path.exists():
        return result
    text = path.read_text(errors="replace")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)', line)
        if m:
            key, val = m.group(1), m.group(2)
            val = re.sub(r'^(["\'])(.*)\1$', r'\2', val)
            result[key] = val
    return result


def load_api_key() -> str:
    # 1. Try python-dotenv
    try:
        from dotenv import load_dotenv
        for env_path in ["recipe-lanes/.env", ".env"]:
            if Path(env_path).exists():
                load_dotenv(env_path, override=False)
                break
    except ImportError:
        # Fall back to manual parsing
        for env_path in [Path("recipe-lanes/.env"), Path(".env")]:
            env_vars = _read_env_file(env_path)
            if "GEMINI_API_KEY" in env_vars:
                os.environ.setdefault("GEMINI_API_KEY", env_vars["GEMINI_API_KEY"])
                break

    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        # Fall back to hardcoded key from project spec
        key = "AIzaSyAWMxpOZtiXdzRpdOLHvFy_Z30QcxNFMgA"
    return key


# ---------------------------------------------------------------------------
# Thumbnail loading
# ---------------------------------------------------------------------------

def load_thumb_b64(thumb_path: Path):
    try:
        with open(thumb_path, "rb") as f:
            return "data:image/png;base64," + base64.b64encode(f.read()).decode()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Cluster naming via Gemini
# ---------------------------------------------------------------------------

def _cluster_cache_key(k: int, cluster_id: int, top8_descs: list) -> str:
    hash_str = hashlib.md5("|".join(sorted(top8_descs)).encode()).hexdigest()[:8]
    return f"{k}_{cluster_id}_{hash_str}"


def name_cluster_gemini(k: int, cluster_id: int, top8_descs: list, api_key: str) -> str:
    prompt = (
        f"Cooking action node labels for a recipe app. Give a SHORT 2-4 word visual label "
        f"for the icon that would represent this group:\n"
        + "\n".join(top8_descs)
        + "\n\nReply with ONLY the label."
    )
    url = GEMINI_GENERATE_URL.format(key=api_key)
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}]
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as exc:
        print(f"\nWarning: Gemini naming failed for k={k} cluster={cluster_id}: {exc}")
        return f"Cluster {cluster_id + 1}"


def get_cluster_names(
    k: int,
    labels: np.ndarray,
    items: list,
    api_key: str,
    cache: dict,
    skip_naming: bool,
) -> dict:
    """Return {str(cluster_id): name} for all clusters in k."""
    names = {}
    for cluster_id in range(k):
        if skip_naming:
            names[str(cluster_id)] = f"Cluster {cluster_id + 1}"
            continue

        # Find items in this cluster, sorted by count descending
        cluster_items = [
            (items[i]["desc"], items[i].get("count", 1))
            for i in range(len(labels))
            if labels[i] == cluster_id
        ]
        cluster_items.sort(key=lambda x: x[1], reverse=True)
        top8 = [desc for desc, _ in cluster_items[:8]]

        if not top8:
            names[str(cluster_id)] = f"Cluster {cluster_id + 1}"
            continue

        cache_key = _cluster_cache_key(k, cluster_id, top8)
        if cache_key in cache:
            names[str(cluster_id)] = cache[cache_key]
        else:
            name = name_cluster_gemini(k, cluster_id, top8, api_key)
            cache[cache_key] = name
            names[str(cluster_id)] = name
            time.sleep(0.1)

    return names


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Run UMAP + k-means + Gemini naming")
    parser.add_argument("--skip-naming", action="store_true",
                        help="Skip Gemini cluster naming; use 'Cluster N' labels")
    args = parser.parse_args()

    # ---- Load inputs -------------------------------------------------------
    print(f"Loading items from {INPUT_FILE}...")
    items = json.loads(INPUT_FILE.read_text())
    n = len(items)
    print(f"  {n} items loaded")

    print(f"Loading text embeddings from {TEXT_EMBED_FILE}...")
    text_embeddings = np.load(str(TEXT_EMBED_FILE)).astype(np.float32)
    print(f"  text_embeddings shape: {text_embeddings.shape}")

    # Image embeddings — optional
    use_image = False
    image_embeddings = None
    if IMAGE_EMBED_FILE.exists():
        image_embeddings = np.load(str(IMAGE_EMBED_FILE)).astype(np.float32)
        if np.all(image_embeddings == 0):
            print("Image embeddings are all zeros — skipping image UMAP")
        else:
            use_image = True
            print(f"  image_embeddings shape: {image_embeddings.shape}")
    else:
        print(f"Image embeddings file not found ({IMAGE_EMBED_FILE}) — skipping image UMAP")

    # ---- UMAP --------------------------------------------------------------
    import umap as umap_lib
    from sklearn.cluster import MiniBatchKMeans

    print("\nRunning UMAP on text embeddings...")
    text_reducer = umap_lib.UMAP(
        n_components=2, n_neighbors=15, min_dist=0.1,
        metric="cosine", random_state=42
    )
    text_2d = text_reducer.fit_transform(text_embeddings)
    print(f"  text_2d shape: {text_2d.shape}")

    image_2d = None
    if use_image:
        print("Running UMAP on image embeddings...")
        image_reducer = umap_lib.UMAP(
            n_components=2, n_neighbors=15, min_dist=0.1,
            metric="cosine", random_state=42
        )
        image_2d = image_reducer.fit_transform(image_embeddings)
        print(f"  image_2d shape: {image_2d.shape}")

    # ---- K-means -----------------------------------------------------------
    print("\nRunning k-means for K values:", K_VALUES)
    kmeans_results = {}
    for k in K_VALUES:
        print(f"  k={k}...", end=" ", flush=True)
        km = MiniBatchKMeans(n_clusters=k, random_state=42, n_init=5)
        labels = km.fit_predict(text_embeddings)
        kmeans_results[k] = labels.tolist()
        print("done")

    # ---- Cluster naming ----------------------------------------------------
    if not args.skip_naming:
        api_key = load_api_key()
    else:
        api_key = None

    # Load naming cache
    if CLUSTER_NAMES_CACHE_FILE.exists():
        cluster_names_cache = json.loads(CLUSTER_NAMES_CACHE_FILE.read_text())
        print(f"\nCluster names cache loaded: {len(cluster_names_cache)} entries")
    else:
        cluster_names_cache = {}

    clusters = {}
    for k in K_VALUES:
        labels = kmeans_results[k]
        print(f"\nNaming clusters for k={k}...")
        names = get_cluster_names(
            k=k,
            labels=np.array(labels),
            items=items,
            api_key=api_key,
            cache=cluster_names_cache,
            skip_naming=args.skip_naming,
        )
        clusters[f"k{k}"] = {
            "labels": labels,
            "names": names,
        }
        # Save cache after each k
        CLUSTER_NAMES_CACHE_FILE.write_text(
            json.dumps(cluster_names_cache, separators=(",", ":"), ensure_ascii=False)
        )
        print(f"  k={k} done, cache saved")

    # ---- Assemble items ----------------------------------------------------
    print("\nAssembling items with thumbnails...")
    assembled_items = []
    for i, item in enumerate(items):
        icon_id = item.get("id", "")
        thumb_path = THUMB_DIR / f"{icon_id}.png"
        thumb_b64 = load_thumb_b64(thumb_path)

        entry = {
            "idx": i,
            "id": icon_id,
            "desc": item.get("desc", ""),
            "count": item.get("count", 1),
            "thumb_b64": thumb_b64,
            "umap_text": [float(text_2d[i, 0]), float(text_2d[i, 1])],
            "umap_image": (
                [float(image_2d[i, 0]), float(image_2d[i, 1])]
                if image_2d is not None else None
            ),
        }
        assembled_items.append(entry)

    # ---- Assemble viz_data.json --------------------------------------------
    viz_data = {
        "n": n,
        "embed_methods": {
            "text": "gemini-embedding-001",
            "image": "Pixel 32x32 RGBA",
        },
        "items": assembled_items,
        "clusters": clusters,
    }

    print(f"\nWriting {OUTPUT_FILE}...")
    output_str = json.dumps(viz_data, separators=(",", ":"), ensure_ascii=False)
    OUTPUT_FILE.write_text(output_str, encoding="utf-8")

    size_mb = len(output_str.encode("utf-8")) / (1024 * 1024)
    print(f"viz_data.json written: {size_mb:.2f} MB")
    print(f"  n={n}, clusters: {list(clusters.keys())}")


if __name__ == "__main__":
    main()
