import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// Mock Graph
const mockGraph: RecipeGraph = {
    title: "Test Recipe",
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'visual', type: 'action', x: 0, y: 0 }],
};

describe('Gallery View (Memory)', () => {
    let service: any;

    beforeEach(() => {
        setDataService(new MemoryDataService());
        service = getDataService();
    });

    it('should filter public and vetted recipes correctly', async () => {
        const pubId = await service.saveRecipe({ ...mockGraph, title: 'Public 1' }, undefined, 'u1', 'public');
        await service.vetRecipe(pubId, true);

        await service.saveRecipe({ ...mockGraph, title: 'Private 1' }, undefined, 'u1', 'private');
        await service.saveRecipe({ ...mockGraph, title: 'Unlisted 1' }, undefined, 'u1', 'unlisted');

        const publicRecipes = await service.getPublicRecipes(10);
        const titles = publicRecipes.map((r: any) => r.title);
        
        assert.ok(titles.includes('Public 1'));
        assert.ok(!titles.includes('Private 1'));
        assert.ok(!titles.includes('Unlisted 1'));
    });

    it('should hide unvetted recipes from public view', async () => {
        await service.saveRecipe({ ...mockGraph, title: 'Public Unvetted' }, undefined, 'u1', 'public');
        const publicRecipes = await service.getPublicRecipes(10);
        const titles = publicRecipes.map((r: any) => r.title);
        assert.ok(!titles.includes('Public Unvetted'));
    });

    it('should filter recipes by user', async () => {
        await service.saveRecipe({ ...mockGraph, title: 'My Public' }, undefined, 'me', 'public');
        await service.saveRecipe({ ...mockGraph, title: 'My Private' }, undefined, 'me', 'private');
        await service.saveRecipe({ ...mockGraph, title: 'Other Public' }, undefined, 'other', 'public');

        const myRecipes = await service.getUserRecipes('me');
        const myTitles = myRecipes.map((r: any) => r.title);

        assert.ok(myTitles.includes('My Public'));
        assert.ok(myTitles.includes('My Private'));
        assert.ok(!myTitles.includes('Other Public'));
    });

    it('should handle starred recipes', async () => {
        const id1 = await service.saveRecipe({ ...mockGraph, title: 'Starred One' }, undefined, 'other', 'public');
        await service.toggleStar(id1, 'me');

        const starred = await service.getStarredRecipes('me');
        assert.strictEqual(starred.length, 1);
        assert.strictEqual(starred[0].title, 'Starred One');
    });
});
