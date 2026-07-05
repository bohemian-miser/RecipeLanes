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

import React, { useCallback, memo } from 'react';
import { useStore, getStraightPath, getBezierPath, getSmoothStepPath } from 'reactflow';

// Define minimalist EdgeProps to satisfy usage, or just use any
interface EdgeProps {
  id: string;
  source: string;
  target: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  markerEnd?: string;
  style?: React.CSSProperties;
  data?: any;
}
import { getEdgeParams, isFiniteHandlePos } from '../../../lib/recipe-lanes/graph-utils';

function FloatingEdge({ id, source, target, markerEnd, style, data, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const sourceNode = useStore(useCallback((store: any) => store.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((store: any) => store.nodeInternals.get(target), [target]));

  if (!sourceNode || !targetNode) {
    return null;
  }

  // Only forward handle positions once RF has actually measured them. Before
  // then RF can supply NaN coords, and typeof NaN === 'number' would sneak them
  // past a plain typeof check into the edge geometry (issue #30).
  const sourceHandle = { x: sourceX, y: sourceY };
  const targetHandle = { x: targetX, y: targetY };
  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
      sourceNode,
      targetNode,
      isFiniteHandlePos(sourceHandle) ? sourceHandle : undefined,
      isFiniteHandlePos(targetHandle) ? targetHandle : undefined
  );

  const variant = data?.variant || 'straight';
  let edgePath = '';

  if (variant === 'bezier') {
      [edgePath] = getBezierPath({ 
          sourceX: sx, sourceY: sy, sourcePosition: sourcePos,
          targetX: tx, targetY: ty, targetPosition: targetPos 
      });
  } else if (variant === 'step') {
      [edgePath] = getSmoothStepPath({ 
          sourceX: sx, sourceY: sy, sourcePosition: sourcePos,
          targetX: tx, targetY: ty, targetPosition: targetPos 
      });
  } else {
      [edgePath] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
  }

  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={edgePath}
      markerEnd={markerEnd}
      style={style}
    />
  );
}

export default memo(FloatingEdge);