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

// RULES REGRESSION HARNESS — "does the app still work?"
//
// Why this file exists: PR #318 tightened firestore.rules on the belief that
// every write goes through the Admin SDK, shipped with a deny-only test suite,
// and broke production (feedback submission among other things). Nothing went
// red, because:
//
//   * the emulator integration tests drive Firestore through the ADMIN SDK,
//     which BYPASSES rules entirely — they cannot fail on a rules change; and
//   * the rules contract suite only asserted that things are DENIED, and
//     removing a grant makes such assertions *more* true.
//
// So this file pins the opposite direction: every Firestore operation the app
// needs is replayed here through a RULES-ENFORCED client, asserting it still
// SUCCEEDS. Take a grant out of firestore.rules and the matching case here
// goes red, naming the user-facing feature that would break.
//
// HOW TO KEEP IT HONEST
//   * Add a case whenever a feature starts touching Firestore from the client
//     (or from any non-Admin-SDK path, e.g. REST).
//   * Never "fix" a red case by relaxing the assertion — either the rule needs
//     restoring, or the app path genuinely moved to the Admin SDK, in which
//     case delete the case and say so in the commit.
//
// Runs under its own emulator project id so it cannot disturb other tests.

import { describe, it, before, after } from 'node:test';
import {
    initializeTestEnvironment,
    assertSucceeds,
    RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../firestore.rules'
);

const VISITOR = 'app-flow-visitor-uid';

let env: RulesTestEnvironment;

const asUser = () => env.authenticatedContext(VISITOR).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

before(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
    const [hostname, port] = host.split(':');
    env = await initializeTestEnvironment({
        projectId: 'rules-app-flows',
        firestore: {
            host: hostname,
            port: Number(port),
            rules: readFileSync(RULES_PATH, 'utf8'),
        },
    });

    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc('icon_index/icon1').set({ ingredient_name: 'carrot' });
        await db.doc('feed_icons/icon1').set({ url: 'https://example/icon.png' });
        await db.doc('ingredients_new/carrot').set({ icons: [] });
        await db.doc('icon_queue/Carrot').set({ status: 'pending' });
        await db.doc('recipes/public1').set({ visibility: 'public', ownerId: 'someone-else' });
        await db.doc('recipes/unlisted1').set({ visibility: 'unlisted', ownerId: 'someone-else' });
        await db.doc('recipes/mine1').set({ visibility: 'private', ownerId: VISITOR });
        await db.doc(`users/${VISITOR}`).set({ displayName: 'Visitor', isAdmin: false });
    });
});

after(async () => {
    await env.cleanup();
});

describe('app flow: feedback submission', () => {
    // components/feedback-modal.tsx. This is the case that #318 broke: the
    // modal must work for logged-OUT visitors, so an unauthenticated create
    // has to be allowed by whatever path reaches Firestore.
    it('a logged-out visitor can submit feedback', async () => {
        await assertSucceeds(
            asAnon().collection('feedback').add({
                message: 'the diagram overlaps on mobile',
                url: 'https://recipelanes.com/lanes?id=abc',
            })
        );
    });

    it('a signed-in visitor can submit feedback', async () => {
        await assertSucceeds(
            asUser().collection('feedback').add({
                message: 'love the timeline view',
                url: 'https://recipelanes.com/lanes?id=abc',
                userId: VISITOR,
            })
        );
    });
});

describe('app flow: viewing recipes', () => {
    // app/lanes/page.tsx and app/icon_overview/page.tsx subscribe to a recipe
    // doc with onSnapshot; the gallery lists public recipes.
    it('anyone can open a public or unlisted (link-shared) recipe', async () => {
        await assertSucceeds(asAnon().doc('recipes/public1').get());
        await assertSucceeds(asAnon().doc('recipes/unlisted1').get());
    });

    it('an owner can open their own private recipe', async () => {
        await assertSucceeds(asUser().doc('recipes/mine1').get());
    });

    it('the gallery can list public recipes', async () => {
        await assertSucceeds(
            asAnon().collection('recipes').where('visibility', '==', 'public').get()
        );
    });
});

describe('app flow: icon display and search', () => {
    // lib/icon-search-registry.ts + components/hooks/useHybridIconSearch.ts
    // read icon_index directly from the browser; the gallery reads feed_icons;
    // nodes resolve ingredient docs.
    it('the client can read the icon index, feed icons, and ingredients', async () => {
        const db = asAnon();
        await assertSucceeds(db.doc('icon_index/icon1').get());
        await assertSucceeds(db.collection('icon_index').limit(5).get());
        await assertSucceeds(db.doc('feed_icons/icon1').get());
        await assertSucceeds(db.collection('feed_icons').limit(5).get());
        await assertSucceeds(db.doc('ingredients_new/carrot').get());
    });
});

describe('app flow: icon generation queue', () => {
    // components/queue-monitor.tsx streams the queue with onSnapshot; the
    // generation pipeline creates and updates queue docs.
    it('the queue monitor can stream queue docs', async () => {
        await assertSucceeds(asAnon().collection('icon_queue').limit(5).get());
        await assertSucceeds(asAnon().doc('icon_queue/Carrot').get());
    });

    it('a generation request can create and update a queue doc', async () => {
        await assertSucceeds(
            asUser().doc('icon_queue/App Flow Probe').set({ status: 'pending' })
        );
        await assertSucceeds(
            asUser().doc('icon_queue/App Flow Probe').update({ status: 'processing' })
        );
    });
});

describe('app flow: user profile and stars', () => {
    // components/auth-provider.tsx reads the user doc on sign-in (isAdmin for
    // UI visibility); starring writes under users/{uid}/stars.
    it('a signed-in user can read their own profile doc', async () => {
        await assertSucceeds(asUser().doc(`users/${VISITOR}`).get());
    });

    it('a signed-in user can write their own profile and stars', async () => {
        await assertSucceeds(
            asUser().doc(`users/${VISITOR}`).set({ displayName: 'Visitor' }, { merge: true })
        );
        await assertSucceeds(
            asUser().doc(`users/${VISITOR}/stars/public1`).set({ recipeId: 'public1' })
        );
        await assertSucceeds(asUser().collection(`users/${VISITOR}/stars`).get());
        await assertSucceeds(asUser().doc(`users/${VISITOR}/stars/public1`).delete());
    });
});
