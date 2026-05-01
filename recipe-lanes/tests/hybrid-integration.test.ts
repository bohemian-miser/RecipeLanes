import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { FirebaseDataService } from '../lib/data-service';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { db } from '../lib/firebase-admin';

/**
 * Integration test for the Search plumbing in FirebaseDataService.
 * This runs against the Firestore emulator.
 */
describe('Search Integration (Emulator)', () => {
    let service: FirebaseDataService;

    beforeEach(async () => {
        service = new FirebaseDataService();
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
    });

    it('resolveRecipeIcons calls the provided searchFn and applies hydrated results', async () => {
        const iconId = 'fast-icon-1';

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

        // 2. Define a batch search fn that returns a mock hydrated result
        const mockBatchSearchFn = async (ingredients: { name: string, queries: string[] }[], _limit: number) => {
            return ingredients.map(ing => ({
                name: ing.name,
                icons: [{
                    id: iconId,
                    visualDescription: 'Egg',
                    score: 0,
                    impressions: 0,
                    rejections: 0
                }],
                matchScores: { [iconId]: 0.99 }
            }));
        };

        // 3. Trigger resolution
        await service.resolveRecipeIcons(recipeId, mockBatchSearchFn);

        // 4. Verify that the node now has a shortlist
        const doc = await recipeRef.get();
        const node = doc.data()?.graph?.nodes[0];
        
        assert.ok(node.iconShortlist, 'Node should have a shortlist');
        assert.strictEqual(node.iconShortlist[0].icon.id, iconId);
        assert.strictEqual(node.iconShortlist[0].matchScore, 0.99);
    });
});
