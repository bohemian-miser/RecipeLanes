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

'use client';

import React, {
  useMemo, useState, useRef, useCallback, useEffect,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { Play, Pause, RotateCcw, ZoomIn, ZoomOut, Maximize2, Undo2 } from 'lucide-react';
import {
  buildTimelineLayout, TL,
  type TLNode, type TLEdge, type TLLane,
} from '@/lib/recipe-lanes/timeline-layout';
import {
  getNodeIconUrlAt, getNodeIngredientName, getNodeIconId, getNodeShortlistKey,
} from '@/lib/recipe-lanes/model-utils';
import { useRecipeStore } from '@/lib/stores/recipe-store';
import { forgeIconAction } from '@/app/actions';
import type { RecipeGraph, RecipeNode } from '@/lib/recipe-lanes/types';

// ── Constants ─────────────────────────────────────────────────────────────────
const TICK_MS   = 250;
const TICK_MIN  = 0.5;
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Viewport { x: number; y: number; scale: number }
const DEFAULT_VP: Viewport = { x: 16, y: 8, scale: 1 };

type DragState =
  | { type: 'canvas'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { type: 'box';    sx: number; sy: number; ex: number; ey: number }
  | { type: 'node';   nodeId: string; movers: string[]; sx: number; sy: number;
      origPositions: Map<string, { cx: number; cy: number }>; moved: boolean; shiftHeld: boolean };

// ── Ancestor walk ─────────────────────────────────────────────────────────────
function getAncestorIds(nodeId: string, nodes: RecipeNode[]): string[] {
  const map = new Map(nodes.map(n => [n.id, n]));
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const pid of map.get(id)?.inputs ?? []) {
      if (!out.has(pid)) { out.add(pid); walk(pid); }
    }
  };
  walk(nodeId);
  return [...out];
}

