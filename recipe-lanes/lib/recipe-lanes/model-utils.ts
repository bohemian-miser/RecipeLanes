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
    return !!node.icon && (!!node.icon.url || !!node.icon.path);
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

// Helper to bridge old code if needed, but prefer using IconStats directly
export function getNodeIconUrl(node: RecipeNode): string | undefined {
    if (!node.icon) return undefined;
    if (node.icon.url) return node.icon.url;
    if (node.icon.path) return getIconUrl(node.icon.path);
    return undefined;
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
        path: icon.path,
        metadata: icon.metadata,
        status: icon.status
    };
    setNodeIcon(node, cleanIcon);
    return node;
}