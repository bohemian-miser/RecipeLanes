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
 * "Notation" layout engine — recipes rendered as ingredient leaves feeding
 * thick per-vessel "spine" lines, with cooking verbs drawn as small emoji
 * glyphs IN the line. Pure: graph in, positions out. Mirrors the shape
 * `calculateLayout` / `calculateRepulsiveCurvesLayout` return (see layout.ts,
 * layout-force.ts) so it can slot into the same `runLayout` dispatch in
 * react-flow-diagram.tsx, plus a `kind` on edges and a `role` on nodes that
 * the notation-specific node/edge components use to pick their visual.
 *
 * ADDITIVE ONLY — does not touch calculateLayout, calculateRepulsiveCurvesLayout,
 * or any existing layout mode.
 *
 * ── Spacing model ───────────────────────────────────────────────────────────
 * The first version of this engine placed every text-bearing node with fixed
 * pixel constants (165px between actions, 115px between sibling leaves, 180px
 * between rows) that were tuned against 2-3 word labels, and measured nothing.
 * On a realistic 27-node recipe that produced 18 overlapping node boxes out of
 * 31 and 41-of-42 colliding label boxes: leaf fans overprinted each other,
 * same-depth same-lane actions were nudged by 82.5px inside a 130px label box,
 * and long ingredient names punched through the row below.
 *
 * The rule now is **bound every label, then space by the bound** — with the
 * bound coming from `notation-metrics.ts`. Concretely:
 *
 *  1. SPINE ITEMS (actions, plus any non-leaf node that isn't a floating
 *     ingredient) are placed by a left-to-right CURSOR per lane rather than by
 *     `depth × constant`. Each item sits at
 *        `max(prevX + gap(prev, this), max over spine inputs (x_input + MIN_EDGE_DX))`
 *     where `gap` is derived from the two items' estimated clamped label
 *     widths. Processing runs in global depth order so input x's are always
 *     resolved first. This is longest-path compaction: no dead space, no
 *     orphaned station badges, and no same-depth tie-break collisions. A row's
 *     first item additionally clears its own station badge's ink, so a long
 *     station name cannot print through it at the fixed ROW_START_X.
 *  2. FLOATING LEAVES get one row per lane (no stagger). Desired centre is the
 *     consumer's x; a greedy interval sweep resolves collisions and each
 *     pushed run is re-centred by half its overflow.
 *  3. ROW PITCH is dynamic and cumulative: each row reserves exactly the
 *     above-spine (leaf icon + label) and below-spine (label + chips) extent
 *     its own content needs, so row bleed is impossible by construction and
 *     leaf-less lanes compress.
 *
 * Every "bound" above is a bound only because the components actually clamp:
 * verb labels to VERB_LABEL_MAX_LINES and leaf/state labels to
 * LEAF_LABEL_MAX_LINES (in notation only), station labels to
 * STATION_LABEL_MAX_WIDTH with an ellipsis. Reserve-by-estimate and
 * clamp-on-render are one mechanism — loosening either side alone reintroduces
 * bleed.
 *
 * Trade-off accepted: same-depth nodes in different lanes no longer share an x
 * column. Rightward-only flow (every item is at least MIN_EDGE_DX right of its
 * inputs) keeps cross-lane edges readable without the shared column.
 */

import type { RecipeGraph, RecipeNode, Lane } from './types';
import { getLeafNodeIds } from './leaf-nodes';
import { classifyVerb } from './verbs';
import {
  defaultEstimator,
  estimateStationLabel,
  type LabelEstimator,
  LEAF_LABEL_MAX_LINES,
  MINIMAL_CHIP_FONT_PX,
  MINIMAL_CHIP_HEIGHT,
  MINIMAL_CHIP_PADDING_X,
  MINIMAL_CONTAINER,
  MINIMAL_LABEL_FONT_PX,
  MINIMAL_LABEL_SIDE_PADDING,
  minimalLabelTopOffset,
  STATION_BADGE_SIZE,
  STATION_LABEL_FONT_PX,
  STATION_LABEL_TOP_OFFSET,
  VERB_CHIP_HEIGHT,
  VERB_CHIP_PADDING_X,
  VERB_GLYPH_SIZE,
  VERB_CHIP_TOP_OFFSET,
  VERB_LABEL_MAX_LINES,
  VERB_LABEL_TOP_OFFSET,
  VERB_LABEL_WIDTH,
  VERB_LABEL_FONT_PX,
  LABEL_LINE_HEIGHT,
} from './notation-metrics';

