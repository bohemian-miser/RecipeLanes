import ELK from 'elkjs/lib/elk.bundled.js';
import { RecipeGraph, LayoutGraph, VisualNode, VisualEdge, VisualLane } from './types';

const elk = new ELK();

const ELK_CONSTANTS = {
    NODE_WIDTH: 140, // Standard
    NODE_HEIGHT: 80,
    MICRO_WIDTH: 20,
    MICRO_HEIGHT: 20,
};

export const calculateElkLayout = async (graph: RecipeGraph, useMicroMode: boolean = false, spacing: number = 1, useForce: boolean = false): Promise<LayoutGraph> => {
    const width = useMicroMode ? ELK_CONSTANTS.MICRO_WIDTH : ELK_CONSTANTS.NODE_WIDTH;
    const height = useMicroMode ? ELK_CONSTANTS.MICRO_HEIGHT : ELK_CONSTANTS.NODE_HEIGHT;
    
    const nodeSep = (useMicroMode ? 10 : 20) * spacing;
    const layerSep = (useMicroMode ? 15 : 40) * spacing;
    const padding = 20 * spacing;

    const layoutOptions: any = {
        'elk.algorithm': useForce ? 'force' : 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': String(nodeSep),
        'elk.padding': `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`
    };

    if (!useForce) {
        layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(layerSep);
        layoutOptions['elk.layered.nodePlacement.strategy'] = 'BRANDES_KOEPF';
        layoutOptions['elk.aspectRatio'] = '1.6';
    } else {
        layoutOptions['elk.force.iterations'] = '100';
        layoutOptions['elk.force.repulsion'] = String(200 * spacing);
    }

    const elkGraph = {
        id: 'root',
        layoutOptions,
        children: graph.nodes.map(n => ({
            id: n.id,
            width: width,
            height: height,
            labels: [{ text: n.text }]
        })),
        edges: [] as any[]
    };

    // Edges
    if (graph.nodes) {
        graph.nodes.forEach(node => {
            if (node.inputs) {
                node.inputs.forEach(inputId => {
                     // Check if source exists
                     if (graph.nodes.find(n => n.id === inputId)) {
                         elkGraph.edges.push({
                             id: `${inputId}->${node.id}`,
                             sources: [inputId],
                             targets: [node.id]
                         });
                     }
                });
            }
        });
    }

    try {
        const layoutNode: any = await elk.layout(elkGraph);
        
        const nodes: VisualNode[] = [];
        const edges: VisualEdge[] = [];
        const lanes: VisualLane[] = [];

        // Map Nodes
        if (layoutNode.children) {
            layoutNode.children.forEach((n: any) => {
                const originalNode = graph.nodes.find(gn => gn.id === n.id);
                if (originalNode) {
                    nodes.push({
                        id: n.id,
                        type: originalNode.type, // Will be overridden by render logic
                        x: n.x,
                        y: n.y,
                        width: n.width,
                        height: n.height,
                        data: originalNode
                    });
                }
            });
        }

        // Map Edges
        if (layoutNode.edges) {
            layoutNode.edges.forEach((e: any) => {
                const sourceId = e.sources[0];
                const targetId = e.targets[0];
                
                edges.push({
                    id: e.id,
                    sourceId: sourceId,
                    targetId: targetId,
                    path: '' // React Flow computes this
                });
            });
        }

        return {
            nodes,
            edges,
            lanes,
            width: layoutNode.width || 800,
            height: layoutNode.height || 600
        };

    } catch (err) {
        console.error("ELK Layout Failed:", err);
        // Fallback to empty or throw
        return { nodes: [], edges: [], lanes: [], width: 100, height: 100 };
    }
};