'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import ReactFlow, { 
    Background, 
    Controls, 
    useNodesState, 
    useEdgesState, 
    ReactFlowProvider,
    useReactFlow,
    Node,
    Edge,
    Panel,
    MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useSearchParams, useRouter } from 'next/navigation';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceY, forceX } from 'd3-force';

import { calculateLayout, LayoutMode } from '../../lib/recipe-lanes/layout';
import { calculateRepulsiveCurvesLayout } from '../../lib/recipe-lanes/layout-force';
import { RecipeGraph } from '../../lib/recipe-lanes/types';
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
  onSave?: (newGraph: RecipeGraph) => void;
  isPublic?: boolean;
  onVisibilityChange?: (isPublic: boolean) => void;
  isLoggedIn?: boolean;
  onNotify?: (msg: string) => void;
  isOwner?: boolean; // YOLO: Added to support auto-save on move logic
}

export interface ReactFlowDiagramHandle {
    resetLayout: () => void;
    toggleVisibility: () => Promise<void>;
    getGraph: () => RecipeGraph;
}

const DiagramInner = forwardRef<ReactFlowDiagramHandle, ReactFlowDiagramProps>(({ graph, mode, spacing = 1, edgeStyle = 'straight', textPos = 'bottom', isLive = false, onInteraction, onSave, isPublic: propIsPublic, onVisibilityChange, isLoggedIn = false, onNotify, isOwner = false }, ref) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const { fitView, getNodes, getEdges } = useReactFlow();
    const searchParams = useSearchParams();
    const router = useRouter();
    const flowWrapper = useRef<HTMLDivElement>(null);
    const simulationRef = useRef<any>(null);
    const [copied, setCopied] = useState(false);
    
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

    // Wrap change handlers to track dirty state
    const onNodesChangeWrapped = useCallback((changes: any) => {
        onNodesChange(changes);
        if (changes.some((c: any) => c.type !== 'select')) setIsDirty(true);
    }, [onNodesChange]);

    const onEdgesChangeWrapped = useCallback((changes: any) => {
        onEdgesChange(changes);
        if (changes.some((c: any) => c.type !== 'select')) setIsDirty(true);
    }, [onEdgesChange]);
    
    // Drag State for Branch Rotation
    const dragRef = useRef<{
        active: boolean;
        pivot?: { x: number, y: number };
        startAngle?: number;
        startDist?: number;
        ancestors?: string[];
        initialPositions?: Record<string, { x: number, y: number }>;
    }>({ active: false });

    const nodeTypes = useMemo(() => ({
        minimal: MinimalNode,
        lane: LaneNode,
        micro: MicroNode
    }), []); // YOLO: Removed CardNode as requested

    const edgeTypes = useMemo(() => ({
        floating: FloatingEdge
    }), []);
    
    // Undo/Redo History
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
        const incoming = currentEdges.filter(ed => ed.target === nodeId);
        const outgoing = currentEdges.filter(ed => ed.source === nodeId);
        
        const newEdgesList = currentEdges.filter(ed => ed.source !== nodeId && ed.target !== nodeId);
        
        incoming.forEach(inEdge => {
            outgoing.forEach(outEdge => {
                newEdgesList.push({
                    id: `${inEdge.source}-${outEdge.target}`,
                    source: inEdge.source,
                    target: outEdge.target,
                    type: 'floating',
                    data: { variant: edgeStyle },
                    style: { stroke: '#9ca3af', strokeWidth: 1.5 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af', width: 20, height: 20 }
                });
            });
        });
        
        setEdges(newEdgesList);
        setNodes(nds => nds.filter(n => n.id !== nodeId));
    }, [takeSnapshot, getEdges, setEdges, setNodes, edgeStyle]);

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
    const runLayout = useCallback(async (preservePositions = false) => {
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
        
        layout.nodes.forEach(n => {
             const originalNode = graph.nodes.find(gn => gn.id === n.id);
             newNodes.push({
                 id: n.id,
                 type: nodeType,
                 position: { x: n.x, y: n.y },
                 data: { ...originalNode, ...n.data, textPos, depth: n.depth, onDelete: () => handleDeleteNode(n.id) },
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

        setNodes(newNodes);
        setEdges(newEdges);

        if (!canPreserve) {
            setTimeout(() => {
                fitView({ padding: 0.1 });
            }, 50);
        }

    }, [graph, mode, spacing, setNodes, setEdges, fitView, handleDeleteNode, edgeStyle]); 

    // Layout Effect
    useEffect(() => {
        runLayout(true); 
    }, [graph, mode, spacing, runLayout]);

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

    // Live Force Simulation
    useEffect(() => {
        if (!isLive) {
            if (simulationRef.current) simulationRef.current.stop();
            return;
        }

        const d3Nodes = nodes.filter(n => n.type !== 'lane').map(n => ({ 
            id: n.id, 
            x: n.position.x, 
            y: n.position.y,
            width: n.width || 100,
            depth: n.data.depth || 0
        }));
        
        const d3Links = edges.map(e => ({ source: e.source, target: e.target }));

        const sim = forceSimulation(d3Nodes as any)
            .force("link", forceLink(d3Links).id((d: any) => d.id).distance(100 * spacing))
            .force("charge", forceManyBody().strength(-300))
            .force("collide", forceCollide().radius((d: any) => (d.width/2) + 20))
            .force("y", forceY((d: any) => d.depth * -150 * spacing).strength(0.1)) 
            .force("x", forceX().strength(0.01))
            .alphaDecay(0) 
            .velocityDecay(0.95) 
            .on('tick', () => {
                 setNodes(nds => nds.map(n => {
                     const d3n = d3Nodes.find(dn => dn.id === n.id);
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
        const layouts = graph.layouts || {};
        layouts[mode as string] = currentNodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }));
        
        // Filter out nodes that are no longer in the ReactFlow state (deleted)
        const nodesWithPos = graph.nodes
            .filter(n => currentNodes.some(rn => rn.id === n.id))
            .map(n => {
               const rfn = currentNodes.find(rn => rn.id === n.id)!;
               return { ...n, x: rfn.position.x, y: rfn.position.y };
            });
            
        return { ...graph, nodes: nodesWithPos, layouts, layoutMode: mode };
    }, [graph, mode, getNodes]);

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
        }
    };

    const toggleVisibility = async () => {
        const newPublic = !visibilityRef.current;
        
        if (onVisibilityChange) {
            onVisibilityChange(newPublic);
        } else {
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
            const incoming = edges.filter(e => e.target === id);
            const parents = incoming.map(e => e.source);
            return [...parents, ...parents.flatMap(p => getAncestors(p, visited))];
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
        if (event.shiftKey) {
            const allNodes = getNodes();
            const outgoing = edges.find(e => e.source === node.id);
            const child = outgoing ? allNodes.find(n => n.id === outgoing.target) : null;

            if (child) {
                const getAncestors = (id: string, visited = new Set<string>()): string[] => {
                    if (visited.has(id)) return [];
                    visited.add(id);
                    const incoming = edges.filter(e => e.target === id);
                    const parents = incoming.map(e => e.source);
                    return [...parents, ...parents.flatMap(p => getAncestors(p, visited))];
                };
                
                const ancestors = getAncestors(node.id);
                
                const initialPositions: Record<string, { x: number, y: number }> = {};
                [node.id, ...ancestors].forEach(id => {
                    const n = allNodes.find(an => an.id === id);
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

    const onNodeDragStop = () => {
        dragRef.current = { active: false };
        if (isOwner) {
            handleSave();
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
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                minZoom={0.1}
                maxZoom={4}
                nodeDragThreshold={5} // Prevent accidental drags
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
                        disabled={!isDirty}
                        className={`p-2 rounded shadow-md border border-zinc-200 transition-colors ${isDirty ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' : 'bg-white text-zinc-400'}`}
                        title={isDirty ? "Save Changes" : "No Changes"}
                    >
                        {copied && !isDirty ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
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
});
DiagramInner.displayName = "DiagramInner";

const ReactFlowDiagram = forwardRef<ReactFlowDiagramHandle, ReactFlowDiagramProps>((props, ref) => (
    <ReactFlowProvider>
        <DiagramInner {...props} ref={ref} />
    </ReactFlowProvider>
));
ReactFlowDiagram.displayName = "ReactFlowDiagram";

export default ReactFlowDiagram;
