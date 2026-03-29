#!/bin/bash
# run_eval_pipeline.sh
# ---------------------
# Runs the full eval + backfill pipeline.
# Safe to re-run: each step checkpoints and skips already-done work.
#
# Steps:
#   1. ie_08_build_eval_hyde.py  — build hyde_from_img + hyde_from_prompt for 100 eval icons
#   2. ie_eval_02_search.py      — run 11 search methods × 400 combos
#   3. ie_eval_03_analyze.py     — compute stats + plots
#   4. ie_10_backfill_all.py     — backfill all ~1684 icons (budget: $5)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IE_DATA_DIR="$SCRIPT_DIR/../../../recipe-lanes/scripts/ie_data"
source ~/venvs/recipeviz/bin/activate

LOG_DIR="$IE_DATA_DIR/eval_logs"
mkdir -p "$LOG_DIR"

echo "=== Step 1: Build eval hyde embeddings ===" | tee "$LOG_DIR/step1.log"
PYTHONUNBUFFERED=1 python3 "$SCRIPT_DIR/ie_08_build_eval_hyde.py" 2>&1 | tee -a "$LOG_DIR/step1.log"

echo "" | tee -a "$LOG_DIR/step1.log"
echo "=== Step 2: Run eval search (11 methods × 400 combos) ===" | tee "$LOG_DIR/step2.log"
PYTHONUNBUFFERED=1 python3 "$SCRIPT_DIR/ie_eval_02_search.py" 2>&1 | tee -a "$LOG_DIR/step2.log"

echo "" | tee -a "$LOG_DIR/step2.log"
echo "=== Step 3: Analyze results + generate plots ===" | tee "$LOG_DIR/step3.log"
PYTHONUNBUFFERED=1 python3 "$SCRIPT_DIR/ie_eval_03_analyze.py" 2>&1 | tee -a "$LOG_DIR/step3.log"

echo "" | tee -a "$LOG_DIR/step3.log"
echo "=== Step 4: Backfill all icons ===" | tee "$LOG_DIR/step4.log"
PYTHONUNBUFFERED=1 python3 "$SCRIPT_DIR/ie_10_backfill_all.py" 2>&1 | tee -a "$LOG_DIR/step4.log"

echo ""
echo "=== Pipeline complete. ==="
echo "Stats: $IE_DATA_DIR/eval_stats.json"
echo "Plots: $IE_DATA_DIR/eval_plots/"
echo "Backfill outputs: $IE_DATA_DIR/all_*.npy"
