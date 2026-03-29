"""
ie_eval_03_analyze.py
---------------------
Load eval_results.json and compute per-method retrieval statistics.
Generates plots saved to scripts/ie_data/eval_plots/.

Metrics per method (and broken down by query_type):
  - MRR (Mean Reciprocal Rank)
  - Hit@1, Hit@3, Hit@5, Hit@10
  - Median rank, Mean rank

Plots:
  1. mrr_by_method.png      — bar chart of MRR per method, grouped by query type
  2. hit_rates.png          — grouped bar chart of Hit@1/3/5/10 for each method
  3. rank_distribution.png  — box plot of rank distributions per method
  4. query_type_comparison.png — heatmap: methods × query_types, colored by MRR

Run from recipe-lanes/:
    python3 scripts/ie_eval_03_analyze.py
"""

import json
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

BASE = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
RESULTS_JSON = BASE / "eval_results.json"
PLOTS_DIR = BASE / "eval_plots"

SEARCH_METHODS = [
    "plain_embed",
    "bm25_desc",
    "siglip2",
    "hyde_from_prompt",
    "hyde_from_img",
    "qexp_plain",
    "qexp_hyde_img",
    "bm25_caption",
    "caption_embed",
    "siglip2_caption",
    "hyde_query",
    "qexp_hyde_prompt",
    "hyde_query_hyde_prompt",
    "qexp_caption",
    "hyde_query_caption",
    "hyde_query_hyde_img",
    # SigLIP2 image-space cross-product (icon-side = SigLIP2 image encoder)
    "siglip2_qexp",    # SigLIP2 text of expanded query → vs SigLIP2 image embeds
    "siglip2_hyde_q",  # SigLIP2 text of hyde description → vs SigLIP2 image embeds
]

QUERY_TYPES = ["query_1", "query_2", "blip_unconditional", "blip_conditional"]

NOT_FOUND_RANK = 9999

# Color families by method type
METHOD_COLORS = {
    "plain_embed":      "#4e79a7",
    "bm25_desc":        "#f28e2b",
    "siglip2":          "#e15759",
    "hyde_from_prompt": "#76b7b2",
    "hyde_from_img":    "#1a9c7b",
    "qexp_plain":       "#59a14f",
    "qexp_hyde_img":    "#edc948",
    "bm25_caption":     "#b07aa1",
    "caption_embed":    "#ff9da7",
    "siglip2_caption":        "#9c755f",
    "hyde_query":             "#2ca02c",
    "qexp_hyde_prompt":       "#aec7e8",
    "hyde_query_hyde_prompt": "#ffbb78",
    "qexp_caption":           "#98df8a",
    "hyde_query_caption":     "#ff9896",
    "hyde_query_hyde_img":    "#c5b0d5",
    "siglip2_qexp":           "#d62728",  # red family — SigLIP2 image space
    "siglip2_hyde_q":         "#e377c2",
}

QUERY_TYPE_LABELS = {
    "query_1": "Query 1",
    "query_2": "Query 2",
    "blip_unconditional": "BLIP uncond.",
    "blip_conditional": "BLIP cond.",
}


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------

def compute_stats(ranks: list[int]) -> dict:
    if not ranks:
        return {"mrr": 0, "hit1": 0, "hit3": 0, "hit5": 0, "hit10": 0,
                "median_rank": NOT_FOUND_RANK, "mean_rank": NOT_FOUND_RANK, "n": 0}
    r = np.array(ranks, dtype=float)
    return {
        "mrr": float(np.mean(1.0 / r)),
        "hit1": float(np.mean(r <= 1)),
        "hit3": float(np.mean(r <= 3)),
        "hit5": float(np.mean(r <= 5)),
        "hit10": float(np.mean(r <= 10)),
        "median_rank": float(np.median(r)),
        "mean_rank": float(np.mean(r)),
        "n": len(ranks),
    }


def collect_ranks(results: list[dict]) -> dict:
    """
    Returns nested dict:
      method -> query_type -> [rank, ...]
      method -> "all" -> [rank, ...]
    """
    data = {m: {qt: [] for qt in QUERY_TYPES} for m in SEARCH_METHODS}
    for m in SEARCH_METHODS:
        data[m]["all"] = []

    for entry in results:
        qt = entry["query_type"]
        for m in SEARCH_METHODS:
            rank = entry["ranks"].get(m, NOT_FOUND_RANK)
            data[m][qt].append(rank)
            data[m]["all"].append(rank)

    return data


# ---------------------------------------------------------------------------
# Plot helpers
# ---------------------------------------------------------------------------

