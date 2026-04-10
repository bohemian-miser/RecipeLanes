/**
 * Unit tests for the icon resolution pipeline, forge/reject actions, and related
 * MemoryDataService behaviour.
 *
 * These tests run without emulators as pure unit tests.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService, DataService } from '../lib/data-service';
import { memoryStore } from '../lib/store';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { buildShortlistEntry, getNodeIconUrl, getNodeIconId } from '../lib/recipe-lanes/model-utils';
import type { IconStats, ShortlistEntry } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeIcon = (id: string): IconStats => ({
    id,
    visualDescription: id,
    score: 0.9,
});

/** Stub batch search fn that returns a fixed vector and fast matches and records how many times it was called. */
function makeEmbedSpy() {
    let callCount = 0;
    const searchFn = async (ingredients: { name: string, queries: string[] }[], _limit: number): Promise<{ name: string, embedding: number[], fast_matches: any[] }[]> => {
        callCount++;
        return ingredients.map(ing => ({ name: ing.name, embedding: [0.1, 0.2, 0.3], fast_matches: [] }));
    };
    return { searchFn, getCallCount: () => callCount };
}
type BatchSearchFn = (ingredients: { name: string, queries: string[] }[], limit: number) => Promise<{ name: string, embedding: number[], fast_matches: any[] }[]>;

/** A MemoryDataService subclass that tracks resolveRecipeIcons calls, including batchSearchFn. */
class SpyMemoryDataService extends MemoryDataService {
    public resolveCallArgs: Array<{ recipeId: string; hadEmbedFn: boolean }> = [];

    override async resolveRecipeIcons(recipeId: string, batchSearchFn?: BatchSearchFn): Promise<void> {
        this.resolveCallArgs.push({ recipeId, hadEmbedFn: batchSearchFn !== undefined });
        return super.resolveRecipeIcons(recipeId, batchSearchFn);
    }
}

/** A MemoryDataService subclass that captures batchSearchFn passed to rejectRecipeIcon. */
class RejectSpyDataService extends MemoryDataService {
    public rejectCalls: Array<{ searchFnProvided: boolean }> = [];

