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

/**
 * Pure unit tests for the recipe + icon lifecycle.
 *
 * Converted from an emulator-backed integration test: the actions exercised here
 * (createDebugRecipeAction / addIngredientNodeAction / forgeIconAction / getRecipe)
 * all work against the in-memory MemoryDataService, which resolves icons
 * synchronously via its mock queueIcons path. No emulator and no polling needed.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createDebugRecipeAction, addIngredientNodeAction, forgeIconAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { memoryStore } from '../lib/store';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { getNodeIconId } from '../lib/recipe-lanes/model-utils';

/** Read the current icon id on a recipe node (synchronous — MemoryDataService resolves inline). */
async function readIconId(recipeId: string, nodeId: string): Promise<string | undefined> {
    const recipe = await getDataService().getRecipe(recipeId);
    const node = recipe?.graph?.nodes?.find((n: any) => n.id === nodeId);
    return node ? (getNodeIconId(node) ?? undefined) : undefined;
}

describe('Recipe & Icon Lifecycle', () => {
    beforeEach(() => {
        memoryStore.clear();
        setDataService(new MemoryDataService());
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
    });

    it('should follow the full creation and icon-resolution flow', async () => {
        const ingredient = 'Lifecycle-Egg-' + Date.now();

        const r1 = await createDebugRecipeAction() as any;
        assert.ok(r1.recipeId, 'createDebugRecipeAction should return a recipeId');
        const recipeId = r1.recipeId;

        const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
        assert.ok(r2.nodeId, 'addIngredientNodeAction should return a nodeId');
        const nodeId = r2.nodeId;

        const iconId = await readIconId(recipeId, nodeId);
        assert.ok(iconId, `Icon not generated for "${ingredient}"`);
    });

    it('forge succeeds and re-queues the node (reroll request accepted)', async () => {
        // NOTE: producing a *distinct* forged icon requires the real icon index /
        // reroll cloud function, which MemoryDataService does not implement (its
        // resolveRecipeIcons skips nodes that already hold an icon). That distinctness
        // assertion stays emulator-backed elsewhere; here we exercise the pure path:
        // forgeIconAction -> rejectRecipeIcon succeeds and marks the node for re-resolution.
        const ingredient = 'Forge-Egg-' + Date.now();

        const r1 = await createDebugRecipeAction() as any;
        assert.ok(r1.recipeId);
        const recipeId = r1.recipeId;

        const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
        assert.ok(r2.nodeId);
        const nodeId = r2.nodeId;

        const initialIconId = await readIconId(recipeId, nodeId);
        assert.ok(initialIconId, `Initial icon not generated for "${ingredient}"`);

        const forgeResult = await forgeIconAction(recipeId, ingredient, initialIconId) as any;
        assert.ok(forgeResult.success, `forgeIconAction failed: ${forgeResult.error}`);

        // Node still resolves to an icon after the reroll request.
        const forgedIconId = await readIconId(recipeId, nodeId);
        assert.ok(forgedIconId, 'Node should still resolve to an icon after forge');
    });
});
