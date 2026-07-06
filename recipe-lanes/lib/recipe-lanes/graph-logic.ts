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

/**
 * Pure functions for graph manipulation logic, decoupled from React/ReactFlow.
 */

export interface MinimalEdge {
    source: string;
    target: string;
    [key: string]: any;
}

/**
 * Minimal shape needed to reason about a node's in-degree. Edges are encoded
 * implicitly on each node via `inputs` (the ids of nodes that flow into it), so
 * an edge is `inputId -> node.id` and a node's incoming edges are exactly its
 * own `inputs`.
 */
export interface DegreeNode {
    id: string;
    inputs?: string[];
}

/**
 * True when the node has no incoming edges (in-degree 0), i.e. an empty/absent
 * `inputs` list. These are the source nodes of the recipe graph — typically the
 * raw ingredients that nothing flows into.
 */
function hasNoIncomingEdges(node: DegreeNode): boolean {
    return !node.inputs || node.inputs.length === 0;
}

/**
 * Returns the set of leaf node ids — nodes with in-degree 0, i.e. no incoming
 * edges. In recipe terms these are the source nodes (e.g. raw ingredients) that
 * nothing flows into.
 */
export function getLeafNodeIds(nodes: DegreeNode[]): Set<string> {
    const leaves = new Set<string>();
    for (const node of nodes) {
        if (hasNoIncomingEdges(node)) leaves.add(node.id);
    }
    return leaves;
}

/**
 * True when `id` is a leaf (in-degree 0) within `nodes`: it exists and has no
 * incoming edges. Returns false when `nodes` is undefined or `id` is unknown.
 * Suitable for use as a Zustand selector since it returns a stable primitive.
 */
export function isLeafNode(nodes: DegreeNode[] | undefined, id: string): boolean {
    if (!nodes) return false;
    const node = nodes.find(n => n.id === id);
    return !!node && hasNoIncomingEdges(node);
}

/**
 * Calculates the new set of edges after a node is deleted, 
 * automatically bridging parents of the deleted node to its children.
 */
export function calculateBridgeEdges<T extends MinimalEdge>(
    nodeId: string, 
    currentEdges: T[],
    edgeFactory: (source: string, target: string) => T
): T[] {
    const incoming = currentEdges.filter(e => e.target === nodeId);
    const outgoing = currentEdges.filter(e => e.source === nodeId);
    
    // Remove all edges connected to the deleted node
    const baseEdges = currentEdges.filter(e => e.source !== nodeId && e.target !== nodeId);
    
    const bridgedEdges: T[] = [];
    
    incoming.forEach(inEdge => {
        outgoing.forEach(outEdge => {
            // Avoid self-loops if somehow triggered
            if (inEdge.source !== outEdge.target) {
                bridgedEdges.push(edgeFactory(inEdge.source, outEdge.target));
            }
        });
    });

    // Deduplicate edges (if parent already connected to child elsewhere)
    const result = [...baseEdges];
    bridgedEdges.forEach(newEdge => {
        const alreadyExists = result.some(e => e.source === newEdge.source && e.target === newEdge.target);
        if (!alreadyExists) {
            result.push(newEdge);
        }
    });

    return result;
}