def method_label(m: str) -> str:
    return m.replace("_", "\n")


# ---------------------------------------------------------------------------
# Plot 1: MRR by method, grouped by query type
# ---------------------------------------------------------------------------

def plot_mrr_by_method(ranks_data: dict, out_path: Path):
    fig, ax = plt.subplots(figsize=(14, 7))

    n_methods = len(SEARCH_METHODS)
    n_qt = len(QUERY_TYPES)
    group_width = 0.8
    bar_width = group_width / n_qt
    x = np.arange(n_methods)

    qt_colors = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2"]
    patches = []

    for qi, qt in enumerate(QUERY_TYPES):
        mrr_vals = [
            compute_stats(ranks_data[m][qt])["mrr"]
            for m in SEARCH_METHODS
        ]
        offset = (qi - (n_qt - 1) / 2) * bar_width
        bars = ax.bar(x + offset, mrr_vals, bar_width * 0.9,
                      color=qt_colors[qi], alpha=0.85, label=QUERY_TYPE_LABELS[qt])
        patches.append(bars)

    ax.set_xticks(x)
    ax.set_xticklabels([m.replace("_", "\n") for m in SEARCH_METHODS], fontsize=9)
    ax.set_ylabel("MRR (Mean Reciprocal Rank)")
    ax.set_title("MRR by Method and Query Type")
    ax.set_ylim(0, 1)
    ax.legend(title="Query Type", loc="upper right")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(str(out_path), dpi=150)
    plt.close(fig)
    print(f"Saved {out_path}")


# ---------------------------------------------------------------------------
# Plot 2: Hit rates (Hit@1/3/5/10) per method (all query types combined)
# ---------------------------------------------------------------------------

def plot_hit_rates(ranks_data: dict, out_path: Path):
    hit_levels = [1, 3, 5, 10]
    hit_colors = ["#4e79a7", "#59a14f", "#f28e2b", "#e15759"]
    hit_labels = [f"Hit@{k}" for k in hit_levels]

    n_methods = len(SEARCH_METHODS)
    n_hits = len(hit_levels)
    group_width = 0.8
    bar_width = group_width / n_hits
    x = np.arange(n_methods)

    fig, ax = plt.subplots(figsize=(14, 7))

    for hi, (k, color, label) in enumerate(zip(hit_levels, hit_colors, hit_labels)):
        vals = [
            compute_stats(ranks_data[m]["all"])[f"hit{k}"]
            for m in SEARCH_METHODS
        ]
        offset = (hi - (n_hits - 1) / 2) * bar_width
        ax.bar(x + offset, vals, bar_width * 0.9,
               color=color, alpha=0.85, label=label)

    ax.set_xticks(x)
    ax.set_xticklabels([m.replace("_", "\n") for m in SEARCH_METHODS], fontsize=9)
    ax.set_ylabel("Hit Rate (fraction of queries)")
    ax.set_title("Hit@1 / Hit@3 / Hit@5 / Hit@10 by Method (all query types)")
    ax.set_ylim(0, 1)
    ax.legend(title="Hit Level", loc="upper right")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(str(out_path), dpi=150)
    plt.close(fig)
    print(f"Saved {out_path}")


# ---------------------------------------------------------------------------
# Plot 3: Rank distribution box plot
# ---------------------------------------------------------------------------

def plot_rank_distribution(ranks_data: dict, out_path: Path):
    fig, ax = plt.subplots(figsize=(14, 7))

    # Cap ranks at 200 for display (to avoid 9999 squishing the plot)
    RANK_CAP = 200
    data = []
    labels = []
    colors = []
    for m in SEARCH_METHODS:
        raw = ranks_data[m]["all"]
        capped = [min(r, RANK_CAP) for r in raw]
        data.append(capped)
        labels.append(m.replace("_", "\n"))
        colors.append(METHOD_COLORS.get(m, "#aaaaaa"))

    bp = ax.boxplot(data, patch_artist=True, vert=True, notch=False,
                    medianprops={"color": "black", "linewidth": 2})
    for patch, color in zip(bp["boxes"], colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.75)

    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel(f"Rank (capped at {RANK_CAP})")
    ax.set_title("Rank Distribution per Method (all query types combined)")
    ax.grid(axis="y", alpha=0.3)
    ax.axhline(y=10, color="gray", linestyle="--", alpha=0.5, label="Rank 10")
    ax.legend()
    fig.tight_layout()
    fig.savefig(str(out_path), dpi=150)
    plt.close(fig)
    print(f"Saved {out_path}")


