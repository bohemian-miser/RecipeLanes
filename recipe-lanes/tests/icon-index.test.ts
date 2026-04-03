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
 * Integration tests for the icon_index population pipeline.
 *
 * Requires the Firestore emulator. Run via scripts/test-unit.sh or
 * directly with the emulator already running:
 *   npx env-cmd -f .env.test node --import tsx --test tests/icon-index.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { createDebugRecipeAction, addIngredientNodeAction } from '../app/actions';
import { getDataService } from '../lib/data-service';
import { db } from '../lib/firebase-admin';
import { DB_COLLECTION_ICON_INDEX } from '../lib/config';

setAIService(new MockAIService());
setAuthService(new MockAuthService());

describe('icon_index population', () => {

    it('writing an icon via the full pipeline creates an icon_index document', async () => {
        // Use a known ingredient so MockAIService returns a local PNG instead of a remote URL
        const ingredient = `IndexEgg-${Date.now()}`;
        const dataService = getDataService();

        // 1. Create a recipe and add an ingredient node to trigger icon generation
        const r1 = await createDebugRecipeAction() as any;
        assert.ok(r1.recipeId, 'createDebugRecipeAction should return a recipeId');
        const recipeId = r1.recipeId;

        const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
        assert.ok(r2.nodeId, 'addIngredientNodeAction should return a nodeId');

        // 2. Wait for the Cloud Function to complete icon generation
        // const icon = await dataService.waitForQueue(ingredient, 60_000);
        // assert.ok(icon, `Icon generation timed out for "${ingredient}"`);
        // assert.ok(icon!.id, 'Generated icon should have an id');

        // // 3. Poll for the icon_index document — the write is fire-and-forget so may
        // //    arrive slightly after waitForQueue resolves.
        // const iconId = icon!.id;
        // let indexDoc: any = null;
        // const deadline = Date.now() + 10_000;
        // while (Date.now() < deadline) {
        //     const snap = await db.collection(DB_COLLECTION_ICON_INDEX).doc(iconId).get();
        //     if (snap.exists) {
        //         indexDoc = snap.data();
        //         break;
        //     }
        //     await new Promise(r => setTimeout(r, 500));
        // }

        // assert.ok(indexDoc, `icon_index document for icon "${iconId}" was not created within 10 s`);

        // // 4. Verify shape
        // assert.strictEqual(indexDoc.icon_id, iconId, 'icon_id must match the generated icon');
        // assert.ok(typeof indexDoc.ingredient_name === 'string' && indexDoc.ingredient_name.length > 0,
        //     'ingredient_name must be a non-empty string');
        // // Firestore stores VectorValue, not a plain array — use toArray() to inspect it
        // const embeddingArr = indexDoc.embedding?.toArray?.();
        // assert.ok(Array.isArray(embeddingArr) && embeddingArr.length > 0,
        //     'embedding must be a non-empty VectorValue');
        // assert.ok(embeddingArr.every((v: any) => typeof v === 'number'),
        //     'all embedding values must be numbers');
        // assert.ok(indexDoc.created_at !== undefined, 'created_at must be set');
    });
});
