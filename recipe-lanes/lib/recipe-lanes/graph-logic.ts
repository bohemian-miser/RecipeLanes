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
