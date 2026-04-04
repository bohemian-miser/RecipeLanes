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

import { useState, useCallback } from 'react';
// @ts-ignore
import { MarkerType } from 'reactflow';
import { calculateBridgeEdges } from '../../../lib/recipe-lanes/graph-logic';

interface UseHistoryManagerParams {
    getNodes: () => any[];
    getEdges: () => any[];
    setNodes: React.Dispatch<React.SetStateAction<any[]>>;
    setEdges: React.Dispatch<React.SetStateAction<any[]>>;
    edgeStyle: string;
    onEdit?: () => void;
    setIsDirty: (dirty: boolean) => void;
}

export function useHistoryManager({
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    edgeStyle,
    onEdit,
    setIsDirty,
}: UseHistoryManagerParams) {
    const [past, setPast] = useState<{ nodes: any[], edges: any[] }[]>([]);
    const [future, setFuture] = useState<{ nodes: any[], edges: any[] }[]>([]);

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
    }, [takeSnapshot, getEdges, setEdges, setNodes, edgeStyle, onEdit, setIsDirty]);

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
            const restoredNodes = previous.nodes.map((n: any) => ({
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
    }, [past, getNodes, getEdges, setNodes, setEdges, handleDeleteNode, setIsDirty]);

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
            const restoredNodes = next.nodes.map((n: any) => ({
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
    }, [future, getNodes, getEdges, setNodes, setEdges, handleDeleteNode, setIsDirty]);

    return { past, future, takeSnapshot, undo, redo, handleDeleteNode };
}
