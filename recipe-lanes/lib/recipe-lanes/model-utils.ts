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
 * Returns true when the node's icon was resolved via search rather than an
 * exact name match.  Used by UI components to show a confidence indicator.
 */
export function isIconSearchMatched(node: RecipeNode): boolean {
    return !!node.iconQuery && node.iconQuery.method !== 'exact_name';
}

/**
 * Returns the 0-based index of the node's current icon within its shortlist,
 * or -1 when the current icon is not present in the shortlist (or when either
 * field is absent).
 */
export function currentShortlistIndex(node: RecipeNode): number {
    if (!node.iconShortlist || !node.icon?.id) return -1;
    return node.iconShortlist.findIndex(s => s.id === node.icon!.id);
}

/**
 * Returns the next shortlist entry after the node's current icon, or null
 * when the shortlist is exhausted (meaning the caller should fall through to
 * the Firestore reroll path).
 */
export function nextShortlistIcon(node: RecipeNode): IconStats | null {
    const shortlist = node.iconShortlist;
    if (!shortlist || shortlist.length === 0) return null;
    const idx = currentShortlistIndex(node);
    const nextIdx = idx + 1;
    if (nextIdx < shortlist.length) return shortlist[nextIdx];
    return null;
}