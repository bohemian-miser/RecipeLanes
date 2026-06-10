/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Unit tests for the autosave-jitter fix.
 *
 * Tests (a) and (b) cover the debounced scheduler (createAutosaveScheduler).
 * Test (c) covers the echo-suppression invariant via the Zustand recipe store.
 *
 *  (a) N rapid mutations → exactly one save call after the debounce window.
 *  (b) flush() fires a pending save immediately (flush-on-hide / unmount).
 *  (c) Snapshot with hasPendingWrites === true is skipped — the page.tsx guard
 *      prevents calling mergeSnapshot(); we verify the store invariant it
 *      protects: local isDirty is never reset by a snapshot, and the
 *      reference-preserving merge does not change node references on identical
 *      data (i.e. no jitter even if the guard were absent).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosaveScheduler } from '../lib/recipe-lanes/autosave-scheduler';
import { useRecipeStore } from '../lib/stores/recipe-store';
import type { RecipeGraph, RecipeNode } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string): RecipeNode {
    return { id, laneId: 'lane-1', text: `Node ${id}`, visualDescription: `v-${id}`, type: 'ingredient' };
}

function makeGraph(nodes: RecipeNode[]): RecipeGraph {
    return { lanes: [], nodes };
}

// ---------------------------------------------------------------------------
// (a) Debounce: N rapid mutations → exactly one save
// ---------------------------------------------------------------------------

describe('createAutosaveScheduler — debounce', () => {
    it('collapses N rapid schedule() calls into exactly one onSave() after the delay', async () => {
        let callCount = 0;
        const DELAY = 20;
        const scheduler = createAutosaveScheduler(() => { callCount++; }, DELAY);

        for (let i = 0; i < 5; i++) {
            scheduler.schedule();
        }

        assert.equal(callCount, 0, 'onSave should not fire before debounce window');

        await new Promise(resolve => setTimeout(resolve, DELAY + 20));

        assert.equal(callCount, 1, 'onSave should fire exactly once after N rapid mutations');
    });

    it('does not fire onSave when no schedule() was called', async () => {
        let callCount = 0;
        createAutosaveScheduler(() => { callCount++; }, 20);
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(callCount, 0, 'onSave must not be called if schedule() was never called');
    });

    it('resets the timer when schedule() is called again mid-window', async () => {
        let callCount = 0;
        const DELAY = 40;
        const scheduler = createAutosaveScheduler(() => { callCount++; }, DELAY);

        scheduler.schedule();
        await new Promise(resolve => setTimeout(resolve, DELAY / 2));
        scheduler.schedule(); // reset timer

        await new Promise(resolve => setTimeout(resolve, DELAY / 2 + 5));
        assert.equal(callCount, 0, 'timer should have been reset by the second call');

        await new Promise(resolve => setTimeout(resolve, DELAY + 10));
        assert.equal(callCount, 1, 'should fire exactly once after reset timer expires');
    });
});

// ---------------------------------------------------------------------------
// (b) flush(): saves immediately and cancels the pending timer
// ---------------------------------------------------------------------------

describe('createAutosaveScheduler — flush', () => {
    it('flush() fires a pending save immediately', () => {
        let callCount = 0;
        const scheduler = createAutosaveScheduler(() => { callCount++; }, 5000);

        scheduler.schedule();
        assert.equal(callCount, 0);

        scheduler.flush();
        assert.equal(callCount, 1, 'flush() should invoke onSave immediately when pending');
    });

    it('flush() is a no-op when nothing is pending', () => {
        let callCount = 0;
        const scheduler = createAutosaveScheduler(() => { callCount++; }, 5000);
        scheduler.flush();
        assert.equal(callCount, 0, 'flush() on empty scheduler must not call onSave');
    });

    it('flush() prevents the timer from firing a second time', async () => {
        let callCount = 0;
        const DELAY = 30;
        const scheduler = createAutosaveScheduler(() => { callCount++; }, DELAY);

        scheduler.schedule();
        scheduler.flush();

        await new Promise(resolve => setTimeout(resolve, DELAY + 20));
        assert.equal(callCount, 1, 'timer must not fire after flush() already consumed the pending save');
    });
});

// ---------------------------------------------------------------------------
// (c) Echo suppression — snapshot guard invariants
//
//  The page.tsx guard (hasPendingWrites check) prevents calling
//  mergeSnapshot() for echoes of our own writes.  We verify the store
//  invariants that guard protects.
// ---------------------------------------------------------------------------

describe('echo suppression — snapshot guard invariants', () => {
    beforeEach(() => useRecipeStore.getState().reset());
    afterEach(() => useRecipeStore.getState().reset());

    it('confirmed snapshot (non-pending) loads the store correctly', () => {
        const node = makeNode('a');
        useRecipeStore.getState().mergeSnapshot(makeGraph([node]), { ownerId: 'user-1' });

        const s = useRecipeStore.getState();
        assert.equal(s.graph?.nodes.length, 1, 'confirmed snapshot should populate the store');
        assert.equal(s.ownerId, 'user-1');
    });

    it('mergeSnapshot never resets isDirty (invariant the guard protects)', () => {
        const node = makeNode('a');
        useRecipeStore.getState().mergeSnapshot(makeGraph([node]));

        // Simulate local edit — isDirty becomes true
        useRecipeStore.getState().setDirty(true);
        assert.equal(useRecipeStore.getState().isDirty, true);

        // Even if the guard were absent and mergeSnapshot() ran on echo,
        // isDirty must remain true (the store never clears it on snapshot).
        useRecipeStore.getState().mergeSnapshot(makeGraph([{ ...node }]));
        assert.equal(
            useRecipeStore.getState().isDirty,
            true,
            'isDirty must not be cleared by mergeSnapshot',
        );
    });

    it('reference-preserving merge returns same node object for identical data (no jitter)', () => {
        const node = makeNode('a');
        useRecipeStore.getState().mergeSnapshot(makeGraph([node]));
        const originalRef = useRecipeStore.getState().graph!.nodes[0];

        // Simulate what would happen if the hasPendingWrites guard were absent:
        // mergeSnapshot() called with structurally identical data (echo).
        useRecipeStore.getState().mergeSnapshot(makeGraph([{ ...node }]));
        const afterRef = useRecipeStore.getState().graph!.nodes[0];

        assert.equal(
            originalRef,
            afterRef,
            'reference-preserving merge must return same node object — no position jitter',
        );
    });
});
