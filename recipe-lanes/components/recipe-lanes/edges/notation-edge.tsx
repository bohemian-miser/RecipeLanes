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

import React, { memo, useCallback } from 'react';
import { useStore } from 'reactflow';
import { CLASSIC_CONTAINER, MODERN_CONTAINER } from '../../../lib/recipe-lanes/edge-anchors';
import { getNodeTheme } from '../../../lib/recipe-lanes/model-utils';
import { CROSS_EDGE_CHANNEL_OFFSET } from '../../../lib/recipe-lanes/notation-metrics';
import { useRecipeStore } from '../../../lib/stores/recipe-store';

const SPINE_INK = '#3a362f';
const LEAF_LINE = '#a39a88';
const SPINE_W = 3.5;
const DROP_W = 1.4;
const CROSS_RADIUS = 24;
/**
 * Horizontal run a cross edge makes before it turns off its source, so the
 * departure reads as its own line instead of as a thickening of the spine it
 * is leaving.
 */
const CROSS_STUB = 24;
/**
 * Below this vertical separation a channel route has no room to be one — the
 * channel would land on or past the target — so the plain elbow is used. Rows
 * are never this close, but nodes in notation are DRAGGABLE, so the geometry
 * has to stay sane for arbitrary positions.
 */
const CROSS_CHANNEL_MIN_DY = CROSS_EDGE_CHANNEL_OFFSET + 20;

interface NotationEdgeProps {
  id: string;
  source: string;
  target: string;
  data?: { kind?: 'spine' | 'drop' | 'cross' };
}

// Anchor point for a notation edge endpoint. Verb circles and station badges
// are symmetric, so their geometric center is right. MinimalNode-rendered
// leaves/states are icon-container-on-top + label-below: their geometric
// center lands on the LABEL, so aim at the icon container's center instead
// (container height by theme/type, same constants as edge-anchors.ts).
//
// `scale` is the leaf-size slider (#155). MinimalNode shrinks leaves with a
// CSS transform whose origin is pinned to the wrapper's top-center (see
// getLeafScaleOrigin), so under scaling the icon center x is invariant and
// its y moves to container/2 * scale from the node top.
function center(node: any, scale = 1): { x: number; y: number } {
  const p = node.positionAbsolute ?? node.position;
  const w = node.width ?? 0;
  const h = node.height ?? 0;
  if (node.type === 'minimal') {
    const theme = getNodeTheme(node.data);
    const modern = theme === 'modern' || theme === 'modern_clean';
    const isIngredient = node.data?.type === 'ingredient';
    const container = (modern ? MODERN_CONTAINER : CLASSIC_CONTAINER)[isIngredient ? 'ingredient' : 'action'];
    return { x: p.x + w / 2, y: p.y + (container / 2) * scale };
  }
  return { x: p.x + w / 2, y: p.y + h / 2 };
}

// Elbow path with a single rounded corner: horizontal from the source, a
// quarter-circle-ish corner, then vertical into the target. Used by 'spine'
// edges whose endpoints are not perfectly level, and as the fallback for a
// 'cross' edge whose endpoints are too close vertically to fit a channel.
function elbowPath(sx: number, sy: number, ex: number, ey: number): string {
  if (Math.abs(sy - ey) < 1) return `M ${sx} ${sy} L ${ex} ${ey}`;
  const r = Math.min(CROSS_RADIUS, Math.abs(ex - sx) / 2, Math.abs(ey - sy) / 2) || 1;
  const midX = ex - r * Math.sign(ex - sx || 1);
  const sweepDown = ey > sy;
  const sweep = sweepDown ? (ex > sx ? 1 : 0) : (ex > sx ? 0 : 1);
  const cornerY = sy + r * (sweepDown ? 1 : -1);
  return `M ${sx} ${sy} L ${midX} ${sy} A ${r} ${r} 0 0 ${sweep} ${ex} ${cornerY} L ${ex} ${ey}`;
}

function straightPath(sx: number, sy: number, ex: number, ey: number): string {
  return `M ${sx} ${sy} L ${ex} ${ey}`;
}

interface Pt { x: number; y: number }

/**
 * Draw an axis-aligned polyline with rounded corners.
 *
 * Each corner eats at most half of each segment it touches, so adjacent
 * corners on a short segment can never overrun each other; a corner with no
 * room left degenerates to a sharp one rather than to an invalid arc.
 * Sweep flag: in SVG's y-down space a turn is clockwise (sweep 1) exactly when
 * the 2D cross product of the incoming and outgoing directions is positive.
 *
 * Only RIGHT angles are rounded, and that restriction is load-bearing rather
 * than a simplification: stepping `r` back along each leg and joining them
 * with a radius-`r` arc is the correct fillet at 90° and at no other angle. As
 * the joint flattens, that same construction's chord grows towards 2r, so it
 * draws a near-semicircular bulge (which flips sides as the path crosses
 * straight) where a corner should be. The near-duplicate filter below can
 * MANUFACTURE such a joint out of a properly axis-aligned path by dropping a
 * sub-pixel point from the middle of it — `channelPath` does exactly that when
 * its two endpoints are within a pixel horizontally — so anything that is not
 * square falls back to a plain line join. For the same reason the filter
 * measures against the last point it KEPT, not the original predecessor.
 */
