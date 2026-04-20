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

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { RecipeGraph } from '../../../lib/recipe-lanes/types';
import { saveRecipeAction } from '@/app/actions';

/**
 * Pure helper extracted from getGraph() so it can be tested without React.
 * NOTE: intentionally preserves the existing mutation of graph.layouts — do not
 * "fix" this here; the bug is tested in tests/layout-saving.test.ts.
 */
export function buildGraphForSave(
    graph: RecipeGraph,
    mode: string,
    rfNodes: any[],
    rfEdges: any[],
): RecipeGraph {
    const currentNodes = rfNodes.filter((n: any) => n.type !== 'lane');
    const layouts = { ...(graph.layouts || {}) };
    layouts[mode] = currentNodes.map((n: any) => ({ id: n.id, x: n.position.x, y: n.position.y }));

    const nodesWithPos = graph.nodes
        .filter(n => currentNodes.some((rn: any) => rn.id === n.id))
        .map(n => {
            const rfn = currentNodes.find((rn: any) => rn.id === n.id)!;
            const inputs = rfEdges
                .filter((e: any) => e.target === n.id)
                .map((e: any) => e.source);
            return { ...n, x: rfn.position.x, y: rfn.position.y, inputs };
        });

    return { ...graph, nodes: nodesWithPos, layouts, layoutMode: mode };
}

interface UseSaveAndForkParams {
    graph: RecipeGraph;
    mode: any;
    getNodes: () => any[];
    getEdges: () => any[];
    isLoggedIn: boolean;
    isOwner: boolean;
    propIsPublic: boolean | undefined;
    onVisibilityChange: ((isPublic: boolean) => void) | undefined;
    onSave: ((graph: RecipeGraph) => void) | undefined;
    onNotify: ((msg: string) => void) | undefined;
}

export function useSaveAndFork({
    graph,
    mode,
    getNodes,
    getEdges,
    isLoggedIn,
    isOwner,
    propIsPublic,
    onVisibilityChange,
    onSave,
    onNotify,
}: UseSaveAndForkParams) {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Initialize from graph.visibility (injected by service)
    // If prop is provided, use it, otherwise fallback to internal state logic
    const initialVisibility = graph.visibility === 'public';
    const [internalIsPublic, setInternalIsPublic] = useState(initialVisibility);

    const isPublic = propIsPublic !== undefined ? propIsPublic : internalIsPublic;

    // We still need a ref for the save function to access the latest state without re-creating the function
    const visibilityRef = useRef(isPublic);

    useEffect(() => {
        visibilityRef.current = isPublic;
    }, [isPublic]);

    const [isDirty, setIsDirty] = useState(false);

    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);

    // Update state if graph prop changes (e.g. fresh load)
    useEffect(() => {
        const pub = graph.visibility === 'public';
        if (propIsPublic === undefined) {
            setInternalIsPublic(pub);
        }
    }, [graph.visibility, propIsPublic]);

    const getGraph = useCallback((): RecipeGraph => {
        return buildGraphForSave(graph, mode as string, getNodes(), getEdges());
    }, [graph, mode, getNodes, getEdges]);

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
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
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
            onNotify?.("Link copied to clipboard");
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

    return {
        copied,
        saved,
        isDirty,
        setIsDirty,
        isPublic,
        visibilityRef,
        getGraph,
        performSave,
        handleSave,
        handleShare,
        toggleVisibility,
    };
}
