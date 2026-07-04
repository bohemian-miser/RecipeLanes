import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { db } from '../lib/firebase-admin';
import { getDataService } from '../lib/data-service';
import { DB_COLLECTION_BUGS, DB_COLLECTION_FEEDBACK } from '../lib/config';

async function clearCollection(name: string) {
  const snap = await db.collection(name).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe('Feedback → Bug automation (issue #148)', () => {
  const svc = getDataService();

  beforeEach(async () => {
    await clearCollection(DB_COLLECTION_BUGS);
    await clearCollection(DB_COLLECTION_FEEDBACK);
  });

  it('files a bug for bug-like feedback, linked to the stored feedback', async () => {
    await svc.submitFeedback({
      message: 'The forge button is broken and crashes',
      url: 'https://recipelanes.app/lanes',
      email: 'reporter@example.com',
      userId: 'user-1',
    });

    const feedback = await db.collection(DB_COLLECTION_FEEDBACK).get();
    assert.strictEqual(feedback.size, 1, 'feedback should still be stored');

    const bugs = await db.collection(DB_COLLECTION_BUGS).get();
    assert.strictEqual(bugs.size, 1, 'expected exactly one bug filed');

    const bug = bugs.docs[0].data();
    assert.strictEqual(bug.title, 'The forge button is broken and crashes');
    assert.strictEqual(bug.status, 'open');
    assert.strictEqual(bug.sourceUrl, 'https://recipelanes.app/lanes');
    assert.strictEqual(bug.reporterEmail, 'reporter@example.com');
    assert.strictEqual(bug.reporterUserId, 'user-1');
    // The bug links back to the source feedback document.
    assert.strictEqual(bug.feedbackId, feedback.docs[0].id);
    assert.ok(bug.created_at, 'bug should carry a server timestamp');
  });

  it('does not file a bug for a suggestion, but still stores the feedback', async () => {
    await svc.submitFeedback({
      message: 'I love this app, could you add a dark mode?',
      url: 'https://recipelanes.app/',
    });

    const feedback = await db.collection(DB_COLLECTION_FEEDBACK).get();
    assert.strictEqual(feedback.size, 1, 'feedback should still be stored');

    const bugs = await db.collection(DB_COLLECTION_BUGS).get();
    assert.strictEqual(bugs.size, 0, 'a suggestion should not create a bug');
  });
});
