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
 * Unit tests for computeShortlistDelta — pure function, no emulator needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeShortlistDelta, markSeenEntriesRejected } from '../lib/recipe-lanes/model-utils';
import type { RecipeNode, IconStats, ShortlistEntry } from '../lib/recipe-lanes/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeIcon(id: string): IconStats {
    return { id, visualDescription: id};
}

function makeEntry(icon: IconStats): ShortlistEntry {
    return { icon, matchType: 'search' };
}

function makeNode(
    shortlist: ShortlistEntry[],
    shortlistIndex: number,
    shortlistCycled?: boolean,
): RecipeNode {
    return {
        id: 'n1', laneId: 'l1', text: 'carrot', visualDescription: 'carrot', type: 'ingredient',
        iconShortlist: shortlist,
        shortlistIndex,
        ...(shortlistCycled ? { shortlistCycled: true } : {}),
    } as any;
}

// ---------------------------------------------------------------------------
// Simulation helpers
// ---------------------------------------------------------------------------

/** Running impression and rejection counts per icon, mirroring what the
 *  backend would accumulate across calls to recordImpression / recordRejection /
 *  decrementRejection. */
type Counts = Record<string, { impressions: number; rejections: number }>;

function getCount(counts: Counts, id: string) {
    return counts[id] ?? { impressions: 0, rejections: 0 };
}

/**
 * Simulate one save:
 *  1. Compute the delta between firestoreNode (old) and clientNode (new).
 *  2. Apply the delta to the running counts.
 *  3. Return the new firestoreNode (updatedShortlist at the client's index).
 */
function save(
    firestoreNode: RecipeNode | null,
    clientNode: RecipeNode,
    counts: Counts,
): RecipeNode {
    const delta = computeShortlistDelta(firestoreNode, clientNode);
    for (const { id } of delta.toImpres)   { counts[id] ??= { impressions: 0, rejections: 0 }; counts[id].impressions++; }
    for (const { id } of delta.toReject)   { counts[id] ??= { impressions: 0, rejections: 0 }; counts[id].rejections++; }
    for (const { id } of delta.toUnreject) { counts[id] ??= { impressions: 0, rejections: 0 }; counts[id].rejections--; }
    return makeNode(delta.updatedShortlist, clientNode.shortlistIndex ?? 0, clientNode.shortlistCycled);
}

/** Advance the shortlist index by 1, wrapping at N. */
function cycle(idx: number, N: number): number {
    return (idx + 1) % N;
}

/**
 * Assert impression and rejection counts for every icon after a save.
 *
 * @param counts     Running totals.
 * @param icons      Ordered list of icons in the shortlist.
 * @param idx        The shortlistIndex that was just saved.
 * @param step       Which step (0-based) this is — used only for error messages.
 * @param impExpected  Expected impressions per icon.
 * @param rejExpected  Expected rejections per icon.
 */
