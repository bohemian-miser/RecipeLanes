'use client';

import React, { useCallback, useEffect, useRef } from 'react';
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
import { Download, Share2, RotateCcw } from 'lucide-react';
import { saveRecipeAction } from '@/app/actions';

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
  mode: LayoutMode | 'elk' | 'micro' | 'force' | 'dagre-lr' | 'repulsive';
  spacing?: number;
  edgeStyle?: 'straight' | 'step' | 'bezier';
  textPos?: 'bottom' | 'top' | 'left' | 'right';
}

const DiagramInner: React.FC<ReactFlowDiagramProps> = ({ graph, mode, spacing = 1, edgeStyle = 'straight', textPos = 'bottom' }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const { fitView, getNodes } = useReactFlow();
    const searchParams = useSearchParams();
    const router = useRouter();
    const flowWrapper = useRef<HTMLDivElement>(null);

    const runLayout = useCallback(async (preservePositions = false) => {
        let layout;
        
        // Check if we should preserve positions (only if graph has them and we are not forcing recalc)
        const canPreserve = preservePositions && graph.nodes.some(n => n.x !== undefined);

        if (canPreserve) {
            layout = calculateLayout(graph, mode as LayoutMode, spacing, true);
        } else if (mode === 'elk' || mode === 'micro' || mode === 'force') {
            layout = await calculateElkLayout(graph, mode === 'micro', spacing, mode === 'force');
        } else if (mode === 'repulsive') {
            layout = calculateRepulsiveCurvesLayout(graph, spacing);
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
        else if (['swimlanes', 'dagre', 'dagre-lr', 'compact', 'elk', 'upward', 'repulsive'].includes(mode as string)) nodeType = 'minimal';
        
        layout.nodes.forEach(n => {
             newNodes.push({
                 id: n.id,
                 type: nodeType,
                 position: { x: n.x, y: n.y },
                 data: { ...n.data, textPos },
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

    }, [graph, mode, spacing, edgeStyle, textPos, setNodes, setEdges, fitView]);

    useEffect(() => {
        runLayout(true); 
    }, [graph, mode, spacing, edgeStyle, textPos, runLayout]);

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
        runLayout(false); 
    };

    const onNodeClick = (event: React.MouseEvent, node: Node) => {
        if (event.shiftKey) {
            setNodes((nds) => nds.map((n) => {
                if (n.id === node.id) {
                    const rot = (n.data.rotation || 0) + 90;
                    return { ...n, data: { ...n.data, rotation: rot } };
                }
                return n;
            }));
        }
    };

    return (
        <div className="w-full h-full" ref={flowWrapper}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
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
                    <div className="flex items-center gap-1 opacity-50 border-t border-zinc-100 pt-2"><span className="text-xs font-bold">Shift+Click</span> Rotate</div>
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