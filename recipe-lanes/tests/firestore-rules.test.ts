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

// Security-rules contract tests (emulator-backed). The architecture invariant
// is "clients read, backend writes": every Firestore write goes through the
// Admin SDK, so firestore.rules must deny ALL client writes and gate reads per
// collection. These tests pin that contract — especially for the collections
// credits/money hang off (user_credits, icon_queue) — so a future rules edit
// that re-opens a write path fails CI instead of shipping.
//
// Uses its own emulator project id ("rules-spec") so loading rules here cannot
// affect the shared "local-project-id" data other integration tests use.

import { describe, it, before, after } from 'node:test';
import {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
    RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../firestore.rules'
);

const OWNER = 'rules-owner-uid';
const STRANGER = 'rules-stranger-uid';

let env: RulesTestEnvironment;

// Firestore contexts per authentication state. Recreated cheaply per use.
const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asStranger = () => env.authenticatedContext(STRANGER).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

before(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
    const [hostname, port] = host.split(':');
    env = await initializeTestEnvironment({
        projectId: 'rules-spec',
        firestore: {
            host: hostname,
            port: Number(port),
            rules: readFileSync(RULES_PATH, 'utf8'),
        },
    });

    // Seed docs the read tests inspect, bypassing rules.
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc('icon_index/icon1').set({ ingredient_name: 'carrot' });
        await db.doc('feed_icons/icon1').set({ url: 'x' });
        await db.doc('ingredients_new/carrot').set({ icons: [] });
        await db.doc('icon_queue/Carrot').set({ status: 'pending' });
        await db.doc('recipes/public1').set({ visibility: 'public', ownerId: OWNER });
        await db.doc('recipes/unlisted1').set({ visibility: 'unlisted', ownerId: OWNER });
        await db.doc('recipes/private1').set({ visibility: 'private', ownerId: OWNER });
        await db.doc(`users/${OWNER}`).set({ displayName: 'Owner' });
        await db.doc(`users/${OWNER}/stars/s1`).set({ recipeId: 'public1' });
        await db.doc(`user_credits/${OWNER}`).set({ balance: 10, granted: 10, spent: 0 });
    });
});

after(async () => {
    await env.cleanup();
});

describe('public catalog collections', () => {
    it('anyone can read icon_index, feed_icons, ingredients_new, icon_queue', async () => {
        const db = asAnon();
        await assertSucceeds(db.doc('icon_index/icon1').get());
        await assertSucceeds(db.doc('feed_icons/icon1').get());
        await assertSucceeds(db.doc('ingredients_new/carrot').get());
        await assertSucceeds(db.doc('icon_queue/Carrot').get());
    });

    it('nobody can write catalog collections from a client', async () => {
        await assertFails(asAnon().doc('icon_index/evil').set({ ingredient_name: 'x' }));
        await assertFails(asOwner().doc('feed_icons/evil').set({ url: 'x' }));
        await assertFails(asOwner().doc('ingredients_new/carrot').set({ icons: [] }));
    });
});

describe('icon_queue (credit-gated pipeline)', () => {
    it('clients cannot create, update, or delete queue docs', async () => {
        // A client queue write would bypass the credit spend in forgeIconAction.
        await assertFails(asAnon().doc('icon_queue/Free Lunch').set({ status: 'pending' }));
        await assertFails(asOwner().doc('icon_queue/Free Lunch').set({ status: 'pending' }));
        await assertFails(asOwner().doc('icon_queue/Carrot').update({ status: 'failed' }));
        await assertFails(asOwner().doc('icon_queue/Carrot').delete());
    });
});

describe('recipes visibility', () => {
    it('public and unlisted recipes are readable by anyone', async () => {
        await assertSucceeds(asAnon().doc('recipes/public1').get());
        await assertSucceeds(asAnon().doc('recipes/unlisted1').get());
    });

    it('private recipes are readable only by their owner', async () => {
        await assertSucceeds(asOwner().doc('recipes/private1').get());
        await assertFails(asStranger().doc('recipes/private1').get());
        await assertFails(asAnon().doc('recipes/private1').get());
    });

    it('clients cannot write recipes', async () => {
        await assertFails(asOwner().doc('recipes/private1').update({ visibility: 'public' }));
        await assertFails(asStranger().doc('recipes/mine').set({ visibility: 'public' }));
    });
});

describe('user profiles & stars', () => {
    it('owner can read their own profile and stars', async () => {
        await assertSucceeds(asOwner().doc(`users/${OWNER}`).get());
        await assertSucceeds(asOwner().doc(`users/${OWNER}/stars/s1`).get());
    });

    it('other users and anon cannot read a profile', async () => {
        await assertFails(asStranger().doc(`users/${OWNER}`).get());
        await assertFails(asAnon().doc(`users/${OWNER}`).get());
    });

    it('even the owner cannot write their profile from a client', async () => {
        // Display names may be shown publicly (icon attribution); they must
        // only change via server actions.
        await assertFails(asOwner().doc(`users/${OWNER}`).set({ displayName: 'Spoofed' }));
        await assertFails(asOwner().doc(`users/${OWNER}/stars/s2`).set({ recipeId: 'x' }));
    });
});

describe('money-adjacent collections are fully closed', () => {
    it('user_credits is unreadable and unwritable, even by its subject', async () => {
        await assertFails(asOwner().doc(`user_credits/${OWNER}`).get());
        await assertFails(asOwner().doc(`user_credits/${OWNER}`).set({ balance: 9999 }));
        await assertFails(asAnon().doc(`user_credits/${OWNER}`).get());
    });

    it('credit_ledger, icon_forge_usage, and config are closed', async () => {
        await assertFails(asOwner().doc(`credit_ledger/${OWNER}-1`).set({ amount: 9999 }));
        await assertFails(asOwner().doc(`icon_forge_usage/${OWNER}_2026-01-01`).get());
        await assertFails(asOwner().doc('icon_forge_usage/x').set({ count: 0 }));
        await assertFails(asAnon().doc('config/icon_queue').get());
        await assertFails(asOwner().doc('config/icon_queue').set({ paused: true }));
    });
});

describe('feedback', () => {
    it('clients cannot create feedback directly (server action only)', async () => {
        await assertFails(asAnon().collection('feedback').add({ text: 'hi' }));
        await assertFails(asOwner().collection('feedback').add({ text: 'hi' }));
    });
});
