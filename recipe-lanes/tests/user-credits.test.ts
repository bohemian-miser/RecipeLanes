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

// Icon credits: starter grant, atomic spend/refund, and the credit gate on
// forgeIconAction. Emulator-backed (writes user_credits via firebase-admin).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { getUserCredits, spendIconCredits, refundIconCredits } from '../lib/user-credits';
import { forgeIconAction, getIconCreditsAction } from '../app/actions';
import { setAuthService, AuthSession } from '../lib/auth-service';
import { setDataService, MemoryDataService } from '../lib/data-service';
import { db } from '../lib/firebase-admin';
import {
    DB_COLLECTION_USER_CREDITS,
    DB_COLLECTION_CONFIG,
    ICON_QUEUE_CONFIG_DOC,
    STARTER_ICON_CREDITS,
} from '../lib/config';

class MockAuth {
    constructor(private user: AuthSession | null) {}
    async verifyAuth() { return this.user; }
}

// Records forge calls without touching Firestore recipes.
class SpyDataService extends MemoryDataService {
    forgeCalls = 0;
    forgeResult: { success: boolean; error?: string } = { success: true };
    async rejectRecipeIcon(): Promise<{ success: boolean; error?: string }> {
        this.forgeCalls++;
        return this.forgeResult;
    }
}

const uid = () => `credits-user-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const creditsRef = (u: string) => db.collection(DB_COLLECTION_USER_CREDITS).doc(u);

describe('user-credits — balance accounting', () => {
    it('seeds the starter grant on first read', async () => {
        const u = uid();
        const credits = await getUserCredits(u);
        assert.strictEqual(credits.balance, STARTER_ICON_CREDITS);
        assert.strictEqual(credits.granted, STARTER_ICON_CREDITS);
        assert.strictEqual(credits.spent, 0);

        // The grant is persisted, not just returned.
        const doc = await creditsRef(u).get();
        assert.strictEqual(doc.data()?.balance, STARTER_ICON_CREDITS);
    });

    it('does not double-grant on a second read', async () => {
        const u = uid();
        await getUserCredits(u);
        const again = await getUserCredits(u);
        assert.strictEqual(again.balance, STARTER_ICON_CREDITS);
        assert.strictEqual(again.granted, STARTER_ICON_CREDITS);
    });

    it('spends atomically and refuses an insufficient balance', async () => {
        const u = uid();
        const first = await spendIconCredits(u, 1);
        assert.deepStrictEqual(first, { ok: true, balance: STARTER_ICON_CREDITS - 1 });

        const drain = await spendIconCredits(u, STARTER_ICON_CREDITS - 1);
        assert.strictEqual(drain.ok, true);
        assert.strictEqual(drain.balance, 0);

        const broke = await spendIconCredits(u, 1);
        assert.deepStrictEqual(broke, { ok: false, balance: 0 });

        const credits = await getUserCredits(u);
        assert.strictEqual(credits.balance, 0);
        assert.strictEqual(credits.spent, STARTER_ICON_CREDITS);
    });

    it('refund restores the balance and lifetime counters', async () => {
        const u = uid();
        await spendIconCredits(u, 2);
        await refundIconCredits(u, 1);
        const credits = await getUserCredits(u);
        assert.strictEqual(credits.balance, STARTER_ICON_CREDITS - 1);
        assert.strictEqual(credits.spent, 1);
    });

    it('rejects nonsensical costs', async () => {
        const u = uid();
        await assert.rejects(() => spendIconCredits(u, 0));
        await assert.rejects(() => spendIconCredits(u, -1));
        await assert.rejects(() => refundIconCredits(u, 1.5));
    });
});

describe('forgeIconAction — credit gate', () => {
    let spy: SpyDataService;

    beforeEach(async () => {
        await db.collection(DB_COLLECTION_CONFIG).doc(ICON_QUEUE_CONFIG_DOC).delete().catch(() => {});
        spy = new SpyDataService();
        setDataService(spy);
    });

    afterEach(async () => {
        await db.collection(DB_COLLECTION_CONFIG).doc(ICON_QUEUE_CONFIG_DOC).delete().catch(() => {});
    });

    it('rejects anonymous callers before touching the queue', async () => {
        setAuthService(new MockAuth(null));
        const res = await forgeIconAction('r1', 'Carrot');
        assert.strictEqual(res.success, false);
        assert.match(res.error || '', /sign in/i);
        assert.strictEqual(spy.forgeCalls, 0);
    });

    it('spends one credit on a successful forge and reports the remainder', async () => {
        const u = uid();
        setAuthService(new MockAuth({ uid: u, isAdmin: false }));

        const res = await forgeIconAction('r1', 'Carrot');
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.creditsRemaining, STARTER_ICON_CREDITS - 1);
        assert.strictEqual(spy.forgeCalls, 1);

        const credits = await getUserCredits(u);
        assert.strictEqual(credits.balance, STARTER_ICON_CREDITS - 1);
    });

    it('blocks a user with an empty balance without forging', async () => {
        const u = uid();
        setAuthService(new MockAuth({ uid: u, isAdmin: false }));
        await spendIconCredits(u, STARTER_ICON_CREDITS);

        const res = await forgeIconAction('r1', 'Carrot');
        assert.strictEqual(res.success, false);
        assert.match(res.error || '', /out of icon credits/i);
        assert.strictEqual(res.creditsRemaining, 0);
        assert.strictEqual(spy.forgeCalls, 0);
    });

    it('refunds the credit when the forge fails to enqueue', async () => {
        const u = uid();
        setAuthService(new MockAuth({ uid: u, isAdmin: false }));
        spy.forgeResult = { success: false, error: 'Recipe not found' };

        const res = await forgeIconAction('r1', 'Carrot');
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.creditsRemaining, STARTER_ICON_CREDITS);

        const credits = await getUserCredits(u);
        assert.strictEqual(credits.balance, STARTER_ICON_CREDITS, 'failed forge must not burn a credit');
        assert.strictEqual(credits.spent, 0);
    });

    it('getIconCreditsAction reports the live balance for the signed-in user', async () => {
        const u = uid();
        setAuthService(new MockAuth({ uid: u, isAdmin: false }));

        assert.deepStrictEqual(await getIconCreditsAction(), { signedIn: true, balance: STARTER_ICON_CREDITS });

        await forgeIconAction('r1', 'Carrot');
        assert.deepStrictEqual(await getIconCreditsAction(), { signedIn: true, balance: STARTER_ICON_CREDITS - 1 });

        setAuthService(new MockAuth(null));
        assert.deepStrictEqual(await getIconCreditsAction(), { signedIn: false, balance: 0 });
    });
});