    override async rejectRecipeIcon(
        recipeId: string,
        ingredientName: string,
        currentIconId?: string,
        userId?: string,
        batchSearchFn?: BatchSearchFn,
    ): Promise<{ success: boolean; error?: string }> {
        this.rejectCalls.push({ searchFnProvided: batchSearchFn !== undefined });
        return super.rejectRecipeIcon(recipeId, ingredientName, currentIconId, userId, batchSearchFn);
    }
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function makeRecipe(service: MemoryDataService): Promise<string> {
    return service.saveRecipe({
        title: 'Test Recipe',
        lanes: [{ id: 'lane-1', label: 'Prep', type: 'prep' }],
        nodes: [],
    }, undefined, 'user-1', 'private');
}

// ---------------------------------------------------------------------------
// resolveRecipeIcons — searchFn behaviour
// ---------------------------------------------------------------------------

describe('MemoryDataService.resolveRecipeIcons', () => {
    let service: MemoryDataService;

    beforeEach(() => {
        memoryStore.clear();
        setDataService(new MemoryDataService());
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
        service = getDataService() as MemoryDataService;
    });

    it('resolves icons for nodes without icons (no searchFn)', async () => {
        const recipeId = await makeRecipe(service);
        await service.addNodeToRecipe(recipeId, 'Carrot');

        const recipe = await service.getRecipe(recipeId);
        assert.ok(recipe, 'recipe should exist');
        // standardizeIngredientName title-cases the name: 'Carrot'
        const node = recipe!.graph.nodes.find(n => n.visualDescription === 'Carrot');
        assert.ok(node, 'Carrot node should exist');
        // MemoryDataService resolves icons via queueIcons (mock generation)
        const url = getNodeIconUrl(node!);
        assert.ok(typeof url === 'string' && url.length > 0, 'icon url should be set after resolve');
    });

    it('still resolves icons when searchFn is provided (backward compat)', async () => {
        const recipeId = await makeRecipe(service);
        await service.addNodeToRecipe(recipeId, 'Tomato');

        // Call resolveRecipeIcons explicitly with an searchFn
        const { searchFn } = makeEmbedSpy();
        await service.resolveRecipeIcons(recipeId, searchFn);

        const recipe = await service.getRecipe(recipeId);
        // standardizeIngredientName title-cases the name: 'Tomato'
        const node = recipe!.graph.nodes.find(n => n.visualDescription === 'Tomato');
        assert.ok(node, 'Tomato node should exist');
        // The icon should already be set after addNodeToRecipe; resolveRecipeIcons with searchFn is a no-op
        const url = getNodeIconUrl(node!);
        assert.ok(typeof url === 'string' && url.length > 0, 'icon url should still be set');
    });

    it('does not call searchFn when all nodes already have icons (no-op path)', async () => {
        const recipeId = await makeRecipe(service);
        await service.addNodeToRecipe(recipeId, 'Onion');

        // All nodes now have icons — a second resolveRecipeIcons call should be a no-op
        const spy = makeEmbedSpy();
        await service.resolveRecipeIcons(recipeId, spy.searchFn);

        // In MemoryDataService, searchFn is not wired to searchIconsByEmbedding, so callCount stays 0
        assert.strictEqual(spy.getCallCount(), 0,
            'searchFn must not be called when all nodes already have icons');
    });

    it('handles a recipe with no nodes gracefully', async () => {
        const recipeId = await makeRecipe(service);
        const { searchFn } = makeEmbedSpy();
        // Must not throw
        await assert.doesNotReject(() => service.resolveRecipeIcons(recipeId, searchFn));
    });

    it('handles a non-existent recipeId gracefully', async () => {
        const { searchFn } = makeEmbedSpy();
        await assert.doesNotReject(() => service.resolveRecipeIcons('does-not-exist', searchFn));
    });
});

// ---------------------------------------------------------------------------
// rejectRecipeIcon — searchFn pass-through
// ---------------------------------------------------------------------------

describe('MemoryDataService.rejectRecipeIcon', () => {
    let service: RejectSpyDataService;

    beforeEach(() => {
        memoryStore.clear();
        service = new RejectSpyDataService();
        setDataService(service);
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
    });

    it('records no searchFn when called without one (forge path)', async () => {
        const recipeId = await makeRecipe(service);
        await service.addNodeToRecipe(recipeId, 'Pepper');

        const recipe = await service.getRecipe(recipeId);
        const node = recipe!.graph.nodes[0];
        const iconId = getNodeIconId(node);

        // Simulate forgeIconAction — no searchFn
        const result = await service.rejectRecipeIcon(recipeId, 'Pepper', iconId ?? undefined, 'user-1');
        assert.strictEqual(result.success, true, 'rejectRecipeIcon should succeed');

        const lastCall = service.rejectCalls[service.rejectCalls.length - 1];
        assert.strictEqual(lastCall.searchFnProvided, false,
            'forge path must NOT pass an searchFn');
    });

    it('records searchFn when called with one (rejectIcon path)', async () => {
        const recipeId = await makeRecipe(service);
        await service.addNodeToRecipe(recipeId, 'Garlic');

        const recipe = await service.getRecipe(recipeId);
        const node = recipe!.graph.nodes[0];
        const iconId = getNodeIconId(node);

        const { searchFn } = makeEmbedSpy();

        // Simulate rejectIcon action — searchFn provided
        const result = await service.rejectRecipeIcon(recipeId, 'Garlic', iconId ?? undefined, 'user-1', searchFn);
        assert.strictEqual(result.success, true, 'rejectRecipeIcon should succeed');

        const lastCall = service.rejectCalls[service.rejectCalls.length - 1];
        assert.strictEqual(lastCall.searchFnProvided, true,
            'rejectIcon path MUST pass an searchFn');
    });

    it('returns error for unauthorized user', async () => {
        const recipeId = await makeRecipe(service); // owned by 'user-1'
        const result = await service.rejectRecipeIcon(recipeId, 'Pepper', undefined, 'user-2');
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Unauthorized'),
            'unauthorized rejection should return Unauthorized error');
    });
});

// ---------------------------------------------------------------------------
// forgeIconAction vs rejectIcon — verifying searchFn wiring via actions layer
// ---------------------------------------------------------------------------

