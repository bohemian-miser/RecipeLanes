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
import { useSearchParams, useRouter } from 'next/navigation';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceY, forceX } from 'd3-force';

import { calculateLayout, LayoutMode } from '../../lib/recipe-lanes/layout';
import { calculateRepulsiveCurvesLayout } from '../../lib/recipe-lanes/layout-force';
import { RecipeGraph } from '../../lib/recipe-lanes/types';
import { getNodeIconUrl, getNodeIconId } from '../../lib/recipe-lanes/model-utils';
import { calculateBridgeEdges } from '../../lib/recipe-lanes/graph-logic';
import MinimalNode from './nodes/minimal-node';
import LaneNode from './nodes/lane-node';
import MicroNode from './nodes/micro-node';
import FloatingEdge from './edges/floating-edge';
import { toPng } from 'html-to-image';
import { Download, Share2, Undo, Redo, Check, Save } from 'lucide-react';
import { saveRecipeAction } from '@/app/actions';

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
    micro: MicroNode
};

const INITIAL_EDGE_TYPES = {
    floating: FloatingEdge
};

const DiagramInner = memo(forwardRef<ReactFlowDiagramHandle, ReactFlowDiagramProps>(({ graph, mode, spacing = 1, edgeStyle = 'straight', textPos = 'bottom', isLive = false, onInteraction, onEdit, onSave, isPublic: propIsPublic, onVisibilityChange, isLoggedIn = false, onNotify, isOwner = false, iconTheme = 'classic' }, ref) => {

    // Cast hooks to avoid implicit any in callbacks
    const [nodes, setNodesRaw, onNodesChange] = useNodesState([]);
    const setNodes = setNodesRaw as React.Dispatch<React.SetStateAction<any[]>>;

    const [edges, setEdgesRaw, onEdgesChange] = useEdgesState([]);
    const setEdges = setEdgesRaw as React.Dispatch<React.SetStateAction<any[]>>;

    const { fitView, getNodes: getNodesRaw, getEdges: getEdgesRaw } = useReactFlow();
    const getNodes = getNodesRaw as () => any[];
    const getEdges = getEdgesRaw as () => any[];
    const searchParams = useSearchParams();
    const router = useRouter();
    const flowWrapper = useRef<HTMLDivElement>(null);
    const simulationRef = useRef<any>(null);
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    
    // Initialize from graph.visibility (injected by service)
    // If prop is provided, use it, otherwise fallback to internal state logic (though moving to prop driven is better)
    const initialVisibility = graph.visibility === 'public';
    const [internalIsPublic, setInternalIsPublic] = useState(initialVisibility);
    
    const isPublic = propIsPublic !== undefined ? propIsPublic : internalIsPublic;

    // We still need a ref for the save function to access the latest state without re-creating the function
    const visibilityRef = useRef(isPublic);
    
    useEffect(() => {
        visibilityRef.current = isPublic;
    }, [isPublic]);

    const [isDirty, setIsDirty] = useState(false);

    // Update state if graph prop changes (e.g. fresh load)
    useEffect(() => {
        const pub = graph.visibility === 'public';
        if (propIsPublic === undefined) {
             setInternalIsPublic(pub);
        }
    }, [graph.visibility, propIsPublic]);

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
    const setLongPress = useCallback((active: boolean) => {
        longPressTriggered.current = active;
    }, []);

    // History
    const [past, setPast] = useState<{ nodes: Node[], edges: Edge[] }[]>([]);
    const [future, setFuture] = useState<{ nodes: Node[], edges: Edge[] }[]>([]);

    const takeSnapshot = useCallback(() => {
        const n = getNodes();
        const e = getEdges();
        setPast(p => [...p, { 
            nodes: JSON.parse(JSON.stringify(n)), 
            edges: JSON.parse(JSON.stringify(e)) 
        }]);
        setFuture([]);
    }, [getNodes, getEdges]);

    const handleDeleteNode = useCallback((nodeId: string) => {
        console.log(`[DiagramInner] handleDeleteNode called for ${nodeId}`);
        takeSnapshot();
        const currentEdges = getEdges();
        
        const edgeFactory = (source: string, target: string) => ({
            id: `${source}-${target}`,
            source,
            target,
            type: 'floating',
            data: { variant: edgeStyle },
            style: { stroke: '#9ca3af', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af', width: 20, height: 20 }
        });

        const newEdgesList = calculateBridgeEdges(nodeId, currentEdges, edgeFactory);
        
        setEdges(newEdgesList);
        setNodes(nds => nds.filter(n => n.id !== nodeId));
        setIsDirty(true);
        setTimeout(() => onEdit?.(), 0);
    }, [takeSnapshot, getEdges, setEdges, setNodes, edgeStyle, onEdit]);

    const undo = useCallback(() => {
        if (past.length === 0) return;
        const newPast = [...past];
        const previous = newPast.pop();
        setPast(newPast);
        setFuture(f => [{ 
            nodes: JSON.parse(JSON.stringify(getNodes())), 
            edges: JSON.parse(JSON.stringify(getEdges())) 
        }, ...f]);
        
        if (previous) {
            // Re-attach handlers that are lost during JSON serialization
            const restoredNodes = previous.nodes.map(n => ({
                ...n,
                data: {
                    ...n.data,
                    onDelete: () => handleDeleteNode(n.id)
                }
            }));
            setNodes(restoredNodes);
            setEdges(previous.edges);
            setIsDirty(true);
        }
    }, [past, getNodes, getEdges, setNodes, setEdges, handleDeleteNode]);

    const redo = useCallback(() => {
        if (future.length === 0) return;
        const newFuture = [...future];
        const next = newFuture.shift();
        setFuture(newFuture);
        setPast(p => [...p, { 
            nodes: JSON.parse(JSON.stringify(getNodes())), 
            edges: JSON.parse(JSON.stringify(getEdges())) 
        }]);
        
        if (next) {
            // Re-attach handlers
            const restoredNodes = next.nodes.map(n => ({
                ...n,
                data: {
                    ...n.data,
                    onDelete: () => handleDeleteNode(n.id)
                }
            }));
            setNodes(restoredNodes);
            setEdges(next.edges);
            setIsDirty(true);
        }
    }, [future, getNodes, getEdges, setNodes, setEdges, handleDeleteNode]);

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
    const runLayout = useCallback(async (preservePositions = false, fit = true) => {
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
            const safeMode = (['swimlanes', 'dagre', 'dagre-lr'].includes(mode as string)) ? (mode as LayoutMode) : 'dagre';
            layout = calculateLayout(effectiveGraph, safeMode, spacing, true);
        } else if (mode === 'repulsive') {
            layout = calculateRepulsiveCurvesLayout(effectiveGraph, spacing);
        } else {
            layout = calculateLayout(effectiveGraph, mode as LayoutMode, spacing);
        }

        const newNodes: Node[] = [];
        
        layout.lanes.forEach(lane => {
             newNodes.push({
                 id: lane.id,
                 type: 'lane',
                 position: { x: lane.x, y: lane.y },
                 data: { label: lane.label, color: lane.color },
                 style: { width: lane.width, height: lane.height, zIndex: -1 },
                 draggable: false,
                 selectable: false,
                 zIndex: -1
             });
        });

        const nodeType = 'minimal'; 
        // TODO: Double check the logic here.
        layout.nodes.forEach(n => {
             const originalNode = graph.nodes.find(gn => gn.id === n.id);
             newNodes.push({
                 id: n.id,
                 type: nodeType,
                 position: { x: n.x, y: n.y },
                 data: { ...originalNode, ...n.data, textPos, depth: n.depth, onDelete: () => handleDeleteNode(n.id), onSetLongPress: setLongPress, iconTheme },
                 width: n.width,
                 height: n.height,
                 draggable: true,
             });
        });

        const newEdges: Edge[] = layout.edges.map(e => ({
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
                height: 20
            },
            animated: false
        }));

        // Sort by Y for depth buffering (Painter's Algo)
        newNodes.sort((a, b) => a.position.y - b.position.y);

        setNodes(newNodes);
        setEdges(newEdges);

        if (fit && !canPreserve) {
            setTimeout(() => {
                fitView({ padding: 0.1 });
            }, 50);
        }

    }, [graph, mode, spacing, setNodes, setEdges, fitView, handleDeleteNode, edgeStyle]); 

    const prevMode = useRef(mode);
    const prevSpacing = useRef(spacing);
    const lastSnapshotRef = useRef(0);

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
            
            // Yield to main thread for UI updates
            const timer = setTimeout(() => {
                const shouldFit = modeChanged; // Only fit if mode changed
                runLayout(false, shouldFit); 
            }, 5);
            return () => clearTimeout(timer);
        }

        if (isDirty) {
            // In dirty mode, we ONLY apply metadata updates (icons) from DB to EXISTING nodes.
            // We DO NOT restore deleted nodes or move nodes based on DB, preventing overwrites.
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
                         const newData = { 
                             ...n.data, 
                             text: dbNode.text,
                             serves: graph.serves, 
                             baseServes: graph.baseServes 
                         };
                         
                         if (dbUrl && dbUrl !== currentUrl) {
                             changed = true;
                             if (dbNode.iconShortlist) {
                                 // Update using the shortlist from DB
                                 newData.iconShortlist = dbNode.iconShortlist;
                                 newData.shortlistIndex = dbNode.shortlistIndex;
                             }
                         }
                         
                         // If serves or text changed, mark as changed to trigger re-render
                         if (n.data.serves !== graph.serves || n.data.text !== dbNode.text) changed = true;

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
                pixelRatio: 2 
            });
            download(dataUrl);
        } catch (err) {
            console.warn("Download failed (CORS?), retrying without font embedding...", err);
            try {
                const dataUrl = await toPng(flowWrapper.current, {
                    backgroundColor: '#ffffff',
                    style: { width: 'auto', height: 'auto', transform: 'none' },
                    pixelRatio: 2,
                    fontEmbedCSS: '' // Disable font embedding
                });
                download(dataUrl);
            } catch (e2) {
                console.error("Download failed again:", e2);
                onNotify?.("Download failed. Check console/CORS.");
            }
        }
    };

    const getGraph = useCallback((): RecipeGraph => {
        const currentNodes = getNodes().filter(n => n.type !== 'lane');
        const currentEdges = getEdges();
        const layouts = graph.layouts || {};
        layouts[mode as string] = currentNodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }));
        
        // Filter out nodes that are no longer in the ReactFlow state (deleted)
        const nodesWithPos = graph.nodes
            .filter(n => currentNodes.some(rn => rn.id === n.id))
            .map(n => {
               const rfn = currentNodes.find(rn => rn.id === n.id)!;
               
               // Reconstruct inputs from current edges to capture bridging/changes
               const inputs = currentEdges
                   .filter(e => e.target === n.id)
                   .map(e => e.source);

               return { ...n, x: rfn.position.x, y: rfn.position.y, inputs };
            });
            
        return { ...graph, nodes: nodesWithPos, layouts, layoutMode: mode };
    }, [graph, mode, getNodes, getEdges]);

    const performSave = async () => {
        const graphToSave = getGraph();
        
        let currentId = searchParams.get('id') || undefined;
        // Use ref for latest value (important for toggleVisibility which is async)
        const visibility = visibilityRef.current ? 'public' : 'unlisted';
        
        // Forking Logic for Non-Owners (Alice Copy)
        if (isLoggedIn && !isOwner && currentId) {
             console.log('[ReactFlow] Forking on Save (Non-Owner)');
             const sourceId = currentId;
             currentId = undefined; // Force new creation
             graphToSave.sourceId = sourceId;

             // Smarter Copy Naming
             let newTitle = graphToSave.title || 'Untitled';
             if (newTitle.startsWith('Yet another copy of ')) {
                 const match = newTitle.match(/Yet another copy of (.*) \((\d+)\)$/);
                 if (match) {
                     newTitle = `Yet another copy of ${match[1]} (${parseInt(match[2]) + 1})`;
                 } else {
                     newTitle = `${newTitle} (1)`;
                 }
             } else if (newTitle.startsWith('Another copy of ')) {
                 newTitle = newTitle.replace('Another copy of ', 'Yet another copy of ');
             } else if (newTitle.startsWith('Copy of ')) {
                 newTitle = newTitle.replace('Copy of ', 'Another copy of ');
             } else {
                 newTitle = `Copy of ${newTitle}`;
             }
             graphToSave.title = newTitle;
             onNotify?.("Saving a copy...");
        }
        
        // Ensure visibility is part of the graph object passed back
        graphToSave.visibility = visibility;

        const result = await saveRecipeAction(graphToSave, currentId, visibility);
        
        if (onSave) onSave(graphToSave);
        return result;
    };

    const handleSave = async () => {
        if (!isLoggedIn) {
            onNotify?.('Log in to save recipe');
            return;
        }
        const res = await performSave();
        if (res.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('id', res.id);
            router.push(url.pathname + url.search);
            setIsDirty(false);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            onNotify?.("Saved changes.");
        } else {
            console.error('Failed to save.');
            onNotify?.("Failed to save.");
        }
    };

    const handleShare = async () => {
        const res = await performSave();
        if (res.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('id', res.id);
            router.push(url.pathname + url.search);
            navigator.clipboard.writeText(url.toString());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            setIsDirty(false);
            onNotify?.("Link copied to clipboard");
        }
    };

    const toggleVisibility = async () => {
        const newPublic = !visibilityRef.current;
        
        if (onVisibilityChange) {
            onVisibilityChange(newPublic);
        }
        else {
            setInternalIsPublic(newPublic);
        }
        
        visibilityRef.current = newPublic;
        setIsDirty(true);
        // Save immediately
        await handleSave();
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

    const selectBranch = (nodeId: string) => {
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
    };

    const onNodeClick = (event: React.MouseEvent, node: Node) => {
        onInteraction?.();
        if (event.altKey) {
            takeSnapshot(); 
            selectBranch(node.id);
            return;
        }
        // Shift+Click handled by ReactFlow for multi-selection
        if (event.shiftKey) {
            takeSnapshot();
        }
        // Mobile/Click-again logic: If already selected, select branch
        if (node.selected) {
             selectBranch(node.id);
        }
    };

    const onNodeContextMenu = (event: React.MouseEvent, node: Node) => {
        onInteraction?.();
        event.preventDefault();
        selectBranch(node.id);
    };

    const onNodeDragStart = (event: React.MouseEvent, node: Node) => {
        onInteraction?.();
        takeSnapshot(); 
        if (event.shiftKey || longPressTriggered.current) {
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
        }
    };

    const onNodeDrag = (event: React.MouseEvent, node: Node) => {
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
                <Background color="#f4f4f5" gap={20} />
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