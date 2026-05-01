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

import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, memo } from 'react';
import ReactFlow, {
    Background,
    Controls,
    ReactFlowProvider,
    useReactFlow
} from 'reactflow';

// @ts-ignore
import { Node, Edge, Panel, MarkerType, useNodesState, useEdgesState } from 'reactflow';

type Node = any;
type Edge = any;
import 'reactflow/dist/style.css';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceY, forceX } from 'd3-force';

import { calculateLayout, LayoutMode } from '../../lib/recipe-lanes/layout';
import { calculateRepulsiveCurvesLayout } from '../../lib/recipe-lanes/layout-force';
import { RecipeGraph } from '../../lib/recipe-lanes/types';
import { getNodeIconUrl, getNodeIconId, preserveNodeShortlist, getNodeShortlistLength } from '../../lib/recipe-lanes/model-utils';
import MinimalNode from './nodes/minimal-node';
import LaneNode from './nodes/lane-node';
import MicroNode from './nodes/micro-node';
import TimelineNode from './nodes/timeline-node';
import FloatingEdge from './edges/floating-edge';
import TimelineEdge from './edges/timeline-edge';
import TimelineBackground, { type TimelineData } from './timeline-background';
import { toPng } from 'html-to-image';
import { Download, Share2, Undo, Redo, Check, Save } from 'lucide-react';
import { useHistoryManager } from './hooks/useHistoryManager';
import { useSaveAndFork } from './hooks/useSaveAndFork';
import { useRecipeStore } from '../../lib/stores/recipe-store';

interface ReactFlowDiagramProps {
  graph: RecipeGraph;
  mode: LayoutMode | 'repulsive';
  spacing?: number;
  edgeStyle?: 'straight' | 'step' | 'bezier';
  textPos?: 'bottom' | 'top' | 'left' | 'right';
  isLive?: boolean;
  onInteraction?: () => void;
  onEdit?: () => void;
  onSave?: (newGraph: RecipeGraph) => void;
  isPublic?: boolean;
  onVisibilityChange?: (isPublic: boolean) => void;
  isLoggedIn?: boolean;
  onNotify?: (msg: string) => void;
  isOwner?: boolean; // YOLO: Added to support auto-save on move logic
  iconTheme?: 'classic' | 'modern' | 'modern_clean';
}

export interface ReactFlowDiagramHandle {
    resetLayout: () => void;
    toggleVisibility: () => Promise<void>;
    getGraph: () => RecipeGraph;
}

const INITIAL_NODE_TYPES = {
    minimal: MinimalNode,
    lane: LaneNode,
    micro: MicroNode,
    'timeline-node': TimelineNode,
};

const INITIAL_EDGE_TYPES = {
    floating: FloatingEdge,
    timeline: TimelineEdge,
};

