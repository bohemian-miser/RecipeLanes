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
 */

import type { RecipeGraph, RecipeNode, Lane } from './types';
import { getLeafNodeIds } from './leaf-nodes';
import { classifyVerb } from './verbs';

export const NOTATION = {
  /** Vertical gap between station rows. */
  ROW_GAP: 140,
  /** Horizontal spacing between consecutive actions along a row. */
  ACTION_SPACING: 110,
  /** How far above its row a leaf floats. */
  LEAF_OFFSET_Y: 90,
  /** Horizontal spread between sibling leaves that feed the same action. */
  LEAF_SIBLING_SPACING: 40,
  /** x of the station badge (row anchor). */
  STATION_X: 70,
  /** x of the first action in a row. */
  ROW_START_X: 180,
  /** Top margin before the first row. */
  MARGIN_TOP: 110,
  /** Layout margin around the computed bounds. */
  MARGIN: 80,

  STATION_SIZE: 52,
  VERB_SIZE: 30,
  LEAF_SIZE: 56,
} as const;

export type NotationNodeRole = 'leaf' | 'verb' | 'state' | 'station';
export type NotationEdgeKind = 'spine' | 'drop' | 'cross';

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

const STATION_GLYPH: Record<Lane['type'], string> = {
  prep: '🔪',
  cook: '🍳',
  serve: '🍽️',
};

function stationNodeId(laneId: string): string {
  return `notation-station-${laneId}`;
}

/**
 * Longest-path depth from any leaf (in-degree 0 node), used only to order
 * actions within a lane topologically. Cross-lane inputs count too, so an
 * action that depends on another lane's output sorts after it even though
 * the dependency isn't rendered as a same-lane spine edge.
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

export function calculateNotationLayout(graph: RecipeGraph): NotationLayoutGraph {
  const nodes: NotationVisualNode[] = [];
  const edges: NotationVisualEdge[] = [];
  const visualLanes: NotationVisualLane[] = [];

  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const leafIds = getLeafNodeIds(graph);
  const depths = computeDepths(graph);

  const laneOrder = graph.lanes.length > 0 ? graph.lanes : [];
  const laneIndexOf = new Map(laneOrder.map((l, i) => [l.id, i]));
  const laneById = new Map(laneOrder.map(l => [l.id, l]));

  const rowY = (laneId: string): number =>
    NOTATION.MARGIN_TOP + (laneIndexOf.get(laneId) ?? 0) * NOTATION.ROW_GAP;

  // ── Station badges ──────────────────────────────────────────────────────
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
    visualLanes.push({
      id: lane.id,
      label: lane.label,
      x: 0,
      y: y - NOTATION.ROW_GAP / 2,
      width: 0,
      height: NOTATION.ROW_GAP,
      color: 'transparent',
    });
  }

  // ── Actions, placed left→right in per-lane topological order ────────────
  const actionXById = new Map<string, number>();
  for (const lane of laneOrder) {
    const laneActions = graph.nodes
      .filter(n => n.type === 'action' && n.laneId === lane.id)
      .sort((a, b) => {
        const da = depths.get(a.id) ?? 0;
        const db = depths.get(b.id) ?? 0;
        if (da !== db) return da - db;
        return graph.nodes.indexOf(a) - graph.nodes.indexOf(b);
      });

    const y = rowY(lane.id);
    laneActions.forEach((action, i) => {
      const x = NOTATION.ROW_START_X + i * NOTATION.ACTION_SPACING;
      actionXById.set(action.id, x);
      const verb = classifyVerb(action.text);
      const role: NotationNodeRole = verb ? 'verb' : 'state';
      const size = role === 'verb' ? NOTATION.VERB_SIZE : NOTATION.LEAF_SIZE;
      nodes.push({
        id: action.id,
        role,
        x: x - size / 2,
        y: y - size / 2,
        width: size,
        height: size,
        laneId: lane.id,
        data: action,
      });
    });
  }

  // ── Leaves float above the row of the first action that consumes them ───
  // Group leaves by their consumer so siblings can be spread horizontally.
  const consumerOfLeaf = new Map<string, string>(); // leafId -> consuming action id
  for (const node of graph.nodes) {
    if (node.type !== 'action') continue;
    for (const inputId of node.inputs ?? []) {
      if (leafIds.has(inputId) && !consumerOfLeaf.has(inputId)) {
        consumerOfLeaf.set(inputId, node.id);
      }
    }
  }

  const leavesByConsumer = new Map<string, string[]>();
  for (const [leafId, consumerId] of consumerOfLeaf) {
    const list = leavesByConsumer.get(consumerId) ?? [];
    list.push(leafId);
    leavesByConsumer.set(consumerId, list);
  }

  for (const [consumerId, siblingIds] of leavesByConsumer) {
    const consumerX = actionXById.get(consumerId);
    const consumer = byId.get(consumerId);
    if (consumerX === undefined || !consumer) continue;
    const consumerY = rowY(consumer.laneId);
    const n = siblingIds.length;
    siblingIds.forEach((leafId, i) => {
      const leaf = byId.get(leafId);
      if (!leaf) return;
      const spread = (i - (n - 1) / 2) * NOTATION.LEAF_SIBLING_SPACING;
      const x = consumerX + spread;
      const y = consumerY - NOTATION.LEAF_OFFSET_Y;
      nodes.push({
        id: leaf.id,
        role: 'leaf',
        x: x - NOTATION.LEAF_SIZE / 2,
        y: y - NOTATION.LEAF_SIZE / 2,
        width: NOTATION.LEAF_SIZE,
        height: NOTATION.LEAF_SIZE,
        laneId: leaf.laneId,
        data: leaf,
      });
    });
  }

  // Leaves that nothing consumes (orphaned / dangling inputs) still need a
  // position so they aren't silently dropped — place them at the top-left of
  // their own lane's row.
  for (const leafId of leafIds) {
    if (nodes.some(n => n.id === leafId)) continue;
    const leaf = byId.get(leafId);
    if (!leaf) continue;
    const y = rowY(leaf.laneId);
    nodes.push({
      id: leaf.id,
      role: 'leaf',
      x: NOTATION.ROW_START_X - NOTATION.LEAF_SIZE / 2,
      y: y - NOTATION.LEAF_OFFSET_Y - NOTATION.LEAF_SIZE / 2,
      width: NOTATION.LEAF_SIZE,
      height: NOTATION.LEAF_SIZE,
      laneId: leaf.laneId,
      data: leaf,
    });
  }

  // ── Edges, classified ─────────────────────────────────────────────────────
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
      edges.push({
        id: `${inputId}->${node.id}`,
        sourceId: inputId,
        targetId: node.id,
        kind,
      });
    }
  }

  // ── Bounds ────────────────────────────────────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  const width = Math.max(800, maxX - minX + NOTATION.MARGIN * 2);
  const height = Math.max(600, maxY - minY + NOTATION.MARGIN * 2);

  visualLanes.forEach(l => { l.width = width; });

  return { nodes, edges, lanes: visualLanes, width, height };
}