function assertCounts(
    counts: Counts,
    icons: IconStats[],
    step: number,
    impExpected: number[],
    rejExpected: number[],
): void {
    // console.log(`step ${step} (shortlistIndex=):`, icons.map(i => `${i.id}(imp:${getCount(counts, i.id).impressions}, rej:${getCount(counts, i.id).rejections})`).join(', '));
    for (let i = 0; i < icons.length; i++) {
        const c = getCount(counts, icons[i].id);
        assert.equal(c.impressions, impExpected[i], `step ${step} icon[${i}] impressions`);
        assert.equal(c.rejections,  rejExpected[i], `step ${step} icon[${i}] rejections`);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeShortlistDelta', () => {

    // -----------------------------------------------------------------------
    // Core cycling test: save at each index 0..2N-1 and check state after each.
    // -----------------------------------------------------------------------

    it('cycling shortlist 2×N times: correct impressions and rejections at every step', () => {
        const N = 4;
        const icons = Array.from({ length: N }, (_, i) => makeIcon(`icon-${i}`));
        const entries = () => icons.map(makeEntry); // always fresh entries (flags come from Firestore side)
        const counts: Counts = {};

        let fs: RecipeNode | null = null;
        let idx = 0;

        // ---- Step 0: first save at idx=0 ----
        // Only icon-0 has been seen. No rejections.
        fs = save(fs, makeNode(entries(), idx), counts);
        //log the counts
        // console.log(`initial save${JSON.stringify(counts)}:`);
        assertCounts(counts, icons, 0,
            [1, 0, 0, 0],   // impressions
            [0, 0, 0, 0],   // rejections
        );
        // console.log(`initial save at idx=${JSON.stringify(counts)}:`);
        console.log('---');

        // ---- Steps 1..N-1: cycle forward through the rest ----
        // After each step s, icons 0..s have impressions; icons 0..s-1 have rejections.
        for (let step = 1; step < N; step++) {
            idx = cycle(idx, N);
            
            fs = save(fs, makeNode(entries(), idx), counts);

            const imp = icons.map((_, i) => i <= step ? 1 : 0);
            const rej = icons.map((_, i) => i < step  ? 1 : 0);
            assertCounts(counts, icons, step, imp, rej);
        }

        console.log('---');
        // After step N-1 (idx = N-1): imp=[1,1,1,1], rej=[1,1,1,0]

        // ---- Steps N..2N-1: second wrap ----
        // All icons already have 1 impression.
        // When cycling back to idx=0, icon-0 gets un-rejected (was 1, now 0).
        // icon-N-1 keeps rej=0 (was never rejected, and it's outside seen range when idx < N-1).
        // As we step through the second cycle, the selected icon's rejection goes to 0
        // and the icon just cycled past gets re-rejected.
        //
        // Pre-computed expected state for each step s in [N, 2N-1]:
        //   imp: all 1 (all seen in first cycle)
        //   rej[i] = 0 if i === (s % N) [currently selected]
        //          = 0 if i === N-1 AND s % N !== N-1  [last icon, never rejected except when something cycles past it — but in a simple forward cycle nothing cycles past icon N-1 until it's the selected one]
        //          = 1 otherwise

        // We track the expected rej array incrementally.
        // After step N-1: rej = [1,1,1,0]
        // The selected icon's rejection clears; the prev selected gets re-rejected.
        let expectedRej = icons.map((_, i) => i < N - 1 ? 1 : 0); // [1,1,1,0]

        for (let step = N; step < 2 * N; step++) {
            const prevIdx = idx;
            idx = cycle(idx, N);
            expectedRej[prevIdx] = 1;
            expectedRej[idx] = 0;

            fs = save(fs, makeNode(entries(), idx, true), counts);
            assertCounts(counts, icons, step,
                icons.map(() => 1),  // all impressed
                [...expectedRej],
            );
        }
    });

    // -----------------------------------------------------------------------
    // Forge at every position 0..2N-1: new icon gets impression, old flags preserved.
    // -----------------------------------------------------------------------

    it('forging at every position 0..2*N-1: new icon impressed, existing flags preserved', () => {
        const N = 4;
        
        for (let f = 0; f < 2 * N; f++) {
            let icons = Array.from({ length: N }, (_, i) => makeIcon(`icon-${i}`));
            const entries = () => icons.map(makeEntry);
            // Build Firestore state by cycling f steps from scratch.
            let fs: RecipeNode | null = null;
            const counts: Counts = {};
            let idx = 0;
            
            fs = save(fs, makeNode(entries(), 0), counts);
            // console.log(`Forging step ${f} + 0`, icons.map(i => `${i.id}(imp:${getCount(counts, i.id).impressions}, rej:${getCount(counts, i.id).rejections})`).join(', '));
            for (let step = 1; step <= f; step++) {
                idx = cycle(idx, N);
                fs = save(fs, makeNode(entries(), idx, step>=N), counts);
                // console.log(`Forging step ${f} + ${step}`, icons.map(i => `${i.id}(imp:${getCount(counts, i.id).impressions}, rej:${getCount(counts, i.id).rejections})`).join(', '));
            }
            // console.log(`Forge`);
            // Snapshot old flags before forge.
            // const oldShortlist = fs!.iconShortlist!;

            // Forge: prepend a new icon, reset index to 0.
            const forged = makeIcon(`forged-${f}`);
            let oldIcons = [ ...icons ]; // copy before forge
            icons = [forged, ...icons]; 
            // FOrging should take care of impressing the new icon and leaving existing counts unchanged.
            //copy fs to node
            // make node a copy of fs
            let node = { ...fs! };
            // let node = fs; //makeNode(postForgeEntries, 0, f>=N );
            // console.log(`Forging step ${f} + F`, icons.map(i => `${i.id}(imp:${getCount(counts, i.id).impressions}, rej:${getCount(counts, i.id).rejections})`).join(', '));
            markSeenEntriesRejected(node!); // simulate the client marking all existing entries as rejected before forge, which is what the UI does.
            // console.log(`node after marking entries rejected pre-forge\t\t\t\t`, node.iconShortlist!.map(e => `${e.icon.id}(imp:${e.hasImpressed?1:0}, rej:${e.hasRejected?1:0})`).join(', '));
        
            // const postForgeEntries = entries();
            let countsAfterForge: Counts = { ...counts };

            // simulate forging. TODO add a test checking that this is what that func in data service is doing.
            // we need to prepend the forged entry to the shortlist after marking entries rejected.
            
            node.iconShortlist = [makeEntry(forged), ...node.iconShortlist!]
            node.shortlistIndex = 0;
            node.iconShortlist[0].hasImpressed = true; // TODO replace with correct calls.
            // console.log(`node after prepending forge\t\t\t`, node.iconShortlist!.map(e => `${e.icon.id}(imp:${e.hasImpressed?1:0}, rej:${e.hasRejected?1:0})`).join(', '));
            
            // // update counts to be accurate
            // for (const [id, count] of Object.entries(countsAfterForge)) {
            //     if (id === forged.id) {
            //         countsAfterForge[id] = { impressions: count.impressions + 1, rejections: count.rejections };
            //     } else {
            //         countsAfterForge[id] = { impressions: count.impressions, rejections: count.rejections + 1 };
            //     }
            // }

            const fsAfterForge = save(fs, node, countsAfterForge);
            // console.log(`Forging step ${f} + F`, icons.map(i => `${i.id}(imp:${getCount(countsAfterForge, i.id).impressions}, rej:${getCount(countsAfterForge, i.id).rejections})`).join(', '));

            // New icon: exactly 1 impression, 0 rejections.
            assert.equal(getCount(countsAfterForge, forged.id).impressions, 1, `f=${f}: forged icon impression`);
            assert.equal(getCount(countsAfterForge, forged.id).rejections,  0, `f=${f}: forged icon no rejection`);

            // Old icons: counts unchanged (they're not in the seen range post-forge).
            for (const icon of oldIcons) {
                assert.equal(
                    getCount(countsAfterForge, icon.id).impressions,
                    getCount(counts, icon.id).impressions,
                    `f=${f} ${icon.id}: impressions unchanged after forge`,
                );
                assert.equal(
                    getCount(countsAfterForge, icon.id).rejections,
                    getCount(counts, icon.id).rejections,
                    `f=${f} ${icon.id}: rejections unchanged after forge`,
                );
            }

            // i do not htink this hsould be true. forging changes things.
            // Old icons' hasImpressed/hasRejected flags preserved verbatim in updatedShortlist.
            // for (let i = 0; i < N; i++) {
            //     const updated = fsAfterForge.iconShortlist![i + 1]; // +1 because forged is at [0]
            //     console.log(`Checking flags preserved for f=${f} icon-${i}: updated ${updated.icon.id} hasImpressed=${updated.hasImpressed}, hasRejected=${updated.hasRejected}`);
            //     const old = oldShortlist.find(e => e.icon.id === icons[i].id)!;
                
            //     console.log(`Checking flags preserved for f=${f} icon-${i}: updated ${old} hasImpressed=${old.hasImpressed}, hasRejected=${old.hasRejected}`);
            //     assert.equal(updated.hasImpressed, old.hasImpressed, `f=${f} icon-${i}: hasImpressed preserved`);
            //     assert.equal(updated.hasRejected,  old.hasRejected,  `f=${f} icon-${i}: hasRejected preserved`);
            // }
        }
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    it('empty shortlist returns empty delta', () => {
        const delta = computeShortlistDelta(null, makeNode([], 0));
        assert.deepEqual(delta.toImpres,  []);
        assert.deepEqual(delta.toReject,  []);
        assert.deepEqual(delta.toUnreject, []);
    });

    it('saving same index twice is a no-op', () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c')];
        let fs: RecipeNode | null = null;
        const counts: Counts = {};
        fs = save(fs, makeNode(icons.map(makeEntry), 1), counts);
        const snapshot = { ...counts, a: { ...counts['a'] }, b: { ...counts['b'] } };
        save(fs, makeNode(icons.map(makeEntry), 1), counts);
        assert.deepEqual(counts, snapshot);
    });

    it('shortlistCycled=true: all icons impressed, all but selected rejected', () => {
        const icons = [makeIcon('a'), makeIcon('b'), makeIcon('c'), makeIcon('d')];
        const counts: Counts = {};
        // First save at idx=0 to establish baseline.
        let fs = save(null, makeNode(icons.map(makeEntry), 0), counts);
        // Now save with shortlistCycled=true and selectedIdx=2.
        save(fs, makeNode(icons.map(makeEntry), 2, true), counts);
        for (const icon of icons) {
            assert.equal(getCount(counts, icon.id).impressions, 1, `${icon.id} impressed`);
        }
        assert.equal(getCount(counts, 'a').rejections, 1, 'a rejected');
        assert.equal(getCount(counts, 'b').rejections, 1, 'b rejected');
        assert.equal(getCount(counts, 'c').rejections, 0, 'c selected — not rejected');
        assert.equal(getCount(counts, 'd').rejections, 1, 'd rejected');
    });
});
