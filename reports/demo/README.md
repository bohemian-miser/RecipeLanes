# Icon Retrieval Demo

A minimal web app to compare search methods for recipe action icon retrieval side by side.

## Setup

```bash
cd reports/demo
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Make sure you have a `GEMINI_API_KEY` set — either in `recipe-lanes/.env` or as an environment variable.

## Run

```bash
source venv/bin/activate   # if not already active
python3 server.py
```

Open http://localhost:5050

## Features

**Single Query tab** — Enter any search query and compare results across all methods at once.

**Recipe → Nodes tab** — Paste a recipe, the LLM extracts action nodes, then searches for icons for each node. Click any node pill to see its results.

## Methods

| Method | Type | Description |
|--------|------|-------------|
| Plain Embed | static | RETRIEVAL_QUERY embed → text embeddings |
| HyDE (image) | static | query embed → pre-computed image HyDE matrix |
| HyDE (prompt) | static | query embed → pre-computed text HyDE matrix |
| Caption Embed | static | query embed → pre-computed caption embeddings |
| BM25 Desc | static | BM25 keyword search on icon descriptions |
| BM25 Caption | static | BM25 keyword search on Gemini captions |
| Qexp Plain | ⚡ API | expand query → avg embed → text embeddings |
| Qexp HyDE-img | ⚡ API | expand query → avg embed → HyDE image matrix |
| Qexp Caption | ⚡ API | expand query → avg embed → caption matrix |
| HyDE Query | ⚡ API | generate hypothetical description → doc embed → text emb |

Static methods require one Gemini embed call per search. API methods (⚡) make additional LLM calls (~0.01¢ each).

## Data

The demo reads directly from `recipe-lanes/scripts/ie_data/`:
- `action-icons.json` — 2000 icon metadata entries
- `text_embeddings.npy` — (2000, 3072) plain text embeddings
- `all_hyde_from_img.npy` — (2000, 3072) HyDE from image (backfilled)
- `all_hyde_from_prompt.npy` — (2000, 3072) HyDE from prompt (backfilled)
- `all_caption_embeddings.npy` — (2000, 3072) caption embeddings (backfilled)
- `icons/thumb/*.png` — 64×64 thumbnail images
