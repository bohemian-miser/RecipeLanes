import React, { useCallback } from 'react';
import { useStore, getStraightPath, getBezierPath, getSmoothStepPath, EdgeProps, MarkerType } from 'reactflow';
import { getEdgeParams } from '../../../lib/recipe-lanes/graph-utils';

function FloatingEdge({ id, source, target, markerEnd, style, data }: EdgeProps) {
  const sourceNode = useStore(useCallback((store) => store.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((store) => store.nodeInternals.get(target), [target]));

  if (!sourceNode || !targetNode) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode);

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

export default FloatingEdge;
