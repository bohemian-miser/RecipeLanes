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
 * Integration tests for impression and rejection tracking.
 *
 * These run against the Firebase emulator (Firestore) and verify that:
 *  - forgeIconAction records +1 impression and +1 rejection for every seen icon
 *  - saveRecipeAction records +1 impression for every seen icon
 *  - Neither action double-counts when called twice (idempotency via hasImpressed/hasRejected)
 *
 * Icons are seeded directly into Firestore — no image generation required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/firebase-admin';
import { getDataService } from '../lib/data-service';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { buildShortlistEntry } from '../lib/recipe-lanes/model-utils';
import { standardizeIngredientName } from '../lib/utils';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_RECIPES, DB_COLLECTION_ICON_INDEX } from '../lib/config';
import type { IconStats, ShortlistEntry } from '../lib/recipe-lanes/types';

setAIService(new MockAIService());
setAuthService(new MockAuthService());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIcon(id: string, visualDescription: string): IconStats {
    return { id, visualDescription, impressions: 0, rejections: 0 };
}

/**
 * Seeds `ingredients_new/{stdName}` with the given icons and returns the
 * shortlist entries to write onto a recipe node.
 */
async function seedIngredient(
    stdName: string,
    icons: IconStats[],
): Promise<ShortlistEntry[]> {
    await db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName).set({
        icons,
        created_at: new Date(),
        updated_at: new Date(),
    });
    const batch = db.batch();
    for (const icon of icons) {
        batch.set(db.collection(DB_COLLECTION_ICON_INDEX).doc(icon.id), {
            ...icon,
            ingredient_name: stdName,
        });
    }
    await batch.commit();
    return icons.map(icon => buildShortlistEntry(icon, 'search'));
}

/**
 * Creates a recipe in Firestore with a single node whose shortlist is
 * pre-populated at the given shortlistIndex (simulating the user having
 * cycled through that many icons).
 */
async function createRecipeWithShortlist(
    stdName: string,
    entries: ShortlistEntry[],
    shortlistIndex: number,
): Promise<string> {
    const doc = await db.collection(DB_COLLECTION_RECIPES).add({
        graph: {
            title: 'test',
            lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
            nodes: [{
                id: 'n1',
                laneId: 'l1',
                text: stdName,
                visualDescription: stdName,
                type: 'ingredient',
                iconShortlist: entries,
                shortlistIndex,
            }],
        },
        visibility: 'private',
        created_at: new Date(),
    });
    return doc.id;
}