export const NOTATION = {
  /** x of the station badge (row anchor). */
  STATION_X: 70,
  /** x a row's first spine item starts at, unless its station label pushes it right. */
  ROW_START_X: 200,
  /** Clear space demanded between a station badge's ink and its row's first item. */
  STATION_LABEL_GAP: 16,
  /** Top margin before the first row's ink. */
  MARGIN_TOP: 120,
  /** Layout margin around the computed bounds. */
  MARGIN: 80,

  /** Badge circle diameter — the components' own constant, not a second copy. */
  STATION_SIZE: STATION_BADGE_SIZE,
  /** Verb glyph circle diameter — likewise. */
  VERB_SIZE: VERB_GLYPH_SIZE,

  /**
   * Rendered wrapper widths of MinimalNode (see verticalMinWidth in
   * minimal-node-classic.tsx): the icon container is horizontally CENTERED in
   * a wrapper this wide. Layout node width must match the rendered width, or
   * everything derived from node.x + width/2 (edge anchors, leaf/consumer
   * alignment) lands (wrapper - container)/2 px left of the visible icon.
   * The container side itself is per node TYPE — see MINIMAL_CONTAINER.
   */
  MINIMAL_WRAPPER_INGREDIENT: 100,
  MINIMAL_WRAPPER_ACTION: 120,

  /** Absolute floor on centre-to-centre distance between two spine neighbours. */
  MIN_ACTION_GAP: 60,
  /** Clear space demanded between two neighbouring spine labels. */
  LABEL_PAD: 14,
  /** Minimum horizontal run of an edge, so flow always reads left→right. */
  MIN_EDGE_DX: 60,
  /** Extra width each leaf claims in its lane's leaf row, on top of its box. */
  LEAF_SLOT_PAD: 10,
  /** Vertical clear space between the bottom of a leaf's ink and the spine furniture. */
  LEAF_CLEARANCE: 10,
  /** Vertical clear space between two rows' reserved extents. */
  ROW_BREATHING: 30,
  /** Vertical clear space between two lost-and-found strays' ink. */
  STRAY_GAP: 30,
} as const;

export type NotationNodeRole = 'leaf' | 'verb' | 'state' | 'station';
export type NotationEdgeKind = 'spine' | 'drop' | 'cross';

/**
 * ReactFlow node type the station badge renders as. Exported so the renderer
 * and the save path share ONE literal — see `NotationVisualEdge.synthetic` for
 * why identifying synthetic canvas furniture by string shape is a trap.
 */
export const NOTATION_STATION_TYPE = 'notation-station';

/**
 * Id prefix for the synthetic per-lane station badge pseudo-nodes.
 *
 * `§` is deliberate: recipe node ids come from the LLM (`z.string()` in
 * parser.ts — unconstrained) and from hand-edited JSON, so no character is
 * *impossible*, but one outside the model's slug vocabulary makes an accidental
 * clash vanishingly unlikely. `stationNodeId` below turns "unlikely" into
 * "guaranteed" by renaming on collision, because an id collision here is not a
 * cosmetic bug: two layout nodes share an id, ReactFlow renders one, and the
 * real node vanishes from the save.
 *
 * NOTHING may identify a station badge by testing this prefix. The id shape is
 * an implementation detail of the minting site; consumers use the node's
 * `role` (in layout space), its RF `type`, or an edge's `synthetic` flag.
 */
export const NOTATION_STATION_ID_PREFIX = '§notation-station-';

/** Synthetic data payload for station badge pseudo-nodes (not in graph.nodes). */
export interface NotationStationData {
  isStation: true;
  laneId: string;
  label: string;
  laneType: Lane['type'];
  glyph: string;
}

export interface NotationVisualNode {
  id: string;
  role: NotationNodeRole;
  x: number;
  y: number;
  width: number;
  height: number;
  laneId: string;
  /**
   * Distance from this node's box top DOWN to its row's spine line, as the
   * layout placed it (`height / 2` for a spine item, the lane's whole
   * above-spine extent for a floating leaf; absent on stations and strays,
   * which belong to no row).
   *
   * Recorded because the restore overlay (issue #268) moves real nodes to
   * saved ys but not the synthetic badges, and putting a badge back on its row
   * afterwards needs to recover the row's line from whatever node is left —
   * including a lane that holds nothing but leaves.
   */
  spineOffset?: number;
  /**
   * True for "lost and found" nodes parked below the last row because no
   * declared lane could hold them. They are NOT part of any lane's spine, so
   * anything reasoning about a row (station anchoring, row extents) must skip
   * them even when their `laneId` happens to name a real lane.
   */
  stray?: true;
  /** Real RecipeNode data for leaf/verb/state nodes; synthetic payload for stations. */
  data: RecipeNode | NotationStationData;
}

export interface NotationVisualEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: NotationEdgeKind;
  /**
   * Canvas furniture, not a recipe relationship: the station→first-step spine
   * stub. Set at the ONE place that mints it and carried into the ReactFlow
   * edge's `data`, because every consumer that walks rendered edges has to skip
   * it — `buildGraphForSave` derives node `inputs` from them (persisting one
   * would write a dangling reference), and the edge walkers would treat the
   * undraggable badge as a branch member.
   *
   * This flag exists so no consumer has to infer "syntheticness" from an id
   * prefix. A real recipe node may legitimately be called
   * `notation-station-prep`, and pattern-matching ids silently corrupted its
   * edges.
   */
  synthetic?: true;
}

