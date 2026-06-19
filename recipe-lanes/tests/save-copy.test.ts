/**
 * Unit tests for the "Save a copy" button gating (issue #46).
 *
 * A logged-in viewer looking at someone else's shared recipe should be able to
 * explicitly save a copy without first making an edit. Owners keep the original
 * dirty/saved gating.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getSaveButtonState } from '../components/recipe-lanes/hooks/useSaveAndFork';

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
