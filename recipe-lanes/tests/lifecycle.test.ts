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
import { createDebugRecipeAction, addIngredientNodeAction, rejectIcon } from '../app/actions';
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
    it('should follow the full creation and reroll flow', async () => {
        const ingredient = "Integration-Burger-" + Date.now();
        const service = getDataService();

        // 1. Create Debug Recipe
        const r1 = await createDebugRecipeAction() as any;
        assert.ok(r1.recipeId);
        const recipeId = r1.recipeId;

        // 2. Add Ingredient Node
        const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
        assert.ok(r2.nodeId);
        const nodeId = r2.nodeId;

        // 3. Resolve (Wait for Cloud Function)
        await service.waitForQueue(ingredient);
        
        let current = await getNodeIcon(recipeId, nodeId);
        assert.ok(current.iconUrl, "Failed to generate Icon A");
        const urlA = current.iconUrl;

        // 4. Reroll
        await rejectIcon(recipeId, ingredient, current.iconId!);
        await service.waitForQueue(ingredient);

        current = await getNodeIcon(recipeId, nodeId);
        assert.ok(current.iconUrl, "Failed to generate Icon B");
        const urlB = current.iconUrl;
        
        assert.notStrictEqual(urlA, urlB, "Should have a new icon after reroll");
    });
});
