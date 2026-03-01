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
    return !!node.icon && !!node.icon.iconUrl;
}

// Helper to bridge old code if needed, but prefer using IconStats directly
export function getNodeIconUrl(node: RecipeNode): string | undefined {
    return node.icon?.iconUrl;
}

export function getNodeIconId(node: RecipeNode): string | undefined {
    return node.icon?.iconId;
}

export function getNodeIconMetadata(node: RecipeNode) {
    return node.icon?.metadata;
}

export function applyIconToNode(node: RecipeNode, icon: IconStats) {
    // Only propagate essential visual/reference data, avoiding stale stats
    const cleanIcon: IconStats = {
        iconId: icon.iconId,
        iconUrl: icon.iconUrl,
        metadata: icon.metadata
    };
    setNodeIcon(node, cleanIcon);
    return node;
}