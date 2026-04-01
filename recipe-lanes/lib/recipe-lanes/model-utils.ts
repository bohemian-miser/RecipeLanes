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

import { RecipeNode, IconStats } from './types';

export function getNodeIcon(node: RecipeNode): IconStats | undefined {
    return node.icon;
}

export function setNodeIcon(node: RecipeNode, icon: IconStats) {
    node.icon = icon;
    return node;
}

export function clearNodeIcon(node: RecipeNode) {
    node.icon = undefined;
    return node;
}

export function hasNodeIcon(node: RecipeNode): boolean {
    return !!node.icon && !!node.icon.url;
}

// Helper to bridge old code if needed, but prefer using IconStats directly
export function getNodeIconUrl(node: RecipeNode): string | undefined {
    return node.icon?.url;
}

export function getNodeIconId(node: RecipeNode): string | undefined {
    return node.icon?.id;
}

export function getNodeIconMetadata(node: RecipeNode) {
    return node.icon?.metadata;
}

export function getNodeIconStatus(node: RecipeNode) {
    return node.icon?.status;
}

export function applyIconToNode(node: RecipeNode, icon: IconStats) {
    // Only propagate essential visual/reference data, avoiding stale stats
    const cleanIcon: IconStats = {
        id: icon.id,
        url: icon.url,
        metadata: icon.metadata,
        status: icon.status
    };
    setNodeIcon(node, cleanIcon);
    return node;
}

/**
 * Returns the matchType of the node's current shortlist entry — 'generated',
 * 'search', or undefined when no shortlist entry is present.
 */
export function getIconMatchType(node: RecipeNode): 'generated' | 'search' | undefined {
    if (!node.iconShortlist || node.shortlistIndex === undefined) return undefined;
    return node.iconShortlist[node.shortlistIndex]?.matchType;
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
 * Returns the next shortlist entry after the node's current icon, or null
 * when the shortlist is exhausted (meaning the caller should fall through to
 * the Firestore reroll path).
 */
export function nextShortlistIcon(node: RecipeNode): IconStats | null {
    const shortlist = node.iconShortlist;
    if (!shortlist || shortlist.length === 0) return null;
    const nextIdx = (node.shortlistIndex ?? 0) + 1;
    if (nextIdx < shortlist.length) return shortlist[nextIdx];
    return null;
}

/**
 * Returns the next index value to be stored on the node after advancing past
 * the current shortlist entry.
 */
export function advanceShortlistIndex(node: RecipeNode): number {
    return (node.shortlistIndex ?? 0) + 1;
}