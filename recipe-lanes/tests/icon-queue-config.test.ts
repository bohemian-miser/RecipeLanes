import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { getIconQueueConfigAction, setIconQueueConfigAction, addIngredientNodeAction } from '../app/actions';
import { setAuthService, AuthSession } from '../lib/auth-service';
import {
    getIconQueueConfig,
    setIconQueueConfig,
    getUserForgeCountToday,
    incrementUserForgeCount,
} from '../lib/icon-queue-config';
import { DEFAULT_ICON_QUEUE_CONFIG, DB_COLLECTION_CONFIG, ICON_QUEUE_CONFIG_DOC } from '../lib/config';
import { db } from '../lib/firebase-admin';

class MockAuth {
    constructor(private user: AuthSession | null) {}
    async verifyAuth() { return this.user; }
}

const configRef = () => db.collection(DB_COLLECTION_CONFIG).doc(ICON_QUEUE_CONFIG_DOC);

describe('Icon Queue Config — accessor', () => {
    beforeEach(async () => {
        await configRef().delete().catch(() => {});
    });
    // Reset shared emulator config so leaked non-default values can't poison
    // other integration test files (they share one Firestore config doc).
    afterEach(async () => {
        await configRef().delete().catch(() => {});
    });

    it('returns safe defaults when the doc is missing', async () => {
        const cfg = await getIconQueueConfig();
        assert.deepStrictEqual(cfg, DEFAULT_ICON_QUEUE_CONFIG);
    });

    it('fills in defaults for missing fields', async () => {
        await configRef().set({ paused: true });
        const cfg = await getIconQueueConfig();
        assert.strictEqual(cfg.paused, true);
        assert.strictEqual(cfg.allowAnonForge, DEFAULT_ICON_QUEUE_CONFIG.allowAnonForge);
        assert.strictEqual(cfg.perUserDailyCap, DEFAULT_ICON_QUEUE_CONFIG.perUserDailyCap);
    });

    it('clamps perUserDailyCap to a non-negative integer on write', async () => {
        const cfg = await setIconQueueConfig({ perUserDailyCap: -5 });
        assert.strictEqual(cfg.perUserDailyCap, 0);
        const cfg2 = await setIconQueueConfig({ perUserDailyCap: 42.9 });
        assert.strictEqual(cfg2.perUserDailyCap, 42);
    });
});

describe('Icon Queue Config — admin actions auth', () => {
    afterEach(async () => {
        await configRef().delete().catch(() => {});
    });

    it('blocks guests and non-admins from reading config', async () => {
        setAuthService(new MockAuth(null));
        assert.strictEqual((await getIconQueueConfigAction()).error, 'Login required');

        setAuthService(new MockAuth({ uid: 'u1', isAdmin: false }));
        await db.collection('users').doc('u1').set({ isAdmin: false });
        assert.strictEqual((await getIconQueueConfigAction()).error, 'Admin required');
    });

    it('allows admins to read & write config', async () => {
        setAuthService(new MockAuth({ uid: 'admin', isAdmin: true }));
        await db.collection('users').doc('admin').set({ isAdmin: true });

        const setRes = await setIconQueueConfigAction({ paused: true, perUserDailyCap: 7 });
        assert.strictEqual(setRes.error, undefined);
        assert.strictEqual(setRes.config?.paused, true);
        assert.strictEqual(setRes.config?.perUserDailyCap, 7);

        const getRes = await getIconQueueConfigAction();
        assert.strictEqual(getRes.config?.paused, true);
    });
});

describe('Icon Queue Config — per-user daily counter', () => {
    it('counts and increments per user', async () => {
        const uid = 'counter-user-' + Date.now();
        assert.strictEqual(await getUserForgeCountToday(uid), 0);
        await incrementUserForgeCount(uid);
        await incrementUserForgeCount(uid);
        assert.strictEqual(await getUserForgeCountToday(uid), 2);
    });
});

describe('Icon Queue Config — enqueue gating', () => {
    beforeEach(async () => {
        await configRef().delete().catch(() => {});
    });
    afterEach(async () => {
        await configRef().delete().catch(() => {});
    });

    it('rejects anonymous forge when allowAnonForge is false', async () => {
        await setIconQueueConfig({ allowAnonForge: false });
        setAuthService(new MockAuth(null));
        const res = await addIngredientNodeAction('any-recipe', 'Carrot');
        assert.strictEqual(res.success, false);
        assert.match(res.error || '', /log in/i);
    });

    it('rejects a user at or over the daily cap', async () => {
        const uid = 'capped-user-' + Date.now();
        await setIconQueueConfig({ perUserDailyCap: 1 });
        await incrementUserForgeCount(uid); // now at cap
        setAuthService(new MockAuth({ uid, isAdmin: false }));
        const res = await addIngredientNodeAction('any-recipe', 'Carrot');
        assert.strictEqual(res.success, false);
        assert.match(res.error || '', /limit reached/i);
    });
});
