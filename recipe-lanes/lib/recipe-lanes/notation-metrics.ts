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
 * ┌── DRIFT HAZARD ───────────────────────────────────────────────────────────┐
 * │ Every geometry number in this file is HAND-MIRRORED from a real component.│
 * │ Nothing enforces that they agree: change the component and the layout     │
 * │ silently spaces by the old numbers (labels overprint) with all pure tests │
 * │ still green. If you touch any of the following, update this file in the   │
 * │ same commit — and prefer moving the number here and importing it.         │
 * │                                                                            │
 * │  components/recipe-lanes/nodes/notation-verb-node.tsx                     │
 * │    · `const SIZE = 30`               → VERB_GLYPH_SIZE                    │
 * │    · label div `top: SIZE + 3`       → VERB_LABEL_TOP_OFFSET              │
 * │    · label div `width: 130`          → VERB_LABEL_WIDTH                   │
 * │    · label div `fontSize: 9`         → VERB_LABEL_FONT_PX                 │
 * │    · label div `lineHeight: 1.25`    → LABEL_LINE_HEIGHT                  │
 * │    · label div `WebkitLineClamp`     → VERB_LABEL_MAX_LINES               │
 * │    · chip div  `top: SIZE + 38`      → VERB_CHIP_TOP_OFFSET               │
 * │    · chip div  `padding: '3px 7px'`  → VERB_CHIP_PADDING_{X,Y}            │
 * │    · chip div  `fontSize: 9`         → VERB_CHIP_FONT_PX                  │
 * │    (this component IMPORTS all of the above — it keeps no local copies)   │
 * │                                                                            │
 * │  components/recipe-lanes/nodes/minimal-node-classic.tsx                   │
 * │    · `containerSize` w-14 / w-20     → MINIMAL_CONTAINER                  │
 * │    · `verticalMinWidth` 100 / 120    → layout-notation MINIMAL_WRAPPER_*  │
 * │    · text container `text-xs`        → MINIMAL_LABEL_FONT_PX              │
 * │    · text container `px-1`           → MINIMAL_LABEL_SIDE_PADDING         │
 * │    · text container `mt-[-4px]`      → MINIMAL_LABEL_PULL_UP              │
 * │    · text container `leading-tight`  → LABEL_LINE_HEIGHT                  │
 * │    · notation clamp on the label     → LEAF_LABEL_MAX_LINES               │
 * │    · temperature/duration chip spans → MINIMAL_CHIP_HEIGHT (Tailwind)     │
 * │    · those chips' `text-[9px]`       → MINIMAL_CHIP_FONT_PX (Tailwind)    │
 * │    · those chips' `px-1` + border    → MINIMAL_CHIP_PADDING_X (Tailwind)  │
 * │    · notation-only `whitespace-nowrap` on them is what makes the          │
 * │      one-line-per-chip reserve above TRUE                                 │
 * │                                                                            │
 * │  components/recipe-lanes/nodes/notation-station-node.tsx                  │
 * │    · `const SIZE`                    → STATION_BADGE_SIZE                 │
 * │    · label div `top: SIZE + 4`       → STATION_LABEL_TOP_OFFSET           │
 * │    · label div `fontSize`            → STATION_LABEL_FONT_PX              │
 * │    · label div `maxWidth` + ellipsis → STATION_LABEL_MAX_WIDTH            │
 * │    · label div uppercase + tracking  → STATION_UPPERCASE_WIDTH_FACTOR     │
 * │    (this component IMPORTS all of the above — it keeps no local copies)   │
 * │                                                                            │
 * │  components/recipe-lanes/nodes/minimal-node-modern.tsx has BIGGER         │
 * │  geometry (80/120px containers, a ~144px left-hand text bubble for        │
 * │  actions) that this file does NOT model. Notation therefore forces the    │
 * │  CLASSIC renderer whatever the icon-theme preference says (see            │
 * │  minimal-node.tsx); supporting modern in notation means giving it         │
 * │  reserved geometry here first.                                            │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

import { CLASSIC_CONTAINER } from './edge-anchors';

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
/**
 * Horizontal padding on the verb duration chip (`padding: '3px 7px'`). The chip
 * is `white-space: nowrap`, so it does NOT wrap inside the 130px label box —
 * a long duration ("1 hour 30 minutes") is WIDER than the label above it and
 * must be counted in the spine spacing, not just in the label box.
 */
export const VERB_CHIP_PADDING_X = 7;
/** Vertical half of that same `padding: '3px 7px'`. */
export const VERB_CHIP_PADDING_Y = 3;
/** `fontSize: 9` on the chip text. */
export const VERB_CHIP_FONT_PX = 9;

// ── Leaf / state labels (minimal-node-classic.tsx, vertical text position) ──
/** `text-xs` on the MinimalNode text container. */
export const MINIMAL_LABEL_FONT_PX = 12;
/** Rendered clamp on ingredient/state labels IN NOTATION (see notationClampStyle). */
export const LEAF_LABEL_MAX_LINES = 2;
/**
 * Usable text width inside the MinimalNode wrapper: wrapper width less the
 * `px-1` padding on both sides.
 */
export const MINIMAL_LABEL_SIDE_PADDING = 4;
/**
 * Icon container side by node type — `containerSize` in minimal-node-classic
 * (`w-14` = 56 for ingredients, `w-20` = 80 for everything else). Re-exported
 * from edge-anchors rather than re-typed, since the anchor math already owns
 * this number: sizing every node from 56 under-reserved the below-spine band
 * of every non-verb ACTION by a full 24px.
 */
