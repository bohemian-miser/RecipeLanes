import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { computeStoredOwnerName, formatDisplayName } from '../lib/utils';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// Issue #146: "publish as anonymous" — a recipe can be saved without the
// owner's display name attached, while keeping ownerId for edit/ownership gates.

describe('computeStoredOwnerName (issue #146)', () => {
    it('returns an empty string when anonymous, so a merge write clears any prior name', () => {
        assert.equal(computeStoredOwnerName('Ada Lovelace', true), '');
        assert.equal(computeStoredOwnerName(undefined, true), '');
        assert.equal(computeStoredOwnerName('', true), '');
    });

    it('keeps the real name when not anonymous', () => {
        assert.equal(computeStoredOwnerName('Ada Lovelace', false), 'Ada Lovelace');
        assert.equal(computeStoredOwnerName('Ada Lovelace', undefined), 'Ada Lovelace');
    });

    it('returns undefined (caller omits the field) when not anonymous and there is no name', () => {
        assert.equal(computeStoredOwnerName(undefined, false), undefined);
        assert.equal(computeStoredOwnerName('', undefined), undefined);
    });

    it('the stored anonymous value renders as "Anon" via the display fallback', () => {
        const stored = computeStoredOwnerName('Ada Lovelace', true); // ''
        assert.equal(formatDisplayName('uid-1', stored), 'Anon');
    });
});

describe('MemoryDataService anonymous publishing (issue #146)', () => {
    const baseGraph = (): RecipeGraph => ({
        title: 'Anon Test',
        lanes: [],
        nodes: [
            { id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'Step 1', type: 'action', x: 0, y: 0 },
        ],
    });

    let service: any;
    beforeEach(() => {
        setDataService(new MemoryDataService());
        service = getDataService();
    });

    it('suppresses the owner byline but keeps ownerId when anonymous', async () => {
        const id = await service.saveRecipe({ ...baseGraph(), anonymous: true }, undefined, 'user-123', 'public', 'Ada Lovelace');
        const recipe = await service.getRecipe(id);
        assert.ok(recipe);
        assert.equal(recipe.ownerId, 'user-123');
        assert.ok(!recipe.ownerName, 'ownerName must be suppressed for anonymous recipes');
    });

    it('keeps an owner byline when not anonymous', async () => {
        const id = await service.saveRecipe({ ...baseGraph() }, undefined, 'user-123', 'public', 'Ada Lovelace');
        const recipe = await service.getRecipe(id);
        assert.ok(recipe);
        assert.equal(recipe.ownerId, 'user-123');
        assert.ok(recipe.ownerName, 'a named recipe should carry a byline');
    });
});
