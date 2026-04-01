import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deleteIconByIdAction } from '../app/actions';
import { setAuthService, AuthSession } from '../lib/auth-service';
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
