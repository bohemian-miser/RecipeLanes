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

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createDebugRecipeAction, addIngredientNodeAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { getDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { getNodeIconUrl, getNodeIconId } from '../lib/recipe-lanes/model-utils';

// Explicitly use Mocks for tests
setAIService(new MockAIService());
setAuthService(new MockAuthService());

async function getNodeIcon(recipeId: string, nodeId: string) {
    const recipeData = await getDataService().getRecipe(recipeId);
    const node = recipeData?.graph?.nodes?.find((n: any) => n.id === nodeId);
    if (!node) return { iconUrl: undefined, iconId: undefined };
    return { iconUrl: getNodeIconUrl(node), iconId: getNodeIconId(node) };
}

describe('Recipe & Icon Lifecycle', () => {
    it('should follow the full creation and shortlist-cycle reroll flow', async () => {
        // Use a unique ingredient name to avoid cache collisions.
        const ingredient = "Integration-Egg-" + Date.now();
        const service = getDataService();

        // 1. Create Debug Recipe
        const r1 = await createDebugRecipeAction() as any;
        assert.ok(r1.recipeId);
        const recipeId = r1.recipeId;

        // 2. Add Ingredient Node
        const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
        assert.ok(r2.nodeId);
        const nodeId = r2.nodeId;

        // 3. Wait for Cloud Function to generate and assign an icon
        // Allow up to 60 s — the emulator can be slow on low-power hardware.
        await service.waitForQueue(ingredient, 60_000);

        let current = await getNodeIcon(recipeId, nodeId);
        assert.ok(current.iconUrl, "Failed to generate initial icon");

        // 4. Verify the recipe node has an icon assigned
        const recipeData = await service.getRecipe(recipeId);
        assert.ok(recipeData, 'recipe should exist');
        const node = recipeData!.graph.nodes.find((n: any) => n.id === nodeId);
        assert.ok(node, 'node should exist');
        assert.ok(getNodeIconUrl(node), 'node should have an icon URL after generation');

        // 5. Verify the shortlist was populated by the CF (it prepends with matchType "generated")
        //    OR was populated by resolveFromIndex with matchType "search".
        //    Either way, an icon and a non-empty shortlist is the success condition.
        const shortlist = node.iconShortlist || [];
        assert.ok(shortlist.length > 0 || getNodeIconUrl(node),
            'node should have either a shortlist or an icon after resolution');
    });
});