# ---------------------------------------------------------------------------
# Plot 4: Heatmap — methods × query_types, colored by MRR
# ---------------------------------------------------------------------------

def plot_query_type_comparison(ranks_data: dict, out_path: Path):
    n_methods = len(SEARCH_METHODS)
    n_qt = len(QUERY_TYPES)

    matrix = np.zeros((n_methods, n_qt))
    for mi, m in enumerate(SEARCH_METHODS):
        for qi, qt in enumerate(QUERY_TYPES):
            matrix[mi, qi] = compute_stats(ranks_data[m][qt])["mrr"]

    fig, ax = plt.subplots(figsize=(9, 8))
    im = ax.imshow(matrix, aspect="auto", cmap="YlGn", vmin=0, vmax=1)

    ax.set_xticks(np.arange(n_qt))
    ax.set_yticks(np.arange(n_methods))
    ax.set_xticklabels([QUERY_TYPE_LABELS[qt] for qt in QUERY_TYPES], fontsize=11)
    ax.set_yticklabels(SEARCH_METHODS, fontsize=10)
    ax.set_title("MRR Heatmap: Methods × Query Types")

    # Annotate cells
    for mi in range(n_methods):
        for qi in range(n_qt):
            val = matrix[mi, qi]
            text_color = "black" if val < 0.6 else "white"
            ax.text(qi, mi, f"{val:.3f}", ha="center", va="center",
                    fontsize=9, color=text_color)

    plt.colorbar(im, ax=ax, label="MRR")
    fig.tight_layout()
    fig.savefig(str(out_path), dpi=150)
    plt.close(fig)
    print(f"Saved {out_path}")


# ---------------------------------------------------------------------------
# Print summary table
# ---------------------------------------------------------------------------

def print_summary(ranks_data: dict):
    print("\n" + "=" * 90)
    print(f"{'Method':<20} {'MRR':>6} {'H@1':>6} {'H@3':>6} {'H@5':>6} {'H@10':>6} {'Med':>6} {'Mean':>7} {'N':>5}")
    print("-" * 90)
    for m in SEARCH_METHODS:
        s = compute_stats(ranks_data[m]["all"])
        print(
            f"{m:<20} {s['mrr']:>6.3f} {s['hit1']:>6.3f} {s['hit3']:>6.3f} "
            f"{s['hit5']:>6.3f} {s['hit10']:>6.3f} {s['median_rank']:>6.0f} "
            f"{s['mean_rank']:>7.1f} {s['n']:>5}"
        )
    print("=" * 90)

    print("\n--- By Query Type ---")
    for qt in QUERY_TYPES:
        print(f"\n  {QUERY_TYPE_LABELS[qt]}:")
        print(f"  {'Method':<20} {'MRR':>6} {'H@1':>6} {'H@3':>6} {'H@10':>6} {'Med':>6}")
        for m in SEARCH_METHODS:
            s = compute_stats(ranks_data[m][qt])
            print(
                f"  {m:<20} {s['mrr']:>6.3f} {s['hit1']:>6.3f} {s['hit3']:>6.3f} "
                f"{s['hit10']:>6.3f} {s['median_rank']:>6.0f}"
            )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not RESULTS_JSON.exists():
        print(f"ERROR: {RESULTS_JSON} not found. Run ie_eval_02_search.py first.")
        return

    results = json.loads(RESULTS_JSON.read_text())["results"]
    print(f"Loaded {len(results)} result entries")

    PLOTS_DIR.mkdir(parents=True, exist_ok=True)

    ranks_data = collect_ranks(results)

    print_summary(ranks_data)

    plot_mrr_by_method(ranks_data, PLOTS_DIR / "mrr_by_method.png")
    plot_hit_rates(ranks_data, PLOTS_DIR / "hit_rates.png")
    plot_rank_distribution(ranks_data, PLOTS_DIR / "rank_distribution.png")
    plot_query_type_comparison(ranks_data, PLOTS_DIR / "query_type_comparison.png")

    # Save summary JSON
    summary = {
        "overall": {
            m: compute_stats(ranks_data[m]["all"])
            for m in SEARCH_METHODS
        },
        "by_query_type": {
            qt: {
                m: compute_stats(ranks_data[m][qt])
                for m in SEARCH_METHODS
            }
            for qt in QUERY_TYPES
        },
    }
    summary_path = BASE / "eval_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"\nSummary JSON saved to {summary_path}")
    print(f"Plots saved to {PLOTS_DIR}/")


if __name__ == "__main__":
    main()