export interface NotationVisualLane {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface NotationLayoutGraph {
  nodes: NotationVisualNode[];
  edges: NotationVisualEdge[];
  lanes: NotationVisualLane[];
  width: number;
  height: number;
}

export interface NotationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STATION_GLYPH: Record<Lane['type'], string> = {
  prep: '🔪',
  cook: '🍳',
  serve: '🍽️',
};

/**
 * Mint the id for a lane's station badge, guaranteed not to collide with any
 * real node id in this graph.
 *
 * The prefix alone is only *probably* unique (see NOTATION_STATION_ID_PREFIX:
 * recipe ids are unconstrained strings). A collision is severe — two layout
 * nodes with one id means ReactFlow drops one, and since `buildGraphForSave`
 * intersects `graph.nodes` with the RENDERED nodes, the real node is then
 * deleted from the recipe on the next save. So widen until it is unique.
 */
function stationNodeId(laneId: string, takenIds: ReadonlySet<string>): string {
  let id = `${NOTATION_STATION_ID_PREFIX}${laneId}`;
  while (takenIds.has(id)) id = `${id}§`;
  return id;
}

function isStationData(data: RecipeNode | NotationStationData): data is NotationStationData {
  return (data as NotationStationData).isStation === true;
}

/**
 * Longest-path depth from any leaf (in-degree 0 node), used to order spine
 * items within a lane and to drive the global placement sweep. Cross-lane
 * inputs count too, so an action that depends on another lane's output sorts
 * after it even though the dependency isn't rendered as a same-lane spine edge.
 */
function computeDepths(graph: RecipeGraph): Map<string, number> {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(id: string): number {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard — treat as depth 0
    visiting.add(id);
    const node = byId.get(id);
    const inputs = (node?.inputs ?? []).filter(i => byId.has(i));
    const d = inputs.length === 0 ? 0 : 1 + Math.max(...inputs.map(depthOf));
    visiting.delete(id);
    depth.set(id, d);
    return d;
  }

  for (const n of graph.nodes) depthOf(n.id);
  return depth;
}

// ── Per-role geometry ────────────────────────────────────────────────────────
// Every number below mirrors a real rendered component; see notation-metrics.ts
// for where each one comes from.

/** Wrapper width of a MinimalNode-rendered node, which must match the DOM. */
function minimalWrapperWidth(node: RecipeNode): number {
  return node.type === 'ingredient'
    ? NOTATION.MINIMAL_WRAPPER_INGREDIENT
    : NOTATION.MINIMAL_WRAPPER_ACTION;
}

/**
 * Icon-container side of a MinimalNode-rendered node. Ingredients get the
 * compact 56px container, everything else (non-verb ACTIONS placed on a spine,
 * and lost-and-found strays) the 80px one — see MINIMAL_CONTAINER. Using 56 for
 * both under-reserved the below-spine band of every non-verb action by 24px.
 */
function minimalContainerSize(node: RecipeNode): number {
  return node.type === 'ingredient' ? MINIMAL_CONTAINER.ingredient : MINIMAL_CONTAINER.action;
}

/**
 * Stacked temperature/duration chips under a MinimalNode label.
 *
 * One line per chip — true only because notation renders them `nowrap`
 * (MINIMAL_CHIP_PADDING_X explains why). Their width is handled separately in
 * `minimalChipWidth`, since nowrap trades height for width.
 */
function minimalChipExtent(node: RecipeNode): number {
  const chips = (node.temperature ? 1 : 0) + (node.duration ? 1 : 0);
  return chips === 0 ? 0 : 4 + chips * MINIMAL_CHIP_HEIGHT;
}

/** Widest nowrap chip under a MinimalNode label. */
function minimalChipWidth(node: RecipeNode, metrics: LabelEstimator): number {
  let widest = 0;
  for (const chip of [node.temperature, node.duration]) {
    if (!chip) continue;
    const text = metrics(chip, MINIMAL_CHIP_FONT_PX, Number.MAX_SAFE_INTEGER, 1);
    widest = Math.max(widest, text.width + MINIMAL_CHIP_PADDING_X * 2);
  }
  return widest;
}

/**
 * Width of a verb's duration chip. The chip is `nowrap`, so unlike the label
 * above it, it is NOT bounded by VERB_LABEL_WIDTH — a long duration is the
 * widest ink the node owns and has to be counted in the spine spacing.
 */
function verbChipWidth(node: RecipeNode, metrics: LabelEstimator): number {
  if (!node.duration) return 0;
  const chipText = metrics(node.duration, VERB_LABEL_FONT_PX, Number.MAX_SAFE_INTEGER, 1);
  return chipText.width + VERB_CHIP_PADDING_X * 2;
}

/**
 * Widest ink a spine/leaf item owns: its wrapped label, or one of its NOWRAP
 * chips — which are bounded by nothing and are routinely the widest thing on
 * the node ("1 hour 30 minutes" under a three-letter verb).
 */
function nodeInkWidth(node: NotationVisualNode, metrics: LabelEstimator): number {
  const data = node.data as RecipeNode;
  if (node.role === 'verb') {
    const label = metrics(data.text ?? '', VERB_LABEL_FONT_PX, VERB_LABEL_WIDTH, VERB_LABEL_MAX_LINES);
    return Math.max(label.width, verbChipWidth(data, metrics));
  }
  const label = metrics(
    data.text ?? '',
    MINIMAL_LABEL_FONT_PX,
    node.width - MINIMAL_LABEL_SIDE_PADDING * 2,
    LEAF_LABEL_MAX_LINES,
  );
  return Math.max(label.width, minimalChipWidth(data, metrics));
}

/**
 * Sort key shared by the per-lane spine ordering and the global placement
 * sweep: longest-path depth first, then the node's position in `graph.nodes`
 * as a stable tie-break. Both call sites MUST agree, or an item can be placed
 * before the neighbour its cursor gap is measured against.
 */
function byDepthThenIndex(
  depths: Map<string, number>,
  graphIndex: Map<string, number>,
): (a: { id: string }, b: { id: string }) => number {
  return (a, b) => {
    const da = depths.get(a.id) ?? 0;
    const db = depths.get(b.id) ?? 0;
    if (da !== db) return da - db;
    return (graphIndex.get(a.id) ?? 0) - (graphIndex.get(b.id) ?? 0);
  };
}

/**
 * Estimated label box of a placed node, in layout coordinates. Exported so the
 * layout tests (and any future renderer) compute the SAME occupied region the
 * spacing math was derived from, rather than re-deriving it from the component
 * styles by hand.
 *
 * `maxLines` defaults to the per-role RENDERED clamp (verbs 3, leaf/state 2),
 * which the notation node components enforce with `-webkit-line-clamp` — so
 * the reservation and the render agree by construction.
 */
export function notationLabelBox(
  node: NotationVisualNode,
  metrics: LabelEstimator = defaultEstimator,
  maxLines?: number,
): NotationBox {
  const cx = node.x + node.width / 2;

  if (node.role === 'station') {
    const label = isStationData(node.data) ? node.data.label : '';
    const est = estimateStationLabel(label, metrics);
    return {
      x: cx - est.width / 2,
      y: node.y + STATION_LABEL_TOP_OFFSET,
      width: est.width,
      height: est.height,
    };
  }

  const data = node.data as RecipeNode;

  if (node.role === 'verb') {
    const lines = maxLines ?? VERB_LABEL_MAX_LINES;
    const est = metrics(data.text ?? '', VERB_LABEL_FONT_PX, VERB_LABEL_WIDTH, lines);
    const top = node.y + VERB_LABEL_TOP_OFFSET;
    let bottom = top + est.height;
    let width = est.width;
    if (data.duration) {
      bottom = Math.max(bottom, node.y + VERB_CHIP_TOP_OFFSET + VERB_CHIP_HEIGHT);
      width = Math.max(width, verbChipWidth(data, metrics));
    }
    return { x: cx - width / 2, y: top, width, height: bottom - top };
  }

  // 'leaf' and 'state' both render as MinimalNode: icon container on top,
  // wrapped label below it, optional chips below that. The container side (and
  // therefore the label's top) depends on the node TYPE, not the role.
  const est = metrics(
    data.text ?? '',
    MINIMAL_LABEL_FONT_PX,
    node.width - MINIMAL_LABEL_SIDE_PADDING * 2,
    maxLines ?? LEAF_LABEL_MAX_LINES,
  );
  // A nowrap chip can be wider than the wrapped label above it, and it is
  // centred on the same axis — so it, not the label, sets the box width.
  const width = Math.max(est.width, minimalChipWidth(data, metrics));
  return {
    x: cx - width / 2,
    y: node.y + minimalLabelTopOffset(data.type),
    width,
    height: est.height + minimalChipExtent(data),
  };
}

/**
 * Half the horizontal extent a spine item claims — the widest of its icon box,
 * its estimated label box and (for verbs) its nowrap duration chip. Two spine
 * neighbours are spaced by the sum of their half-extents plus LABEL_PAD, which
 * is what makes label collisions impossible along a spine.
 */
export function notationSpineHalfExtent(
  node: NotationVisualNode,
  metrics: LabelEstimator = defaultEstimator,
): number {
  return Math.max(node.width, nodeInkWidth(node, metrics)) / 2;
}

/**
 * Right edge of a lane's station badge ink — the badge circle or its (capped,
 * uppercase-corrected) label, whichever is wider, centred on STATION_X.
 * The row's first spine item must clear this, or a long station name prints
 * straight through it at the fixed ROW_START_X.
 */
export function notationStationInkRight(
  label: string,
  metrics: LabelEstimator = defaultEstimator,
): number {
  const labelWidth = estimateStationLabel(label, metrics).width;
  return NOTATION.STATION_X + Math.max(NOTATION.STATION_SIZE, labelWidth) / 2;
}

/** Ink extent of a spine item above and below its row's spine line. */
function spineItemExtents(
  node: NotationVisualNode,
  rowY: number,
  metrics: LabelEstimator,
): { above: number; below: number } {
  const label = notationLabelBox(node, metrics);
  const above = rowY - node.y;
  const below = Math.max(node.y + node.height, label.y + label.height) - rowY;
  return { above, below };
}

/** Ink height of a MinimalNode-rendered node, measured from its box top. */
function minimalInkHeight(node: NotationVisualNode, metrics: LabelEstimator): number {
  const label = notationLabelBox(node, metrics);
  return Math.max(node.height, label.y + label.height - node.y);
}

/** Half-extent a leaf claims in its lane's leaf row. */
function leafSlotWidth(node: NotationVisualNode, metrics: LabelEstimator): number {
  const label = notationLabelBox(node, metrics);
  return Math.max(node.width, label.width) + NOTATION.LEAF_SLOT_PAD;
}

interface LeafPlacement {
  node: NotationVisualNode;
  rowLaneId: string;
  desiredX: number;
  slot: number;
}

export function calculateNotationLayout(
  graph: RecipeGraph,
  metrics: LabelEstimator = defaultEstimator,
): NotationLayoutGraph {
  const nodes: NotationVisualNode[] = [];
  const edges: NotationVisualEdge[] = [];
  const visualLanes: NotationVisualLane[] = [];

  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const leafIds = getLeafNodeIds(graph);
  const depths = computeDepths(graph);
  const graphIndex = new Map(graph.nodes.map((n, i) => [n.id, i]));

  const laneOrder = graph.lanes.length > 0 ? graph.lanes : [];
  const laneIndexOf = new Map(laneOrder.map((l, i) => [l.id, i]));

  // A node floats as a leaf iff it is an in-degree-0 INGREDIENT. Everything
  // else (actions — including zero-input ones like "Preheat the oven" — and
  // ingredients that something flows into) lives on a spine, so every node has
  // exactly one primary placement pass and the two can never double-place.
  const isFloatingLeaf = (n: RecipeNode) => n.type === 'ingredient' && leafIds.has(n.id);

  // ── 1. Spine items, ordered per lane, placed by a label-aware cursor ───────
  const spineByLane = new Map<string, NotationVisualNode[]>();
  const allSpineItems: NotationVisualNode[] = [];

  const spineOrder = byDepthThenIndex(depths, graphIndex);

  for (const lane of laneOrder) {
    const items = graph.nodes
      .filter(n => n.laneId === lane.id && !isFloatingLeaf(n))
      .sort(spineOrder)
      .map<NotationVisualNode>(n => {
        // Actions that match a cooking verb render as a glyph IN the spine
        // line; everything else renders as a MinimalNode sitting on it.
        const role: NotationNodeRole = n.type === 'action' && classifyVerb(n.text) ? 'verb' : 'state';
        const width = role === 'verb' ? NOTATION.VERB_SIZE : minimalWrapperWidth(n);
        const height = role === 'verb' ? NOTATION.VERB_SIZE : minimalContainerSize(n);
        return { id: n.id, role, x: 0, y: 0, width, height, laneId: lane.id, data: n };
      });
    spineByLane.set(lane.id, items);
    allSpineItems.push(...items);
  }

  // Global sweep in ascending depth (then graph order). Because depth(n) is
  // strictly greater than the depth of every input, an item's inputs are always
  // already placed when it is reached, so the MIN_EDGE_DX constraint can be
  // applied in a single pass — no iteration, no solver.
  const placementOrder = [...allSpineItems].sort(spineOrder);

  // A row's first item must clear its own station badge's ink (badge circle or
  // uppercase label, whichever is wider) — ROW_START_X alone is not enough for
  // a lane with a long name.
  const laneStartX = new Map<string, number>();
  for (const lane of laneOrder) {
    laneStartX.set(lane.id, notationStationInkRight(lane.label, metrics) + NOTATION.STATION_LABEL_GAP);
  }

  const spineX = new Map<string, number>();
  const laneCursor = new Map<string, NotationVisualNode>(); // last placed item per lane

  for (const item of placementOrder) {
    const prev = laneCursor.get(item.laneId);
    let x: number;
    if (!prev) {
      // laneStartX has an entry for every declared lane, and spine items are
      // only ever built per declared lane — assert rather than fall back.
      x = Math.max(
        NOTATION.ROW_START_X,
        laneStartX.get(item.laneId)! + notationSpineHalfExtent(item, metrics),
      );
    } else {
      const gap = Math.max(
        NOTATION.MIN_ACTION_GAP,
        notationSpineHalfExtent(prev, metrics) + notationSpineHalfExtent(item, metrics) + NOTATION.LABEL_PAD,
      );
      x = (spineX.get(prev.id) ?? NOTATION.ROW_START_X) + gap;
    }
    for (const inputId of (item.data as RecipeNode).inputs ?? []) {
      const inputX = spineX.get(inputId);
      if (inputX !== undefined) x = Math.max(x, inputX + NOTATION.MIN_EDGE_DX);
    }
    spineX.set(item.id, x);
    item.x = x - item.width / 2;
    laneCursor.set(item.laneId, item);
  }

  // ── 2. Leaves: one row per lane, greedy interval sweep, runs re-centred ────
  // A leaf floats above the row of the FIRST action that consumes it (which is
  // not necessarily its own lane's row), so leaves are grouped by the row they
  // actually land on.
  const consumerOfLeaf = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.type !== 'action') continue;
    for (const inputId of node.inputs ?? []) {
      if (leafIds.has(inputId) && byId.get(inputId)?.type === 'ingredient' && !consumerOfLeaf.has(inputId)) {
        consumerOfLeaf.set(inputId, node.id);
      }
    }
  }

  const leafPlacements: LeafPlacement[] = [];
  for (const node of graph.nodes) {
    if (!isFloatingLeaf(node)) continue;
    const consumerId = consumerOfLeaf.get(node.id);
    const consumer = consumerId ? byId.get(consumerId) : undefined;
    const consumerX = consumerId ? spineX.get(consumerId) : undefined;
    // Leaves nothing consumes (orphaned / dangling inputs) still need a
    // position so they aren't silently dropped — anchor them at their own
    // lane's row start and let the sweep pack them.
    const rowLaneId = consumer && consumerX !== undefined ? consumer.laneId : node.laneId;
    // A leaf whose row isn't a declared lane has no reserved band to float in;
    // let the catch-all sweep park it instead of stacking it on lane 0.
    if (!laneIndexOf.has(rowLaneId)) continue;
    const visual: NotationVisualNode = {
      id: node.id,
      role: 'leaf',
      x: 0,
      y: 0,
      width: NOTATION.MINIMAL_WRAPPER_INGREDIENT,
      height: minimalContainerSize(node),
      laneId: rowLaneId,
      data: node,
    };
    leafPlacements.push({
      node: visual,
      rowLaneId,
      desiredX: consumerX ?? NOTATION.ROW_START_X,
      slot: leafSlotWidth(visual, metrics),
    });
  }

  const leavesByRow = new Map<string, LeafPlacement[]>();
  for (const p of leafPlacements) {
    const list = leavesByRow.get(p.rowLaneId) ?? [];
    list.push(p);
    leavesByRow.set(p.rowLaneId, list);
  }

  for (const [, row] of leavesByRow) {
    // Stable sort: desired x, then the order the leaves appear in graph.nodes.
    const sorted = [...row].sort((a, b) => {
      if (a.desiredX !== b.desiredX) return a.desiredX - b.desiredX;
      return (graphIndex.get(a.node.id) ?? 0) - (graphIndex.get(b.node.id) ?? 0);
    });

    const xs: number[] = [];
    const pushed: boolean[] = [];
    sorted.forEach((p, i) => {
      const floor =
        i === 0 ? -Infinity : xs[i - 1] + (sorted[i - 1].slot + p.slot) / 2;
      const x = Math.max(p.desiredX, floor);
      xs.push(x);
      pushed.push(x > p.desiredX);
    });

    // Each maximal run of pushed leaves slid right; slide the whole run back by
    // half its overflow so the fan stays visually centred on its consumers,
    // without breaking the disjointness the sweep just established.
    let runStart = 0;
    for (let i = 0; i < sorted.length; i++) {
      const isRunEnd = i === sorted.length - 1 || !pushed[i + 1];
      if (!isRunEnd) continue;
      const j = runStart;
      const overflow = xs[i] - sorted[i].desiredX;
      const floorX = Math.max(
        NOTATION.ROW_START_X - sorted[j].slot / 2,
        j > 0 ? xs[j - 1] + (sorted[j - 1].slot + sorted[j].slot) / 2 : -Infinity,
      );
      const shift = Math.max(0, Math.min(overflow / 2, xs[j] - floorX));
      if (shift > 0) for (let m = j; m <= i; m++) xs[m] -= shift;
      runStart = i + 1;
    }

    sorted.forEach((p, i) => { p.node.x = xs[i] - p.node.width / 2; });
  }

  // ── 3. Dynamic row pitch from each lane's own above/below extents ──────────
  // Provisional rowY = 0 so extents are measured relative to the spine; the
  // real y is folded in afterwards.
  const aboveExtent = new Map<string, number>();
  const belowExtent = new Map<string, number>();
  const stationAbove = NOTATION.STATION_SIZE / 2;
  const stationBelow =
    NOTATION.STATION_SIZE / 2 +
    (STATION_LABEL_TOP_OFFSET - NOTATION.STATION_SIZE) +
    STATION_LABEL_FONT_PX * LABEL_LINE_HEIGHT;

  for (const lane of laneOrder) {
    const spine = spineByLane.get(lane.id) ?? [];
    let above = stationAbove;
    let below = stationBelow;
    for (const item of spine) {
      // Place the item's box relative to a spine at y = 0 to measure it.
      item.y = -item.height / 2;
      const ext = spineItemExtents(item, 0, metrics);
      above = Math.max(above, ext.above);
      below = Math.max(below, ext.below);
    }
    const rowLeaves = leavesByRow.get(lane.id) ?? [];
    if (rowLeaves.length > 0) {
      let ink = 0;
      for (const p of rowLeaves) {
        p.node.y = 0;
        ink = Math.max(ink, minimalInkHeight(p.node, metrics));
      }
      above = ink + NOTATION.LEAF_CLEARANCE + above;
    }
    aboveExtent.set(lane.id, above);
    belowExtent.set(lane.id, below);
  }

  // INVARIANT from here down: every lane in `laneOrder` has an entry in
  // aboveExtent / belowExtent / rowYByLane (the loop above just wrote all
  // three), and every id reaching `rowY` is a declared lane — spine items are
  // built per lane, and leaf placements skip rows that are not declared lanes.
  // The lookups below therefore assert rather than substitute a plausible
  // fallback: a miss is a bug in this function, and silently laying the row out
  // at MARGIN_TOP would hide it behind a merely-odd-looking canvas.
  const rowYByLane = new Map<string, number>();
  let cursorY: number = NOTATION.MARGIN_TOP;
  laneOrder.forEach((lane, i) => {
    if (i > 0) {
      cursorY += belowExtent.get(laneOrder[i - 1].id)! + NOTATION.ROW_BREATHING;
    }
    const y = cursorY + aboveExtent.get(lane.id)!;
    rowYByLane.set(lane.id, y);
    cursorY = y;
  });

  const rowY = (laneId: string): number => rowYByLane.get(laneId)!;

  // ── 4. Emit stations, spine items and leaves at their final y ─────────────
  // Station ids are minted against the real node ids so a recipe node called
  // `§notation-station-<laneId>` cannot collide with the badge (finding: a
  // duplicate id makes ReactFlow drop one node, and the save then deletes it).
  const realNodeIds = new Set(graph.nodes.map(n => n.id));
  const stationIdByLane = new Map<string, string>();

  for (const lane of laneOrder) {
    const y = rowY(lane.id);
    const above = aboveExtent.get(lane.id)!;
    const below = belowExtent.get(lane.id)!;
    const stationId = stationNodeId(lane.id, realNodeIds);
    stationIdByLane.set(lane.id, stationId);
    nodes.push({
      id: stationId,
      role: 'station',
      x: NOTATION.STATION_X - NOTATION.STATION_SIZE / 2,
      y: y - NOTATION.STATION_SIZE / 2,
      width: NOTATION.STATION_SIZE,
      height: NOTATION.STATION_SIZE,
      laneId: lane.id,
      data: {
        isStation: true,
        laneId: lane.id,
        label: lane.label,
        laneType: lane.type,
        glyph: STATION_GLYPH[lane.type] ?? '🍳',
      },
    });
    visualLanes.push({
      id: lane.id,
      label: lane.label,
      x: 0,
      y: y - above - NOTATION.ROW_BREATHING / 2,
      width: 0,
      height: above + below + NOTATION.ROW_BREATHING,
      color: 'transparent',
    });

    for (const item of spineByLane.get(lane.id) ?? []) {
      item.y = y - item.height / 2;
      item.spineOffset = item.height / 2;
      nodes.push(item);
    }
  }

  for (const p of leafPlacements) {
    const above = aboveExtent.get(p.rowLaneId)!;
    p.node.y = rowY(p.rowLaneId) - above;
    // A leaf sits a whole above-spine extent above its row's line. Recording
    // that lets a badge be put back on a leaf-ONLY row after a restore.
    p.node.spineOffset = above;
    nodes.push(p.node);
  }

  // ── 5. Catch-all sweep: EVERY graph node must be placed exactly once ───────
  // The passes above cover every node whose laneId matches a declared lane. A
  // node pointing at a lane that doesn't exist (hand-edited JSON, a stale
  // applyPatch) would otherwise be dropped — and a node missing from the layout
  // doesn't just fail to render: buildGraphForSave intersects graph.nodes with
  // the rendered RF nodes, so saving in Notation mode would PERMANENTLY DELETE
  // it from the recipe. These land in a "lost and found" column below the last
  // row, where they cannot collide with real content.
  //
  // The column pitch is CUMULATIVE over each stray's own estimated ink (a
  // 2-line label plus both chips reaches ~146px, past any fixed pitch), not a
  // constant — otherwise the lost-and-found overlaps itself.
  const placedIds = new Set(nodes.map(n => n.id));
  // `laneOrder` really can be empty here (a graph with nodes but no lanes), so
  // this one is a genuine fallback, not a defensive `??`.
  const lastLane = laneOrder[laneOrder.length - 1];
  let strayY =
    cursorY + (lastLane ? belowExtent.get(lastLane.id)! : 0) + NOTATION.ROW_BREATHING;
  for (const node of graph.nodes) {
    if (placedIds.has(node.id)) continue;
    placedIds.add(node.id);
    const stray: NotationVisualNode = {
      id: node.id,
      role: 'state',
      x: NOTATION.ROW_START_X - minimalWrapperWidth(node) / 2,
      y: strayY,
      width: minimalWrapperWidth(node),
      height: minimalContainerSize(node),
      laneId: node.laneId,
      stray: true,
      data: node,
    };
    nodes.push(stray);
    strayY += minimalInkHeight(stray, metrics) + NOTATION.STRAY_GAP;
  }

  // ── 6. Edges, classified ──────────────────────────────────────────────────
  for (const node of graph.nodes) {
    for (const inputId of node.inputs ?? []) {
      const source = byId.get(inputId);
      if (!source) continue;
      let kind: NotationEdgeKind;
      if (source.type === 'ingredient') {
        kind = 'drop';
      } else if (source.laneId === node.laneId) {
        kind = 'spine';
      } else {
        kind = 'cross';
      }
      edges.push({ id: `${inputId}->${node.id}`, sourceId: inputId, targetId: node.id, kind });
    }
  }

  // Synthetic spine stub from each station badge to its row's first item, so
  // the badge reads as the row's anchor rather than a floating decoration.
  //
  // THE ONE PLACE A SYNTHETIC EDGE IS MINTED. It is marked here, and the flag
  // rides all the way into the ReactFlow edge's `data`, so that every consumer
  // (the save path, the edge walkers, the physics sim, the re-anchor below)
  // tests the marker instead of re-deriving "is this synthetic?" from the id.
  for (const lane of laneOrder) {
    const first = (spineByLane.get(lane.id) ?? [])[0];
    if (!first) continue;
    const stationId = stationIdByLane.get(lane.id)!;
    edges.push({
      id: `${stationId}->${first.id}`,
      sourceId: stationId,
      targetId: first.id,
      kind: 'spine',
      synthetic: true,
    });
  }

  // ── 7. Bounds ─────────────────────────────────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const label = notationLabelBox(n, metrics);
    minX = Math.min(minX, n.x, label.x);
    minY = Math.min(minY, n.y, label.y);
    maxX = Math.max(maxX, n.x + n.width, label.x + label.width);
    maxY = Math.max(maxY, n.y + n.height, label.y + label.height);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  const width = Math.max(800, maxX - minX + NOTATION.MARGIN * 2);
  const height = Math.max(600, maxY - minY + NOTATION.MARGIN * 2);

  visualLanes.forEach(l => { l.width = width; });

  return { nodes, edges, lanes: visualLanes, width, height };
}