export const MINIMAL_CONTAINER = CLASSIC_CONTAINER;
/** The text container's `mt-[-4px]` pull-up under the icon container. */
export const MINIMAL_LABEL_PULL_UP = 4;
/** Top of the label block relative to the node box top, per node type. */
export function minimalLabelTopOffset(type: 'ingredient' | 'action' | string): number {
  const container = type === 'ingredient' ? MINIMAL_CONTAINER.ingredient : MINIMAL_CONTAINER.action;
  return container - MINIMAL_LABEL_PULL_UP;
}
/** Temperature / duration chips stacked under the label (`text-[9px]` + margins). */
export const MINIMAL_CHIP_HEIGHT = 15;
/** `text-[9px]` on those chips. */
export const MINIMAL_CHIP_FONT_PX = 9;
/**
 * Horizontal room a MinimalNode chip needs beyond its text: `px-1` (4px each
 * side) plus a 1px border each side.
 *
 * MINIMAL_CHIP_HEIGHT only reserves ONE line per chip, which is a lie unless
 * the chip refuses to wrap — and a long LLM-emitted duration
 * ("1 hour 30 minutes, plus resting") wrapped to three. In notation the chips
 * are therefore rendered `whitespace-nowrap`, which makes the single-line
 * reserve true and moves the pressure into WIDTH, where the spine spacing can
 * account for it (exactly how verb chips are handled).
 */
export const MINIMAL_CHIP_PADDING_X = 5;
/** Duration chip under a verb label. */
export const VERB_CHIP_HEIGHT = 18;

// ── Cross-edge channel (notation-edge.tsx) ──────────────────────────────────
/**
 * How deep a VERB spine item's ink reaches BELOW its row's spine line.
 *
 * The glyph is centred on the line, and the lowest thing the node owns is the
 * bottom of its duration chip — which sits further down than even a fully
 * clamped three-line label (`VERB_LABEL_TOP_OFFSET + 3 × 9 × 1.25` ≈ 67 vs
 * `VERB_CHIP_TOP_OFFSET + VERB_CHIP_HEIGHT` = 86, both measured from the box
 * top). Every notation row has verbs on it, so this is the below-spine band
 * that is always occupied.
 */
export const VERB_BELOW_SPINE_EXTENT =
  VERB_CHIP_TOP_OFFSET + VERB_CHIP_HEIGHT - VERB_GLYPH_SIZE / 2;

/**
 * Depth below the UPPER of the two rows a cross edge joins at which its long
 * horizontal run is placed — the "channel".
 *
 * Bounded from both sides, which is why it is derived rather than tuned:
 *  - it must be at least `VERB_BELOW_SPINE_EXTENT`, or the run is drawn
 *    straight through that row's verb labels and duration chips;
 *  - it must not exceed that row's below-spine extent plus
 *    `NOTATION.ROW_BREATHING` (30), or the run drops into the NEXT row's leaf
 *    icons. The shallowest a row's below-extent ever gets is a short verb with
 *    no chip (~42px, set by the station label), which still leaves the channel
 *    inside the guaranteed gap at this depth.
 * Landing exactly on the verb extent is deliberate: erring shallow clips the
 * bottom border of a duration chip (cosmetic), erring deep ploughs through the
 * next row's ingredient icons (not).
 *
 * This is NOT a router: there is one channel per edge, no crossing
 * minimisation, and two cross edges spanning the same row pair share a line.
 */
export const CROSS_EDGE_CHANNEL_OFFSET = VERB_BELOW_SPINE_EXTENT;

// ── Station badges (notation-station-node.tsx) ──────────────────────────────
/** Badge circle diameter (`SIZE` in notation-station-node.tsx). */
export const STATION_BADGE_SIZE = 52;
export const STATION_LABEL_FONT_PX = 10;
/** Label top offset from the badge box top (`top: SIZE + 4`). */
export const STATION_LABEL_TOP_OFFSET = STATION_BADGE_SIZE + 4;
/**
 * Station labels render `text-transform: uppercase` with `letter-spacing:
 * 0.04em`, both of which widen the average advance well past the lowercase
 * 0.6 factor. Applied as a multiplier on the generic estimate so the injected
 * estimator stays role-agnostic.
 */
export const STATION_UPPERCASE_WIDTH_FACTOR = 1.25;
/**
 * Hard cap on a station label's rendered width. The label is `nowrap`, so
 * without a cap a long station name has UNBOUNDED ink reaching right into the
 * first spine item. The component enforces the same cap with an ellipsis (plus
 * a `title` tooltip), so the estimate below is a bound and not a guess.
 */
export const STATION_LABEL_MAX_WIDTH = 120;

/**
 * Station-label extent: single line, uppercase-corrected, capped.
 * Used both for the label box and for the per-lane "first spine item must
 * clear the badge label" constraint.
 */
export function estimateStationLabel(label: string, metrics: LabelEstimator): LabelMetrics {
  const est = metrics(label ?? '', STATION_LABEL_FONT_PX, Number.MAX_SAFE_INTEGER, 1);
  return {
    ...est,
    width: Math.min(STATION_LABEL_MAX_WIDTH, est.width * STATION_UPPERCASE_WIDTH_FACTOR),
  };
}

/**
 * Inline style that makes a rendered label actually stop at `lines` lines.
 *
 * Applied ONLY in notation mode (via the `isNotationView` flag injected by the
 * notation branch of node building in react-flow-diagram.tsx) — every other
 * view must keep rendering unclamped, byte-identically. The layout reserves
 * row height for exactly these line counts, so a label that is free to wrap
 * further in the DOM bleeds into the row below.
 */
export function notationClampStyle(lines: number): {
  display: string;
  WebkitBoxOrient: 'vertical';
  WebkitLineClamp: number;
  overflow: string;
} {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
  };
}

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
