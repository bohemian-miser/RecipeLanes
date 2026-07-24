/*
 * Copyright (C) 2026 Bohemian Miser
 *
 * Emulator integration test for issue #217: server actions run with the Admin
 * SDK (Firestore rules do not apply), so authorization must happen in the
 * action. Covers applyIconSearchResultsAction (auth + ownership) and the
 * restored admin gate on getAllStorageFilesAction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyIconSearchResultsAction, getAllStorageFilesAction } from '../app/actions';
import { setAuthService, AuthSession } from '../lib/auth-service';
import { db } from '../lib/firebase-admin';
import { DB_COLLECTION_RECIPES } from '../lib/config';
import { standardizeIngredientName } from '../lib/utils';

class MockAuth {
    constructor(private user: AuthSession | null) {}
    async verifyAuth() { return this.user; }
}

const INGREDIENT = 'Carrot';
const STD_NAME = standardizeIngredientName(INGREDIENT);

function makeNode() {
    return { id: 'n1', laneId: 'l1', type: 'ingredient', text: INGREDIENT, visualDescription: INGREDIENT };
}

// results[].name must match standardizeIngredientName(node.visualDescription).
function makeResults() {
    return [{ name: STD_NAME, icons: [{ id: 'icon-1' } as any], matchScores: { 'icon-1': 0.9 } }];
}

async function seedRecipe(ownerId: string | undefined, nodes: any[]): Promise<string> {
    const payload: any = {
        graph: { title: 'test', lanes: [], nodes },
        visibility: 'private',
        created_at: new Date(),
    };
    if (ownerId !== undefined) payload.ownerId = ownerId;
    const doc = await db.collection(DB_COLLECTION_RECIPES).add(payload);
    return doc.id;
}

async function fetchNodes(recipeId: string): Promise<any[]> {
    const snap = await db.collection(DB_COLLECTION_RECIPES).doc(recipeId).get();
    return snap.data()?.graph?.nodes || [];
}

describe('applyIconSearchResultsAction authorization (issue #217)', () => {
    it('rejects a different logged-in user and leaves graph.nodes byte-identical', async () => {
        const recipeId = await seedRecipe('userA', [makeNode()]);
        const before = await fetchNodes(recipeId);

        setAuthService(new MockAuth({ uid: 'userB', isAdmin: false }));
        const res = await applyIconSearchResultsAction(recipeId, makeResults());

        assert.equal(res.success, false);
        const after = await fetchNodes(recipeId);
        assert.deepEqual(after, before);
        assert.equal(after[0].iconShortlist, undefined);
    });

    it('rejects an anonymous (no session) caller with "Login required"', async () => {
        const recipeId = await seedRecipe('userA', [makeNode()]);
        const before = await fetchNodes(recipeId);

        setAuthService(new MockAuth(null));
        const res = await applyIconSearchResultsAction(recipeId, makeResults());

        assert.equal(res.success, false);
        assert.equal(res.error, 'Login required');
        const after = await fetchNodes(recipeId);
        assert.deepEqual(after, before);
    });

    it('applies shortlists for the recipe owner', async () => {
        const recipeId = await seedRecipe('userA', [makeNode()]);

        setAuthService(new MockAuth({ uid: 'userA', isAdmin: false }));
        const res = await applyIconSearchResultsAction(recipeId, makeResults());

        assert.equal(res.success, true);
        assert.equal(res.applied, 1);
        const after = await fetchNodes(recipeId);
        assert.ok(Array.isArray(after[0].iconShortlist) && after[0].iconShortlist.length > 0);
    });

    it('stays writable for an anon-owned recipe (no ownerId) by any logged-in user', async () => {
        const recipeId = await seedRecipe(undefined, [makeNode()]);

        setAuthService(new MockAuth({ uid: 'someone-else', isAdmin: false }));
        const res = await applyIconSearchResultsAction(recipeId, makeResults());

        assert.equal(res.success, true);
        assert.equal(res.applied, 1);
        const after = await fetchNodes(recipeId);
        assert.ok(Array.isArray(after[0].iconShortlist) && after[0].iconShortlist.length > 0);
    });
});

describe('getAllStorageFilesAction admin gate (issue #217)', () => {
    it('returns null for a non-admin session', async () => {
        setAuthService(new MockAuth({ uid: 'plain-user', isAdmin: false }));
        const res = await getAllStorageFilesAction();
        assert.equal(res, null);
    });

    it('returns null for an anonymous (no session) caller', async () => {
        setAuthService(new MockAuth(null));
        const res = await getAllStorageFilesAction();
        assert.equal(res, null);
    });
});