/**
 * Re-anchor every station badge onto its row's ACTUAL leftmost spine item.
 *
 * `calculateNotationLayout` is a from-scratch engine, so saved/dragged
 * positions (issue #268) can only be applied to its OUTPUT. But the overlay
 * skips station badges — they are synthetic and not draggable — which leaves
 * each badge on the freshly-computed row pitch while its row's real nodes jump
 * to their saved ys. Any layout saved before the dynamic-pitch change therefore
 * renders with detached badges and diagonal stub edges climbing to them.
 *
 * Running this AFTER the overlay puts the badge back on its row's line and
 * re-targets the stub at whatever is now leftmost (a drag can reorder a row).
 * On a fresh layout it is a no-op, so the overlay path and the fresh path stay
 * on one code path.
 */
export function reanchorNotationStations(layout: NotationLayoutGraph): NotationLayoutGraph {
  const centerX = (n: NotationVisualNode) => n.x + n.width / 2;

  // Which lane each station badge belongs to, resolved from the NODE'S ROLE —
  // never from its id. Testing an id prefix here was a corruption bug: a real
  // recipe node called `notation-station-<an existing laneId>` matched, and the
  // edge pass below silently re-pointed its REAL edges at another node, which
  // `buildGraphForSave` then wrote into the recipe as changed `inputs`.
  const laneOfStationNode = new Map<string, string>();
  for (const n of layout.nodes) {
    if (n.role === 'station') laneOfStationNode.set(n.id, n.laneId);
  }
  if (laneOfStationNode.size === 0) return layout;

  // A row's line is recovered from its leftmost surviving member. Spine items
  // are preferred; a lane holding nothing but floating leaves still has a row,
  // and its badge would otherwise keep the pre-overlay pitch forever. Strays
  // never anchor: they render as 'state' and can carry a real laneId, but they
  // sit in a column far below the rows.
  const spineAnchorByLane = new Map<string, NotationVisualNode>();
  const leafAnchorByLane = new Map<string, NotationVisualNode>();
  for (const n of layout.nodes) {
    if (n.stray) continue;
    const into =
      n.role === 'verb' || n.role === 'state' ? spineAnchorByLane
        : n.role === 'leaf' ? leafAnchorByLane
        : undefined;
    if (!into) continue;
    const current = into.get(n.laneId);
    if (!current || centerX(n) < centerX(current)) into.set(n.laneId, n);
  }

  const anchorFor = (laneId: string) =>
    spineAnchorByLane.get(laneId) ?? leafAnchorByLane.get(laneId);

  // `spineOffset` is how far below the node's own top its row's line ran when
  // the layout placed it, so this works for a leaf (a whole above-spine extent)
  // exactly as it does for a spine item (half its height).
  const spineYOf = (anchor: NotationVisualNode) =>
    anchor.y + (anchor.spineOffset ?? anchor.height / 2);

  const nodes = layout.nodes.map(n => {
    if (n.role !== 'station') return n;
    const anchor = anchorFor(n.laneId);
    if (!anchor) return n;
    const y = spineYOf(anchor) - n.height / 2;
    return y === n.y ? n : { ...n, y };
  });

  const edges = layout.edges.map(e => {
    // Only the synthetic stub is ours to re-point, and only the minting site
    // gets to say which edges those are.
    if (!e.synthetic) return e;
    const laneId = laneOfStationNode.get(e.sourceId);
    if (laneId === undefined) return e;
    // Leaf-only lanes have no stub edge to move; the badge above is enough.
    const anchor = spineAnchorByLane.get(laneId);
    if (!anchor || anchor.id === e.targetId) return e;
    return { ...e, id: `${e.sourceId}->${anchor.id}`, targetId: anchor.id };
  });

  return { ...layout, nodes, edges };
}
