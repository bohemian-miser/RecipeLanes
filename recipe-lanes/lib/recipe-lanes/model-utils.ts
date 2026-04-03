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

import { RecipeNode, IconStats, IconIndexEntry, ShortlistEntry, SearchTerm } from './types';
import { standardizeIngredientName } from '../utils';

/**
 * Returns the canonical ingredient name for a node — used for icon lookup and standardisation.
 * Prefers visualDescription over text (visualDescription is the icon-specific description).
 */
export function getNodeIngredientName(node: RecipeNode): string {
    return node.visualDescription || node.text;
}

/** Returns the display theme for a node's icon. */
export function getNodeTheme(node: RecipeNode): 'classic' | 'modern' | 'modern_clean' {
    return (node.iconTheme as 'classic' | 'modern' | 'modern_clean') || 'classic';
}

/**
 * Returns the HyDE queries for a node, or an empty array when none are present.
 */
export function getNodeHydeQueries(node: RecipeNode): string[] {
    return node.hydeQueries || [];
}

/** Derives the Storage path for an icon from its ID and ingredient name. */
export function getIconPath(iconId: string, ingredientName: string): string {
    const shortId = iconId.substring(0, 8);
    const kebabName = ingredientName.trim().replace(/\s+/g, '-');
    return `icons/${kebabName}-${shortId}.png`;
}

/** Derives the thumb Storage path. */
export function getIconThumbPath(iconId: string, ingredientName: string): string {
    return getIconPath(iconId, ingredientName).replace('.png', '.thumb.png');
}

export function getNodeIcon(node: RecipeNode): IconStats | undefined {
    const entry = getCurrentEntry(node);
    return entry ? getEntryIcon(entry) : undefined;
}

/** @deprecated - icon writes go through the shortlist; this is a no-op. */
export function setNodeIcon(node: RecipeNode, _icon: IconStats) {
    return node;
}

/** Clears all shortlist state from the node (shortlist, index, and cycled flag). */
export function clearNodeShortlist(node: RecipeNode): void {
    node.iconShortlist = undefined;
    node.shortlistIndex = undefined;
    node.shortlistCycled = undefined;
}

/**
 * Returns the IDs of every icon the user has seen in the current cycle:
 * - If shortlistCycled is true: all entries in the shortlist
 * - Otherwise: entries 0 through shortlistIndex inclusive
 */
export function getSeenIconIds(node: RecipeNode): string[] {
    const shortlist = node.iconShortlist;
    if (!shortlist || shortlist.length === 0) return [];
    const upTo = node.shortlistCycled ? shortlist.length : (node.shortlistIndex ?? 0) + 1;
    return shortlist.slice(0, upTo).map(e => getEntryIcon(e).id);
}

/** Returns the IconStats at a given shortlist position, or undefined if out of bounds. */
export function getShortlistIconAt(node: RecipeNode, index: number): IconStats | undefined {
    const entry = node.iconShortlist?.[index];
    return entry ? getEntryIcon(entry) : undefined;
}

export function hasNodeIcon(node: RecipeNode): boolean {
    const entry = getCurrentEntry(node);
    if (!entry) return false;
    const icon = getEntryIcon(entry);
    return !!icon.id;
}

/**
 * Reconstructs the public Firebase Storage URL from a path.
 * In emulator environments (local-project-id), points to the Storage emulator.
 */
export function getIconUrl(path: string): string {
    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
    const encodedPath = encodeURIComponent(path);
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
    if (projectId === 'local-project-id' || projectId.startsWith('demo-')) {
        const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
        return `http://${emulatorHost}/v0/b/${bucket}/o/${encodedPath}?alt=media`;
    }
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
}

/** Maps an IconIndexEntry (Firestore doc) to an IconStats object. */
export function iconIndexEntryToStats(entry: IconIndexEntry): IconStats {
    return { id: entry.icon_id, visualDescription: entry.ingredient_name };
}

export function getIconStoragePaths(icon: IconStats): { main: string; thumb: string } {
    if (!icon.visualDescription) throw new Error(`getIconStoragePaths: icon ${icon.id} has no visualDescription`);
    const stdName = standardizeIngredientName(icon.visualDescription);
    return { main: getIconPath(icon.id, stdName), thumb: getIconThumbPath(icon.id, stdName) };
}

export function getIconPublicUrl(icon: IconStats): string {
    return getIconUrl(getIconStoragePaths(icon).main);
}

export function getIconThumbUrl(icon: IconStats): string {
    return getIconUrl(getIconStoragePaths(icon).thumb);
}

export function withSearchTerms(icon: IconStats, hydeQueries: string[]): IconStats {
    if (hydeQueries.length === 0) return icon;
    const searchTerms: SearchTerm[] = hydeQueries.map(text => ({
        text,
        source: 'hyde_from_img' as const,
        addedAt: Date.now(),
    }));
    return { ...icon, searchTerms };
}