// ── Edge paths ────────────────────────────────────────────────────────────────
function chainPath(x1: number, y1: number, x2: number, y2: number): string {
  const sx = x1 + TL.NODE_R, ex = x2 - TL.NODE_R;
  if (sx >= ex) return `M ${sx} ${y1} L ${ex} ${y2}`;
  if (Math.abs(y2 - y1) < 1) return `M ${sx} ${y1} H ${ex}`;
  const mid = (sx + ex) / 2;
  return `M ${sx} ${y1} C ${mid} ${y1} ${mid} ${y2} ${ex} ${y2}`;
}
function spurPath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1 + TL.NODE_R} L ${x2} ${y2 - TL.NODE_R}`;
}

// ── Node controls (↺ reroll, ⚒ forge, × delete) ───────────────────────────
function NodeControls({ cx, cy, isForging, onReroll, onForge, onDelete }: {
  cx: number; cy: number; isForging: boolean;
  onReroll: (e: React.MouseEvent) => void;
  onForge:  (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const y = cy - TL.NODE_R;
  return (
    <g onMouseDown={e => e.stopPropagation()}>
      <g onClick={onReroll} style={{ cursor: 'pointer' }}>
        <circle cx={cx - 18} cy={y} r={8} fill="#3b82f6" stroke="white" strokeWidth={1.5}/>
        <text x={cx - 18} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="white">↺</text>
      </g>
      <g onClick={onForge} style={{ cursor: isForging ? 'not-allowed' : 'pointer' }}>
        <circle cx={cx} cy={y} r={8} fill={isForging ? '#f59e0b' : '#92400e'} stroke="white" strokeWidth={1.5}/>
        <text x={cx} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="white">
          {isForging ? '…' : '⚒'}
        </text>
      </g>
      <g onClick={onDelete} style={{ cursor: 'pointer' }}>
        <circle cx={cx + 18} cy={y} r={8} fill="#ef4444" stroke="white" strokeWidth={1.5}/>
        <text x={cx + 18} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="white">×</text>
      </g>
    </g>
  );
}

// ── Shared node props ─────────────────────────────────────────────────────────
interface NodeProps {
  node: TLNode; cx: number; cy: number;
  lineColor: string; playbackMin: number | null;
  isHovered: boolean; isSelected: boolean; isForging: boolean;
  onMouseDown:  (e: React.MouseEvent) => void;
  onMouseEnter: () => void; onMouseLeave: () => void;
  onReroll: (e: React.MouseEvent) => void;
  onForge:  (e: React.MouseEvent) => void;
  onDelete: () => void;
}

// ── Action node ───────────────────────────────────────────────────────────────
function ActionNode({ node, cx, cy, lineColor, playbackMin, isHovered, isSelected, isForging,
  onMouseDown, onMouseEnter, onMouseLeave, onReroll, onForge, onDelete }: NodeProps) {
  const { data } = node;
  const iconUrl = getNodeIconUrlAt(data, Math.max(0, data.shortlistIndex ?? 0));
  const clipId  = `tl-a-${node.id.replace(/\W/g, '')}`;
  const innerR  = TL.NODE_R - 3;

  const endMin   = node.startMin + node.durationMin;
  const isDone   = playbackMin !== null && playbackMin >= endMin;
  const isActive = playbackMin !== null && playbackMin >= node.startMin && !isDone;

  const ring  = isSelected ? '#6366f1' : lineColor;
  const ringW = isSelected ? 3 : isActive ? 3 : 2;

  return (
    <g opacity={isDone ? 0.4 : 1} style={{ cursor: 'pointer' }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      data-testid={`node-${node.id}`}
    >
      {isActive   && <circle cx={cx} cy={cy} r={TL.NODE_R + 8} fill={lineColor} opacity={0.15}/>}
      {isSelected && <circle cx={cx} cy={cy} r={TL.NODE_R + 4} fill="none" stroke="#6366f1" strokeWidth={1.5} opacity={0.5}/>}
      <circle cx={cx} cy={cy} r={TL.NODE_R}
        fill={isDone ? '#f4f4f5' : 'white'} stroke={ring} strokeWidth={ringW}/>
      {iconUrl ? (
        <>
          <clipPath id={clipId}><circle cx={cx} cy={cy} r={innerR}/></clipPath>
          <image href={iconUrl} x={cx - innerR} y={cy - innerR}
            width={innerR * 2} height={innerR * 2}
            clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice"/>
        </>
      ) : (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
          fontSize={12} fill={lineColor} fontWeight="700">⚡</text>
      )}
      <text x={cx} y={cy + TL.NODE_R + 9}
        textAnchor="middle" fontSize={8} fill={isDone ? '#a1a1aa' : '#3f3f46'}
        fontFamily="ui-sans-serif, system-ui, sans-serif">{data.text}</text>
      {!isHovered && data.duration && playbackMin === null && (
        <text x={cx} y={cy - TL.NODE_R - 5}
          textAnchor="middle" fontSize={8} fill="#a1a1aa" fontFamily="ui-monospace, monospace">
          {data.duration}
        </text>
      )}
      {isHovered && (
        <NodeControls cx={cx} cy={cy} isForging={isForging}
          onReroll={onReroll} onForge={onForge}
          onDelete={e => { e.stopPropagation(); onDelete(); }}/>
      )}
    </g>
  );
}

// ── Ingredient node ───────────────────────────────────────────────────────────
function IngredientNode({ node, cx, cy, lineColor, playbackMin, isHovered, isSelected, isForging,
  onMouseDown, onMouseEnter, onMouseLeave, onReroll, onForge, onDelete }: NodeProps) {
  const { data } = node;
  const iconUrl = getNodeIconUrlAt(data, Math.max(0, data.shortlistIndex ?? 0));
  const clipId  = `tl-i-${node.id.replace(/\W/g, '')}`;
  const innerR  = TL.NODE_R - 3;
  const ring = isSelected ? '#6366f1' : lineColor;

  return (
    <g opacity={playbackMin !== null ? 0.6 : 1} style={{ cursor: 'pointer' }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      data-testid={`node-${node.id}`}
    >
      {isSelected && <circle cx={cx} cy={cy} r={TL.NODE_R + 4} fill="none" stroke="#6366f1" strokeWidth={1.5} opacity={0.5}/>}
      <circle cx={cx} cy={cy} r={TL.NODE_R}
        fill="white" stroke={ring} strokeWidth={isSelected ? 2.5 : 1.5} strokeDasharray="3 2"/>
      {iconUrl ? (
        <>
          <clipPath id={clipId}><circle cx={cx} cy={cy} r={innerR}/></clipPath>
          <image href={iconUrl} x={cx - innerR} y={cy - innerR}
            width={innerR * 2} height={innerR * 2}
            clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice"/>
        </>
      ) : (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={lineColor}>·</text>
      )}
      <text x={cx} y={cy + TL.NODE_R + 9}
        textAnchor="middle" fontSize={8} fill="#52525b"
        fontFamily="ui-sans-serif, system-ui, sans-serif">{data.text}</text>
      {isHovered && (
        <NodeControls cx={cx} cy={cy} isForging={isForging}
          onReroll={onReroll} onForge={onForge}
          onDelete={e => { e.stopPropagation(); onDelete(); }}/>
      )}
    </g>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function TimelineView({ graph, onSave }: { graph: RecipeGraph, onSave?: (graph: RecipeGraph) => void }) {
  const searchParams   = useSearchParams();
  const recipeId       = searchParams.get('id');
  const cycleShortlist = useRecipeStore(s => s.cycleShortlist);
  const setGraph       = useRecipeStore(s => s.setGraph);

  const layout = useMemo(() => buildTimelineLayout(graph), [graph]);
  const { nodes, edges, lanes, totalMinutes, totalWidth, totalHeight, pixelsPerMin: ppm, actionZoneY } = layout;

  // ── Playback ──────────────────────────────────────────────────────────────
  const [playbackMin, setPlaybackMin] = useState<number | null>(null);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);
  const pause     = useCallback(() => { setIsPlaying(false); stopInterval(); }, [stopInterval]);
  const play      = useCallback(() => {
    setIsPlaying(true);
    setPlaybackMin(p => (p === null || p >= layout.totalMinutes + 1) ? 0 : p);
    stopInterval();
    intervalRef.current = setInterval(() => {
      setPlaybackMin(p => {
        const n = (p ?? 0) + TICK_MIN;
        if (n > layout.totalMinutes + 1) { stopInterval(); setIsPlaying(false); return layout.totalMinutes + 1; }
        return n;
      });
    }, TICK_MS);
  }, [layout.totalMinutes, stopInterval]);
  const resetPlay = useCallback(() => { pause(); setPlaybackMin(null); }, [pause]);
  useEffect(() => () => stopInterval(), [stopInterval]);

  // ── Undo ──────────────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<RecipeGraph[]>([]);
  const pushUndo = useCallback((s: RecipeGraph) => setUndoStack(p => [...p.slice(-49), s]), []);
  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (!prev.length) return prev;
      const next = [...prev];
      setGraph(next.pop()!);
      return next;
    });
  }, [setGraph]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo]);

  // ── Forge state ───────────────────────────────────────────────────────────
  const [forgingIds, setForgingIds]   = useState<Set<string>>(new Set());
  const forgingIdsRef                 = useRef(forgingIds);
  const prevShortlistKeysRef          = useRef<Map<string, string>>(new Map());
  useEffect(() => { forgingIdsRef.current = forgingIds; }, [forgingIds]);

  // Clear forge when shortlist key changes (forge result arrived)
  useEffect(() => {
    const curr = forgingIdsRef.current;
    if (!curr.size) return;
    const toRemove: string[] = [];
    for (const id of curr) {
      const node   = graph.nodes.find(n => n.id === id);
      const prev   = prevShortlistKeysRef.current.get(id);
      const newKey = node ? getNodeShortlistKey(node) : 'gone';
      if (prev !== undefined && prev !== newKey) toRemove.push(id);
      if (node) prevShortlistKeysRef.current.set(id, newKey);
    }
    if (toRemove.length)
      setForgingIds(p => { const n = new Set(p); toRemove.forEach(id => n.delete(id)); return n; });
  }, [graph.nodes]); // intentionally excludes forgingIds

  const handleForge = useCallback(async (nodeId: string, data: RecipeNode) => {
    if (forgingIdsRef.current.has(nodeId)) return;
    prevShortlistKeysRef.current.set(nodeId, getNodeShortlistKey(data));
    setForgingIds(p => new Set([...p, nodeId]));
    try {
      const res = await forgeIconAction(recipeId ?? '', getNodeIngredientName(data), getNodeIconId(data) ?? '');
      if (res && !res.success)
        setForgingIds(p => { const n = new Set(p); n.delete(nodeId); return n; });
    } catch {
      setForgingIds(p => { const n = new Set(p); n.delete(nodeId); return n; });
    }
  }, [recipeId]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef                = useRef(selectedIds);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  // ── Position overrides ────────────────────────────────────────────────────
  const [posOverrides, setPosOverrides] = useState<Map<string, { cx: number; cy: number }>>(() => {
    const m = new Map<string, { cx: number; cy: number }>();
    if (graph.layouts?.['timeline2']) {
      graph.layouts['timeline2'].forEach(l => {
        m.set(l.id, { cx: l.x + TL.NODE_R, cy: l.y + TL.NODE_R });
      });
    } else if (graph.layoutMode === 'timeline2') {
      graph.nodes.forEach(n => {
        if (n.x !== undefined && n.y !== undefined) {
          m.set(n.id, { cx: n.x + TL.NODE_R, cy: n.y + TL.NODE_R });
        }
      });
    }
    return m;
  });
  const posOverridesRef                 = useRef(posOverrides);
  useEffect(() => { posOverridesRef.current = posOverrides; }, [posOverrides]);

  // ── Hover ─────────────────────────────────────────────────────────────────
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // ── Box select (state for rendering) ─────────────────────────────────────
  const [boxRect, setBoxRect] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteNode = useCallback((nodeId: string) => {
    pushUndo(graph);
    setGraph({ ...graph, nodes: graph.nodes.filter(n => n.id !== nodeId) });
    setPosOverrides(p => { const n = new Map(p); n.delete(nodeId); return n; });
    setSelectedIds(p => { const n = new Set(p); n.delete(nodeId); return n; });
    setHoveredNodeId(null);
  }, [graph, setGraph, pushUndo]);

  // ── Viewport / drag ───────────────────────────────────────────────────────
  const [vp, setVp]       = useState<Viewport>(DEFAULT_VP);
  const vpRef             = useRef(vp);
  const svgRef            = useRef<SVGSVGElement>(null);
  const dragRef           = useRef<DragState | null>(null);
  const graphNodesRef     = useRef(graph.nodes);
  const tlNodesRef        = useRef(nodes);
  useEffect(() => { vpRef.current         = vp; }, [vp]);
  useEffect(() => { graphNodesRef.current = graph.nodes; }, [graph.nodes]);
  useEffect(() => { tlNodesRef.current    = nodes; }, [nodes]);

  // Wheel zoom (non-passive)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const fn = (e: WheelEvent) => {
      e.preventDefault();
      const f    = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect = el.getBoundingClientRect();
      setVp(prev => {
        const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * f));
        const cx = (e.clientX - rect.left - prev.x) / prev.scale;
        const cy = (e.clientY - rect.top  - prev.y) / prev.scale;
        return { scale: ns, x: e.clientX - rect.left - cx * ns, y: e.clientY - rect.top - cy * ns };
      });
    };
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, []);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { type: 'canvas', sx: e.clientX, sy: e.clientY, ox: vp.x, oy: vp.y, moved: false };
  }, [vp]);

  const onNodeMouseDown = useCallback((e: React.MouseEvent, node: TLNode) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    const sel    = selectedIdsRef.current;
    const isSel  = sel.has(node.id);
    const movers = isSel && sel.size > 1 ? [...Array.from(sel)] : [node.id];

    const orig = new Map<string, { cx: number; cy: number }>();
    for (const mid of movers) {
      const mn = tlNodesRef.current.find(n => n.id === mid);
      if (mn) orig.set(mid, posOverridesRef.current.get(mid) ?? { cx: mn.cx, cy: mn.cy });
    }
    // shiftHeld recorded here so onMouseMove can check it at drag-start (mirrors onNodeDragStart in DAG)
    dragRef.current = { type: 'node', nodeId: node.id, movers, sx: e.clientX, sy: e.clientY, origPositions: orig, moved: false, shiftHeld: e.shiftKey };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;

    if (d.type === 'canvas') {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
      setVp(prev => ({ ...prev, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.type === 'box') {
      d.ex = e.clientX; d.ey = e.clientY;
      setBoxRect({ sx: d.sx, sy: d.sy, ex: d.ex, ey: d.ey });
    } else {
      const dx = (e.clientX - d.sx) / vpRef.current.scale;
      const dy = (e.clientY - d.sy) / vpRef.current.scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3 || d.moved) {
        if (!d.moved) {
          d.moved = true;
          // ── Pivot: same trigger as onNodeDragStart in DAG view ────────────────
          // Check shiftKey at the moment drag actually begins (not at mousedown),
          // then add all ancestors to movers + capture their current positions.
          if (d.shiftHeld || e.shiftKey) {
            const ancestors = getAncestorIds(d.nodeId, graphNodesRef.current);
            for (const aid of ancestors) {
              if (!d.movers.includes(aid)) {
                d.movers.push(aid);
                const an = tlNodesRef.current.find(n => n.id === aid);
                if (an) d.origPositions.set(aid, posOverridesRef.current.get(aid) ?? { cx: an.cx, cy: an.cy });
              }
            }
          }
        }
        setPosOverrides(prev => {
          const next = new Map(prev);
          for (const [mid, o] of d.origPositions) next.set(mid, { cx: o.cx + dx, cy: o.cy + dy });
          return next;
        });
      }
    }
  }, []);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;

    if (d.type === 'box') {
      setBoxRect(null);
      const el = svgRef.current;
      if (!el) return;
      const r  = el.getBoundingClientRect();
      const cv = vpRef.current;
      const toC = (sx: number, sy: number) => ({
        cx: (sx - r.left - cv.x) / cv.scale,
        cy: (sy - r.top  - cv.y) / cv.scale,
      });
      const p1 = toC(Math.min(d.sx, d.ex), Math.min(d.sy, d.ey));
      const p2 = toC(Math.max(d.sx, d.ex), Math.max(d.sy, d.ey));
      const hit = nodes
        .filter(n => {
          const pos = posOverridesRef.current.get(n.id) ?? { cx: n.cx, cy: n.cy };
          return pos.cx >= p1.cx && pos.cx <= p2.cx && pos.cy >= p1.cy && pos.cy <= p2.cy;
        })
        .map(n => n.id);
      setSelectedIds(prev => new Set([...(e.shiftKey ? prev : []), ...hit]));
      return;
    }

    if (d.type === 'canvas' && !d.moved) {
      setSelectedIds(new Set());
      return;
    }

    if (d.type === 'node' && !d.moved) {
      if (d.shiftHeld) {
        setSelectedIds(prev => { const n = new Set(prev); n.has(d.nodeId) ? n.delete(d.nodeId) : n.add(d.nodeId); return n; });
      } else {
        // Select clicked node + all its ancestors (everything feeding into it)
        const ancestors = getAncestorIds(d.nodeId, graphNodesRef.current);
        setSelectedIds(new Set([d.nodeId, ...ancestors]));
      }
    }

    if (d.type === 'node' && d.moved) {
      // Drag finished, apply positions to graph and save
      const nextNodes = graphNodesRef.current.map(n => {
        const over = posOverridesRef.current.get(n.id);
        if (over) return { ...n, x: over.cx - TL.NODE_R, y: over.cy - TL.NODE_R };
        return n;
      });
      const nextGraph = { ...graph, nodes: nextNodes };
      onSave?.(nextGraph);
    }
  }, [nodes, graph, onSave]);

  const zoomBy    = useCallback((f: number) => {
    setVp(prev => {
      const el  = svgRef.current;
      const w   = el ? el.clientWidth  / 2 : 0;
      const h   = el ? el.clientHeight / 2 : 0;
      const ns  = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * f));
      const cx  = (w - prev.x) / prev.scale;
      const cy  = (h - prev.y) / prev.scale;
      return { scale: ns, x: w - cx * ns, y: h - cy * ns };
    });
  }, []);
  const resetZoom = useCallback(() => setVp(DEFAULT_VP), []);

  // ── Rendering helpers ─────────────────────────────────────────────────────
  const lineColorOf = useMemo(() => {
    const m = new Map(lanes.map(l => [l.laneId, l.lineColor]));
    return (id: string) => m.get(id) ?? '#D4D4D8';
  }, [lanes]);

  const effectivePos = useCallback((node: TLNode) =>
    posOverrides.get(node.id) ?? { cx: node.cx, cy: node.cy },
  [posOverrides]);

  const gridTicks: number[] = [];
  for (let t = 0; t <= Math.ceil(totalMinutes) + TL.GRID_INTERVAL; t += TL.GRID_INTERVAL) gridTicks.push(t);

  // Box select rect in content space
  const boxContent = boxRect && svgRef.current ? (() => {
    const r = svgRef.current!.getBoundingClientRect();
    const cv = vpRef.current;
    const toC = (sx: number, sy: number) => ({
      x: (sx - r.left - cv.x) / cv.scale, y: (sy - r.top - cv.y) / cv.scale,
    });
    const p1 = toC(Math.min(boxRect.sx, boxRect.ex), Math.min(boxRect.sy, boxRect.ey));
    const p2 = toC(Math.max(boxRect.sx, boxRect.ex), Math.max(boxRect.sy, boxRect.ey));
    return { x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y };
  })() : null;

  if (!nodes.length) {
    return <div className="flex items-center justify-center h-full text-zinc-400 text-sm">No nodes to display.</div>;
  }

  const playheadX = playbackMin !== null ? TL.LANE_LABEL_W + playbackMin * ppm : null;
  const playMins  = playbackMin !== null ? Math.floor(playbackMin) : 0;
  const playSecs  = playbackMin !== null ? Math.round((playbackMin % 1) * 60) : 0;

  return (
    <div className="flex flex-col h-full bg-white select-none">

      {/* ── Controls bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-100 bg-zinc-50 shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button onClick={isPlaying ? pause : play}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-zinc-800 text-white text-xs font-medium hover:bg-zinc-700 transition-colors">
            {isPlaying ? <><Pause className="w-3 h-3"/>Pause</> : <><Play className="w-3 h-3"/>Play</>}
          </button>
          <button onClick={resetPlay} title="Reset"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors">
            <RotateCcw className="w-3 h-3"/>
          </button>
          {playbackMin !== null && (
            <span className="text-xs text-zinc-500 font-mono tabular-nums">
              {playMins}m {String(playSecs).padStart(2, '0')}s
            </span>
          )}
        </div>

        <div className="w-px h-4 bg-zinc-200 mx-1"/>

        <div className="flex items-center gap-1">
          <button onClick={() => zoomBy(1.25)} title="Zoom in" className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"><ZoomIn className="w-3.5 h-3.5"/></button>
          <button onClick={() => zoomBy(1/1.25)} title="Zoom out" className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"><ZoomOut className="w-3.5 h-3.5"/></button>
          <button onClick={resetZoom} title="Reset zoom" className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"><Maximize2 className="w-3.5 h-3.5"/></button>
          <span className="text-xs text-zinc-400 font-mono tabular-nums w-10 text-right">{Math.round(vp.scale * 100)}%</span>
        </div>

        <div className="w-px h-4 bg-zinc-200 mx-1"/>

        <button onClick={undo} disabled={!undoStack.length} title="Undo (⌘Z)"
          className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
          <Undo2 className="w-3.5 h-3.5"/>
        </button>

        {selectedIds.size > 0 && (
          <span className="text-xs text-indigo-600 font-medium ml-1">{selectedIds.size} selected</span>
        )}
        <span className="ml-auto text-xs text-zinc-400 font-mono">~{Math.round(totalMinutes)} min</span>
      </div>

      {/* ── SVG canvas ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden bg-zinc-50">
        <svg ref={svgRef} width="100%" height="100%"
          style={{ cursor: boxRect ? 'crosshair' : 'grab', display: 'block' }}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.scale})`}
             style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

            {/* Lane bands */}
            {lanes.map((lane: TLLane) => (
              <rect key={`band-${lane.laneId}`}
                x={0} y={lane.yMin} width={totalWidth}
                height={lane.yMax - lane.yMin + TL.LANE_GAP / 2}
                fill={lane.color}/>
            ))}

            {/* Ingredient zone */}
            <rect x={0} y={TL.RULER_H} width={totalWidth} height={TL.INGREDIENT_ZONE_H} fill="#fafafa"/>

            {/* Lane labels */}
            {lanes.map((lane: TLLane) => {
              const my = (lane.yMin + lane.yMax) / 2;
              return (
                <text key={`lbl-${lane.laneId}`}
                  x={TL.LANE_LABEL_W / 2} y={my}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fontWeight="600" fill="#71717a"
                  transform={`rotate(-90, ${TL.LANE_LABEL_W / 2}, ${my})`}>
                  {lane.label}
                </text>
              );
            })}

            {/* Separators */}
            <line x1={TL.LANE_LABEL_W} y1={TL.RULER_H} x2={TL.LANE_LABEL_W} y2={totalHeight} stroke="#e4e4e7" strokeWidth={1}/>
            <line x1={TL.LANE_LABEL_W} y1={actionZoneY} x2={totalWidth} y2={actionZoneY} stroke="#e4e4e7" strokeWidth={0.75} strokeDasharray="4 3"/>

            {/* Grid + ruler */}
            {gridTicks.map(t => {
              const x = TL.LANE_LABEL_W + t * ppm, major = t % 10 === 0;
              return (
                <g key={`g-${t}`}>
                  <line x1={x} y1={TL.RULER_H} x2={x} y2={totalHeight}
                    stroke={major ? '#d4d4d8' : '#eeeeee'}
                    strokeWidth={major ? 1 : 0.5}
                    strokeDasharray={major ? undefined : '2 3'}/>
                  <text x={x} y={TL.RULER_H - 6} textAnchor="middle" fontSize={9}
                    fill={major ? '#71717a' : '#a1a1aa'} fontFamily="ui-monospace, monospace">
                    {t}m
                  </text>
                </g>
              );
            })}
            <line x1={TL.LANE_LABEL_W} y1={TL.RULER_H} x2={totalWidth} y2={TL.RULER_H} stroke="#d4d4d8" strokeWidth={1}/>

            {/* Edges */}
            {edges.map((edge: TLEdge) => {
              const sn = nodes.find((n: TLNode) => n.id === edge.sourceId);
              const tn = nodes.find((n: TLNode) => n.id === edge.targetId);
              const sp = sn ? effectivePos(sn) : { cx: edge.x1, cy: edge.y1 };
              const tp = tn ? effectivePos(tn) : { cx: edge.x2, cy: edge.y2 };
              const color = edge.kind === 'spur'
                ? (tn ? lineColorOf(tn.laneId) : '#D4D4D8')
                : (sn ? lineColorOf(sn.laneId) : '#D4D4D8');
              return edge.kind === 'spur' ? (
                <path key={edge.id} d={spurPath(sp.cx, sp.cy, tp.cx, tp.cy)}
                  fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.6}/>
              ) : (
                <path key={edge.id} d={chainPath(sp.cx, sp.cy, tp.cx, tp.cy)}
                  fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
              );
            })}

            {/* Nodes */}
            {nodes.map((node: TLNode) => {
              const color = lineColorOf(node.laneId);
              const pos   = effectivePos(node);
              const props: NodeProps = {
                node, cx: pos.cx, cy: pos.cy, lineColor: color, playbackMin,
                isHovered:  hoveredNodeId === node.id,
                isSelected: selectedIds.has(node.id),
                isForging:  forgingIds.has(node.id),
                onMouseDown:  e => onNodeMouseDown(e, node),
                onMouseEnter: () => setHoveredNodeId(node.id),
                onMouseLeave: () => setHoveredNodeId(id => id === node.id ? null : id),
                onReroll: e => { e.stopPropagation(); cycleShortlist(node.id); },
                onForge:  e => { e.stopPropagation(); handleForge(node.id, node.data); },
                onDelete: () => deleteNode(node.id),
              };
              return node.kind === 'ingredient'
                ? <IngredientNode key={node.id} {...props}/>
                : <ActionNode     key={node.id} {...props}/>;
            })}

            {/* Box select rect */}
            {boxContent && (
              <rect x={boxContent.x} y={boxContent.y} width={boxContent.w} height={boxContent.h}
                fill="#6366f1" fillOpacity={0.08} stroke="#6366f1" strokeWidth={1} strokeDasharray="4 2"/>
            )}

            {/* Playhead */}
            {playheadX !== null && (
              <g>
                <line x1={playheadX} y1={TL.RULER_H} x2={playheadX} y2={totalHeight}
                  stroke="#ef4444" strokeWidth={1.5}/>
                <polygon
                  points={`${playheadX-5},${TL.RULER_H} ${playheadX+5},${TL.RULER_H} ${playheadX},${TL.RULER_H+8}`}
                  fill="#ef4444"/>
              </g>
            )}

          </g>
        </svg>
      </div>
    </div>
  );
}
