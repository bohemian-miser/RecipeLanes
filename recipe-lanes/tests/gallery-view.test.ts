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

    // Backs the gallery `?filter=source&sourceId=...` view (issue #11): the
    // "Existing Copies" banner links here, and the gallery delegates to
    // checkExistingCopies to show only the current user's copies of a source.
    it('should filter my copies of a given source recipe (issue #11)', async () => {
        const sourceId = 'src-1';
        await service.saveRecipe({ ...mockGraph, title: 'My Copy A', sourceId }, undefined, 'me', 'private');
        await service.saveRecipe({ ...mockGraph, title: 'My Copy B', sourceId }, undefined, 'me', 'private');
        // A copy of a different source — must not appear.
        await service.saveRecipe({ ...mockGraph, title: 'Copy Of Other Source', sourceId: 'src-2' }, undefined, 'me', 'private');
        // Another user's copy of the same source — must not appear.
        await service.saveRecipe({ ...mockGraph, title: 'Their Copy', sourceId }, undefined, 'someone-else', 'private');
        // An unrelated recipe with no sourceId — must not appear.
        await service.saveRecipe({ ...mockGraph, title: 'Not A Copy' }, undefined, 'me', 'private');

        const copies = await service.checkExistingCopies(sourceId, 'me');
        const titles = copies.map((r: any) => r.title);

        assert.strictEqual(copies.length, 2);
        assert.ok(titles.includes('My Copy A'));
        assert.ok(titles.includes('My Copy B'));
        assert.ok(!titles.includes('Copy Of Other Source'));
        assert.ok(!titles.includes('Their Copy'));
        assert.ok(!titles.includes('Not A Copy'));
    });

    it('should return no copies for a source that has none (issue #11)', async () => {
        await service.saveRecipe({ ...mockGraph, title: 'Solo', sourceId: 'src-9' }, undefined, 'me', 'private');
        const copies = await service.checkExistingCopies('src-does-not-exist', 'me');
        assert.strictEqual(copies.length, 0);
    });

    it('should handle starred recipes', async () => {
        const id1 = await service.saveRecipe({ ...mockGraph, title: 'Starred One' }, undefined, 'other', 'public');
        await service.toggleStar(id1, 'me');

        const starred = await service.getStarredRecipes('me');
        assert.strictEqual(starred.length, 1);
        assert.strictEqual(starred[0].title, 'Starred One');
    });
});
