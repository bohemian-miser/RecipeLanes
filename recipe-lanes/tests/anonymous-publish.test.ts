import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { computeStoredOwnerName, formatDisplayName, resolveBylineName } from '../lib/utils';
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

describe('resolveBylineName (issue #146 — instant byline, no double-update)', () => {
    it('always reads "Anon" when anonymous, regardless of stored/own name', () => {
        assert.equal(resolveBylineName('uid-1', 'Ada Lovelace', true, true, 'Ada Lovelace'), 'Anon');
        assert.equal(resolveBylineName('uid-1', '', true, true, 'Ada Lovelace'), 'Anon');
    });

    it('shows the stored owner name when present and not anonymous', () => {
        assert.equal(resolveBylineName('uid-1', 'Ada Lovelace', false, true, 'someone-else'), 'Ada Lovelace');
        assert.equal(resolveBylineName('uid-1', 'Ada Lovelace', false, false, undefined), 'Ada Lovelace');
    });

    it('falls back to the owner-viewer\'s own name when the stored name is empty (instant un-anon)', () => {
        // Right after toggling back from anonymous, the store ownerName is still
        // the cleared '' — the byline must read the real name instantly, not "Anon".
        assert.equal(resolveBylineName('uid-1', '', false, true, 'Ada Lovelace'), 'Ada Lovelace');
        assert.equal(resolveBylineName('uid-1', null, false, true, 'Ada Lovelace'), 'Ada Lovelace');
    });

    it('does NOT use the current name for a non-owner viewer (only the stored name)', () => {
        assert.equal(resolveBylineName('uid-1', '', false, false, 'Viewer Name'), 'Anon');
    });

    it('reads "Anon" when nobody has a usable name', () => {
        assert.equal(resolveBylineName('uid-1', '', false, true, ''), 'Anon');
        assert.equal(resolveBylineName('uid-1', undefined, false, true, undefined), 'Anon');
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
