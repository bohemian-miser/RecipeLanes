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

import type { RecipeGraph, RecipeNode } from './types';

// ── Public types ─────────────────────────────────────────────────────────────

export interface TLNode {
  id: string;
  startMin: number;
  durationMin: number;
  laneId: string;
  laneIndex: number;
  trackIndex: number;
  cx: number;
  cy: number;
  /** 'ingredient' nodes appear in the ingredient zone above the action tracks. */
  kind: 'action' | 'ingredient';
  data: RecipeNode;
}

export interface TLEdge {
  id: string;
  sourceId: string;
  targetId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 'chain' connects action→action along the timeline; 'spur' connects ingredient→action. */
  kind: 'chain' | 'spur';
}

export interface TLLane {
  laneId: string;
  label: string;
  color: string;
  lineColor: string;
  yMin: number;
  yMax: number;
  trackCount: number;
}

export interface TimelineLayout {
  nodes: TLNode[];
  edges: TLEdge[];
  lanes: TLLane[];
  totalMinutes: number;
  totalWidth: number;
  totalHeight: number;
  pixelsPerMin: number;
  /** y coordinate where ingredient zone ends / action tracks begin */
  actionZoneY: number;
}

// ── Layout constants ─────────────────────────────────────────────────────────

export const TL = {
  NODE_R: 20,            // node circle radius (px)
  TRACK_H: 72,           // pixels per action track row
  LANE_GAP: 10,          // gap between lane bands
  LANE_LABEL_W: 72,      // left gutter for rotated lane name
  RULER_H: 34,           // top time ruler height
  /** Vertical space reserved above action tracks for ingredient stubs */
  INGREDIENT_ZONE_H: 65,
  /** Gap between sibling ingredient circles in a fan */
  ING_SPACING: 16,
  MARGIN_RIGHT: 48,
  GRID_INTERVAL: 5,
  TARGET_W: 1100,
  MIN_PPM: 22,
  MAX_PPM: 80,
} as const;

// ── Colour maps ───────────────────────────────────────────────────────────────

export const LANE_BG: Record<string, string> = {
  prep:    '#EFF6FF',
  cook:    '#FFF7ED',
  serve:   '#F0FDF4',
  default: '#FAFAFA',
};

export const LANE_LINE: Record<string, string> = {
  prep:    '#93C5FD',
  cook:    '#FB923C',
  serve:   '#4ADE80',
  default: '#D4D4D8',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract duration in minutes from a node.
 * Reads the first number from the `duration` string and treats it as minutes.
 * Falls back to 1 min for ingredients, 5 min for actions.
 */
export function parseDurationMins(node: RecipeNode): number {
  if (node.duration) {
    const m = node.duration.match(/\d+(\.\d+)?/);
    if (m) return Math.max(0.5, parseFloat(m[0]));
  }
  return node.type === 'ingredient' ? 1 : 5;
}

/**
 * Kahn's algorithm topological sort.
 * Nodes in cycles are appended at the end (safe fallback).
 */
export function topoSort(nodes: RecipeNode[]): string[] {
  const indegree = new Map<string, number>(nodes.map(n => [n.id, 0]));
  const children = new Map<string, string[]>();

  for (const n of nodes) {
    for (const pid of n.inputs ?? []) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid)!.push(n.id);
      indegree.set(n.id, (indegree.get(n.id) ?? 0) + 1);
    }
  }

  const queue = nodes.filter(n => (indegree.get(n.id) ?? 0) === 0).map(n => n.id);
  const result: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const child of children.get(id) ?? []) {
      const deg = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, deg);
      if (deg === 0) queue.push(child);
    }
  }

  const seen = new Set(result);
  for (const n of nodes) if (!seen.has(n.id)) result.push(n.id);
  return result;
}

// ── Main layout ───────────────────────────────────────────────────────────────

/**
 * Produces a timeline layout for the given recipe graph.
 *
 * Visual structure (top → bottom):
 *   [Ruler]
 *   [Ingredient zone]  — ingredient nodes fanned above their consumer actions
 *   ─────────────────  — separator line
 *   [Lane bands]       — action nodes on horizontal tracks, coloured by lane type
 */
