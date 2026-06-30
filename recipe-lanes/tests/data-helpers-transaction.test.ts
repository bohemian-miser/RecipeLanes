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
 * Emulator-backed integration test for lib/data-helpers.setIngredientStatuses.
 *
 * This covers the one case that cannot be reproduced against MemoryDataService:
 * running setIngredientStatuses inside an existing Firestore transaction
 * (real tx.get / tx.update semantics). The emulator-independent cases live in
 * tests/data-helpers.test.ts (pure tier). Requires the Firestore emulator;
 * wired into the integration tier via scripts/test-unit-integration.sh.
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

describe('setIngredientStatuses (Firestore transaction)', () => {

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
