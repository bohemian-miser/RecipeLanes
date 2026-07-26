import { test } from 'node:test';
import assert from 'node:assert';
import { isUntriaged, toTriageItem } from '../scripts/lib/feedback-triage-lib';

test('isUntriaged: true only when triage field is absent', () => {
    assert.strictEqual(isUntriaged({ message: 'hi' }), true);
    assert.strictEqual(isUntriaged({ triage: { status: 'filed', issue: 12 } }), false);
    assert.strictEqual(isUntriaged({ triage: { status: 'skipped', reason: 'noise' } }), false);
});

test('toTriageItem: never exposes email, truncates userId', () => {
    const item = toTriageItem('doc1', {
        message: 'the diagram overlaps on mobile',
        url: 'https://recipelanes.com/lanes/abc',
        email: 'reporter@example.com',
        userId: 'uid_1234567890abcdef',
        created_at: { toDate: () => new Date('2026-07-01T10:00:00Z') },
    });
    assert.strictEqual(JSON.stringify(item).includes('reporter@example.com'), false);
    assert.strictEqual('email' in (item as unknown as Record<string, unknown>), false);
    assert.strictEqual(item.userIdHint, 'uid_1234…');
    assert.strictEqual(item.message, 'the diagram overlaps on mobile');
    assert.strictEqual(item.url, 'https://recipelanes.com/lanes/abc');
    assert.strictEqual(item.createdAt, '2026-07-01T10:00:00.000Z');
});

test('toTriageItem: tolerates missing/malformed optional fields', () => {
    const item = toTriageItem('doc2', {});
    assert.deepStrictEqual(item, { id: 'doc2', message: '', url: '', userIdHint: null, createdAt: null });
    const item2 = toTriageItem('doc3', { message: 42, userId: null, created_at: 'not-a-timestamp' });
    assert.strictEqual(item2.message, '');
    assert.strictEqual(item2.userIdHint, null);
    assert.strictEqual(item2.createdAt, null);
});