export function buildTimelineLayout(graph: RecipeGraph): TimelineLayout {
  const { nodes, lanes: graphLanes = [] } = graph;

  const actionZoneY = TL.RULER_H + TL.INGREDIENT_ZONE_H;

  if (nodes.length === 0) {
    return {
      nodes: [], edges: [], lanes: [],
      totalMinutes: 0,
      totalWidth: TL.LANE_LABEL_W + TL.MARGIN_RIGHT,
      totalHeight: actionZoneY + 60,
      pixelsPerMin: TL.MIN_PPM,
      actionZoneY,
    };
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const durMap  = new Map(nodes.map(n => [n.id, parseDurationMins(n)]));

  // 1. Topological sort → start times
  const sorted   = topoSort(nodes);
  const startMin = new Map<string, number>();

  for (const id of sorted) {
    const n      = nodeMap.get(id)!;
    const inputs = n.inputs ?? [];
    const predEnd = inputs.length > 0
      ? Math.max(...inputs.map(pid => (startMin.get(pid) ?? 0) + (durMap.get(pid) ?? 5)))
      : 0;
    startMin.set(id, predEnd);
  }

  const totalMinutes = Math.max(
    1,
    ...nodes.map(n => (startMin.get(n.id) ?? 0) + (durMap.get(n.id) ?? 5)),
  );

  // 2. Pixels-per-minute (scale to TARGET_W)
  const usableW = TL.TARGET_W - TL.LANE_LABEL_W - TL.MARGIN_RIGHT;
  const ppm     = Math.min(TL.MAX_PPM, Math.max(TL.MIN_PPM, usableW / totalMinutes));

  // 3. Lane ordering
  const laneOrder    = new Map<string, number>(graphLanes.map((l, i) => [l.id, i]));
  const getLaneIndex = (laneId: string) => laneOrder.get(laneId) ?? graphLanes.length;

  // 4. Greedy track assignment — for ACTION nodes only.
  //    Ingredient nodes get special placement later.
  const trackAssign     = new Map<string, number>();
  const laneTrackCounts = new Map<string, number>();

  const laneActionGroups = new Map<string, string[]>();
  for (const id of sorted) {
    if (nodeMap.get(id)!.type !== 'action') continue;
    const laneId = nodeMap.get(id)!.laneId ?? 'default';
    if (!laneActionGroups.has(laneId)) laneActionGroups.set(laneId, []);
    laneActionGroups.get(laneId)!.push(id);
  }

  for (const [laneId, ids] of laneActionGroups) {
    const byStart   = [...ids].sort((a, b) => (startMin.get(a) ?? 0) - (startMin.get(b) ?? 0));
    const trackEnds: number[] = [];
    for (const id of byStart) {
      const s = startMin.get(id) ?? 0;
      const d = durMap.get(id) ?? 5;
      let track = trackEnds.findIndex(end => end <= s + 0.01);
      if (track === -1) { track = trackEnds.length; trackEnds.push(0); }
      trackEnds[track] = s + d;
      trackAssign.set(id, track);
    }
    laneTrackCounts.set(laneId, Math.max(1, trackEnds.length));
  }

  // 5. Lane Y offsets — start BELOW the ingredient zone
  const allActionLaneIds = [...laneActionGroups.keys()].sort(
    (a, b) => getLaneIndex(a) - getLaneIndex(b),
  );
  const laneYStart = new Map<string, number>();
  let y = actionZoneY;
  for (const laneId of allActionLaneIds) {
    laneYStart.set(laneId, y);
    y += (laneTrackCounts.get(laneId) ?? 1) * TL.TRACK_H + TL.LANE_GAP;
  }
  const totalHeight = y + 8;

  // 6. Build initial TLNodes with time-based cx/cy for everything
  const tlNodes: TLNode[] = nodes.map(n => {
    const laneId    = n.laneId ?? 'default';
    const trackIdx  = trackAssign.get(n.id) ?? 0;
    const s         = startMin.get(n.id) ?? 0;
    const laneY     = laneYStart.get(laneId) ?? actionZoneY;
    const cx        = TL.LANE_LABEL_W + s * ppm;
    const cy        = laneY + trackIdx * TL.TRACK_H + TL.TRACK_H / 2;
    return {
      id: n.id,
      startMin:    s,
      durationMin: durMap.get(n.id) ?? 1,
      laneId,
      laneIndex:   getLaneIndex(laneId),
      trackIndex:  trackIdx,
      cx, cy,
      kind: n.type === 'ingredient' ? 'ingredient' : 'action',
      data: n,
    };
  });

  const tlNodeMap = new Map(tlNodes.map(n => [n.id, n]));

  // 7. Post-process: re-position ingredient nodes to fan above their consumer actions
  //
  //    For each action node, collect its ingredient inputs.
  //    Fan those ingredients horizontally around the action's cx,
  //    all at the same cy in the ingredient zone.
  //    Ingredients consumed by multiple actions are anchored to the earliest one.

  // ingId → primary consumer actionId (lowest startMin)
  const ingPrimary = new Map<string, string>();
  for (const n of nodes) {
    if (n.type !== 'action') continue;
    for (const inputId of n.inputs ?? []) {
      if (nodeMap.get(inputId)?.type !== 'ingredient') continue;
      const existing = ingPrimary.get(inputId);
      if (!existing || (startMin.get(n.id) ?? 0) < (startMin.get(existing) ?? 0)) {
        ingPrimary.set(inputId, n.id);
      }
    }
  }

  // primary actionId → [ingIds] (for fan spread)
  const primaryFan = new Map<string, string[]>();
  for (const [ingId, actionId] of ingPrimary) {
    if (!primaryFan.has(actionId)) primaryFan.set(actionId, []);
    primaryFan.get(actionId)!.push(ingId);
  }

  const ingSpacing = TL.NODE_R * 2 + TL.ING_SPACING;

  for (const [actionId, ingIds] of primaryFan) {
    const action = tlNodeMap.get(actionId);
    if (!action) continue;
    const count = ingIds.length;
    // Place ingredient just above the consumer action — short spur, no lane-crossing
    const ingCy = action.cy - TL.NODE_R * 2 - 8;
    ingIds.forEach((ingId, i) => {
      const ingNode = tlNodeMap.get(ingId);
      if (!ingNode) return;
      const xOff = (i - (count - 1) / 2) * ingSpacing;
      ingNode.cx = action.cx + xOff;
      ingNode.cy = ingCy;
      ingNode.kind = 'ingredient';
      // Inherit the consumer action's lane so the spur colour matches the action line
      ingNode.laneId = action.laneId;
    });
  }

  // 8. Build TLEdges
  const tlEdges: TLEdge[] = [];
  for (const n of nodes) {
    const target = tlNodeMap.get(n.id);
    if (!target) continue;
    for (const inputId of n.inputs ?? []) {
      const source = tlNodeMap.get(inputId);
      if (!source) continue;
      const kind: TLEdge['kind'] =
        source.kind === 'ingredient' && target.kind === 'action' ? 'spur' : 'chain';
      tlEdges.push({
        id: `${inputId}->${n.id}`,
        sourceId: inputId,
        targetId: n.id,
        x1: source.cx,
        y1: source.cy,
        x2: target.cx,
        y2: target.cy,
        kind,
      });
    }
  }

  // 9. Build TLLanes (only for lanes that have action nodes)
  const tlLanes: TLLane[] = allActionLaneIds.map(laneId => {
    const lane       = graphLanes.find(l => l.id === laneId);
    const trackCount = laneTrackCounts.get(laneId) ?? 1;
    const yMin       = laneYStart.get(laneId) ?? actionZoneY;
    const yMax       = yMin + trackCount * TL.TRACK_H;
    return {
      laneId,
      label:     lane?.label ?? laneId,
      color:     LANE_BG[lane?.type  ?? 'default'] ?? LANE_BG.default,
      lineColor: LANE_LINE[lane?.type ?? 'default'] ?? LANE_LINE.default,
      yMin, yMax,
      trackCount,
    };
  });

  const totalWidth = TL.LANE_LABEL_W + totalMinutes * ppm + TL.MARGIN_RIGHT;

  return {
    nodes: tlNodes, edges: tlEdges, lanes: tlLanes,
    totalMinutes, totalWidth, totalHeight, pixelsPerMin: ppm,
    actionZoneY,
  };
}
