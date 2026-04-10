import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { FirebaseDataService } from '../lib/data-service';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { db } from '../lib/firebase-admin';

/**
 * Integration test for the Hybrid Search plumbing in FirebaseDataService.
 * This runs against the Firestore emulator.
 */
describe('Hybrid Search Integration (Emulator)', () => {
    let service: FirebaseDataService;

    beforeEach(async () => {
        service = new FirebaseDataService();
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
    });

    it('resolveRecipeIcons calls the provided searchFn and merges results', async () => {
        // 0. Seed a mock icon in the index
        const iconId = 'fast-icon-1';
        await db.collection('icon_index').doc(iconId).set({
            ingredient_name: 'Egg',
            visualDescription: 'Egg',
            embedding: new Array(384).fill(0.1)
        });

        // 1. Create a dummy recipe
        const recipeId = 'test-hybrid-' + Date.now();
        const recipeRef = db.collection('recipes').doc(recipeId);
        await recipeRef.set({
            graph: {
                nodes: [
                    { id: 'n1', text: 'Egg', visualDescription: 'Egg', type: 'ingredient' }
                ]
            }
        });

        // 2. Define a searchFn that returns a mock result
        const mockSearchFn = async (texts: string[]) => {
            return {
                embedding: new Array(384).fill(0.1),
                fast_matches: [{ icon_id: iconId, score: 0.99 }]
            };
        };

        // 3. Trigger resolution
        await service.resolveRecipeIcons(recipeId, mockSearchFn);

        // 4. Verify that the node now has a shortlist
        const doc = await recipeRef.get();
        const node = doc.data()?.graph?.nodes[0];
        
        assert.ok(node.iconShortlist, 'Node should have a shortlist');
        assert.strictEqual(node.iconShortlist[0].icon.id, iconId);
    });

    it('falls back to findNearest when fast_matches is empty (Legacy Mode)', async () => {
        // 0. Seed a mock icon in the index with a specific embedding
        const legacyIconId = 'legacy-icon-1';
        const legacyEmbedding = new Array(768).fill(0.2); // 768d for legacy
        await db.collection('icon_index').doc(legacyIconId).set({
            ingredient_name: 'Bacon',
            visualDescription: 'Bacon',
            embedding: legacyEmbedding
        });

        // 1. Create a dummy recipe
        const recipeId = 'test-legacy-' + Date.now();
        const recipeRef = db.collection('recipes').doc(recipeId);
        await recipeRef.set({
            graph: {
                nodes: [
                    { id: 'n1', text: 'Bacon', visualDescription: 'Bacon', type: 'ingredient' }
                ]
            }
        });

        // 2. Define a searchFn simulating legacy mode (empty fast_matches, 768d embedding)
        const mockSearchFn = async (texts: string[]) => {
            return {
                embedding: legacyEmbedding,
                fast_matches: [] // Force fallback to findNearest
            };
        };

        // Give the Firestore emulator vector index a moment to update
        // Note: Emulators can be flaky building vector indexes synchronously. 
        // We'll mock the actual `searchIconsByEmbedding` call just to prove the fallback logic routes correctly.
        const originalSearch = service.searchIconsByEmbedding.bind(service);
        let fallbackCalled = false;
        service.searchIconsByEmbedding = async (vec, limit) => {
            fallbackCalled = true;
            return [{
                id: legacyIconId,
                visualDescription: 'Bacon',
                score: 0.99
            }];
        };

        // 3. Trigger resolution
        await service.resolveRecipeIcons(recipeId, mockSearchFn);

        // Restore
        service.searchIconsByEmbedding = originalSearch;

        // 4. Verify that the node found the icon via the fallback
        const doc = await recipeRef.get();
        const node = doc.data()?.graph?.nodes[0];
        
        assert.ok(fallbackCalled, 'searchIconsByEmbedding should have been called as a fallback');
        assert.ok(node.iconShortlist, 'Node should have a shortlist from legacy pass');
        assert.strictEqual(node.iconShortlist[0].icon.id, legacyIconId);
    });
});
