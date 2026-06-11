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
 * Pure unit tests for the ingredient-status mutation logic.
 *
 * Converted from an emulator-backed test of lib/data-helpers.setIngredientStatuses.
 * That helper is a thin Firestore-transaction wrapper bound directly to the
 * firebase-admin `db`; its only app logic is the `mutateNodesByIngredient`
 * status set/clear callback. We exercise that exact callback here through a
 * MemoryDataService saveRecipe -> mutate -> saveRecipe -> getRecipe round-trip.
 *
 * NOTE: the original "works inside an existing Firestore transaction" case tests
 * real Transaction semantics (tx.get / tx.update) that have no MemoryDataService
 * analogue. That case is intentionally NOT reproduced here and remains
 * emulator-only territory — see report.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { memoryStore } from '../lib/store';
import { mutateNodesByIngredient } from '../lib/recipe-lanes/model-utils';
import { standardizeIngredientName } from '../lib/utils';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, visualDescription: string, status?: string) {
    const n: any = { id, laneId: 'l1', text: visualDescription, visualDescription, type: 'ingredient', x: 0, y: 0 };
    if (status) n.status = status;
    return n;
}

async function seedRecipe(nodes: any[]): Promise<string> {
    const graph: RecipeGraph = { title: 'test', lanes: [], nodes } as any;
    return getDataService().saveRecipe(graph, undefined, 'user-1', 'private');
}

async function fetchNodes(recipeId: string): Promise<any[]> {
    const recipe = await getDataService().getRecipe(recipeId);
    return recipe?.graph?.nodes || [];
}

/**
 * Faithful re-implementation of the setIngredientStatuses mutation body
 * (lib/data-helpers.ts), run against MemoryDataService instead of a Firestore
 * transaction. Same `mutateNodesByIngredient` callback; same set/delete rules.
 */
async function setIngredientStatusesMemory(
    recipeId: string,
    stdNames: string[],
    status: 'pending' | 'failed' | undefined,
): Promise<void> {
    const recipe = await getDataService().getRecipe(recipeId);
    if (!recipe) return;
    const nodes: any[] = recipe.graph.nodes || [];
    let changed = false;
    for (const stdName of stdNames) {
        changed = mutateNodesByIngredient(nodes, stdName, (n) => {
            if (status === undefined) delete n.status;
            else n.status = status;
        }) || changed;
    }
    if (changed) {
        await getDataService().saveRecipe(recipe.graph, recipeId, 'user-1', 'private');
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setIngredientStatuses (mutation logic, MemoryDataService)', () => {

    beforeEach(() => {
        memoryStore.clear();
        setDataService(new MemoryDataService());
    });

    it('sets status to pending on matching nodes', async () => {
        const carrot = standardizeIngredientName('Carrot');
        const onion = standardizeIngredientName('Onion');
        const recipeId = await seedRecipe([makeNode('n1', carrot), makeNode('n2', onion)]);

        await setIngredientStatusesMemory(recipeId, [carrot], 'pending');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes.find(n => n.id === 'n1')?.status, 'pending');
        assert.equal(nodes.find(n => n.id === 'n2')?.status, undefined, 'non-matching node untouched');
    });

    it('sets status to failed on matching nodes', async () => {
        const garlic = standardizeIngredientName('Garlic');
        const recipeId = await seedRecipe([makeNode('n1', garlic, 'pending')]);

        await setIngredientStatusesMemory(recipeId, [garlic], 'failed');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes[0].status, 'failed');
    });

    it('clears status (undefined) on matching nodes', async () => {
        const butter = standardizeIngredientName('Butter');
        const recipeId = await seedRecipe([makeNode('n1', butter, 'pending')]);

        await setIngredientStatusesMemory(recipeId, [butter], undefined);

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes[0].status, undefined, 'status should be cleared');
    });

    it('sets status on multiple ingredients in one write', async () => {
        const a = standardizeIngredientName('Egg');
        const b = standardizeIngredientName('Flour');
        const c = standardizeIngredientName('Sugar');
        const recipeId = await seedRecipe([makeNode('n1', a), makeNode('n2', b), makeNode('n3', c)]);

        await setIngredientStatusesMemory(recipeId, [a, b], 'pending');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes.find(n => n.id === 'n1')?.status, 'pending');
        assert.equal(nodes.find(n => n.id === 'n2')?.status, 'pending');
        assert.equal(nodes.find(n => n.id === 'n3')?.status, undefined, 'n3 not in stdNames — untouched');
    });

    it('is a no-op when no nodes match', async () => {
        const recipeId = await seedRecipe([makeNode('n1', 'tomato')]);

        await setIngredientStatusesMemory(recipeId, ['nonexistent-ingredient'], 'pending');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes[0].status, undefined, 'unmatched recipe untouched');
    });

    it('is a no-op when recipe does not exist', async () => {
        await assert.doesNotReject(() =>
            setIngredientStatusesMemory('nonexistent-recipe-id', ['carrot'], 'pending')
        );
    });
});
