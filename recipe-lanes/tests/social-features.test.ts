import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// Mock Graph
const mockGraph: RecipeGraph = {
    title: "Test Recipe",
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'Step 1', type: 'action', x: 0, y: 0 }],
    layouts: {
        'swimlanes': [{ id: '1', x: 10, y: 10 }],
        'dagre': [{ id: '1', x: 20, y: 20 }]
    }
};

describe('Social Features (Memory)', () => {
    let service: any;

    beforeEach(() => {
        setDataService(new MemoryDataService());
        service = getDataService();
    });

    it('should handle ownership and visibility', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'user-123', 'public');
        const recipe1 = await service.getRecipe(id1);
        
        assert.ok(recipe1, "Recipe should be saved");
        assert.strictEqual(recipe1.ownerId, 'user-123', "Owner ID mismatch");
        assert.strictEqual(recipe1.visibility, 'public', "Visibility mismatch");
    });

    it('should filter public and vetted recipes', async () => {
        const pubId = await service.saveRecipe({ ...mockGraph, title: 'Public One' }, undefined, 'u1', 'public');
        await service.vetRecipe(pubId, true);

        await service.saveRecipe({ ...mockGraph, title: 'Private One' }, undefined, 'u1', 'unlisted');

        const publicRecipes = await service.getPublicRecipes(10);
        const titles = publicRecipes.map((r: any) => r.title);
        assert.ok(titles.includes('Public One'), "Should find public vetted recipe");
        assert.ok(!titles.includes('Private One'), "Should NOT find unlisted recipe");
    });

    it('should search public recipes by title and content', async () => {
        const spagId = await service.saveRecipe({ ...mockGraph, title: 'Spaghetti Bolognese' }, undefined, 'u1', 'public');
        await service.vetRecipe(spagId, true);
        
        const results = await service.searchPublicRecipes('Spaghetti');
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].title, 'Spaghetti Bolognese');

        // Search by content (Node text)
        const contentResults = await service.searchPublicRecipes('Step 1');
        assert.ok(contentResults.length >= 1);
    });

    it('should track likes and dislikes', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'u1', 'public');
        
        // User 1 Likes
        await service.voteRecipe(id1, 'user-1', 'like');
        let r = await service.getRecipe(id1);
        assert.strictEqual(r?.stats?.likes, 1);

        // User 1 Likes again (No change)
        await service.voteRecipe(id1, 'user-1', 'like');
        r = await service.getRecipe(id1);
        assert.strictEqual(r?.stats?.likes, 1);

        // User 1 Dislikes (Switch)
        await service.voteRecipe(id1, 'user-1', 'dislike');
        r = await service.getRecipe(id1);
        assert.strictEqual(r?.stats?.likes, 0);
        assert.strictEqual(r?.stats?.dislikes, 1);
    });

    it('should handle starring recipes', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'u1', 'public');
        
        const isStarred = await service.toggleStar(id1, 'user-1');
        assert.strictEqual(isStarred, true);

        const starred = await service.getStarredRecipes('user-1');
        assert.strictEqual(starred.length, 1);
        assert.strictEqual(starred[0].id, id1);

        // Unstar
        const isStarred2 = await service.toggleStar(id1, 'user-1');
        assert.strictEqual(isStarred2, false);
        
        const starred2 = await service.getStarredRecipes('user-1');
        assert.strictEqual(starred2.length, 0);
    });

    it('should support copying recipes', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'u1', 'public');
        const newId = await service.copyRecipe(id1, 'copier');
        const copy = await service.getRecipe(newId);
        
        assert.strictEqual(copy?.ownerId, 'copier');
        assert.ok(copy?.graph.title?.includes('(Copy)'));
        assert.strictEqual(copy?.visibility, 'unlisted');
    });
});
