import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { memoryStore } from '../lib/store';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { saveRecipeAction } from '../app/actions';

const baseGraph: any = {
    title: 'Original Title',
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', type: 'action', x: 0, y: 0 }],
};

describe('Title Persistence', () => {
    beforeEach(() => {
        memoryStore.clear();
        setDataService(new MemoryDataService());
        setAuthService(new MockAuthService({ uid: 'user-1', email: 'u@test.com', name: 'User 1', isAdmin: false }));
    });

    it('saves a new recipe with a title', async () => {
        const res = await saveRecipeAction({ ...baseGraph, title: 'My Recipe' });
        assert.ok(res.id, 'should return an id');
        const saved = await getDataService().getRecipe(res.id!);
        assert.strictEqual(saved?.graph.title, 'My Recipe');
    });

    it('persists a title update when owner saves existing recipe', async () => {
        // Create initial recipe as user-1
        const { id } = await saveRecipeAction({ ...baseGraph, title: 'Old Title' });
        assert.ok(id);

        // Update the title
        const update = await saveRecipeAction({ ...baseGraph, title: 'New Title' }, id);
        assert.ok(!update.error, `unexpected error: ${update.error}`);

        const saved = await getDataService().getRecipe(id!);
        assert.strictEqual(saved?.graph.title, 'New Title', 'title should be updated in DB');
    });

    it('returns an error (not throws) when non-owner tries to overwrite', async () => {
        // Create as user-1
        const { id } = await saveRecipeAction({ ...baseGraph });
        assert.ok(id);

        // Switch to user-2 and try to save over user-1's recipe
        setAuthService(new MockAuthService({ uid: 'user-2', email: 'u2@test.com', name: 'User 2', isAdmin: false }));
        const res = await saveRecipeAction({ ...baseGraph, title: 'Hijacked Title' }, id);

        assert.ok(res.error, 'should return an error for non-owner save');
        assert.ok(!res.id, 'should not return an id on failure');

        // Original title should be unchanged
        const saved = await getDataService().getRecipe(id!);
        assert.strictEqual(saved?.graph.title, 'Original Title');
    });

    it('returns an error when unauthenticated user tries to overwrite an owned recipe', async () => {
        // Create as user-1
        const { id } = await saveRecipeAction({ ...baseGraph });
        assert.ok(id);

        // Switch to unauthenticated
        setAuthService(new MockAuthService(null));
        const res = await saveRecipeAction({ ...baseGraph, title: 'Unauthenticated Title' }, id);

        assert.ok(res.error, 'should return an error');

        const saved = await getDataService().getRecipe(id!);
        assert.strictEqual(saved?.graph.title, 'Original Title', 'title should not have changed');
    });

    it('title update does not clobber other graph data', async () => {
        const graphWithNodes: any = {
            title: 'Original',
            lanes: [{ id: 'l1', title: 'Main' }],
            nodes: [
                { id: 'n1', laneId: 'l1', text: 'Chop onions', type: 'action', x: 0, y: 0 },
                { id: 'n2', laneId: 'l1', text: 'Fry pan', type: 'action', x: 0, y: 100 },
            ],
        };
        const { id } = await saveRecipeAction(graphWithNodes);
        assert.ok(id);

        // Save with just a title change (same nodes)
        const res = await saveRecipeAction({ ...graphWithNodes, title: 'Updated Title' }, id);
        assert.ok(!res.error);

        const saved = await getDataService().getRecipe(id!);
        assert.strictEqual(saved?.graph.title, 'Updated Title');
        assert.strictEqual(saved?.graph.nodes.length, 2, 'nodes should be preserved');
        assert.strictEqual(saved?.graph.nodes[0].text, 'Chop onions');
    });
});
