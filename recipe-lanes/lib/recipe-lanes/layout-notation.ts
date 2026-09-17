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
 *     orphaned station badges, and no same-depth tie-break collisions.
 *  2. FLOATING LEAVES get one row per lane (no stagger). Desired centre is the
 *     consumer's x; a greedy interval sweep resolves collisions and each
 *     pushed run is re-centred by half its overflow.
 *  3. ROW PITCH is dynamic and cumulative: each row reserves exactly the
 *     above-spine (leaf icon + label) and below-spine (label + chips) extent
 *     its own content needs, so row bleed is impossible by construction and
 *     leaf-less lanes compress.
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
  type LabelEstimator,
  LEAF_LABEL_MAX_LINES,
  MINIMAL_CHIP_HEIGHT,
  MINIMAL_LABEL_FONT_PX,
  MINIMAL_LABEL_SIDE_PADDING,
  MINIMAL_LABEL_TOP_OFFSET,
  ROW_HEIGHT_MAX_LINES,
  STATION_LABEL_FONT_PX,
  STATION_LABEL_TOP_OFFSET,
  VERB_CHIP_HEIGHT,
  VERB_CHIP_TOP_OFFSET,
  VERB_LABEL_MAX_LINES,
  VERB_LABEL_TOP_OFFSET,
  VERB_LABEL_WIDTH,
  VERB_LABEL_FONT_PX,
  LABEL_LINE_HEIGHT,
} from './notation-metrics';

export const NOTATION = {
  /** Minimum vertical gap between two rows' ink. Row pitch itself is dynamic. */
  ROW_GAP: 180,
  /** Legacy fixed action pitch. Superseded by the label-aware cursor (see MIN_ACTION_GAP). */
  ACTION_SPACING: 165,
  /** Legacy fixed leaf float height. Superseded by the per-lane above-spine extent. */
  LEAF_OFFSET_Y: 95,
  /** Legacy fixed leaf fan pitch. Superseded by per-leaf slot widths (see LEAF_SLOT_PAD). */
  LEAF_SIBLING_SPACING: 115,
  /** x of the station badge (row anchor). */
  STATION_X: 70,
  /** x of the first action in a row. */
  ROW_START_X: 200,
  /** Top margin before the first row's ink. */
  MARGIN_TOP: 120,
  /** Layout margin around the computed bounds. */
  MARGIN: 80,

  STATION_SIZE: 52,
  VERB_SIZE: 30,
  LEAF_SIZE: 56,

  /**
   * Rendered wrapper widths of MinimalNode (see verticalMinWidth in
   * minimal-node-classic.tsx): the icon container is horizontally CENTERED in
   * a wrapper this wide. Layout node width must match the rendered width, or
   * everything derived from node.x + width/2 (edge anchors, leaf/consumer
   * alignment) lands (wrapper - LEAF_SIZE)/2 px left of the visible icon.
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
} as const;

export type NotationNodeRole = 'leaf' | 'verb' | 'state' | 'station';
export type NotationEdgeKind = 'spine' | 'drop' | 'cross';

/** Id prefix of the synthetic per-lane station badge pseudo-nodes. */
export const NOTATION_STATION_ID_PREFIX = 'notation-station-';

/**
 * True for the synthetic station-badge pseudo-nodes this layout emits.
 *
 * These are NOT in `graph.nodes`, so anything that round-trips the rendered
 * ReactFlow graph back into recipe data must skip them — both as nodes (they
 * would be persisted as phantom layout rows) and as EDGE ENDPOINTS: the layout
 * emits a synthetic `station -> first action` spine edge purely so the badge
 * reads as its row's anchor, and `buildGraphForSave` derives `inputs` from
 * rendered edges.
 */
export function isNotationStationId(id: string): boolean {
  return id.startsWith(NOTATION_STATION_ID_PREFIX);
}

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
  /** Real RecipeNode data for leaf/verb/state nodes; synthetic payload for stations. */
  data: RecipeNode | NotationStationData;
}

export interface NotationVisualEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: NotationEdgeKind;
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

