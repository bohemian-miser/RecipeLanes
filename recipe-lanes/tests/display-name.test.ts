import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDisplayName } from '../lib/utils';

// Issue 34: the byline must never expose a raw user ID when the user has no
// display name. formatDisplayName resolves the author label shown in the header.
describe('formatDisplayName (Issue 34: hide raw user ID)', () => {
    const uid = 'user-no-name-1718000000000';

    it('returns "Anon" when displayName is empty', () => {
        assert.equal(formatDisplayName(uid, ''), 'Anon');
    });

    it('returns "Anon" when displayName is undefined', () => {
        assert.equal(formatDisplayName(uid, undefined), 'Anon');
    });

    it('returns "Anon" when displayName is only whitespace', () => {
        assert.equal(formatDisplayName(uid, '   '), 'Anon');
    });

    it('never shows the raw uid when displayName equals the uid', () => {
        const out = formatDisplayName(uid, uid);
        assert.equal(out, 'Anon');
        assert.ok(!out.includes(uid));
    });

    it('never shows the raw uid when displayName is the "User <uid>" mock form', () => {
        const out = formatDisplayName(uid, `User ${uid}`);
        assert.equal(out, 'Anon');
        assert.ok(!out.includes(uid));
    });

    it('preserves a genuine display name', () => {
        assert.equal(formatDisplayName(uid, 'Ada Lovelace'), 'Ada Lovelace');
    });

    it('works for guests with no uid', () => {
        assert.equal(formatDisplayName(undefined, ''), 'Anon');
        assert.equal(formatDisplayName(undefined, 'Guest Chef'), 'Guest Chef');
    });
});
