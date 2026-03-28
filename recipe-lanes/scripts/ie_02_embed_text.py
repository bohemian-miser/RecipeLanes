"""
ie_02_embed_text.py

Generate Gemini text embeddings for all action descriptions, with caching.

Run from recipe-lanes/:
    python3 scripts/ie_02_embed_text.py
"""

import json
import os
import re
import time
import urllib.request
import urllib.error
import concurrent.futures
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
IE_DATA_DIR = SCRIPT_DIR / "ie_data"
INPUT_FILE = IE_DATA_DIR / "action-icons.json"
CACHE_FILE = IE_DATA_DIR / "text_embed_cache.json"
OUTPUT_NPY = IE_DATA_DIR / "text_embeddings.npy"

EMBED_DIM = 3072
BATCH_SIZE = 20  # number of requests per parallel batch
BATCH_SLEEP = 0.1  # seconds between batches

EMBED_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)

# ---------------------------------------------------------------------------
# Load API key
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
            # Strip optional surrounding quotes
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
        raise RuntimeError(
            "GEMINI_API_KEY not found. Set it in .env or as an environment variable."
        )
    return key


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def embed_text(desc: str, api_key: str) -> list:
    """Call the Gemini embedding endpoint for a single description."""
    url = EMBED_URL_TEMPLATE.format(key=api_key)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": desc}]},
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return data["embedding"]["values"]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    api_key = load_api_key()

    # Load input
    items = json.loads(INPUT_FILE.read_text())
    total = len(items)
    print(f"Loaded {total} items from {INPUT_FILE}")

    # Load cache
    if CACHE_FILE.exists():
        cache: dict = json.loads(CACHE_FILE.read_text())
        print(f"Cache loaded: {len(cache)} entries")
    else:
        cache = {}

    # Determine which descriptions need embedding
    all_descs = [item["desc"] for item in items]
    missing_descs = [d for d in dict.fromkeys(all_descs) if d not in cache]
    print(f"Need to embed {len(missing_descs)} new descriptions")

    done = 0

    # Process in batches
    for batch_start in range(0, len(missing_descs), BATCH_SIZE):
        batch = missing_descs[batch_start: batch_start + BATCH_SIZE]

        def _embed(desc, key=api_key):
            return desc, embed_text(desc, key)

        with concurrent.futures.ThreadPoolExecutor(max_workers=BATCH_SIZE) as executor:
            futures = {executor.submit(_embed, d): d for d in batch}
            for future in concurrent.futures.as_completed(futures):
                try:
                    desc, values = future.result()
                    cache[desc] = values
                except Exception as exc:
                    desc = futures[future]
                    print(f"\nError embedding '{desc[:60]}': {exc}")

        done += len(batch)
        print(f"Embedding {done}/{len(missing_descs)}...", end="\r")

        # Save cache after each batch
        CACHE_FILE.write_text(json.dumps(cache, separators=(",", ":")))

        # Rate-limit pause between batches
        if batch_start + BATCH_SIZE < len(missing_descs):
            time.sleep(BATCH_SLEEP)

    if missing_descs:
        print(f"\nAll embeddings complete. Cache saved to {CACHE_FILE}")
    else:
        print("All descriptions already cached, nothing to embed.")

    # Build numpy array aligned to action-icons.json order
    embedding_matrix = np.zeros((total, EMBED_DIM), dtype=np.float32)
    missing_from_cache = []
    for i, item in enumerate(items):
        desc = item["desc"]
        if desc in cache:
            embedding_matrix[i] = cache[desc]
        else:
            missing_from_cache.append((i, desc))

    if missing_from_cache:
        print(f"WARNING: {len(missing_from_cache)} items have no cached embedding and will be zero vectors.")

    np.save(str(OUTPUT_NPY), embedding_matrix)
    print(f"Saved embeddings array shape={embedding_matrix.shape} to {OUTPUT_NPY}")


if __name__ == "__main__":
    main()
