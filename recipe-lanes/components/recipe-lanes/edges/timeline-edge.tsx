/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { memo, useCallback, useState, useEffect } from 'react';
import { useStore } from 'reactflow';
import { getNodeIconUrlAt, currentShortlistIndex } from '../../../lib/recipe-lanes/model-utils';

// Both node types are 40×40 circles — must match TIMELINE_NODE_SIZE in layout.ts
const S = 40;
const R = S / 2;
const CHAIN_W = 5;  // stroke width for chain edges
const SPUR_W  = 2;  // stroke width for spur (ingredient→action) edges

function chainPath(sx: number, sy: number, ex: number, ey: number): string {
  if (sx >= ex) return `M ${sx} ${sy} L ${ex} ${ey}`;
  if (Math.abs(ey - sy) < 1) return `M ${sx} ${sy} H ${ex}`;
  const mid = (sx + ex) / 2;
  return `M ${sx} ${sy} C ${mid} ${sy} ${mid} ${ey} ${ex} ${ey}`;
}

function spurPath(sx: number, sy: number, ex: number, ey: number): string {
  return `M ${sx} ${sy} L ${ex} ${ey}`;
}

// ── Deterministic color from ingredient name / node id ───────────────────────
// Used as a reliable fallback when canvas pixel extraction is unavailable.
// FNV-1a hash spread through the golden angle gives visually distinct hues.

function hashColor(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hue = Math.round((h % 360) * 137.508) % 360;
  return `hsl(${hue}, 72%, 50%)`;
}

function nodeHashColor(nodeData: any): string {
  const name = nodeData?.visualDescription || nodeData?.text || nodeData?.id || '';
  return hashColor(name);
}

// ── Canvas-based average color extraction ────────────────────────────────────
// Samples the dominant non-white, non-transparent pixel. Works when Firebase
// Storage returns CORS headers; silently falls back to null on CORS block.

function extractColor(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, 16, 16);
        const px = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 80) continue;
          if (px[i] > 230 && px[i + 1] > 230 && px[i + 2] > 230) continue;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        }
        resolve(n > 8 ? `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})` : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// useIconColor: attempts canvas extraction, falls back to hashColor.
// nodeData is used only for the hash fallback; iconUrl for canvas.
function useIconColor(iconUrl: string | undefined, nodeData: any): string {
  const base = nodeHashColor(nodeData);
  const [canvasColor, setCanvasColor] = useState<string | null>(null);
  useEffect(() => {
    if (!iconUrl) { setCanvasColor(null); return; }
    let cancelled = false;
    extractColor(iconUrl).then(c => { if (!cancelled) setCanvasColor(c); });
    return () => { cancelled = true; };
  }, [iconUrl]);
  return canvasColor ?? base;
}

interface TimelineEdgeProps {
  id: string;
  source: string;
  target: string;
  data?: { lineColor?: string; kind?: 'chain' | 'spur' };
}

function TimelineEdge({ id, source, target, data }: TimelineEdgeProps) {
  const sourceNode = useStore(useCallback((s: any) => s.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((s: any) => s.nodeInternals.get(target), [target]));

  // Leaf source = a chain edge whose source has no incoming chain edges.
  // Leaf edges get a solid gradient; non-leaf edges get a stripe pattern.
  const sourceHasIncomingChain = useStore(useCallback((s: any) => {
    const edges: any[] = Array.isArray(s.edges) ? s.edges : [];
    return edges.some((e: any) => e.target === source && e.data?.kind === 'chain');
  }, [source]));

  const isSpurEdge = data?.kind === 'spur';

  let srcIconUrl: string | undefined;
  let tgtIconUrl: string | undefined;
  try {
    srcIconUrl = sourceNode?.data
      ? getNodeIconUrlAt(sourceNode.data, Math.max(0, currentShortlistIndex(sourceNode.data)))
      : undefined;
    tgtIconUrl = targetNode?.data
      ? getNodeIconUrlAt(targetNode.data, Math.max(0, currentShortlistIndex(targetNode.data)))
      : undefined;
  } catch { /* missing visualDescription — canvas fallback will be null, hash color used */ }

  const srcColor = useIconColor(srcIconUrl, sourceNode?.data);
  const tgtColor = useIconColor(tgtIconUrl, targetNode?.data);

  if (!sourceNode || !targetNode) return null;

  const sp = sourceNode.positionAbsolute ?? sourceNode.position;
  const tp = targetNode.positionAbsolute ?? targetNode.position;

  // ── Spur edge (ingredient → action) ────────────────────────────────────────
  if (isSpurEdge) {
    const sx = sp.x + R, sy = sp.y + R;
    const ex = tp.x + R, ey = tp.y + R;
    return (
      <path
        id={id}
        className="react-flow__edge-path"
        d={spurPath(sx, sy, ex, ey)}
        fill="none"
        opacity={0.8}
        style={{ stroke: srcColor, strokeWidth: CHAIN_W, strokeLinecap: 'round' }}
      />
    );
  }

  // ── Chain edge (action → action) ────────────────────────────────────────────
  const sx = sp.x + R, sy = sp.y + R;
  const ex = tp.x + R, ey = tp.y + R;
  const d  = chainPath(sx, sy, ex, ey);
  // Stripe mode: all chain edges except leaves (no predecessor).
  // Two interleaved dashed paths create alternating colour stripes.
  if (sourceHasIncomingChain) {
    return (
      <g>
        {/* White ghost for readability against coloured lane backgrounds */}
        <path d={d} fill="none" stroke="white" strokeWidth={CHAIN_W + 3} strokeLinecap="butt" opacity={0.4} />
        {/* Stripe A — source colour */}
        <path
          d={d} fill="none"
          stroke={srcColor}
          strokeWidth={CHAIN_W}
          strokeDasharray="16 16"
          strokeDashoffset="0"
          strokeLinecap="butt"
        />
        {/* Stripe B — target colour, offset by half-dash to interleave */}
        <path
          d={d} fill="none"
          stroke={tgtColor}
          strokeWidth={CHAIN_W}
          strokeDasharray="16 16"
          strokeDashoffset="16"
          strokeLinecap="butt"
        />
      </g>
    );
  }

  // Solid edge for leaf sources (first node in a chain).
  // style={{}} beats ReactFlow's .react-flow__edge-path { stroke: #b1b1b7; stroke-width: 1 } rule.
  return (
    <g>
      {/* White ghost so the line reads against coloured lane backgrounds */}
      <path d={d} fill="none" stroke="white" strokeWidth={CHAIN_W + 3} strokeLinecap="round" opacity={0.45} />
      <path
        id={id}
        className="react-flow__edge-path"
        d={d}
        fill="none"
        style={{ stroke: srcColor, strokeWidth: CHAIN_W, strokeLinecap: 'round' }}
      />
    </g>
  );
}

export default memo(TimelineEdge);
