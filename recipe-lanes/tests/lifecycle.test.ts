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
import { createDebugRecipeAction, addIngredientNodeAction, forgeIconAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { getDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { getNodeIconId } from '../lib/recipe-lanes/model-utils';

setAIService(new MockAIService());
setAuthService(new MockAuthService());

/** Poll the recipe node until it has an icon different from `excludeId`, or timeout. */
async function pollForIcon(
    recipeId: string,
    nodeId: string,
    excludeId: string | undefined,
    timeoutMs = 60_000
): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const recipe = await getDataService().getRecipe(recipeId);
        const node = recipe?.graph?.nodes?.find((n: any) => n.id === nodeId);
        const iconId = node ? getNodeIconId(node) : undefined;
        if (iconId && iconId !== excludeId) return iconId;
        await new Promise(r => setTimeout(r, 500));
    }
    return null;
}

describe('Recipe & Icon Lifecycle', () => {
    it('should follow the full creation and shortlist-cycle reroll flow', async () => {
        const ingredient = 'Integration-Egg-' + Date.now();

        const r1 = await createDebugRecipeAction() as any;
        assert.ok(r1.recipeId, 'createDebugRecipeAction should return a recipeId');
        const recipeId = r1.recipeId;

        const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
        assert.ok(r2.nodeId, 'addIngredientNodeAction should return a nodeId');
        const nodeId = r2.nodeId;

        const iconId = await pollForIcon(recipeId, nodeId, undefined);
        assert.ok(iconId, `Icon not generated within timeout for "${ingredient}"`);
    });

    it('forge produces a new icon distinct from the original', async () => {
        const ingredient = 'Forge-Egg-' + Date.now();

        const r1 = await createDebugRecipeAction() as any;
        assert.ok(r1.recipeId);
        const recipeId = r1.recipeId;

        const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
        assert.ok(r2.nodeId);
        const nodeId = r2.nodeId;

        const initialIconId = await pollForIcon(recipeId, nodeId, undefined);
        assert.ok(initialIconId, `Initial icon not generated within timeout for "${ingredient}"`);

        // Forge — clears current icon and queues a brand-new generation
        const forgeResult = await forgeIconAction(recipeId, ingredient, initialIconId) as any;
        assert.ok(forgeResult.success, `forgeIconAction failed: ${forgeResult.error}`);

        // Wait for a different icon to land on the node
        const forgedIconId = await pollForIcon(recipeId, nodeId, initialIconId);
        assert.ok(forgedIconId, 'Forged icon did not appear within timeout');
        assert.notStrictEqual(forgedIconId, initialIconId, 'Forged icon should be a new icon');
    });
});
