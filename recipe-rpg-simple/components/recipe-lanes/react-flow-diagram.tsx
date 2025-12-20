'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { calculateElkLayout } from '../../lib/recipe-lanes/layout-elk';
import { calculateRepulsiveCurvesLayout } from '../../lib/recipe-lanes/layout-force';
import { RecipeGraph } from '../../lib/recipe-lanes/types';
import MinimalNode from './nodes/minimal-node';
import CardNode from './nodes/card-node';
import LaneNode from './nodes/lane-node';
import MicroNode from './nodes/micro-node';
import FloatingEdge from './edges/floating-edge';
import { toPng } from 'html-to-image';
import { Download, Share2, RotateCcw, RefreshCw, Undo, Redo } from 'lucide-react';
import { saveRecipeAction, calculatePenroseLayoutAction } from '@/app/actions';

const nodeTypes = {
  minimal: MinimalNode,
  card: CardNode,
  lane: LaneNode,
  micro: MicroNode
};

const edgeTypes = {
  floating: FloatingEdge
};

interface ReactFlowDiagramProps {
  graph: RecipeGraph;
  mode: LayoutMode | 'elk' | 'micro' | 'force' | 'dagre-lr' | 'repulsive' | 'penrose';
  spacing?: number;
  edgeStyle?: 'straight' | 'step' | 'bezier';
  textPos?: 'bottom' | 'top' | 'left' | 'right';
  isLive?: boolean;
}