export function getNodeIconUrl(node: RecipeNode): string | undefined {
    const entry = getCurrentEntry(node);
    const icon = entry ? getEntryIcon(entry) : undefined;
    if (!icon?.id) return undefined;
    // Prefer the icon's own visualDescription (set at index time) over the node's.
    const vd = icon.visualDescription || getNodeIngredientName(node);
    return getIconThumbUrl({ ...icon, visualDescription: vd });
}

export function getNodeIconId(node: RecipeNode): string | undefined {
    const entry = getCurrentEntry(node);
    return entry ? getEntryIcon(entry).id : undefined;
}

export function getNodeIconMetadata(node: RecipeNode) {
    const entry = getCurrentEntry(node);
    return entry ? getEntryIcon(entry).metadata : undefined;
}

export function getNodeIconStatus(node: RecipeNode) {
    const entry = getCurrentEntry(node);
    return entry ? getEntryIcon(entry).status : undefined;
}

/**
 * Returns a plain-object subset of IconStats safe to embed in recipe nodes.
 * Strips legacy fields (path, url, fullPrompt, created_at, etc.) and Firestore
 * Timestamp instances that break Next.js client↔server serialization.
 */
export function toRecipeIcon(icon: IconStats): IconStats {
    return {
        id: icon.id,
        visualDescription: icon.visualDescription,
        metadata: icon.metadata,
        status: icon.status,
        ...(icon.score !== undefined && { score: icon.score }),
        ...(icon.impressions !== undefined && { impressions: icon.impressions }),
        ...(icon.rejections !== undefined && { rejections: icon.rejections }),
    };
}

export function applyIconToNode(node: RecipeNode, icon: IconStats) {
    // Only propagate essential visual/reference data, avoiding stale stats
    setNodeIcon(node, toRecipeIcon(icon));
    return node;
}

/**
 * Returns the matchType of the node's current shortlist entry — 'generated',
 * 'search', or undefined when no shortlist entry is present or shortlistIndex
 * has not been explicitly set.
 */
export function getIconMatchType(node: RecipeNode): 'generated' | 'search' | undefined {
    if (!node.iconShortlist || node.shortlistIndex === undefined) return undefined;
    const entry = node.iconShortlist[node.shortlistIndex];
    return entry ? getEntryMatchType(entry) : undefined;
}

/**
 * Returns true when the node's icon was resolved via search rather than
 * generation.  Reads from the current shortlist entry's matchType field.
 * Kept as a one-liner alias so existing callers don't break.
 */
export function isIconSearchMatched(node: RecipeNode): boolean {
    return getIconMatchType(node) === 'search';
}

/**
 * Returns the 0-based index of the node's current icon within its shortlist,
 * reading from the explicit shortlistIndex field.  Returns -1 when the
 * shortlist or shortlistIndex is absent.
 */
export function currentShortlistIndex(node: RecipeNode): number {
    if (!node.iconShortlist) return -1;
    if (node.shortlistIndex === undefined) return -1;
    return node.shortlistIndex;
}

/**
 * Returns the next shortlist icon after the node's current icon, or null
 * when the shortlist is exhausted (meaning the caller should fall through to
 * the Firestore reroll path).
 */
export function nextShortlistIcon(node: RecipeNode): IconStats | null {
    const shortlist = node.iconShortlist;
    if (!shortlist || shortlist.length === 0) return null;
    const nextIdx = (node.shortlistIndex ?? 0) + 1;
    if (nextIdx < shortlist.length) return getEntryIcon(shortlist[nextIdx]);
    return null;
}

/**
 * Returns the next index value to be stored on the node after advancing past
 * the current shortlist entry.
 */
export function advanceShortlistIndex(node: RecipeNode): number {
    return (node.shortlistIndex ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// ShortlistEntry helpers — the ONLY place that knows ShortlistEntry internals
// ---------------------------------------------------------------------------

/** Wraps an IconStats + matchType into a ShortlistEntry. */
export function buildShortlistEntry(icon: IconStats, matchType: 'generated' | 'search'): ShortlistEntry {
    return { icon, matchType };
}

/**
 * Returns the current ShortlistEntry for the node (shortlist[shortlistIndex ?? 0]),
 * or undefined when no shortlist is present.
 */
export function getCurrentEntry(node: RecipeNode): ShortlistEntry | undefined {
    if (!node.iconShortlist || node.iconShortlist.length === 0) return undefined;
    return node.iconShortlist[node.shortlistIndex ?? 0];
}

/** Extracts the IconStats from a ShortlistEntry. */
export function getEntryIcon(entry: ShortlistEntry): IconStats {
    return entry.icon;
}

/** Extracts the matchType from a ShortlistEntry. */
export function getEntryMatchType(entry: ShortlistEntry): 'generated' | 'search' {
    return entry.matchType;
}

/**
 * Prepends entry to existing shortlist (no cap — caller decides slice limits).
 * De-duplicates by icon id so that re-generating an already-present icon
 * doesn't create a duplicate.
 */
export function prependToShortlist(existing: ShortlistEntry[], entry: ShortlistEntry): ShortlistEntry[] {
    const newId = getEntryIcon(entry).id;
    const filtered = existing.filter(e => getEntryIcon(e).id !== newId);
    return [entry, ...filtered];
}