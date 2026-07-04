import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  looksLikeBug,
  deriveBugTitle,
  buildBugFromFeedback,
} from '../lib/recipe-lanes/feedback-triage';

describe('feedback-triage: looksLikeBug', () => {
  it('flags messages that mention a bug', () => {
    assert.strictEqual(looksLikeBug('There is a bug on the lanes page'), true);
    assert.strictEqual(looksLikeBug('This feature is really buggy'), true);
  });

  it('flags common bug phrasings', () => {
    assert.strictEqual(looksLikeBug("The forge button doesn't work"), true);
    assert.strictEqual(looksLikeBug('The diagram is broken after saving'), true);
    assert.strictEqual(looksLikeBug('It crashed when I uploaded a photo'), true);
    assert.strictEqual(looksLikeBug("I can't save my recipe"), true);
    assert.strictEqual(looksLikeBug('The page keeps crashing'), true);
    assert.strictEqual(looksLikeBug('Nothing happens when I click forge'), true);
  });

  it('is case-insensitive', () => {
    assert.strictEqual(looksLikeBug('ERROR when loading the gallery'), true);
    assert.strictEqual(looksLikeBug('Does Not Work at all'), true);
  });

  it('does not flag suggestions or compliments', () => {
    assert.strictEqual(looksLikeBug('I love this app, great work!'), false);
    assert.strictEqual(
      looksLikeBug('It would be nice to have a dark mode'),
      false,
    );
    assert.strictEqual(looksLikeBug('Can you add more recipe templates?'), false);
    assert.strictEqual(looksLikeBug(''), false);
  });

  it('does not fire on bug-words embedded in unrelated words', () => {
    // "debugging" contains "bug" but should not match on a word boundary;
    // "errorless" contains "error"; neither is a standalone bug word here.
    assert.strictEqual(looksLikeBug('I enjoyed debugging along with you'), false);
    assert.strictEqual(looksLikeBug('a smooth errorless experience'), false);
  });
});

describe('feedback-triage: deriveBugTitle', () => {
  it('uses the first non-empty line', () => {
    assert.strictEqual(
      deriveBugTitle('\n  Forge button broken  \nmore detail below'),
      'Forge button broken',
    );
  });

  it('collapses internal whitespace', () => {
    assert.strictEqual(deriveBugTitle('too    many   spaces'), 'too many spaces');
  });

  it('truncates long titles with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const title = deriveBugTitle(long);
    assert.ok(title.length <= 80, `title too long: ${title.length}`);
    assert.ok(title.endsWith('…'));
  });

  it('falls back for empty/blank input', () => {
    assert.strictEqual(deriveBugTitle('   \n  '), 'User-reported bug');
    assert.strictEqual(deriveBugTitle(''), 'User-reported bug');
  });
});

describe('feedback-triage: buildBugFromFeedback', () => {
  it('maps all feedback fields onto the bug record', () => {
    const bug = buildBugFromFeedback({
      message: 'The gallery is broken\nsteps: open gallery',
      url: 'https://recipelanes.app/gallery',
      email: '  reporter@example.com  ',
      userId: 'user-123',
      feedbackId: 'fb-abc',
    });
    assert.strictEqual(bug.title, 'The gallery is broken');
    assert.strictEqual(
      bug.description,
      'The gallery is broken\nsteps: open gallery',
    );
    assert.strictEqual(bug.sourceUrl, 'https://recipelanes.app/gallery');
    assert.strictEqual(bug.reporterEmail, 'reporter@example.com');
    assert.strictEqual(bug.reporterUserId, 'user-123');
    assert.strictEqual(bug.feedbackId, 'fb-abc');
    assert.strictEqual(bug.status, 'open');
  });

  it('normalizes missing optional fields to null / empty', () => {
    const bug = buildBugFromFeedback({ message: 'It crashed' });
    assert.strictEqual(bug.sourceUrl, '');
    assert.strictEqual(bug.reporterEmail, null);
    assert.strictEqual(bug.reporterUserId, null);
    assert.strictEqual(bug.feedbackId, null);
    assert.strictEqual(bug.status, 'open');
  });

  it('treats a blank email as no email', () => {
    const bug = buildBugFromFeedback({ message: 'error', email: '   ' });
    assert.strictEqual(bug.reporterEmail, null);
  });
});
