/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Text metrics for the "Notation" layout — PURE and server-safe.
 *
 * The notation layout used to space text-bearing nodes with fixed pixel
 * constants tuned against 2-3 word labels and never measured the text it was
 * placing, so long real-world ingredient names overprinted each other (see
 * `layout-notation.ts` header). Everything here exists so the layout can
 * *bound* every label and then space by the bound.
 *
 * Deliberately an ESTIMATE, not a measurement:
 *  - `canvas.measureText` is unavailable in the pure/unit tier and on the
 *    server, and would make the layout non-deterministic across environments.
 *  - A two-pass "render, measure, relayout" would flicker for precision the
 *    layout does not need.
 * An average-char-width factor of 0.6 × fontPx is a safe upper bound for the
 * UI sans-serif stack at these sizes; over-estimating only costs whitespace,
 * while under-estimating costs collisions — so the bias is deliberate.
 *
 * The geometry constants below mirror the real rendered components. Keep them
 * in sync:
 *   - `components/recipe-lanes/nodes/notation-verb-node.tsx` (verb glyph + label)
 *   - `components/recipe-lanes/nodes/minimal-node-classic.tsx` (leaf/state label)
 *   - `components/recipe-lanes/nodes/notation-station-node.tsx` (station badge)
 */

/** Average glyph advance as a fraction of font size. Upper bound, not exact. */
export const AVG_CHAR_WIDTH_FACTOR = 0.6;

/** Shared line-height multiplier: verb label `lineHeight: 1.25`, minimal-node `leading-tight`. */
export const LABEL_LINE_HEIGHT = 1.25;

// ── Verb labels (notation-verb-node.tsx) ────────────────────────────────────
/** Fixed label container width under a verb glyph. */
export const VERB_LABEL_WIDTH = 130;
/** `fontSize: 9` on the verb label div. */
export const VERB_LABEL_FONT_PX = 9;
/** Clamp target for verb labels (rendered clamp lands in PR 2). */
export const VERB_LABEL_MAX_LINES = 3;
/** Verb glyph circle diameter (`SIZE` in notation-verb-node.tsx). */
export const VERB_GLYPH_SIZE = 30;
/** Label top offset from the verb node box top (`top: SIZE + 3`). */
export const VERB_LABEL_TOP_OFFSET = VERB_GLYPH_SIZE + 3;
/** Duration chip top offset from the verb node box top (`top: SIZE + 38`). */
export const VERB_CHIP_TOP_OFFSET = VERB_GLYPH_SIZE + 38;

// ── Leaf / state labels (minimal-node-classic.tsx, vertical text position) ──
/** `text-xs` on the MinimalNode text container. */
export const MINIMAL_LABEL_FONT_PX = 12;
/** Clamp target for ingredient/state labels (rendered clamp lands in PR 2). */
export const LEAF_LABEL_MAX_LINES = 2;
/**
 * Usable text width inside the MinimalNode wrapper: wrapper width less the
 * `px-1` padding on both sides.
 */
export const MINIMAL_LABEL_SIDE_PADDING = 4;
/**
 * The text container sits directly under the 56px icon container with a
 * `mt-[-4px]` pull-up.
 */
export const MINIMAL_ICON_CONTAINER = 56;
export const MINIMAL_LABEL_TOP_OFFSET = MINIMAL_ICON_CONTAINER - 4;
/** Temperature / duration chips stacked under the label (`text-[9px]` + margins). */
export const MINIMAL_CHIP_HEIGHT = 15;
/** Duration chip under a verb label. */
export const VERB_CHIP_HEIGHT = 18;

// ── Station badges (notation-station-node.tsx) ──────────────────────────────
export const STATION_LABEL_FONT_PX = 10;
/** `top: SIZE + 4` where SIZE = 52. */
export const STATION_LABEL_TOP_OFFSET = 56;

/**
 * Line budget used for ROW HEIGHT reservation. Labels are not clamped in the
 * DOM yet (PR 2 of the notation-layout chain adds `-webkit-line-clamp`), so
 * row pitch must reserve room for a label that really does wrap further than
 * its clamp target. Four lines covers every name in the torture fixture.
 * Once the render clamps, this can drop to the per-role MAX_LINES.
 */
export const ROW_HEIGHT_MAX_LINES = 4;

export interface LabelMetrics {
  /** Estimated ink width, never wider than `boxWidthPx`. */
  width: number;
  /** Wrapped line count after clamping to `maxLines` (0 for empty text). */
  lines: number;
  /** `lines × fontPx × LABEL_LINE_HEIGHT`. */
  height: number;
}

/**
 * Signature of the injectable label estimator. `calculateNotationLayout` takes
 * one so tests can substitute a stricter/looser model and assert the layout
 * still satisfies its spacing invariants under it.
 */
export type LabelEstimator = (
  text: string,
  fontPx: number,
  boxWidthPx: number,
  maxLines: number,
) => LabelMetrics;

/**
 * Estimate the rendered extent of a wrapped, clamped text label.
 *
 * Guarantees relied on by the layout (and asserted in tests):
 *  - monotone non-decreasing in `text.length` for fixed box/font,
 *  - `width <= boxWidthPx`,
 *  - `height === lines * fontPx * LABEL_LINE_HEIGHT`,
 *  - `lines <= maxLines`.
 */
export const estimateLabel: LabelEstimator = (text, fontPx, boxWidthPx, maxLines) => {
  const chars = (text ?? '').trim().length;
  const box = Math.max(1, boxWidthPx);
  const cap = Math.max(1, Math.floor(maxLines));
  const lineHeight = fontPx * LABEL_LINE_HEIGHT;

  if (chars === 0) return { width: 0, lines: 0, height: 0 };

  const naturalWidth = chars * fontPx * AVG_CHAR_WIDTH_FACTOR;
  const lines = Math.min(cap, Math.max(1, Math.ceil(naturalWidth / box)));
  return {
    width: Math.min(box, naturalWidth),
    lines,
    height: lines * lineHeight,
  };
};

/** The estimator `calculateNotationLayout` uses when none is injected. */
export const defaultEstimator: LabelEstimator = estimateLabel;