function stationNodeId(laneId: string): string {
  return `${NOTATION_STATION_ID_PREFIX}${laneId}`;
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

/** Stacked temperature/duration chips under a MinimalNode label. */
function minimalChipExtent(node: RecipeNode): number {
  const chips = (node.temperature ? 1 : 0) + (node.duration ? 1 : 0);
  return chips === 0 ? 0 : 4 + chips * MINIMAL_CHIP_HEIGHT;
}

/**
 * Estimated label box of a placed node, in layout coordinates. Exported so the
 * layout tests (and any future renderer) compute the SAME occupied region the
 * spacing math was derived from, rather than re-deriving it from the component
 * styles by hand.
 *
 * `maxLines` defaults to the conservative row-height budget rather than the
 * per-role clamp target, because the DOM clamp lands in a follow-up change.
 */
export function notationLabelBox(
  node: NotationVisualNode,
  metrics: LabelEstimator = defaultEstimator,
  maxLines: number = ROW_HEIGHT_MAX_LINES,
): NotationBox {
  const cx = node.x + node.width / 2;

  if (node.role === 'station') {
    const label = isStationData(node.data) ? node.data.label : '';
    const est = metrics(label, STATION_LABEL_FONT_PX, Number.MAX_SAFE_INTEGER, 1);
    return {
      x: cx - est.width / 2,
      y: node.y + STATION_LABEL_TOP_OFFSET,
      width: est.width,
      height: est.height,
    };
  }

  const data = node.data as RecipeNode;

  if (node.role === 'verb') {
    const est = metrics(data.text ?? '', VERB_LABEL_FONT_PX, VERB_LABEL_WIDTH, maxLines);
    const top = node.y + VERB_LABEL_TOP_OFFSET;
    let bottom = top + est.height;
    let width = est.width;
    if (data.duration) {
      bottom = Math.max(bottom, node.y + VERB_CHIP_TOP_OFFSET + VERB_CHIP_HEIGHT);
      // nowrap chip: text width + horizontal padding
      width = Math.max(width, metrics(data.duration, VERB_LABEL_FONT_PX, Number.MAX_SAFE_INTEGER, 1).width + 14);
    }
    return { x: cx - width / 2, y: top, width, height: bottom - top };
  }

  // 'leaf' and 'state' both render as MinimalNode: icon container on top,
  // wrapped label below it, optional chips below that.
  const est = metrics(
    data.text ?? '',
    MINIMAL_LABEL_FONT_PX,
    node.width - MINIMAL_LABEL_SIDE_PADDING * 2,
    maxLines,
  );
  return {
    x: cx - est.width / 2,
    y: node.y + MINIMAL_LABEL_TOP_OFFSET,
    width: est.width,
    height: est.height + minimalChipExtent(data),
  };
}

/**
 * Half the horizontal extent a spine item claims — the wider of its icon box
 * and its estimated label box. Two spine neighbours are spaced by the sum of
 * their half-extents plus LABEL_PAD, which is what makes label collisions
 * impossible along a spine.
 */
export function notationSpineHalfExtent(
  node: NotationVisualNode,
  metrics: LabelEstimator = defaultEstimator,
): number {
  const data = node.data as RecipeNode;
  const labelWidth =
    node.role === 'verb'
      ? metrics(data.text ?? '', VERB_LABEL_FONT_PX, VERB_LABEL_WIDTH, VERB_LABEL_MAX_LINES).width
      : metrics(
          data.text ?? '',
          MINIMAL_LABEL_FONT_PX,
          node.width - MINIMAL_LABEL_SIDE_PADDING * 2,
          LEAF_LABEL_MAX_LINES,
        ).width;
  return Math.max(node.width / 2, labelWidth / 2);
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

/** Ink height of a MinimalNode-rendered leaf, measured from its box top. */
function leafInkHeight(node: NotationVisualNode, metrics: LabelEstimator): number {
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

  for (const lane of laneOrder) {
    const items = graph.nodes
      .filter(n => n.laneId === lane.id && !isFloatingLeaf(n))
      .sort((a, b) => {
        const da = depths.get(a.id) ?? 0;
        const db = depths.get(b.id) ?? 0;
        if (da !== db) return da - db;
        return (graphIndex.get(a.id) ?? 0) - (graphIndex.get(b.id) ?? 0);
      })
      .map<NotationVisualNode>(n => {
        // Actions that match a cooking verb render as a glyph IN the spine
        // line; everything else renders as a MinimalNode sitting on it.
        const role: NotationNodeRole = n.type === 'action' && classifyVerb(n.text) ? 'verb' : 'state';
        const width = role === 'verb' ? NOTATION.VERB_SIZE : minimalWrapperWidth(n);
        const height = role === 'verb' ? NOTATION.VERB_SIZE : NOTATION.LEAF_SIZE;
        return { id: n.id, role, x: 0, y: 0, width, height, laneId: lane.id, data: n };
      });
    spineByLane.set(lane.id, items);
    allSpineItems.push(...items);
  }

  // Global sweep in ascending depth (then graph order). Because depth(n) is
  // strictly greater than the depth of every input, an item's inputs are always
  // already placed when it is reached, so the MIN_EDGE_DX constraint can be
  // applied in a single pass — no iteration, no solver.
  const placementOrder = [...allSpineItems].sort((a, b) => {
    const da = depths.get(a.id) ?? 0;
    const db = depths.get(b.id) ?? 0;
    if (da !== db) return da - db;
    return (graphIndex.get(a.id) ?? 0) - (graphIndex.get(b.id) ?? 0);
  });

  const spineX = new Map<string, number>();
  const laneCursor = new Map<string, NotationVisualNode>(); // last placed item per lane

  for (const item of placementOrder) {
    const prev = laneCursor.get(item.laneId);
    let x: number;
    if (!prev) {
      x = NOTATION.ROW_START_X;
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
      height: NOTATION.LEAF_SIZE,
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
        ink = Math.max(ink, leafInkHeight(p.node, metrics));
      }
      above = ink + NOTATION.LEAF_CLEARANCE + above;
    }
    aboveExtent.set(lane.id, above);
    belowExtent.set(lane.id, below);
  }

  const rowYByLane = new Map<string, number>();
  let cursorY: number = NOTATION.MARGIN_TOP;
  laneOrder.forEach((lane, i) => {
    if (i > 0) {
      const prev = laneOrder[i - 1];
      cursorY += (belowExtent.get(prev.id) ?? 0) + NOTATION.ROW_BREATHING;
    }
    const y = cursorY + (aboveExtent.get(lane.id) ?? 0);
    rowYByLane.set(lane.id, y);
    cursorY = y;
  });

  const rowY = (laneId: string): number =>
    rowYByLane.get(laneId) ?? (rowYByLane.get(laneOrder[0]?.id ?? '') ?? NOTATION.MARGIN_TOP);

  // ── 4. Emit stations, spine items and leaves at their final y ─────────────
  for (const lane of laneOrder) {
    const y = rowY(lane.id);
    nodes.push({
      id: stationNodeId(lane.id),
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
    const bandTop = y - (aboveExtent.get(lane.id) ?? 0) - NOTATION.ROW_BREATHING / 2;
    const bandHeight =
      (aboveExtent.get(lane.id) ?? 0) + (belowExtent.get(lane.id) ?? 0) + NOTATION.ROW_BREATHING;
    visualLanes.push({
      id: lane.id,
      label: lane.label,
      x: 0,
      y: bandTop,
      width: 0,
      height: bandHeight,
      color: 'transparent',
    });

    for (const item of spineByLane.get(lane.id) ?? []) {
      item.y = y - item.height / 2;
      nodes.push(item);
    }
  }

  for (const p of leafPlacements) {
    p.node.y = rowY(p.rowLaneId) - (aboveExtent.get(p.rowLaneId) ?? 0);
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
  const placedIds = new Set(nodes.map(n => n.id));
  let strayIndex = 0;
  const strayTop = cursorY + (belowExtent.get(laneOrder[laneOrder.length - 1]?.id ?? '') ?? 0) + NOTATION.ROW_BREATHING;
  for (const node of graph.nodes) {
    if (placedIds.has(node.id)) continue;
    placedIds.add(node.id);
    nodes.push({
      id: node.id,
      role: 'state',
      x: NOTATION.ROW_START_X - minimalWrapperWidth(node) / 2,
      y: strayTop + strayIndex * (NOTATION.LEAF_SIZE + 80),
      width: minimalWrapperWidth(node),
      height: NOTATION.LEAF_SIZE,
      laneId: node.laneId,
      data: node,
    });
    strayIndex++;
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
  // RENDER-ONLY: `buildGraphForSave` derives node `inputs` from rendered edges,
  // so it filters these out via isNotationStationId.
  for (const lane of laneOrder) {
    const first = (spineByLane.get(lane.id) ?? [])[0];
    if (!first) continue;
    edges.push({
      id: `${stationNodeId(lane.id)}->${first.id}`,
      sourceId: stationNodeId(lane.id),
      targetId: first.id,
      kind: 'spine',
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
