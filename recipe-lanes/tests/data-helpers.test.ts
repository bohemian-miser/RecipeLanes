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
 * Unit tests for lib/data-helpers.ts — runs against the Firestore emulator.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/firebase-admin';
import { DB_COLLECTION_RECIPES } from '../lib/config';
import { setIngredientStatuses } from '../lib/data-helpers';
import { standardizeIngredientName } from '../lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, visualDescription: string, status?: string) {
    const n: any = { id, laneId: 'l1', text: visualDescription, visualDescription, type: 'ingredient' };
    if (status) n.status = status;
    return n;
}

async function seedRecipe(nodes: any[]): Promise<string> {
    const doc = await db.collection(DB_COLLECTION_RECIPES).add({
        graph: { title: 'test', lanes: [], nodes },
        visibility: 'private',
        created_at: new Date(),
    });
    return doc.id;
}

async function fetchNodes(recipeId: string): Promise<any[]> {
    const doc = await db.collection(DB_COLLECTION_RECIPES).doc(recipeId).get();
    return doc.data()?.graph?.nodes || [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setIngredientStatuses', () => {

    it('sets status to pending on matching nodes', async () => {
        const carrot = standardizeIngredientName('Carrot');
        const onion = standardizeIngredientName('Onion');
        const recipeId = await seedRecipe([makeNode('n1', carrot), makeNode('n2', onion)]);

        await setIngredientStatuses(recipeId, [carrot], 'pending');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes.find(n => n.id === 'n1')?.status, 'pending');
        assert.equal(nodes.find(n => n.id === 'n2')?.status, undefined, 'non-matching node untouched');
    });

    it('sets status to failed on matching nodes', async () => {
        const garlic = standardizeIngredientName('Garlic');
        const recipeId = await seedRecipe([makeNode('n1', garlic, 'pending')]);

        await setIngredientStatuses(recipeId, [garlic], 'failed');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes[0].status, 'failed');
    });

    it('clears status (undefined) on matching nodes', async () => {
        const butter = standardizeIngredientName('Butter');
        const recipeId = await seedRecipe([makeNode('n1', butter, 'pending')]);

        await setIngredientStatuses(recipeId, [butter], undefined);

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes[0].status, undefined, 'status should be cleared');
    });

    it('sets status on multiple ingredients in one write', async () => {
        const a = standardizeIngredientName('Egg');
        const b = standardizeIngredientName('Flour');
        const c = standardizeIngredientName('Sugar');
        const recipeId = await seedRecipe([makeNode('n1', a), makeNode('n2', b), makeNode('n3', c)]);

        await setIngredientStatuses(recipeId, [a, b], 'pending');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes.find(n => n.id === 'n1')?.status, 'pending');
        assert.equal(nodes.find(n => n.id === 'n2')?.status, 'pending');
        assert.equal(nodes.find(n => n.id === 'n3')?.status, undefined, 'n3 not in stdNames — untouched');
    });

    it('is a no-op when no nodes match', async () => {
        const recipeId = await seedRecipe([makeNode('n1', 'tomato')]);

        await setIngredientStatuses(recipeId, ['nonexistent-ingredient'], 'pending');

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes[0].status, undefined, 'unmatched recipe untouched');
    });

    it('is a no-op when recipe does not exist', async () => {
        await assert.doesNotReject(() =>
            setIngredientStatuses('nonexistent-recipe-id', ['carrot'], 'pending')
        );
    });

    it('works inside an existing transaction', async () => {
        const pepper = standardizeIngredientName('Pepper');
        const recipeId = await seedRecipe([makeNode('n1', pepper)]);

        await db.runTransaction(async (t) => {
            await setIngredientStatuses(recipeId, [pepper], 'pending', t);
        });

        const nodes = await fetchNodes(recipeId);
        assert.equal(nodes[0].status, 'pending');
    });
});