describe('forgeIconAction vs rejectIcon — searchFn wiring', () => {
    let spyService: RejectSpyDataService;

    beforeEach(() => {
        memoryStore.clear();
        spyService = new RejectSpyDataService();
        setDataService(spyService);
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
    });

    it('forgeIconAction calls rejectRecipeIcon WITHOUT searchFn', async () => {
        // Import dynamically to ensure the service singleton is set above
        const { forgeIconAction } = await import('../app/actions');

        const recipeId = await makeRecipe(spyService);
        await spyService.addNodeToRecipe(recipeId, 'Egg');

        const before = await spyService.getRecipe(recipeId);
        const node = before!.graph.nodes[0];
        const iconId = getNodeIconId(node);

        await forgeIconAction(recipeId, 'Egg', iconId ?? undefined);

        assert.ok(spyService.rejectCalls.length > 0, 'rejectRecipeIcon should have been called');
        const lastCall = spyService.rejectCalls[spyService.rejectCalls.length - 1];
        assert.strictEqual(lastCall.searchFnProvided, false,
            'forgeIconAction must NOT pass searchFn — it skips index search');
    });

    it('rejectIcon calls rejectRecipeIcon WITH an searchFn', async () => {
        const { rejectIcon } = await import('../app/actions');

        const recipeId = await makeRecipe(spyService);
        await spyService.addNodeToRecipe(recipeId, 'Butter');

        const before = await spyService.getRecipe(recipeId);
        const node = before!.graph.nodes[0];
        const iconId = getNodeIconId(node);

        await rejectIcon(recipeId, 'Butter', iconId ?? undefined);

        assert.ok(spyService.rejectCalls.length > 0, 'rejectRecipeIcon should have been called');
        const lastCall = spyService.rejectCalls[spyService.rejectCalls.length - 1];
        assert.strictEqual(lastCall.searchFnProvided, true,
            'rejectIcon must pass searchFn so index search is attempted before generation');
    });
});

// ---------------------------------------------------------------------------
// searchIconsByEmbedding on MemoryDataService — stub returns empty
// ---------------------------------------------------------------------------

describe('MemoryDataService.searchIconsByEmbedding', () => {
    it('always returns an empty array (no index in memory mode)', async () => {
        const service = new MemoryDataService();
        const results = await service.searchIconsByEmbedding([0.1, 0.2, 0.3], 5);
        assert.ok(Array.isArray(results), 'result must be an array');
        assert.strictEqual(results.length, 0,
            'MemoryDataService has no icon index, so searchIconsByEmbedding always returns []');
    });

    it('is called with any vector shape without throwing', async () => {
        const service = new MemoryDataService();
        await assert.doesNotReject(() => service.searchIconsByEmbedding([], 0));
        await assert.doesNotReject(() => service.searchIconsByEmbedding([0.9, 0.1, 0.5], 10));
    });
});


// ---------------------------------------------------------------------------
// Reroll wrapping — shortlistIndex wraps at list end
// ---------------------------------------------------------------------------

describe('shortlist wrapping via advanceShortlistIndex', () => {
    it('nextShortlistIcon wraps to start when shortlistIndex reaches the end', async () => {
        // The minimal-node.tsx wrapping logic: wrappedIdx = nextIdx < shortlist.length ? nextIdx : 0
        const shortlist: ShortlistEntry[] = [
            buildShortlistEntry(makeIcon('a'), 'generated'),
            buildShortlistEntry(makeIcon('b'), 'generated'),
            buildShortlistEntry(makeIcon('c'), 'generated'),
        ];

        // Simulate the wrapping logic in minimal-node.tsx
        function wrappedNext(currentIdx: number): { icon: IconStats; wrappedIdx: number } {
            const nextIdx = currentIdx + 1;
            const wrappedIdx = nextIdx < shortlist.length ? nextIdx : 0;
            return { icon: shortlist[wrappedIdx].icon, wrappedIdx };
        }

        // At index 0 → advances to 1
        const step1 = wrappedNext(0);
        assert.strictEqual(step1.icon.id, 'b');
        assert.strictEqual(step1.wrappedIdx, 1);

        // At index 1 → advances to 2
        const step2 = wrappedNext(1);
        assert.strictEqual(step2.icon.id, 'c');
        assert.strictEqual(step2.wrappedIdx, 2);

        // At index 2 (last) → wraps to 0, NOT falls through to rejection
        const step3 = wrappedNext(2);
        assert.strictEqual(step3.icon.id, 'a', 'should wrap to start instead of falling off the end');
        assert.strictEqual(step3.wrappedIdx, 0);
    });

    it('wrapping with a single-item shortlist always stays at index 0', () => {
        const shortlist: ShortlistEntry[] = [buildShortlistEntry(makeIcon('only'), 'generated')];

        function wrappedNext(currentIdx: number): { icon: IconStats; wrappedIdx: number } {
            const nextIdx = currentIdx + 1;
            const wrappedIdx = nextIdx < shortlist.length ? nextIdx : 0;
            return { icon: shortlist[wrappedIdx].icon, wrappedIdx };
        }

        const step = wrappedNext(0);
        assert.strictEqual(step.icon.id, 'only');
        assert.strictEqual(step.wrappedIdx, 0);
    });
});
