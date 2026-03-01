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

import { deleteIconByUrlAction } from '../app/actions';
import { setAuthService, AuthSession } from '../lib/auth-service';
import * as assert from 'assert';

class MockAuth {
    constructor(private user: AuthSession | null) {}
    async verifyAuth() { return this.user; }
}

async function testAdminSecurity() {
    console.log('Testing Admin Security...');

    // 1. Test as Guest
    setAuthService(new MockAuth(null));
    const res1 = await deleteIconByUrlAction('http://fake.url');
    assert.strictEqual(res1.success, false);
    assert.strictEqual(res1.error, 'Login required');
    console.log('Guest check passed.');

    // 2. Test as Non-Admin
    setAuthService(new MockAuth({ uid: 'user', isAdmin: false }));
    
    // Note: The action now does a DB lookup too!
    // So mocking verifyAuth isn't enough if the action calls DB.
    // Action:
    // const userDoc = await db.collection('users').doc(session.uid).get();
    
    // We need to mock the DB or seed the DB.
    // Since we are in test-unit.sh environment, we have emulators.
    // We can write to the emulator DB.
    
    // Import DB
    const { db } = await import('../lib/firebase-admin');
    
    // Create Non-Admin User
    await db.collection('users').doc('user').set({ isAdmin: false });
    
    const res2 = await deleteIconByUrlAction('http://fake.url');
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.error, 'Admin required');
    console.log('Non-Admin check passed.');

    // 3. Test as Admin
    setAuthService(new MockAuth({ uid: 'admin', isAdmin: true }));
    // Update DB to match (action checks DB)
    await db.collection('users').doc('admin').set({ isAdmin: true });
    
    // It will try to delete from Storage/Firestore which might fail if item missing, 
    // but should pass the admin check.
    // deleteIcon calls DataService.deleteIcon
    // We can't easily mock DataService internal call here without more mocks.
    // But we can check if error is NOT "Admin required".
    
    const res3 = await deleteIconByUrlAction('http://fake.url');
    // It likely fails with "Icon not found" or something, but NOT "Admin required".
    console.log('Admin result:', res3);
    assert.notStrictEqual(res3.error, 'Admin required');
    assert.notStrictEqual(res3.error, 'Login required');
    console.log('Admin check passed.');
}

testAdminSecurity().catch(e => {
    console.error(e);
    process.exit(1);
});