const DiagramInner = memo(forwardRef<ReactFlowDiagramHandle, ReactFlowDiagramProps>(({ graph, mode: propMode, spacing = 1, edgeStyle: propEdgeStyle = 'straight', textPos = 'bottom', isLive = false, onInteraction, onEdit, onSave, isPublic: propIsPublic, onVisibilityChange, isLoggedIn = false, onNotify, isOwner = false, iconTheme: propIconTheme = 'classic' }, ref) => {

    const iconStyle = useRecipeStore(s => s.iconStyle);
    const edgeStyle = useRecipeStore(s => s.lineStyle);
    const mode = useRecipeStore(s => s.nodeLayout);
    const backgrounds = useRecipeStore(s => s.backgrounds);
    const iconTheme = iconStyle;

    // Cast hooks to avoid implicit any in callbacks
    const [nodes, setNodesRaw, onNodesChange] = useNodesState([]);
    const setNodes = setNodesRaw as React.Dispatch<React.SetStateAction<any[]>>;

    const [edges, setEdgesRaw, onEdgesChange] = useEdgesState([]);
    const setEdges = setEdgesRaw as React.Dispatch<React.SetStateAction<any[]>>;

    const { fitView, getNodes: getNodesRaw, getEdges: getEdgesRaw } = useReactFlow();
    const getNodes = getNodesRaw as () => any[];
    const getEdges = getEdgesRaw as () => any[];
    const flowWrapper = useRef<HTMLDivElement>(null);
    const simulationRef = useRef<any>(null);
    const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
    const {
        copied,
        saved,
        isDirty,
        setIsDirty,
        isPublic,
        visibilityRef,
        getGraph,
        performSave,
        handleSave,
        handleShare,
        toggleVisibility,
    } = useSaveAndFork({
        graph,
        mode,
        getNodes,
        getEdges,
        isLoggedIn,
        isOwner,
        propIsPublic,
        onVisibilityChange,
        onSave,
        onNotify,
    });

    // Theme Effect
    useEffect(() => {
        setNodes(nds => nds.map(n => ({
            ...n,
            data: { ...n.data, iconTheme }
        })));
    }, [iconTheme, setNodes]);

    // Wrap change handlers to track dirty state
    const onNodesChangeWrapped = useCallback((changes: any) => {
        onNodesChange(changes);
        if (changes.some((c: any) => c.type !== 'select')) {
            setIsDirty(true);
            onEdit?.();
        }
    }, [onNodesChange, onEdit]);

    const onEdgesChangeWrapped = useCallback((changes: any) => {
        onEdgesChange(changes);
        if (changes.some((c: any) => c.type !== 'select')) {
            setIsDirty(true);
            onEdit?.();
        }
    }, [onEdgesChange, onEdit]);
    
    // Drag State for Branch Rotation
    const dragRef = useRef<{
        active: boolean;
        pivot?: { x: number, y: number };
        startAngle?: number;
        startDist?: number;
        ancestors?: string[];
        initialPositions?: Record<string, { x: number, y: number }>;
    }>({ active: false });
    
    // Long Press State for Mobile Pivot
    const longPressTriggered = useRef(false);
    const selectBranch = useCallback((nodeId: string) => {
        const getAncestors = (id: string, visited = new Set<string>()): string[] => {
            if (visited.has(id)) return [];
            visited.add(id);
            const incoming = edges.filter((e: any) => e.target === id);
            const parents = incoming.map((e: any) => e.source);
            return [...parents, ...parents.flatMap((p: any) => getAncestors(p, visited))];
        };

        const ancestors = getAncestors(nodeId);
        const toSelect = new Set([nodeId, ...ancestors]);

        setNodes((nds) => nds.map((n) => ({
            ...n,
            selected: toSelect.has(n.id) || n.selected
        })));
    }, [edges, setNodes]);

    const setLongPress = useCallback((active: boolean, nodeId?: string) => {
        longPressTriggered.current = active;
        if (active && nodeId) {
            selectBranch(nodeId);
        }
    }, [selectBranch]);

    // History
    const { past, future, takeSnapshot, undo, redo, handleDeleteNode } = useHistoryManager({
        getNodes,
        getEdges,
        setNodes,
        setEdges,
        edgeStyle,
        onEdit,
        setIsDirty,
    });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
                 e.preventDefault();
                 redo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);

    // Initial Layout Calculation
    const runLayout = useCallback((preservePositions = false, fit = true) => {
        let layout;

        // Determine effective graph and preservation status based on mode
        let effectiveGraph = graph;
        let shouldUseSavedLayout = false;

        if (preservePositions) {
            // 1. Check for Independent Layout in layouts map
            if (graph.layouts && graph.layouts[mode]) {
                const layoutNodes = graph.layouts[mode];
                const nodesWithLayout = graph.nodes.map(n => {
                    const pos = layoutNodes.find(l => l.id === n.id);
                    return pos ? { ...n, x: pos.x, y: pos.y } : n;
                });
                effectiveGraph = { ...graph, nodes: nodesWithLayout };
                shouldUseSavedLayout = true;
            } 
            // 2. Fallback: If mode matches the saved 'layoutMode', use main nodes positions
            else if (graph.layoutMode === mode && graph.nodes.some(n => n.x !== undefined)) {
                 shouldUseSavedLayout = true;
            }
        }

        const canPreserve = shouldUseSavedLayout;

        if (canPreserve) {
            const safeMode = (['swimlanes', 'dagre', 'dagre-lr', 'timeline'].includes(mode as string)) ? (mode as LayoutMode) : 'dagre';
            layout = calculateLayout(effectiveGraph, safeMode, spacing, true);
        } else if (mode === 'repulsive') {
            layout = calculateRepulsiveCurvesLayout(effectiveGraph, spacing);
        } else {
            layout = calculateLayout(effectiveGraph, mode as LayoutMode, spacing);
        }

        const isTimeline = mode === 'timeline';

        const newNodes: Node[] = [];

        layout.lanes.forEach(lane => {
             newNodes.push({
                 id: lane.id,
                 type: 'lane',
                 position: { x: lane.x, y: lane.y },
                 data: { label: lane.label, color: lane.color },
                 style: {
                     width: lane.width,
                     height: lane.height,
                     zIndex: -1,
                     // In timeline mode: colored band background + no pointer events so
                     // clicking empty space deselects nodes correctly.
                     ...(isTimeline ? { backgroundColor: lane.color, pointerEvents: 'none' } : {}),
                 },
                 draggable: false,
                 selectable: false,
                 focusable: false,
                 zIndex: -1
             });
        });

        layout.nodes.forEach(n => {
             const originalNode = graph.nodes.find(gn => gn.id === n.id);
             const nodeType = isTimeline ? 'timeline-node' : 'minimal';
             newNodes.push({
                 id: n.id,
                 type: nodeType,
                 position: { x: n.x, y: n.y },
                 data: {
                     ...originalNode, ...n.data,
                     ...(isTimeline ? { lineColor: n.lineColor } : {}),
                     textPos, depth: n.depth,
                     onDelete: () => handleDeleteNode(n.id),
                     onSetLongPress: setLongPress,
                     iconTheme,
                 },
                 width: n.width,
                 height: n.height,
                 draggable: true,
             });
        });

        // Capture timeline grid data so the background can render it.
        if (isTimeline && layout.timelineData) {
            setTimelineData(layout.timelineData);
        } else if (!isTimeline) {
            setTimelineData(null);
        }

        const newEdges: Edge[] = layout.edges.map(e => {
            if (isTimeline) {
                return {
                    id: e.id,
                    source: e.sourceId,
                    target: e.targetId,
                    type: 'timeline',
                    data: { lineColor: e.lineColor, kind: e.kind },
                    style: {},
                };
            }
            return {
                id: e.id,
                source: e.sourceId,
                target: e.targetId,
                type: 'floating',
                data: { variant: edgeStyle },
                style: { stroke: '#9ca3af', strokeWidth: 1.5 },
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: '#9ca3af',
                    width: 20,
                    height: 20,
                },
                animated: false,
            };
        });

        // Sort by Y for depth buffering (Painter's Algo)
        newNodes.sort((a, b) => a.position.y - b.position.y);

        setNodes(newNodes);
        setEdges(newEdges);
        hasInitialLayoutRef.current = true;

        if (fit && !canPreserve) {
            setTimeout(() => {
                fitView({ padding: 0.1 });
            }, 50);
        }

    }, [graph, mode, spacing, setNodes, setEdges, fitView, handleDeleteNode, edgeStyle]);

    const prevMode = useRef(mode);
    const prevSpacing = useRef(spacing);
    const lastSnapshotRef = useRef(0);
    // Set to true after the first runLayout completes. Once nodes are laid out,
    // subsequent graph updates (snapshots, saves) must NOT re-run layout — that
    // would reset positions the user has moved. Reset when the recipe changes
    // (component unmounts because {graph ? <Diagram/> : null} swaps it out).
    const hasInitialLayoutRef = useRef(false);

    // Tracks the serialized content of graph.layouts[mode] from the last effect
    // run. When the saved layout data arrives for the first time (or changes) after
    // the initial dagre render, we must call runLayout(true) so those positions are
    // applied — the "two-snapshot" bug: first Firestore snapshot has no layouts,
    // second snapshot has them, but by then hasInitialLayoutRef is already true.
    const prevLayoutsKeyRef = useRef<string | null | undefined>(undefined);

    // Layout Effect
    useEffect(() => {
        if (isLive) return; // Skip static layout if physics is running

        const modeChanged = prevMode.current !== mode;
        const spacingChanged = prevSpacing.current !== spacing;

        if (modeChanged || spacingChanged) {
            prevMode.current = mode;
            prevSpacing.current = spacing;
            setIsDirty(true);

            // Throttle snapshot for spacing to prevent history spam and lag
            const now = Date.now();
            if (modeChanged || now - lastSnapshotRef.current > 500) {
                takeSnapshot();
                lastSnapshotRef.current = now;
            }

            // Yield to main thread for UI updates.
            // On mode change: restore saved positions if available. On spacing-only change: always re-run fresh layout.
            const hasSavedPositions = modeChanged && !!(graph.layouts?.[mode]);
            const timer = setTimeout(() => {
                const shouldFit = modeChanged;
                runLayout(hasSavedPositions, shouldFit);
            }, 5);
            return () => clearTimeout(timer);
        }

        // Detect whether saved layout data has arrived or changed since the last
        // render. We compare by JSON content (not by reference) so that Firebase
        // re-sending identical data does not trigger an unnecessary re-layout.
        const currentLayoutsKey: string | null =
            graph.layouts?.[mode] ? JSON.stringify(graph.layouts[mode]) : null;
        // Fires once when saved layout data arrives after the initial dagre render ran
        // without it (two-snapshot scenario). The key comparison already prevents
        // re-firing on unchanged data, so we don't need an !isDirty guard here.
        const layoutsJustArrived =
            hasInitialLayoutRef.current &&
            currentLayoutsKey !== null &&
            currentLayoutsKey !== prevLayoutsKeyRef.current;
        prevLayoutsKeyRef.current = currentLayoutsKey;

        if (layoutsJustArrived) {
            runLayout(true);
            return;
        }


        if (isDirty || hasInitialLayoutRef.current) {
            // Detect full regeneration: if none of the incoming graph node IDs match
            // current ReactFlow nodes, the recipe was re-parsed with all-new IDs.
            // In that case, do a fresh layout rather than a no-op metadata patch.
            const currentRFNodeIds = new Set(
                getNodes().filter((n: any) => n.type !== 'lane').map((n: any) => n.id)
            );
            const incomingIds = graph.nodes.map(n => n.id);
            // Guard: if rfNodes is empty but hasInitialLayoutRef is true, runLayout
            // just executed synchronously and the RF store hasn't rendered yet.
            // Treat as overlap to avoid incorrectly running a fresh dagre layout.
            const hasOverlap =
                currentRFNodeIds.size === 0 ||
                incomingIds.length === 0 ||
                incomingIds.some(id => currentRFNodeIds.has(id));
            if (!hasOverlap) {
                hasInitialLayoutRef.current = false;
                runLayout(false, true);
                return;
            }

            // Once the initial layout has run (or while dirty), ONLY apply metadata updates
            // (icons, text, serves) from DB to EXISTING nodes.
            // We DO NOT restore deleted nodes or move nodes based on DB — that would reset
            // positions the user has moved.
            // This prevents moving an icon in one tab from affecting another tab.
            setNodes(currentNodes => {
                let changed = false;
                const newNodes = currentNodes.map(n => {
                     const dbNode = graph.nodes.find(dn => dn.id === n.id);
                     if (dbNode) {
                         // Check for Icon Update
                         const dbUrl = getNodeIconUrl(dbNode);
                         const currentUrl = getNodeIconUrl(n.data);

                         // Always sync text/serves/baseServes from DB prop even if dirty,
                         // so that top-level scaling (serves) and background updates (icons) work.
                         const baseData = {
                             ...n.data,
                             text: dbNode.text,
                             serves: graph.serves,
                             baseServes: graph.baseServes
                         };

                         // Copy shortlist from DB when the icon changed (forge result arrived).
                         const newData = preserveNodeShortlist(baseData, dbNode);

                         // If serves or text changed, mark as changed to trigger re-render
                         if (n.data.serves !== graph.serves || n.data.text !== dbNode.text || newData !== baseData) changed = true;

                         return {
                             ...n,
                             data: newData
                         };
                     }
                     return n;
                });
                // TODO: Show a visual to confirm this happens when we think it should.
                return changed ? newNodes : currentNodes;
            });
        } else {
            runLayout(true);
        }
    }, [graph, mode, spacing, runLayout, isDirty, setNodes, takeSnapshot]);

    // Text Position Update Effect
    useEffect(() => {
        setNodes(nds => nds.map(n => ({
            ...n,
            data: { ...n.data, textPos }
        })));
    }, [textPos, setNodes]);

    // Edge Style Update Effect
    useEffect(() => {
        setEdges(eds => eds.map(e => ({
            ...e,
            data: { ...e.data, variant: edgeStyle }
        })));
    }, [edgeStyle, setEdges]);

    const prevIsLiveRef = useRef(isLive);

    // Live Force Simulation
    useEffect(() => {
        const wasLive = prevIsLiveRef.current;
        prevIsLiveRef.current = isLive;

        if (!isLive) {
            if (simulationRef.current) simulationRef.current.stop();
            if (wasLive) {
                setIsDirty(true);
            }
            return;
        }

        // Take snapshot on start
        if (!wasLive) takeSnapshot();

        const d3Nodes = nodes.filter((n: any) => n.type !== 'lane').map((n: any) => ({ 
            id: n.id, 
            x: n.position.x, 
            y: n.position.y,
            width: n.width || 100,
            depth: n.data.depth || 0
        }));
        
        const d3Links = edges.map((e: any) => ({ source: e.source, target: e.target }));

        const sim = forceSimulation(d3Nodes as any)
            .force("link", forceLink(d3Links).id((d: any) => d.id).distance(100 * spacing))
            .force("charge", forceManyBody().strength(-300))
            .force("collide", forceCollide().radius((d: any) => (d.width/2) + 20))
            .force("y", forceY((d: any) => d.depth * -150 * spacing).strength(0.1)) 
            .force("x", forceX().strength(0.01))
            .alphaDecay(0) 
            .velocityDecay(0.95) 
            .on('tick', () => {
                 setNodes((nds: any[]) => nds.map((n: any) => {
                     const d3n = d3Nodes.find((dn: any) => dn.id === n.id);
                     if (d3n) {
                         return { ...n, position: { x: d3n.x, y: d3n.y } };
                     }
                     return n;
                 }));
            });
        
        simulationRef.current = sim;

        return () => { sim.stop(); };
    }, [isLive, spacing, graph]); 

    const downloadImage = async () => {
        if (!flowWrapper.current) return;
        
        const download = (dataUrl: string) => {
            const link = document.createElement('a');
            link.download = `recipe-lanes-${mode}.png`;
            link.href = dataUrl;
            link.click();
        };

        try {
            const dataUrl = await toPng(flowWrapper.current, {
                backgroundColor: '#ffffff',
                style: { width: 'auto', height: 'auto', transform: 'none' },
                cacheBust: true,
                skipFonts: true,
                pixelRatio: 2
            });
            download(dataUrl);
        } catch (err) {
            console.warn("Download failed, retrying with minimal options...", err);
            try {
                const dataUrl = await toPng(flowWrapper.current, {
                    backgroundColor: '#ffffff',
                    style: { width: 'auto', height: 'auto', transform: 'none' },
                    pixelRatio: 2,
                    skipFonts: true,
                    fontEmbedCSS: ''
                });
                download(dataUrl);
            } catch (e2) {
                console.error("Download failed again:", e2);
                onNotify?.("Download failed. Check console/CORS.");
            }
        }
    };

    const handleReset = () => {
        setIsDirty(true);
        takeSnapshot();
        runLayout(false); 
    };

    useImperativeHandle(ref, () => ({
        resetLayout: handleReset,
        toggleVisibility: toggleVisibility,
        getGraph: getGraph
    }));

    const onNodeClick = (event: React.MouseEvent, node: Node) => {
        onInteraction?.();
        takeSnapshot(); 
        selectBranch(node.id);
    };

    const onNodeContextMenu = (event: React.MouseEvent, node: Node) => {
        onInteraction?.();
        event.preventDefault();
        selectBranch(node.id);
    };

    const initPivotDrag = (node: Node) => {
        longPressTriggered.current = false; // Reset immediately
        const allNodes = getNodes();
        const outgoing = edges.find((e: any) => e.source === node.id);
        const child = outgoing ? allNodes.find((n: any) => n.id === outgoing.target) : null;

        if (child) {
            const getAncestors = (id: string, visited = new Set<string>()): string[] => {
                if (visited.has(id)) return [];
                visited.add(id);
                const incoming = edges.filter((e: any) => e.target === id);
                const parents = incoming.map((e: any) => e.source);
                return [...parents, ...parents.flatMap((p: any) => getAncestors(p, visited))];
            };
            
            const ancestors = getAncestors(node.id);
            
            const initialPositions: Record<string, { x: number, y: number }> = {};
            const candidates = [node.id, ...ancestors];
            candidates.forEach((id: any) => {
                const n = allNodes.find((an: any) => an.id === id);
                if (n) initialPositions[id] = { ...n.position };
            });

            const dx = node.position.x - child.position.x;
            const dy = node.position.y - child.position.y;
            
            dragRef.current = {
                active: true,
                pivot: { x: child.position.x, y: child.position.y },
                startAngle: Math.atan2(dy, dx),
                startDist: Math.sqrt(dx*dx + dy*dy),
                ancestors,
                initialPositions
            };
        }
    };

    const onNodeDragStart = (event: React.MouseEvent, node: Node) => {
        onInteraction?.();
        takeSnapshot(); 
        if (event.shiftKey || longPressTriggered.current) {
            initPivotDrag(node);
        }
    };

    const onNodeDrag = (event: React.MouseEvent, node: Node) => {
        if (longPressTriggered.current && !dragRef.current.active) {
            initPivotDrag(node);
        }

        if (dragRef.current.active && dragRef.current.pivot && dragRef.current.initialPositions) {
            const { pivot, startAngle, startDist, ancestors, initialPositions } = dragRef.current;
            
            const dx = node.position.x - pivot.x;
            const dy = node.position.y - pivot.y;
            const currAngle = Math.atan2(dy, dx);
            const currDist = Math.sqrt(dx*dx + dy*dy);
            
            const rotation = currAngle - (startAngle || 0);
            const scale = (startDist && startDist > 0) ? currDist / startDist : 1;

            if (ancestors) {
                setNodes(nds => nds.map(n => {
                    if (ancestors.includes(n.id)) {
                        const initPos = initialPositions[n.id];
                        const vx = initPos.x - pivot.x;
                        const vy = initPos.y - pivot.y;
                        
                        const rx = vx * Math.cos(rotation) - vy * Math.sin(rotation);
                        const ry = vx * Math.sin(rotation) + vy * Math.cos(rotation);
                        
                        return {
                            ...n,
                            position: {
                                x: pivot.x + rx * scale,
                                y: pivot.y + ry * scale
                            }
                        };
                    }
                    return n;
                }));
            }
        }
    };

    const updateLaneBounds = useCallback(() => {
        setNodes(nds => {
            const laneNodes = nds.filter(n => n.type === 'lane');
            if (laneNodes.length === 0) return nds;

            const contentNodes = nds.filter(n => n.type !== 'lane');
            let changed = false;

            const newNodes = nds.map(n => {
                if (n.type === 'lane') {
                    const children = contentNodes.filter(c => c.data.laneId === n.id);
                    if (children.length > 0) {
                        let maxY = 0;
                        children.forEach(c => {
                            const bottom = c.position.y + (c.height || 100);
                            if (bottom > maxY) maxY = bottom;
                        });
                        const newHeight = Math.max(maxY + 50, 600);
                        if (n.style?.height !== newHeight) {
                            changed = true;
                            return { ...n, style: { ...n.style, height: newHeight } };
                        }
                    }
                }
                return n;
            });
            return changed ? newNodes : nds;
        });
    }, [setNodes]);

    const onNodeDragStop = () => {
        dragRef.current = { active: false };
        updateLaneBounds();
        if (isOwner) {
            handleSave();
        } else {
            onEdit?.();
        }
    };

    return (
        <div className="w-full h-full touch-none" ref={flowWrapper}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChangeWrapped}
                onEdgesChange={onEdgesChangeWrapped}
                onNodeClick={onNodeClick}
                onNodeContextMenu={onNodeContextMenu}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onPaneClick={() => onInteraction?.()}
                onMoveStart={() => onInteraction?.()}
                nodeTypes={INITIAL_NODE_TYPES}
                edgeTypes={INITIAL_EDGE_TYPES}
                fitView
                minZoom={0.1}
                maxZoom={4}
                nodeDragThreshold={10} // Prevent accidental drags, allow long press jitter
                defaultEdgeOptions={{ type: 'floating' }}
                onlyRenderVisibleElements={false}
                multiSelectionKeyCode={['Shift']}
            >
                {timelineData
                    ? <TimelineBackground data={timelineData} />
                    : <Background color="#f4f4f5" gap={20} />
                }
                <Controls showInteractive={false} />
                <Panel position="top-right" className="flex gap-2">
                    <div className="flex gap-1 mr-2 border-r border-zinc-200 pr-2">
                        <button 
                            onClick={undo} 
                            disabled={past.length === 0}
                            className="bg-white p-2 rounded shadow-md border border-zinc-200 hover:bg-zinc-50 text-zinc-600 disabled:opacity-50"
                            title="Undo (Ctrl+Z)"
                        >
                            <Undo className="w-4 h-4" />
                        </button>
                        <button 
                            onClick={redo} 
                            disabled={future.length === 0}
                            className="bg-white p-2 rounded shadow-md border border-zinc-200 hover:bg-zinc-50 text-zinc-600 disabled:opacity-50"
                            title="Redo (Ctrl+Shift+Z)"
                        >
                            <Redo className="w-4 h-4" />
                        </button>
                    </div>

                     <button 
                        onClick={handleSave} 
                        disabled={!isDirty && !saved}
                        className={`p-2 rounded shadow-md border border-zinc-200 transition-colors ${saved ? 'bg-green-50 text-green-600 border-green-200' : isDirty ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' : 'bg-white text-zinc-400'}`}
                        title={saved ? "Saved!" : isDirty ? "Save Changes" : "No Changes"}
                    >
                        {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    </button>

                     <button 
                        onClick={handleShare} 
                        className={`p-2 rounded shadow-md border border-zinc-200 transition-colors ${copied ? 'bg-green-50 text-green-600 border-green-200' : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
                        title={copied ? "Copied!" : "Save & Copy Link"}
                    >
                        {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                    </button>
                    <button 
                        onClick={downloadImage} 
                        className="bg-white p-2 rounded shadow-md border border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                        title="Download PNG"
                    >
                        <Download className="w-4 h-4" />
                    </button>
                </Panel>
            </ReactFlow>
        </div>
    );
}));
DiagramInner.displayName = "DiagramInner";

const ReactFlowDiagram = forwardRef<ReactFlowDiagramHandle, ReactFlowDiagramProps>((props, ref) => (
    <DiagramInner {...props} ref={ref} />
));
ReactFlowDiagram.displayName = "ReactFlowDiagram";

export default ReactFlowDiagram;