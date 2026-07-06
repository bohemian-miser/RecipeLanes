import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { FirebaseDataService } from '../lib/data-service';
import { setAIService } from '../lib/ai-service';
import { MockAIService } from '../lib/ai-service.mock';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { db } from '../lib/firebase-admin';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

/**
 * Issue #146: publishing a recipe anonymously must drop the owner's display
 * name everywhere it could surface — the stored doc AND the getRecipe
 * user-profile fallback — while still retaining ownerId. Runs against the
 * Firestore emulator via FirebaseDataService.
 */
describe('Anonymous publishing (Emulator, issue #146)', () => {
    let service: FirebaseDataService;

    const baseGraph = (): RecipeGraph => ({
        title: 'Anon Integration',
        lanes: [],
        nodes: [
            { id: 'n1', laneId: 'l1', text: 'Egg', visualDescription: 'Egg', type: 'ingredient', x: 0, y: 0 },
        ],
    });

    beforeEach(() => {
        service = new FirebaseDataService();
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
    });

    it('drops the owner name but retains ownerId when published anonymously', async () => {
        const id = await service.saveRecipe({ ...baseGraph(), anonymous: true }, undefined, 'user-anon-1', 'public', 'Ada Lovelace');
        const recipe = await service.getRecipe(id);
        assert.ok(recipe, 'recipe should exist');
        assert.strictEqual(recipe!.ownerId, 'user-anon-1', 'ownerId must be retained');
        assert.ok(!recipe!.ownerName, `ownerName should be hidden, got ${recipe!.ownerName}`);

        // The name must not be retained in the stored doc either (privacy at rest).
        const raw = (await db.collection('recipes').doc(id).get()).data();
        assert.ok(!raw?.ownerName, `stored ownerName should be blank, got ${raw?.ownerName}`);
    });

    it('keeps the byline when not anonymous', async () => {
        const id = await service.saveRecipe({ ...baseGraph() }, undefined, 'user-named-1', 'public', 'Grace Hopper');
        const recipe = await service.getRecipe(id);
        assert.ok(recipe);
        assert.strictEqual(recipe!.ownerName, 'Grace Hopper');
    });

    it('does not resurface the user-profile name for anonymous recipes', async () => {
        // getRecipe normally falls back to users/{ownerId} when ownerName is blank;
        // that fallback must be skipped for anonymously-published recipes.
        const uid = 'user-profile-1';
        await db.collection('users').doc(uid).set({ name: 'Real Name Person' });

        const id = await service.saveRecipe({ ...baseGraph(), anonymous: true }, undefined, uid, 'public', 'Real Name Person');
        const recipe = await service.getRecipe(id);
        assert.ok(recipe);
        assert.ok(!recipe!.ownerName, `profile fallback must not leak the name, got ${recipe!.ownerName}`);
    });

    it('clears a previously-saved name when toggled to anonymous (merge write)', async () => {
        const uid = 'user-toggle-1';
        const id = await service.saveRecipe({ ...baseGraph() }, undefined, uid, 'public', 'Named Author');
        let recipe = await service.getRecipe(id);
        assert.strictEqual(recipe!.ownerName, 'Named Author', 'precondition: starts named');

        // Re-save the same recipe (merge) as anonymous.
        await service.saveRecipe({ ...baseGraph(), anonymous: true }, id, uid, 'public', 'Named Author');
        recipe = await service.getRecipe(id);
        assert.ok(!recipe!.ownerName, 'toggling anonymous must clear the byline');
        assert.strictEqual(recipe!.ownerId, uid, 'ownership must be retained');

        const raw = (await db.collection('recipes').doc(id).get()).data();
        assert.ok(!raw?.ownerName, `merge write should have blanked the stored name, got ${raw?.ownerName}`);
    });
});
