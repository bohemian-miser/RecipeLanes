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

// Security-rules contract tests (emulator-backed). These pin what the DEPLOYED
// rules allow and deny, so an unintended widening fails CI.
//
// They are deliberately paired with tests/firestore-rules-app-flows.test.ts,
// which pins the other direction: the operations the app REQUIRES must keep
// working. #318 tightened rules with only this half of the coverage and broke
// production — a deny-only suite happily goes green while the app dies.
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
        await db.doc('feedback/seeded1').set({ message: 'seeded', url: 'https://x' });
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

describe('icon_queue', () => {
    // KNOWN GAP, pinned rather than asserted-away: queue writes are currently
    // open, so a client could enqueue generation without spending a credit.
    // This test documents the live behaviour; when the gap is closed (with the
    // app-flow harness proving nothing needs it) flip these to assertFails.
    it('queue writes are currently open to any client', async () => {
        await assertSucceeds(asAnon().doc('icon_queue/Rules Probe Anon').set({ status: 'pending' }));
        await assertSucceeds(asOwner().doc('icon_queue/Carrot').update({ status: 'pending' }));
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

    it('the owner can write their own profile and stars', async () => {
        await assertSucceeds(asOwner().doc(`users/${OWNER}`).set({ displayName: 'Owner' }, { merge: true }));
        await assertSucceeds(asOwner().doc(`users/${OWNER}/stars/s2`).set({ recipeId: 'x' }));
    });

    it('nobody can write ANOTHER user\'s profile or stars', async () => {
        await assertFails(asStranger().doc(`users/${OWNER}`).set({ displayName: 'Pwned' }));
        await assertFails(asStranger().doc(`users/${OWNER}/stars/s3`).set({ recipeId: 'x' }));
        await assertFails(asAnon().doc(`users/${OWNER}`).set({ displayName: 'Pwned' }));
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
    it('anyone, signed in or not, can create feedback', async () => {
        await assertSucceeds(asAnon().collection('feedback').add({ message: 'hi' }));
        await assertSucceeds(asOwner().collection('feedback').add({ message: 'hi' }));
    });

    it('feedback is not readable, updatable, or deletable by clients', async () => {
        await assertFails(asAnon().collection('feedback').get());
        await assertFails(asOwner().doc('feedback/seeded1').get());
        await assertFails(asOwner().doc('feedback/seeded1').update({ message: 'edited' }));
        await assertFails(asOwner().doc('feedback/seeded1').delete());
    });
});

// ---------------------------------------------------------------------------
// Bypass attempts. The blocks above assert the intended contract; these model
// an attacker actively working around it. Each one is a route that has bitten
// real Firestore deployments: collection LIST queries (rules gate each doc, so
// an unfiltered list of a gated collection must fail wholesale), forged custom
// claims, nested paths under a deny-by-default collection (rules do NOT cascade
// to subcollections — an unmatched nested path is only denied because nothing
// grants it), batched/transactional writes smuggled alongside legitimate ones,
// and malformed docs that make a rule expression error out.
// ---------------------------------------------------------------------------

describe('bypass attempts', () => {
    it('cannot LIST a gated collection to harvest other users\' data', async () => {
        // Per-doc rules do not make a collection listable: an unfiltered list of
        // recipes would expose private ones, so the whole query must fail.
        await assertFails(asStranger().collection('recipes').get());
        await assertFails(asAnon().collection('recipes').get());
        // Nor can the query be aimed at someone else's private recipes.
        await assertFails(
            asStranger().collection('recipes').where('ownerId', '==', OWNER).get()
        );
        // A query constrained to what the rules allow does succeed.
        await assertSucceeds(
            asAnon().collection('recipes').where('visibility', '==', 'public').get()
        );
    });

    it('cannot LIST users, user_credits, or icon_forge_usage', async () => {
        await assertFails(asOwner().collection('users').get());
        await assertFails(asOwner().collection('user_credits').get());
        await assertFails(asOwner().collection('icon_forge_usage').get());
        await assertFails(asAnon().collection('users').get());
    });

    it('forged custom claims grant nothing', async () => {
        // No rule consults custom claims, so a token minted with admin-ish
        // claims must be exactly as powerless as a plain one.
        const forged = env
            .authenticatedContext(STRANGER, { admin: true, role: 'admin', credits: 9999 })
            .firestore();
        await assertFails(forged.doc(`user_credits/${OWNER}`).get());
        await assertFails(forged.doc(`user_credits/${STRANGER}`).set({ balance: 9999 }));
        await assertFails(forged.doc(`users/${OWNER}`).get());
        await assertFails(forged.doc('recipes/private1').get());
        // NB: icon_queue writes are open to everyone right now (known gap), so
        // there is nothing for a forged claim to gain there — see the
        // 'icon_queue' suite above.
    });

    it('nested paths under closed collections stay closed', async () => {
        // Rules do not cascade into subcollections; these paths match no rule,
        // so writing "around" the closed doc must still fail.
        await assertFails(asOwner().doc(`user_credits/${OWNER}/ledger/entry1`).set({ amount: 9999 }));
        await assertFails(asOwner().doc(`user_credits/${OWNER}/ledger/entry1`).get());
        await assertFails(asOwner().doc('icon_queue/Carrot/attempts/1').set({ status: 'pending' }));
        await assertFails(asOwner().doc(`users/${OWNER}/stars/s1/notes/n1`).set({ text: 'x' }));
    });

    it('batched and transactional writes cannot smuggle a denied write', async () => {
        // A batch is atomic: pairing a denied write with anything else still
        // fails, so this is not a route around the per-doc rules.
        const db = asOwner();
        const batch = db.batch();
        batch.set(db.doc(`user_credits/${OWNER}`), { balance: 9999 });
        batch.set(db.doc(`users/${OWNER}`), { displayName: 'Owner' });
        await assertFails(batch.commit());

        await assertFails(
            db.runTransaction(async (t: any) => {
                t.set(db.doc(`user_credits/${OWNER}`), { balance: 9999 });
            })
        );
    });

    it('credit fields cannot be nudged by a partial update or merge', async () => {
        // set({merge:true}) and update() are writes like any other — the
        // deny-by-default collection has no update path to exploit.
        const db = asOwner();
        await assertFails(db.doc(`user_credits/${OWNER}`).update({ balance: 9999 }));
        await assertFails(db.doc(`user_credits/${OWNER}`).set({ balance: 9999 }, { merge: true }));
        await assertFails(db.doc(`user_credits/${OWNER}`).delete());
    });

    it('a recipe missing its visibility field is not readable by a stranger', async () => {
        // The visibility comparison errors on a doc without the field; a rule
        // that errors denies, and must not fall through to the owner clause.
        await env.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc('recipes/malformed1').set({ ownerId: OWNER });
        });
        await assertFails(asStranger().doc('recipes/malformed1').get());
        await assertFails(asAnon().doc('recipes/malformed1').get());
        await assertSucceeds(asOwner().doc('recipes/malformed1').get());
    });

    it('one user cannot read or write another user\'s profile or stars', async () => {
        await assertFails(asStranger().doc(`users/${OWNER}/stars/s1`).get());
        await assertFails(asStranger().doc(`users/${OWNER}`).set({ displayName: 'Pwned' }));
        await assertFails(asStranger().doc(`users/${OWNER}/stars/sX`).set({ recipeId: 'x' }));
    });
});
