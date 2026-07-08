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
import { getClaimToken, clearClaimToken } from '@/lib/recipe-lanes/claim-token-client';
import { track } from '@/lib/analytics';

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
    // Exclude synthetic canvas-only nodes: lane bands and notation station
    // badges (row anchors that exist only in the layout, not in graph.nodes).
    // Without this, saving in notation mode writes phantom
    // `notation-station-<laneId>` rows into layouts[mode] forever.
    const currentNodes = rfNodes.filter((n: any) => n.type !== 'lane' && n.type !== 'notation-station');
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

/**
 * Pure helper: given a recipe title, produce the title for the next saved
 * copy. Repeated copies escalate "Copy of" → "Another copy of" → "Yet another
 * copy of X (n)" so a chain of copies stays readable. Extracted so both the
 * fork-on-save path and the explicit "Save a copy" button (issue #239) share
 * one naming scheme and it can be unit-tested.
 */
export function nextCopyTitle(title: string | undefined): string {
    const base = title || 'Untitled';
    if (base.startsWith('Yet another copy of ')) {
        const match = base.match(/Yet another copy of (.*) \((\d+)\)$/);
        if (match) {
            return `Yet another copy of ${match[1]} (${parseInt(match[2]) + 1})`;
        }
        return `${base} (1)`;
    }
    if (base.startsWith('Another copy of ')) {
        return base.replace('Another copy of ', 'Yet another copy of ');
    }
    if (base.startsWith('Copy of ')) {
        return base.replace('Copy of ', 'Another copy of ');
    }
    return `Copy of ${base}`;
}

/**
 * Pure helper: turn the current graph into the graph that should be persisted
 * as an explicit copy (issue #239). Always a brand-new recipe — it records the
 * original as `sourceId` and renames via nextCopyTitle. Callers pass the copy
 * to saveRecipeAction with no id so the original is never overwritten.
 */
export function buildCopyGraph(graph: RecipeGraph, sourceId: string | undefined): RecipeGraph {
    return {
        ...graph,
        sourceId,
        title: nextCopyTitle(graph.title),
    };
}

/**
 * Pure helper: decides how the Save button should behave for the current
 * viewer. A logged-in non-owner can always "Save a copy" of a shared recipe
 * (issue #46) without first making an edit. Owners keep the original
 * dirty/saved gating.
 */
export function getSaveButtonState(params: {
    isLoggedIn: boolean;
    isOwner: boolean;
    isDirty: boolean;
    saved: boolean;
}): { enabled: boolean; label: string; isCopy: boolean } {
    const { isLoggedIn, isOwner, isDirty, saved } = params;

    // Logged-in viewer looking at someone else's recipe: explicit "Save a copy".
    if (isLoggedIn && !isOwner) {
        return {
            enabled: true,
            label: saved ? 'Saved a copy!' : 'Save a copy',
            isCopy: true,
        };
    }

    // Owner (or not-yet-saved new recipe): original behaviour.
    return {
        enabled: isDirty || saved,
        label: saved ? 'Saved!' : isDirty ? 'Save Changes' : 'No Changes',
        isCopy: false,
    };
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
            // eslint-disable-next-line react-hooks/set-state-in-effect
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

        // If this browser minted the recipe anonymously, attach its claim
        // token so this ordinary save (now that the user is signed in) also
        // transfers ownership — saveRecipe only honors it when the recipe
        // still has no owner (#151 follow-up).
        const claimToken = currentId ? getClaimToken(localStorage, currentId) : undefined;

        // Forking Logic for Non-Owners (Alice Copy)
        if (isLoggedIn && !isOwner && currentId) {
            console.log('[ReactFlow] Forking on Save (Non-Owner)');
            const sourceId = currentId;
            currentId = undefined; // Force new creation
            graphToSave.sourceId = sourceId;

            // Smarter Copy Naming (shared with the explicit "Save a copy" button).
            graphToSave.title = nextCopyTitle(graphToSave.title);
            onNotify?.("Saving a copy...");
        }

        // Ensure visibility is part of the graph object passed back
        graphToSave.visibility = visibility;

        const result = await saveRecipeAction(graphToSave, currentId, visibility, claimToken);
        // One attempt is enough — whether it succeeded or the token was
        // stale/invalid, there's nothing to gain by attaching it again.
        if (claimToken && currentId) clearClaimToken(localStorage, currentId);

        if (result.id) track('recipe_saved');
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

    // Explicit "Save a copy" (issue #239): always fork the *current* graph into
    // a brand-new recipe, even for the owner. Unlike handleSave's non-owner fork
    // path, this never overwrites the original and captures unsaved edits.
    const performSaveCopy = async () => {
        const sourceId = searchParams.get('id') || undefined;
        const graphToSave = buildCopyGraph(getGraph(), sourceId);
        const visibility = visibilityRef.current ? 'public' : 'unlisted';
        graphToSave.visibility = visibility;
        onNotify?.("Saving a copy...");
        // No id → saveRecipe always creates a new recipe.
        const result = await saveRecipeAction(graphToSave, undefined, visibility);
        if (onSave) onSave(graphToSave);
        return result;
    };

    const handleSaveCopy = async () => {
        if (!isLoggedIn) {
            onNotify?.('Log in to save recipe');
            return;
        }
        const res = await performSaveCopy();
        if (res.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('id', res.id);
            router.push(url.pathname + url.search);
            setIsDirty(false);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            onNotify?.("Saved a copy.");
        } else {
            console.error('Failed to save copy.');
            onNotify?.("Failed to save copy.");
        }
    };

    const handleShare = async () => {
        const res = await performSave();
        if (res.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('id', res.id);
            router.push(url.pathname + url.search);
            navigator.clipboard.writeText(url.toString());
            track('share_clicked');
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
        handleSaveCopy,
        handleShare,
        toggleVisibility,
    };
}
