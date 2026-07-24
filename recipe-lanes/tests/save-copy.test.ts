/**
 * Unit tests for the "Save a copy" button gating (issue #46).
 *
 * A logged-in viewer looking at someone else's shared recipe should be able to
 * explicitly save a copy without first making an edit. Owners keep the original
 * dirty/saved gating.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    getSaveButtonState,
    nextCopyTitle,
    buildCopyGraph,
} from '../components/recipe-lanes/hooks/useSaveAndFork';
import { RecipeGraph } from '../lib/recipe-lanes/types';

describe('getSaveButtonState', () => {
    it('lets a logged-in non-owner save a copy without editing first', () => {
        const state = getSaveButtonState({ isLoggedIn: true, isOwner: false, isDirty: false, saved: false });
        assert.equal(state.enabled, true);
        assert.equal(state.isCopy, true);
        assert.equal(state.label, 'Save a copy');
    });

    it('shows a confirmation label after a non-owner copy is saved', () => {
        const state = getSaveButtonState({ isLoggedIn: true, isOwner: false, isDirty: false, saved: true });
        assert.equal(state.enabled, true);
        assert.equal(state.isCopy, true);
        assert.equal(state.label, 'Saved a copy!');
    });

    it('keeps the owner button disabled when there are no changes', () => {
        const state = getSaveButtonState({ isLoggedIn: true, isOwner: true, isDirty: false, saved: false });
        assert.equal(state.enabled, false);
        assert.equal(state.isCopy, false);
        assert.equal(state.label, 'No Changes');
    });

    it('enables the owner button when the recipe is dirty', () => {
        const state = getSaveButtonState({ isLoggedIn: true, isOwner: true, isDirty: true, saved: false });
        assert.equal(state.enabled, true);
        assert.equal(state.isCopy, false);
        assert.equal(state.label, 'Save Changes');
    });

    it('does not offer copy to a logged-out viewer (handleSave prompts login)', () => {
        const state = getSaveButtonState({ isLoggedIn: false, isOwner: false, isDirty: false, saved: false });
        assert.equal(state.isCopy, false);
        assert.equal(state.enabled, false);
    });
});

/**
 * Naming scheme shared by the fork-on-save path and the explicit "Save a copy"
 * button (issue #239). A chain of copies must escalate the prefix rather than
 * pile up "Copy of Copy of ...".
 */
describe('nextCopyTitle', () => {
    it('prefixes a plain title with "Copy of"', () => {
        assert.equal(nextCopyTitle('Pancakes'), 'Copy of Pancakes');
    });

    it('escalates "Copy of" to "Another copy of"', () => {
        assert.equal(nextCopyTitle('Copy of Pancakes'), 'Another copy of Pancakes');
    });

    it('escalates "Another copy of" to "Yet another copy of"', () => {
        assert.equal(nextCopyTitle('Another copy of Pancakes'), 'Yet another copy of Pancakes');
    });

    it('starts numbering once at "Yet another copy of"', () => {
        assert.equal(nextCopyTitle('Yet another copy of Pancakes'), 'Yet another copy of Pancakes (1)');
    });

    it('increments an existing "Yet another copy of ... (n)" counter', () => {
        assert.equal(nextCopyTitle('Yet another copy of Pancakes (3)'), 'Yet another copy of Pancakes (4)');
    });

    it('falls back to "Untitled" for a missing title', () => {
        assert.equal(nextCopyTitle(undefined), 'Copy of Untitled');
        assert.equal(nextCopyTitle(''), 'Copy of Untitled');
    });
});

/**
 * buildCopyGraph turns the *current* graph into the graph that gets persisted
 * as a brand-new recipe when the Save-a-copy button is clicked (issue #239).
 */
describe('buildCopyGraph', () => {
    const base: RecipeGraph = {
        title: 'Pancakes',
        nodes: [{ id: 'n1' } as any],
        layouts: {},
    } as RecipeGraph;

    it('renames the copy and records the source recipe id', () => {
        const copy = buildCopyGraph(base, 'src-123');
        assert.equal(copy.title, 'Copy of Pancakes');
        assert.equal(copy.sourceId, 'src-123');
    });

    it('preserves the original graph contents (nodes carried over)', () => {
        const copy = buildCopyGraph(base, 'src-123');
        assert.deepEqual(copy.nodes, base.nodes);
    });

    it('does not mutate the source graph', () => {
        const copy = buildCopyGraph(base, 'src-123');
        assert.equal(base.title, 'Pancakes');
        assert.equal(base.sourceId, undefined);
        assert.notEqual(copy, base);
    });

    it('handles a copy made from an unsaved recipe (no source id)', () => {
        const copy = buildCopyGraph(base, undefined);
        assert.equal(copy.sourceId, undefined);
        assert.equal(copy.title, 'Copy of Pancakes');
    });
});
