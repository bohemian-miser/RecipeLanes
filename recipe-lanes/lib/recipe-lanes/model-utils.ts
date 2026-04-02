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

import { RecipeNode, IconStats, ShortlistEntry } from './types';

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

export function getNodeIcon(node: RecipeNode): IconStats | undefined {
    const entry = getCurrentEntry(node);
    return entry ? getEntryIcon(entry) : undefined;
}

/** @deprecated - icon writes go through the shortlist; this is a no-op. */
export function setNodeIcon(node: RecipeNode, _icon: IconStats) {
    return node;
}

/** @deprecated - clear via node.iconShortlist = undefined; node.shortlistIndex = undefined; */
export function clearNodeIcon(node: RecipeNode) {
    return node;
}

export function hasNodeIcon(node: RecipeNode): boolean {
    const entry = getCurrentEntry(node);
    if (!entry) return false;
    const icon = getEntryIcon(entry);
    return !!(icon.url || icon.path || icon.id);
}

/**
 * Reconstructs the public Firebase Storage URL from a path.
 * Format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded-path}?alt=media
 */
export function getIconUrl(path: string): string {
    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
    const encodedPath = encodeURIComponent(path);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
}

/**
 * Derives the 128×128 thumbnail path from an icon's main storage path.
 * e.g. icons/Carrot-abc12345.png → icons/Carrot-abc12345.thumb.png
 */
export function getThumbPath(path: string): string {
    return path.replace(/\.png$/, '.thumb.png');
}

export function getNodeIconUrl(node: RecipeNode): string | undefined {
    const entry = getCurrentEntry(node);
    const icon = entry ? getEntryIcon(entry) : undefined;
    if (!icon) return undefined;
    if (icon.path) return getIconUrl(getThumbPath(icon.path));
    if (icon.url) return icon.url; // fallback for old icons without path
    return undefined;
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

/** @deprecated - icon writes go through the shortlist. */
export function applyIconToNode(node: RecipeNode, _icon: IconStats) {
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
    const filtered = existing.filter(e => e.icon.id !== entry.icon.id);
    return [entry, ...filtered];
}