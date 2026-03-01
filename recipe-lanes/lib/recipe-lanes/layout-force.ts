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

import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter, forceX, forceY } from 'd3-force';
import { hierarchy, tree } from 'd3-hierarchy';
import type { RecipeGraph, LayoutGraph, VisualNode, VisualEdge } from './types';

// Constants
const NODE_RADIUS = 50; // Effective radius for collision
const DEFAULT_LINK_DISTANCE = 100;

export const calculateRepulsiveCurvesLayout = (graph: RecipeGraph, spacing: number = 1): LayoutGraph => {
    const nodes = graph.nodes.map(n => ({ ...n, id: n.id }));
    const links: { source: string; target: string; }[] = [];
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // 1. Build Links and Adjacency for Tree Construction
    const consumersOf = new Map<string, string[]>(); // node -> parents (consumers)
    const consumedBy = new Map<string, string[]>(); // node -> children (inputs)

    // Note: In D3 Tree, "Children" are usually down. 
    // In Recipe, "Inputs" are children if we root at "Serve".
    // Root = Serve. Children = Ingredients/Actions leading to it.

    graph.nodes.forEach(n => {
        if (n.inputs) {
            n.inputs.forEach(inpId => {
                if (nodeMap.has(inpId)) {
                    links.push({ source: inpId, target: n.id });
                    
                    if (!consumersOf.has(n.id)) consumersOf.set(n.id, []);
                    consumersOf.get(n.id)!.push(inpId);

                    if (!consumedBy.has(inpId)) consumedBy.set(inpId, []);
                    consumedBy.get(inpId)!.push(n.id);
                }
            });
        }
    });

    // 2. Identify Root (Sink)
    const sinks = nodes.filter(n => !consumedBy.has(n.id));
    // If multiple sinks, create a virtual root? Or just pick one.
    // Let's create a hierarchy structure.
    
    // We need a strict tree for d3.hierarchy. 
    // We use a BFS/DFS to build the spanning tree.
    const visited = new Set<string>();
    const rootId = sinks.find(n => n.type === 'action')?.id || sinks[0]?.id || nodes[0]?.id;

    const buildTreeData = (id: string): any => {
        visited.add(id);
        const inputs = consumersOf.get(id) || [];
        const children: any[] = [];
        
        for (const inputId of inputs) {
            if (!visited.has(inputId)) {
                children.push(buildTreeData(inputId));
            }
            // If visited, it's a DAG/Cycle link, ignored for Tree layout, handled by Force
        }
        
        return { id, children };
    };

    const treeData = buildTreeData(rootId);

    // 3. Initial Radial Layout (d3-hierarchy)
    const hRoot = hierarchy(treeData);
    const treeLayout = tree().size([2 * Math.PI, 800 * spacing]); // 360 deg, radius scaled by spacing
    treeLayout(hRoot);

    // Map initial positions and DEPTH
    hRoot.descendants().forEach((d: any) => {
        const node = nodeMap.get(d.data.id);
        if (node) {
            const angle = d.x;
            const radius = d.y;
            // @ts-ignore
            node.x = radius * Math.cos(angle - Math.PI / 2); 
            // @ts-ignore
            node.y = radius * Math.sin(angle - Math.PI / 2);
            // @ts-ignore
            node.depth = d.depth; // Save depth for forceY
        }
    });

    // Handle disconnected nodes
    nodes.forEach((n: any) => {
        if (n.x === undefined) {
            n.x = (Math.random() - 0.5) * 1000;
            n.y = (Math.random() - 0.5) * 1000;
            n.depth = 0;
        }
    });

    // 4. Physics Simulation (d3-force)
    const simulation = forceSimulation(nodes as any)
        .force("link", forceLink(links).id((d: any) => d.id).distance(DEFAULT_LINK_DISTANCE * spacing))
        .force("charge", forceManyBody().strength(-1000 * spacing))
        .force("collide", forceCollide().radius((d: any) => (d.type === 'action' ? 150 : 80) * spacing).iterations(2))
        .force("y", forceY((d: any) => d.depth * -150 * spacing).strength(0.3)) // Negative depth to place Ingredients (leaves) at Top, Root (Serve) at Bottom
        .force("x", forceX().strength(0.05)) // Gentle centering
        .stop();

    // Run simulation
    const ticks = 300;
    for (let i = 0; i < ticks; ++i) simulation.tick();

    // 5. Output
    const visualNodes: VisualNode[] = nodes.map((n: any) => ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
        width: n.type === 'action' ? 280 : 140,
        height: 100,
        data: n
    }));

    const visualEdges: VisualEdge[] = links.map((l: any) => ({
        id: `${l.source.id}->${l.target.id}`,
        sourceId: l.source.id,
        targetId: l.target.id,
        path: '' // React Flow handles path
    }));

    // Calculate bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visualNodes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x);
        maxY = Math.max(maxY, n.y);
    });

    const width = Math.max(800, maxX - minX + 200);
    const height = Math.max(600, maxY - minY + 200);

    // Center layout
    const offsetX = (width - (maxX - minX)) / 2 - minX;
    const offsetY = (height - (maxY - minY)) / 2 - minY;

    visualNodes.forEach(n => {
        n.x += offsetX;
        n.y += offsetY;
    });

    return {
        nodes: visualNodes,
        edges: visualEdges,
        lanes: [], // No lanes
        width,
        height
    };
};