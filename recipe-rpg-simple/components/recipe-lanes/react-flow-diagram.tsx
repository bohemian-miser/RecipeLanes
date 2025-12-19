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
    Panel,
    MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';

import { calculateLayout, LayoutMode } from '../../lib/recipe-lanes/layout';
import { calculateElkLayout } from '../../lib/recipe-lanes/layout-elk';
import { RecipeGraph } from '../../lib/recipe-lanes/types';
import MinimalNode from './nodes/minimal-node';
import CardNode from './nodes/card-node';
import LaneNode from './nodes/lane-node';
import MicroNode from './nodes/micro-node';
import { toPng } from 'html-to-image';
import { Download } from 'lucide-react';

const nodeTypes = {
  minimal: MinimalNode,
  card: CardNode,
  lane: LaneNode,
  micro: MicroNode
};

interface ReactFlowDiagramProps {
  graph: RecipeGraph;
  mode: LayoutMode | 'elk' | 'micro' | 'force';
  spacing?: number;
}

// Inner component to access ReactFlow context
const DiagramInner: React.FC<ReactFlowDiagramProps> = ({ graph, mode, spacing = 1 }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const { fitView } = useReactFlow();

    useEffect(() => {
        const runLayout = async () => {
            let layout;
            
            if (mode === 'elk' || mode === 'micro' || mode === 'force') {
                layout = await calculateElkLayout(graph, mode === 'micro', spacing, mode === 'force');
            } else {
                layout = calculateLayout(graph, mode as LayoutMode, spacing);
            }

            const newNodes: Node[] = [];
            
            // 1. Lanes (Background Layer)
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

            // 2. Recipe Nodes
            let nodeType = 'card';
            if (mode === 'micro') nodeType = 'micro';
            else if (mode === 'swimlanes' || mode === 'dagre' || mode === 'compact' || mode === 'elk' || mode === 'upward') nodeType = 'minimal';
            
            layout.nodes.forEach(n => {
                 newNodes.push({
                     id: n.id,
                     type: nodeType,
                     position: { x: n.x, y: n.y },
                     data: n.data,
                     draggable: true,
                 });
            });

            // 3. Edges
            const newEdges: Edge[] = layout.edges.map(e => ({
                id: e.id,
                source: e.sourceId,
                target: e.targetId,
                type: mode === 'upward' ? 'default' : 'smoothstep',
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

            setTimeout(() => {
                fitView({ padding: 0.1 });
            }, 50);
        };

        runLayout();

    }, [graph, mode, setNodes, setEdges, fitView]);
// ...

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
