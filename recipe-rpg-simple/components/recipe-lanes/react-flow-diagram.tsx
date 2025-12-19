'use client';

import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, { 
    Background, 
    Controls, 
    useNodesState, 
    useEdgesState, 
    ReactFlowProvider,
    useReactFlow,
    Node,
    Edge,
    Panel
} from 'reactflow';
import 'reactflow/dist/style.css';

import { calculateLayout, LayoutMode } from '../../lib/recipe-lanes/layout';
import { RecipeGraph } from '../../lib/recipe-lanes/types';
import MinimalNode from './nodes/minimal-node';
import CardNode from './nodes/card-node';
import LaneNode from './nodes/lane-node';
import { toPng } from 'html-to-image';
import { Download } from 'lucide-react';

const nodeTypes = {
  minimal: MinimalNode,
  card: CardNode,
  lane: LaneNode
};

interface ReactFlowDiagramProps {
  graph: RecipeGraph;
  mode: LayoutMode;
}

// Inner component to access ReactFlow context
const DiagramInner: React.FC<ReactFlowDiagramProps> = ({ graph, mode }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const { fitView, getNodes } = useReactFlow();

    // Re-calculate layout when graph or mode changes
    useEffect(() => {
        const layout = calculateLayout(graph, mode);
        const isHorizontal = mode === 'horizontal';
        
        const newNodes: Node[] = [];
        
        // 1. Lanes (Background Layer)
        layout.lanes.forEach(lane => {
             newNodes.push({
                 id: lane.id,
                 type: 'lane',
                 position: { x: lane.x, y: lane.y }, // Note: LaneNode needs width/height in data or style
                 data: { label: lane.label, color: lane.color },
                 style: { width: lane.width, height: lane.height, zIndex: -1 },
                 draggable: false,
                 selectable: false,
                 zIndex: -1
             });
        });

        // 2. Recipe Nodes
        const nodeType = (mode === 'swimlanes' || mode === 'dagre' || mode === 'compact') ? 'minimal' : 'card';
        
        layout.nodes.forEach(n => {
             newNodes.push({
                 id: n.id,
                 type: nodeType,
                 position: { x: n.x, y: n.y },
                 data: n.data,
                 draggable: true, // Allow user to rearrange! (FR)
             });
        });

        // 3. Edges
        const newEdges: Edge[] = layout.edges.map(e => ({
            id: e.id,
            source: e.sourceId,
            target: e.targetId,
            type: 'default', // 'smoothstep' or 'bezier'
            style: { stroke: '#9ca3af', strokeWidth: 1.5 },
            animated: false
        }));

        setNodes(newNodes);
        setEdges(newEdges);

        // Fit view after a brief delay to allow rendering
        setTimeout(() => {
            fitView({ padding: 0.1 });
        }, 50);

    }, [graph, mode, setNodes, setEdges, fitView]);

    const downloadImage = () => {
        const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
        if (!viewport) return;

        toPng(viewport, {
            backgroundColor: '#ffffff',
            style: {
                width: 'auto',
                height: 'auto',
                transform: 'none' // Reset transform for capture? Usually handled by library but tricky with RF
            }
        }).then((dataUrl) => {
            const link = document.createElement('a');
            link.download = `recipe-lanes-${mode}.png`;
            link.href = dataUrl;
            link.click();
        });
        // Note: react-flow has specific image export examples that are more robust (using getNodesBounds), 
        // but simple viewport capture is a start. 
        // Better way: use the specific `download` function from RF examples if this fails.
    };

    return (
        <div className="w-full h-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.1}
                maxZoom={4}
                defaultEdgeOptions={{ type: 'smoothstep' }}
            >
                <Background color="#f4f4f5" gap={20} />
                <Controls showInteractive={false} />
                <Panel position="top-right">
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
};

const ReactFlowDiagram = (props: ReactFlowDiagramProps) => (
    <ReactFlowProvider>
        <DiagramInner {...props} />
    </ReactFlowProvider>
);

export default ReactFlowDiagram;
