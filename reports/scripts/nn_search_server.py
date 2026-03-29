"""
nn_search_server.py

Nearest-neighbour icon search server for RecipeLanes.
Serves the HTML frontend and handles embedding + cosine-similarity search.

Run from any directory:
    python3 /path/to/scripts/nn_search_server.py

Then open http://localhost:8766/
"""

import json
import os
import re
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
IE_DATA_DIR = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
ICONS_JSON   = IE_DATA_DIR / "action-icons.json"
EMBEDDINGS_NPY = IE_DATA_DIR / "text_embeddings.npy"
ENV_FILE = Path(__file__).parent.parent.parent / 'recipe-lanes' / ".env"

PORT = 8766
TOP_K = 20

EMBED_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent?key={key}"
)

# ---------------------------------------------------------------------------
# Startup: load data
# ---------------------------------------------------------------------------

def _read_env_file(path: Path) -> dict:
    result = {}
    if not path.exists():
        return result
    for line in path.read_text(errors="replace").splitlines():
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
    # Try python-dotenv first
    try:
        from dotenv import load_dotenv
        for p in [ENV_FILE, SCRIPT_DIR / ".env", Path(".env")]:
            if p.exists():
                load_dotenv(str(p), override=False)
                break
    except ImportError:
        for p in [ENV_FILE, SCRIPT_DIR / ".env", Path(".env")]:
            env_vars = _read_env_file(p)
            if "GEMINI_API_KEY" in env_vars:
                os.environ.setdefault("GEMINI_API_KEY", env_vars["GEMINI_API_KEY"])
                break

    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY not found. Checked .env at repo root and GEMINI_API_KEY env var."
        )
    return key


print("Loading data...")
ITEMS: list = json.loads(ICONS_JSON.read_text())
EMBEDDINGS: np.ndarray = np.load(str(EMBEDDINGS_NPY))  # shape (N, 3072), float32

# Pre-normalise all embeddings for fast cosine similarity (dot product only)
norms = np.linalg.norm(EMBEDDINGS, axis=1, keepdims=True)
norms[norms == 0] = 1.0
EMBEDDINGS_NORM: np.ndarray = (EMBEDDINGS / norms).astype(np.float32)

API_KEY: str = load_api_key()
print(f"Loaded {len(ITEMS)} icons, embeddings shape={EMBEDDINGS.shape}")

# ---------------------------------------------------------------------------
# Embedding helper
# ---------------------------------------------------------------------------

def embed_query(text: str) -> np.ndarray:
    """Call Gemini to embed a text string. Returns float32 unit vector."""
    url = EMBED_URL_TEMPLATE.format(key=API_KEY)
    body = json.dumps({
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    vec = np.array(data["embedding"]["values"], dtype=np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec

# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logging
        print(f"  {self.address_string()} {fmt % args}")

    def _send_cors_preflight(self):
        self.send_response(204)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()

    def _send_json(self, status: int, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- routing ----

    def do_OPTIONS(self):
        self._send_cors_preflight()

    def do_GET(self):
        path = self.path.split("?")[0]

        # Root → serve the HTML
        if path in ("/", "/nn-search.html"):
            html_file = SCRIPT_DIR / "nn-search.html"
            if html_file.exists():
                self._send_file(html_file, "text/html; charset=utf-8")
            else:
                self._send_json(404, {"error": "nn-search.html not found"})
            return

        # Static files under /ie_data/icons/thumb/
        if path.startswith("/ie_data/icons/thumb/"):
            rel = path.lstrip("/")
            file_path = SCRIPT_DIR / rel
            if file_path.exists() and file_path.suffix == ".png":
                self._send_file(file_path, "image/png")
            else:
                self.send_response(404)
                self.end_headers()
            return

        # Any other file under scripts/ (CSS, JS, etc.)
        rel = path.lstrip("/")
        file_path = SCRIPT_DIR / rel
        if file_path.exists() and file_path.is_file():
            ext = file_path.suffix.lower()
            ctype_map = {
                ".html": "text/html; charset=utf-8",
                ".js": "application/javascript",
                ".css": "text/css",
                ".json": "application/json",
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".svg": "image/svg+xml",
            }
            ctype = ctype_map.get(ext, "application/octet-stream")
            self._send_file(file_path, ctype)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?")[0]

        if path == "/search":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                self._send_json(400, {"error": "Invalid JSON"})
                return

            description = (payload.get("description") or "").strip()
            if not description:
                self._send_json(400, {"error": "description is required"})
                return

            try:
                query_vec = embed_query(description)
            except Exception as exc:
                self._send_json(502, {"error": f"Embedding failed: {exc}"})
                return

            # Cosine similarities (dot product of unit vectors)
            sims = EMBEDDINGS_NORM @ query_vec  # shape (N,)

            # Top-K indices
            top_indices = np.argpartition(sims, -TOP_K)[-TOP_K:]
            top_indices = top_indices[np.argsort(sims[top_indices])[::-1]]

            results = []
            for idx in top_indices:
                item = ITEMS[int(idx)]
                results.append({
                    "idx": int(idx),
                    "id": item.get("id", ""),
                    "desc": item.get("desc", ""),
                    "count": item.get("count", 0),
                    "similarity": float(sims[idx]),
                })

            self._send_json(200, results)
            return

        self._send_json(404, {"error": "Not found"})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    server = HTTPServer(("", PORT), Handler)
    print(f"\nNN Search server running at http://localhost:{PORT}/")
    print("Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