const DiagramInner: React.FC<ReactFlowDiagramProps> = ({ graph, mode, spacing = 1, edgeStyle = 'straight', textPos = 'bottom', isLive = false }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const { fitView, getNodes } = useReactFlow();
    const searchParams = useSearchParams();
    const router = useRouter();
    const flowWrapper = useRef<HTMLDivElement>(null);
    const simulationRef = useRef<any>(null);
    
    // Undo/Redo History
    const [past, setPast] = useState<Node[][]>([]);
    const [future, setFuture] = useState<Node[][]>([]);

    const takeSnapshot = useCallback(() => {
        setPast(p => [...p, JSON.parse(JSON.stringify(getNodes()))]);
        setFuture([]);
    }, [getNodes]);

    const undo = useCallback(() => {
        if (past.length === 0) return;
        const newPast = [...past];
        const previous = newPast.pop();
        setPast(newPast);
        setFuture(f => [JSON.parse(JSON.stringify(getNodes())), ...f]);
        setNodes(previous!);
    }, [past, getNodes, setNodes]);

    const redo = useCallback(() => {
        if (future.length === 0) return;
        const newFuture = [...future];
        const next = newFuture.shift();
        setFuture(newFuture);
        setPast(p => [...p, JSON.parse(JSON.stringify(getNodes()))]);
        setNodes(next!);
    }, [future, getNodes, setNodes]);

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

    // Drag State for Branch Rotation
    const dragRef = useRef<{
        active: boolean;
        pivot?: { x: number, y: number };
        startAngle?: number;
        startDist?: number;
        ancestors?: string[];
        initialPositions?: Record<string, { x: number, y: number }>;
    }>({ active: false });

    // Initial Layout Calculation
    const runLayout = useCallback(async (preservePositions = false) => {
        let layout;
        
        const canPreserve = preservePositions && graph.nodes.some(n => n.x !== undefined);

        if (canPreserve) {
            layout = calculateLayout(graph, mode as LayoutMode, spacing, true);
        } else if (mode === 'elk' || mode === 'micro' || mode === 'force') {
            layout = await calculateElkLayout(graph, mode === 'micro', spacing, mode === 'force');
        } else if (mode === 'repulsive') {
            layout = calculateRepulsiveCurvesLayout(graph, spacing);
        } else if (mode === 'penrose') {
            const res = await calculatePenroseLayoutAction(graph, spacing);
            if (res.error || !res.layout) {
                console.error("Penrose Error", res.error);
                layout = calculateLayout(graph, 'compact', spacing);
            } else {
                layout = res.layout;
            }
        } else {
            layout = calculateLayout(graph, mode as LayoutMode, spacing);
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

        let nodeType = 'card';
        if (mode === 'micro') nodeType = 'micro';
        else if (['swimlanes', 'dagre', 'dagre-lr', 'compact', 'elk', 'upward', 'repulsive', 'penrose'].includes(mode as string)) nodeType = 'minimal';
        
        layout.nodes.forEach(n => {
             newNodes.push({
                 id: n.id,
                 type: nodeType,
                 position: { x: n.x, y: n.y },
                 data: { ...n.data, textPos, depth: n.depth },
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

    }, [graph, mode, spacing, setNodes, setEdges, fitView]); // Remove visual props deps

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
            .force("y", forceY((d: any) => d.depth * 150 * spacing).strength(0.1))
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

    const downloadImage = () => {
        if (!flowWrapper.current) return;
        toPng(flowWrapper.current, {
            backgroundColor: '#ffffff',
            style: { width: 'auto', height: 'auto', transform: 'none' }
        }).then((dataUrl) => {
            const link = document.createElement('a');
            link.download = `recipe-lanes-${mode}.png`;
            link.href = dataUrl;
            link.click();
        });
    };

    const handleShare = async () => {
        const currentNodes = getNodes();
        const nodesWithPos = graph.nodes.map(n => {
           const rfn = currentNodes.find(rn => rn.id === n.id);
           return rfn ? { ...n, x: rfn.position.x, y: rfn.position.y } : n;
        });
        
        const graphToSave = { ...graph, nodes: nodesWithPos, layoutMode: mode };
        const res = await saveRecipeAction(graphToSave);
        if (res.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('id', res.id);
            router.push(url.pathname + url.search);
            navigator.clipboard.writeText(url.toString());
            alert('Layout saved & Link copied!');
        } else {
            alert('Failed to save layout.');
        }
    };

    const handleReset = () => {
        takeSnapshot();
        runLayout(false); 
    };

    const handleRotateSelection = () => {
        takeSnapshot();
        const currentNodes = getNodes();
        const selected = currentNodes.filter(n => n.selected);
        if (selected.length > 0) {
            const cx = selected.reduce((sum, n) => sum + n.position.x, 0) / selected.length;
            const cy = selected.reduce((sum, n) => sum + n.position.y, 0) / selected.length;
            
            setNodes(nds => nds.map(n => {
                if (n.selected) {
                    const dx = n.position.x - cx;
                    const dy = n.position.y - cy;
                    return {
                        ...n,
                        position: { x: cx - dy, y: cy + dx }
                    };
                }
                return n;
            }));
        }
    };

    const onNodeClick = (event: React.MouseEvent, node: Node) => {
        if (event.shiftKey) {
            const hasOtherSelection = nodes.some(n => n.selected && n.id !== node.id);
            if (hasOtherSelection) {
                takeSnapshot(); 
                return;
            }

            takeSnapshot(); 
            const getAncestors = (id: string, visited = new Set<string>()): string[] => {
                if (visited.has(id)) return [];
                visited.add(id);
                const incoming = edges.filter(e => e.target === id);
                const parents = incoming.map(e => e.source);
                return [...parents, ...parents.flatMap(p => getAncestors(p, visited))];
            };

            const ancestors = getAncestors(node.id);
            const toSelect = new Set([node.id, ...ancestors]);

            setNodes((nds) => nds.map((n) => ({
                ...n,
                selected: toSelect.has(n.id) || n.selected
            })));
        }
    };

    const onNodeDragStart = (event: React.MouseEvent, node: Node) => {
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
    };

    const hasSelection = nodes.some(n => n.selected);

    return (
        <div className="w-full h-full" ref={flowWrapper}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                minZoom={0.1}
                maxZoom={4}
                defaultEdgeOptions={{ type: 'floating' }}
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

                    {hasSelection && (
                        <button 
                            onClick={handleRotateSelection}
                            className="bg-white p-2 rounded shadow-md border border-zinc-200 hover:bg-zinc-50 text-blue-600 animate-in fade-in zoom-in"
                            title="Rotate Selection 90°"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    )}
                    <button 
                        onClick={handleReset} 
                        className="bg-white p-2 rounded shadow-md border border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                        title="Reset Layout"
                    >
                        <RotateCcw className="w-4 h-4" />
                    </button>
                     <button 
                        onClick={handleShare} 
                        className="bg-white p-2 rounded shadow-md border border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                        title="Save & Share Layout"
                    >
                        <Share2 className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={downloadImage} 
                        className="bg-white p-2 rounded shadow-md border border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                        title="Download PNG"
                    >
                        <Download className="w-4 h-4" />
                    </button>
                </Panel>
                
                <Panel position="bottom-left" className="bg-white/90 backdrop-blur p-3 rounded-lg shadow-lg border border-zinc-200 text-xs text-zinc-700 flex flex-col gap-2">
                    <div className="font-bold text-zinc-400 uppercase tracking-widest text-[10px]">Legend</div>
                    <div className="flex items-center gap-2"><span className="text-xl">🥕</span> Ingredients</div>
                    <div className="flex items-center gap-2"><span className="text-xl">🍳</span> Actions</div>
                    <div className="flex items-center gap-1 opacity-50 border-t border-zinc-100 pt-2"><span className="text-xs font-bold">Shift+Click</span> Select Branch</div>
                    <div className="flex items-center gap-1 opacity-50"><span className="text-xs font-bold">Shift+Drag</span> Rotate Branch</div>
                </Panel>
            </ReactFlow>
        </div>
    );
};

const ReactFlowDiagram = (props: ReactFlowDiagramProps) => (
    <ReactFlowProvider>
        <DiagramInner {...props} />
    </ReactFlowProvider>
);

export default ReactFlowDiagram;