function roundedPolyline(points: Pt[], radius: number): string {
  if (points.length === 0) return '';
  const pts: Pt[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) pts.push(p);
  }
  if (pts.length < 2) return `M ${pts[0].x} ${pts[0].y}`;

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inUx = (cur.x - prev.x) / inLen, inUy = (cur.y - prev.y) / inLen;
    const outUx = (next.x - cur.x) / outLen, outUy = (next.y - cur.y) / outLen;
    // |cross| is sin(turn angle): 1 at a right angle, 0 straight through.
    const cross = inUx * outUy - inUy * outUx;
    // No room for an arc, or not a right angle to round.
    if (r < 2 || Math.abs(Math.abs(cross) - 1) > 1e-3) { d += ` L ${cur.x} ${cur.y}`; continue; }

    d += ` L ${cur.x - inUx * r} ${cur.y - inUy * r}`;
    d += ` A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${cur.x + outUx * r} ${cur.y + outUy * r}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

/**
 * Three-segment channel route for a 'cross' edge (see the notation layout
 * plan, §2.7): stub horizontally off the source, drop to a horizontal channel
 * running in the inter-row gap, then descend into the target.
 *
 * The single-corner `elbowPath` it replaces ran the long horizontal leg at the
 * SOURCE's own y — i.e. within a few px of the spine it was leaving, for
 * hundreds of px — so a cross edge and a spine read as one thick line, and the
 * run cut straight through that row's below-spine labels.
 *
 * The channel is placed `CROSS_EDGE_CHANNEL_OFFSET` below the UPPER of the two
 * endpoints, never below the source specifically: for an upward edge the
 * source's own "gap" is its leaf fan, whereas the upper (target) row's
 * below-spine gap is free either way. Expressed as `min(sy, ey) + offset`, it
 * is the same band in both directions and always strictly between the rows.
 */
function channelPath(sx: number, sy: number, ex: number, ey: number): string {
  const hx = Math.sign(ex - sx) || 1;
  // Never stub past the target: a cross edge whose endpoints are nearly
  // vertically aligned would otherwise double back on itself.
  const stub = Math.min(CROSS_STUB, Math.abs(ex - sx) / 2);
  const channelY = Math.min(sy, ey) + CROSS_EDGE_CHANNEL_OFFSET;
  return roundedPolyline(
    [
      { x: sx, y: sy },
      { x: sx + hx * stub, y: sy },
      { x: sx + hx * stub, y: channelY },
      { x: ex, y: channelY },
      { x: ex, y: ey },
    ],
    CROSS_RADIUS,
  );
}

// Notation edges: 'spine' (thick, same-lane action->action), 'drop' (thin,
// leaf->action, ending in a filled dot, no arrowhead), 'cross' (thick,
// three-segment channel route between lanes — see channelPath). Positions come
// straight from ReactFlow's node store —
// same absolute-position pattern as TimelineEdge, since layout-notation.ts
// already computes final x/y rather than relying on handle anchoring.
function NotationEdge({ id, source, target, data }: NotationEdgeProps) {
  const sourceNode = useStore(useCallback((s: any) => s.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((s: any) => s.nodeInternals.get(target), [target]));
  // Leaf-size slider (#155): scaled leaves need scaled anchors, same as
  // FloatingEdge does for the other layout modes.
  const leafNodeScale = useRecipeStore(st => st.leafNodeScale);

  if (!sourceNode || !targetNode) return null;

  const s = center(sourceNode, sourceNode.data?.isLeaf ? leafNodeScale : 1);
  const t = center(targetNode, targetNode.data?.isLeaf ? leafNodeScale : 1);
  const kind = data?.kind ?? 'spine';

  if (kind === 'drop') {
    const d = straightPath(s.x, s.y, t.x, t.y);
    return (
      <g>
        <path id={id} className="react-flow__edge-path" d={d} fill="none" style={{ stroke: LEAF_LINE, strokeWidth: DROP_W }} />
        <circle cx={t.x} cy={t.y} r={4} fill={SPINE_INK} />
      </g>
    );
  }

  if (kind === 'cross') {
    // Rows are always far enough apart for a channel; a dragged node may not be.
    const d = Math.abs(t.y - s.y) >= CROSS_CHANNEL_MIN_DY
      ? channelPath(s.x, s.y, t.x, t.y)
      : elbowPath(s.x, s.y, t.x, t.y);
    // Small arrowhead at the target end, pointing in the final (vertical)
    // approach direction. Drawn as a plain polygon (rather than an SVG
    // <marker>) so multiple cross edges don't collide on a shared marker id.
    const ah = 5;
    const dir = t.y >= s.y ? 1 : -1; // approaching from above (down) or below (up)
    const tipX = t.x, tipY = t.y;
    const backY = tipY - ah * 1.6 * dir;
    return (
      <g>
        <path
          id={id}
          className="react-flow__edge-path"
          d={d}
          fill="none"
          style={{ stroke: SPINE_INK, strokeWidth: SPINE_W, strokeLinecap: 'round' }}
        />
        <polygon
          points={`${tipX},${tipY} ${tipX - ah},${backY} ${tipX + ah},${backY}`}
          fill={SPINE_INK}
        />
      </g>
    );
  }

  // spine — thick straight/elbow line, round caps, no arrowhead (flow reads left->right)
  const d = Math.abs(s.y - t.y) < 1 ? straightPath(s.x, s.y, t.x, t.y) : elbowPath(s.x, s.y, t.x, t.y);
  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={d}
      fill="none"
      style={{ stroke: SPINE_INK, strokeWidth: SPINE_W, strokeLinecap: 'round' }}
    />
  );
}

export default memo(NotationEdge);
