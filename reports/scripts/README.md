# Icon Retrieval Evaluation — Reproduction Guide

This guide explains how to reproduce the icon retrieval evaluation from scratch.

## Prerequisites

- Python 3.11+
- A Gemini API key (set as `GEMINI_API_KEY` in a `.env` file or environment variable)
- The full `action-icons.json` icon library (2000 icons) — not included in this package
- GPU optional (SigLIP2 will fall back to CPU)

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Place your API key in a `.env` file at the project root:
```
GEMINI_API_KEY=your_key_here
```

## Pipeline Steps

Scripts live in `reports/scripts/`. Data lives in `recipe-lanes/scripts/ie_data/`
(not committed — large binary files). Scripts use `__file__`-relative paths to
locate the data directory automatically.

To run the full pipeline in one shot:
```bash
bash reports/scripts/run_eval_pipeline.sh
```

Or run individual steps:

### Step 1 — Generate evaluation data

```bash
python3 reports/scripts/ie_eval_01_generate.py
```

Selects 100 icons for evaluation, generates query types (LLM query_1/query_2,
BLIP unconditional/conditional captions), and writes `recipe-lanes/scripts/ie_data/eval_data.json`.

Requires: `action-icons.json`, Gemini API key, BLIP model

### Step 2 — Build HyDE embedding matrices

```bash
python3 reports/scripts/ie_08_build_eval_hyde.py
```

For each of the 2000 icons, generates hypothetical search queries using Gemini
(from text description and from image via Gemini Vision), then embeds them.

Outputs:
- `recipe-lanes/scripts/ie_data/eval_hyde_from_prompt.npy`  (2000, 3072)
- `recipe-lanes/scripts/ie_data/eval_hyde_from_img.npy`     (2000, 3072)

### Step 3 — Run all search methods

```bash
python3 reports/scripts/ie_eval_02_search.py
```

Runs 11 search methods for each of 400 (icon × query_type) combinations.
Checkpoints every 10 entries. Outputs `recipe-lanes/scripts/ie_data/eval_results.json`.

Methods: plain_embed, bm25_desc, siglip2, hyde_from_prompt, hyde_from_img,
qexp_plain, qexp_hyde_img, bm25_caption, caption_embed, siglip2_caption, hyde_query

Also computes:
- `recipe-lanes/scripts/ie_data/eval_caption_embeddings.npy`
- `recipe-lanes/scripts/ie_data/eval_caption_siglip_embeddings.npy`

### Step 4 — Patch 5 additional cross-product methods

```bash
python3 reports/scripts/ie_eval_02b_patch.py
```

Adds 5 missing method combinations to `eval_results.json`:
- `qexp_hyde_prompt`, `hyde_query_hyde_prompt`, `qexp_caption`,
  `hyde_query_caption`, `hyde_query_hyde_img`

Checkpoints every 20 entries. Safe to re-run if interrupted.

### Step 5 — Analyze and plot

```bash
python3 reports/scripts/ie_eval_03_analyze.py
```

Computes MRR, Hit@1/3/5/10, median/mean rank for all 16 methods.
Saves plots to `recipe-lanes/scripts/ie_data/eval_plots/` and summary to
`recipe-lanes/scripts/ie_data/eval_summary.json`.

## API Cost Estimate

- Steps 1–3: ~$1–2 (100 icons × queries + 2000 icons × hyde generation + 400 × embed calls)
- Step 4 (patch): ~$0.10 (100 unique queries × expand + hyde_query, cached across query types)

## Notes

- Use `gemini-2.5-flash` for all generation (not `gemini-2.0-flash`)
- Use `gemini-embedding-001` for all embeddings
- All embedding vectors are L2-normalized
- The BM25 index covers all 2000 icons (not just the 100 eval icons)
