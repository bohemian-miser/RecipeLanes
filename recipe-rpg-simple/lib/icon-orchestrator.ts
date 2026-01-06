import { RecipeGraph } from './recipe-lanes/types';
import { getDataService } from './data-service';
import { standardizeIngredientName } from './utils';

export interface IconOrchestratorResult {
    graph: RecipeGraph;
    pendingCount: number;
    hits: Map<string, { iconId: string, iconUrl: string }>;
}

/**
 * Unified function to resolve and queue icons for a recipe graph.
 * Handles cache checks, rejections, and queuing for background generation.
 */
export async function resolveIconsForGraph(
    graph: RecipeGraph, 
    recipeId?: string, 
    sessionRejections: Map<string, string[]> = new Map()
): Promise<IconOrchestratorResult> {
    
    // 1. Identify items to queue
    const itemsToQueue: { ingredientName: string, recipeId?: string, rejectedIds?: string[] }[] = [];

    graph.nodes.forEach(n => {
        if (n.visualDescription && !n.iconUrl) { // Only queue if missing?
            // Actually, if we are calling this, we might want to check updates even if present?
            // But usually we only queue if missing.
            // However, "Optimistic Return" logic in actions.ts queued everything.
            // queueIcons logic is: check cache. If cached icon matches current node icon, no change.
            // If cache has *better* icon (not rejected), return it.
            
            // For unified logic, let's process ALL visual nodes.
            // queueIcons is cheap (cache read).
            
            const name = n.visualDescription;
            const rejections = [
                ...(graph.rejections?.[name] || []),
                ...(sessionRejections.get(name) || [])
            ];

            // If the node ALREADY has an icon, it might be in the rejection list?
            // If it is, we definitely want a new one.
            // If it's NOT in rejection list, queueIcons will likely return it again (cache hit).
            
            itemsToQueue.push({
                ingredientName: name,
                recipeId,
                rejectedIds: rejections
            });
        }
    });

    if (itemsToQueue.length === 0) {
        return { graph, pendingCount: 0, hits: new Map() };
    }

    // 2. Call Unified Queue
    const hits = await getDataService().queueIcons(itemsToQueue);
    
    // 3. Apply Hits to Graph
    let pendingCount = 0;
    
    graph.nodes = graph.nodes.map(n => {
        if (!n.visualDescription) return n;
        
        const stdName = standardizeIngredientName(n.visualDescription);
        if (hits.has(stdName)) {
            const hit = hits.get(stdName)!;
            // Only update if changed
            if (n.iconId !== hit.iconId) {
                return { 
                    ...n, 
                    iconId: hit.iconId,
                    iconUrl: hit.iconUrl 
                };
            }
        } else {
            pendingCount++;
        }
        return n;
    });

    return { graph, pendingCount, hits };
}
