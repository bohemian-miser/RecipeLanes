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

const SPINE_INK = '#3a362f';
const LEAF_LINE = '#a39a88';
const SPINE_W = 3.5;
const DROP_W = 1.4;
const CROSS_RADIUS = 24;

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
function center(node: any): { x: number; y: number } {
  const p = node.positionAbsolute ?? node.position;
  const w = node.width ?? 0;
  const h = node.height ?? 0;
  if (node.type === 'minimal') {
    const theme = getNodeTheme(node.data);
    const modern = theme === 'modern' || theme === 'modern_clean';
    const isIngredient = node.data?.type === 'ingredient';
    const container = (modern ? MODERN_CONTAINER : CLASSIC_CONTAINER)[isIngredient ? 'ingredient' : 'action'];
    return { x: p.x + w / 2, y: p.y + container / 2 };
  }
  return { x: p.x + w / 2, y: p.y + h / 2 };
}

// Elbow path with a rounded corner, used for 'cross' edges (different lanes).
// Goes horizontal from the source, then a quarter-circle-ish rounded corner,
// then vertical/horizontal into the target.
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

// Notation edges: 'spine' (thick, same-lane action->action), 'drop' (thin,
// leaf->action, ending in a filled dot, no arrowhead), 'cross' (thick, rounded
// elbow between lanes). Positions come straight from ReactFlow's node store —
// same absolute-position pattern as TimelineEdge, since layout-notation.ts
// already computes final x/y rather than relying on handle anchoring.
function NotationEdge({ id, source, target, data }: NotationEdgeProps) {
  const sourceNode = useStore(useCallback((s: any) => s.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((s: any) => s.nodeInternals.get(target), [target]));

  if (!sourceNode || !targetNode) return null;

  const s = center(sourceNode);
  const t = center(targetNode);
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
    const d = elbowPath(s.x, s.y, t.x, t.y);
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
