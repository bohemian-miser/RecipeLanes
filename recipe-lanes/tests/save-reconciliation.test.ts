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
 * Integration tests for the saveRecipe server-state reconciliation (issue #221).
 *
 * The client always saves the whole graph, and the update path writes it with
 * `set(..., { merge: true })`. Firestore's merge:true replaces arrays wholesale,
 * so `graph.nodes` is last-writer-wins. The server concurrently writes node
 * fields in the background (icon resolution: fastMatches/hydeQueries/iconQuery/
 * iconShortlist; queueing: status). A client save built from a graph fetched
 * before those background writes landed must not silently erase them.
 *
 * These tests seed the "server wrote fields the client doesn't know about" state
 * directly via the admin SDK (deterministic, no need to run the real icon
 * pipeline), then call saveRecipe with a stale client graph and assert the
 * server-owned fields survive while client-owned/new-node fields still win
 * where they're supposed to.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/firebase-admin';
import { getDataService } from '../lib/data-service';
import { setAIService } from '../lib/ai-service';
import { MockAIService } from '../lib/ai-service.mock';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { buildShortlistEntry } from '../lib/recipe-lanes/model-utils';
import { DB_COLLECTION_RECIPES } from '../lib/config';
import type { IconStats, ShortlistEntry } from '../lib/recipe-lanes/types';

setAIService(new MockAIService());
setAuthService(new MockAuthService());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIcon(id: string, visualDescription: string): IconStats {
    return { id, visualDescription, impressions: 0, rejections: 0 };
}

function makeShortlist(prefix: string, visualDescription: string): ShortlistEntry[] {
    return [
        buildShortlistEntry(makeIcon(`${prefix}-1`, visualDescription), 'search'),
        buildShortlistEntry(makeIcon(`${prefix}-2`, visualDescription), 'search'),
    ];
}

const createdRecipeIds: string[] = [];

/** Creates a recipe doc directly via the admin SDK, simulating server-written state. */
async function createRecipeDoc(graph: any): Promise<string> {
    const doc = await db.collection(DB_COLLECTION_RECIPES).add({
        graph,
        visibility: 'private',
        created_at: new Date(),
        updated_at: new Date(),
    });
    createdRecipeIds.push(doc.id);
    return doc.id;
}

async function fetchGraph(recipeId: string): Promise<any> {
    const doc = await db.collection(DB_COLLECTION_RECIPES).doc(recipeId).get();
    return doc.data()?.graph;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('saveRecipe server-state reconciliation (#221)', () => {

    afterEach(async () => {
        // Integration tier shares one global Firestore — clean up after ourselves.
        await Promise.all(
            createdRecipeIds.splice(0).map((id) => db.collection(DB_COLLECTION_RECIPES).doc(id).delete()),
        );
    });

    it('preserves server-written iconShortlist/fastMatches/hydeQueries/iconQuery/status when the client save is stale', async () => {
        const visualDescription = `stale-node-${Date.now()}`;
        const serverShortlist = makeShortlist('srv', visualDescription);

        const recipeId = await createRecipeDoc({
            title: 'test',
            lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
            nodes: [{
                id: 'n1',
                laneId: 'l1',
                text: visualDescription,
                visualDescription,
                type: 'ingredient',
                iconShortlist: serverShortlist,
                shortlistIndex: 1,
                shortlistCycled: true,
                fastMatches: [{ icon_id: 'srv-1', score: 0.9 }],
                hydeQueries: ['a hyde query'],
                iconQuery: { queryUsed: 'server query', method: 'hyde' },
                status: 'processing',
            }],
        });

        // Stale client graph: fetched before the server's background writes landed,
        // so this node lacks all of the server-owned fields above.
        const staleClientGraph = {
            title: 'test',
            lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
            nodes: [{
                id: 'n1',
                laneId: 'l1',
                text: visualDescription,
                visualDescription,
                type: 'ingredient',
                x: 42,
                y: 7,
            }],
        };

        await getDataService().saveRecipe(staleClientGraph as any, recipeId);

        const savedGraph = await fetchGraph(recipeId);
        const savedNode = savedGraph.nodes.find((n: any) => n.id === 'n1');

        assert.equal(savedNode.iconShortlist?.length, 2, 'iconShortlist should survive the stale save');
        assert.equal(savedNode.shortlistIndex, 1, 'shortlistIndex should be restored alongside the shortlist');
        assert.equal(savedNode.shortlistCycled, true, 'shortlistCycled should be restored alongside the shortlist');
        assert.deepEqual(savedNode.fastMatches, [{ icon_id: 'srv-1', score: 0.9 }], 'fastMatches should survive');
        assert.deepEqual(savedNode.hydeQueries, ['a hyde query'], 'hydeQueries should survive');
        assert.deepEqual(savedNode.iconQuery, { queryUsed: 'server query', method: 'hyde' }, 'iconQuery should survive');
        assert.equal(savedNode.status, 'processing', 'status should survive');
        // Client-owned fields from the stale save should still win.
        assert.equal(savedNode.x, 42, 'client x should still be applied');
        assert.equal(savedNode.y, 7, 'client y should still be applied');
    });

    it('honours the client shortlistIndex when the client node already has a shortlist', async () => {
        const visualDescription = `moved-index-${Date.now()}`;
        const shortlist = makeShortlist('mv', visualDescription);

        const recipeId = await createRecipeDoc({
            title: 'test',
            lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
            nodes: [{
                id: 'n1',
                laneId: 'l1',
                text: visualDescription,
                visualDescription,
                type: 'ingredient',
                iconShortlist: shortlist,
                shortlistIndex: 0,
            }],
        });

        // Client has the same shortlist but has cycled forward to index 1 — this is
        // the normal "user pressed reroll" case and must be honoured, not clobbered
        // by the server's stale index.
        const clientGraph = {
            title: 'test',
            lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
            nodes: [{
                id: 'n1',
                laneId: 'l1',
                text: visualDescription,
                visualDescription,
                type: 'ingredient',
                iconShortlist: shortlist,
                shortlistIndex: 1,
            }],
        };

        await getDataService().saveRecipe(clientGraph as any, recipeId);

        const savedGraph = await fetchGraph(recipeId);
        const savedNode = savedGraph.nodes.find((n: any) => n.id === 'n1');

        assert.equal(savedNode.shortlistIndex, 1, 'client-trusted shortlistIndex should be honoured');
    });

    it('leaves a node new to the doc completely untouched', async () => {
        const visualDescription = `existing-${Date.now()}`;
        const newNodeDescription = `brand-new-${Date.now()}`;

        const recipeId = await createRecipeDoc({
            title: 'test',
            lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
            nodes: [{
                id: 'n1',
                laneId: 'l1',
                text: visualDescription,
                visualDescription,
                type: 'ingredient',
            }],
        });

        const clientGraph = {
            title: 'test',
            lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
            nodes: [
                {
                    id: 'n1',
                    laneId: 'l1',
                    text: visualDescription,
                    visualDescription,
                    type: 'ingredient',
                },
                {
                    id: 'n2',
                    laneId: 'l1',
                    text: newNodeDescription,
                    visualDescription: newNodeDescription,
                    type: 'ingredient',
                    status: 'pending',
                    x: 10,
                    y: 20,
                },
            ],
        };

        await getDataService().saveRecipe(clientGraph as any, recipeId);

        const savedGraph = await fetchGraph(recipeId);
        const savedNewNode = savedGraph.nodes.find((n: any) => n.id === 'n2');

        assert.ok(savedNewNode, 'new node should be present in the saved doc');
        assert.equal(savedNewNode.status, 'pending', 'new node client-provided status should be kept');
        assert.equal(savedNewNode.x, 10, 'new node client-provided x should be kept');
        assert.equal(savedNewNode.y, 20, 'new node client-provided y should be kept');
    });
});