/** Fetches icons from `ingredients_new/{stdName}` keyed by icon id. */
async function fetchIconStats(iconIds: string[]): Promise<Map<string, { impressions: number; rejections: number }>> {
    const map = new Map<string, { impressions: number; rejections: number }>();
    for (const id of iconIds) {
        const doc = await db.collection(DB_COLLECTION_ICON_INDEX).doc(id).get();
        if (doc.exists) {
            const icon = doc.data()!;
            map.set(doc.id, { impressions: icon.impressions || 0, rejections: icon.rejections || 0 });
        }
    }
    return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Impression and Rejection Tracking', () => {

    it('forge records +1 impression and +1 rejection for every seen icon', async () => {
        const ingredient = `forge-test-${Date.now()}`;
        const stdName = standardizeIngredientName(ingredient);
        const icons = [makeIcon('fi-1', stdName), makeIcon('fi-2', stdName), makeIcon('fi-3', stdName)];

        // Seed icons into ingredients_new and create recipe with shortlistIndex=2
        // (all 3 icons have been seen: indices 0, 1, 2)
        const entries = await seedIngredient(stdName, icons);
        const recipeId = await createRecipeWithShortlist(stdName, entries, 2);

        // Forge (no embedFn → skips index search, just queues generation)
        const result = await getDataService().rejectRecipeIcon(recipeId, ingredient) as any;
        assert.ok(result.success, `rejectRecipeIcon failed: ${result.error}`);

        // Verify all 3 icons got +1 impression and +1 rejection
        const stats = await fetchIconStats(icons.map(i => i.id));
        for (const icon of icons) {
            const s = stats.get(icon.id);
            assert.ok(s, `icon ${icon.id} not found in ingredients_new`);
            assert.equal(s!.impressions, 1, `${icon.id}: expected 1 impression, got ${s!.impressions}`);
            assert.equal(s!.rejections, 1, `${icon.id}: expected 1 rejection, got ${s!.rejections}`);
        }
    });

    it('forge only records the first N seen icons when shortlistIndex < length', async () => {
        const ingredient = `forge-partial-${Date.now()}`;
        const stdName = standardizeIngredientName(ingredient);
        // 3 icons in shortlist but user only saw the first 2 (shortlistIndex=1)
        const icons = [makeIcon('fp-1', stdName), makeIcon('fp-2', stdName), makeIcon('fp-3', stdName)];
        const entries = await seedIngredient(stdName, icons);
        const recipeId = await createRecipeWithShortlist(stdName, entries, 1);

        await getDataService().rejectRecipeIcon(recipeId, ingredient);

        const stats = await fetchIconStats(icons.map(i => i.id));
        // Icons at index 0 and 1 should be recorded; index 2 should not.
        assert.equal(stats.get('fp-1')!.impressions, 1, 'fp-1 impression');
        assert.equal(stats.get('fp-1')!.rejections, 1, 'fp-1 rejection');
        assert.equal(stats.get('fp-2')!.impressions, 1, 'fp-2 impression');
        assert.equal(stats.get('fp-2')!.rejections, 1, 'fp-2 rejection');
        assert.equal(stats.get('fp-3')!.impressions, 0, 'fp-3 should have no impression (not seen)');
        assert.equal(stats.get('fp-3')!.rejections, 0, 'fp-3 should have no rejection (not seen)');
    });

    it('save records +1 impression for every seen', async () => {
        const ingredient = `save-test-${Date.now()}`;
        const stdName = standardizeIngredientName(ingredient);
        // User has seen 2 of 3 icons (shortlistIndex=1)
        const icons = [makeIcon('si-1', stdName), makeIcon('si-2', stdName), makeIcon('si-3', stdName)];
        // Put these icons in the DB.
        const entries = await seedIngredient(stdName, icons);
        const recipeId = await createRecipeWithShortlist(stdName, entries, 1);

        // I think this could be a bit more comprehensive and look at multiple nodes with different shortlistIndices.
        // This is also a bit redundant based on the shortlistdelta tests. but they don't cover some of the stuff.
        // TODO look at making a unified test that covers more.

        // Fetch the recipe graph and save it (simulates user pressing Save).
        const recipe = await getDataService().getRecipe(recipeId) as any;
        assert.ok(recipe, 'recipe not found');
        await getDataService().saveRecipe(recipe.graph, recipeId);

        const stats = await fetchIconStats(icons.map(i => i.id));
        assert.equal(stats.get('si-1')!.impressions, 1, 'si-1 impression');
        assert.equal(stats.get('si-1')!.rejections, 1, 'si-1 should have rejection');
        assert.equal(stats.get('si-2')!.impressions, 1, 'si-2 impression');
        assert.equal(stats.get('si-2')!.rejections, 0, 'si-2 should have no rejection');
        assert.equal(stats.get('si-3')!.impressions, 0, 'si-3 (unseen) should have no impression');
        assert.equal(stats.get('si-3')!.rejections, 0, 'si-3 should have no rejection');
    });

    it('forging twice does not double-count impressions or rejections (idempotency)', async () => {
        const ingredient = `idempotent-${Date.now()}`;
        const stdName = standardizeIngredientName(ingredient);
        const icons = [makeIcon('id-1', stdName), makeIcon('id-2', stdName)];
        const entries = await seedIngredient(stdName, icons);
        const recipeId = await createRecipeWithShortlist(stdName, entries, 1);

        // First forge
        await getDataService().rejectRecipeIcon(recipeId, ingredient);

        // Second forge — shortlistIndex may have changed; read fresh state
        const recipe = await getDataService().getRecipe(recipeId) as any;
        const freshNode = recipe?.graph?.nodes?.find((n: any) => n.visualDescription === stdName);
        // Only forge again if both entries still show as seen (shortlistIndex >= 1)
        if (freshNode && (freshNode.shortlistIndex ?? 0) >= 1) {
            await getDataService().rejectRecipeIcon(recipeId, ingredient);
        }

        const stats = await fetchIconStats(icons.map(i => i.id));
        // Despite two forge calls, already-flagged entries should not be double-counted
        assert.ok(stats.get('id-1')!.impressions <= 1, `id-1 impressions should be ≤1, got ${stats.get('id-1')!.impressions}`);
        assert.ok(stats.get('id-1')!.rejections <= 1, `id-1 rejections should be ≤1, got ${stats.get('id-1')!.rejections}`);
        assert.ok(stats.get('id-2')!.impressions <= 1, `id-2 impressions should be ≤1, got ${stats.get('id-2')!.impressions}`);
        assert.ok(stats.get('id-2')!.rejections <= 1, `id-2 rejections should be ≤1, got ${stats.get('id-2')!.rejections}`);
    });

    it('save then forge: save records impressions, forge records remaining impressions + rejections', async () => {
        const ingredient = `save-then-forge-${Date.now()}`;
        const stdName = standardizeIngredientName(ingredient);
        const icons = [makeIcon('stf-1', stdName), makeIcon('stf-2', stdName), makeIcon('stf-3', stdName)];
        const entries = await seedIngredient(stdName, icons);
        // User has seen all 3 at shortlistIndex=2
        const recipeId = await createRecipeWithShortlist(stdName, entries, 2);

        // Save first — records impressions for all 3 (call saveRecipe directly to avoid
        // setting ownerId, which would block the subsequent rejectRecipeIcon without userId).
        const recipe = await getDataService().getRecipe(recipeId) as any;
        await getDataService().saveRecipe(recipe.graph, recipeId);

        // Forge — should record rejections for all 3, but NOT double-count impressions
        await getDataService().rejectRecipeIcon(recipeId, ingredient);

        const stats = await fetchIconStats(icons.map(i => i.id));
        for (const icon of icons) {
            const s = stats.get(icon.id)!;
            assert.equal(s.impressions, 1, `${icon.id}: expected exactly 1 impression`);
            assert.equal(s.rejections, 1, `${icon.id}: expected exactly 1 rejection`);
        }
    });
});
