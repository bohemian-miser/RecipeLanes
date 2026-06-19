import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deleteIconByIdAction, addIngredientNodeAction } from '../app/actions';
import { setAuthService, AuthSession } from '../lib/auth-service';
import { setIconQueueConfig } from '../lib/icon-queue-config';
import { db } from '../lib/firebase-admin';

class MockAuth {
    constructor(private user: AuthSession | null) {}
    async verifyAuth() { return this.user; }
}

describe('Admin Security', () => {
    it('should block guest from deleting icon', async () => {
        setAuthService(new MockAuth(null));
        const res = await deleteIconByIdAction('fake-id');
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.error, 'Login required');
    });

    it('should block non-admin from deleting icon', async () => {
        setAuthService(new MockAuth({ uid: 'user', isAdmin: false }));
        // Action checks Firestore too
        await db.collection('users').doc('user').set({ isAdmin: false });
        
        const res = await deleteIconByIdAction('fake-id');
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.error, 'Admin required');
    });

    it('should allow admin to pass security check', async () => {
        setAuthService(new MockAuth({ uid: 'admin', isAdmin: true }));
        await db.collection('users').doc('admin').set({ isAdmin: true });
        
        const res = await deleteIconByIdAction('fake-id');
        // We expect it NOT to fail with auth error, though it might fail because ID is fake
        assert.notStrictEqual(res.error, 'Admin required');
        assert.notStrictEqual(res.error, 'Login required');
    });
});

describe('Forge Auth Scoping (Bug 172) + abuse controls', () => {
    const ANON_BLOCKED = 'Please log in to forge new icons.';

    it('should allow anonymous forging when allowAnonForge is true (default)', async () => {
        setAuthService(new MockAuth(null));
        await setIconQueueConfig({ allowAnonForge: true });
        const res = await addIngredientNodeAction('missing-recipe', 'Carrot');
        // Anon is permitted by default; the action may still fail for other
        // reasons (e.g. missing recipe) but never with the anon-gate message.
        assert.notStrictEqual(res.error, ANON_BLOCKED);
    });

    it('should block anonymous forging when allowAnonForge is false', async () => {
        setAuthService(new MockAuth(null));
        await setIconQueueConfig({ allowAnonForge: false });
        const res = await addIngredientNodeAction('any-recipe', 'Carrot');
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.error, ANON_BLOCKED);
    });

    it('should let a logged-in (non-admin) user past the anon gate', async () => {
        setAuthService(new MockAuth({ uid: 'forger', isAdmin: false }));
        await setIconQueueConfig({ allowAnonForge: false });
        const res = await addIngredientNodeAction('missing-recipe', 'Carrot');
        // A logged-in user is not subject to the anon gate.
        assert.notStrictEqual(res.error, ANON_BLOCKED);
    });
});
