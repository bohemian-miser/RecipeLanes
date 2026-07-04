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

// Feedback triage: turn free-text feedback-form submissions into bug records
// automatically (issue #148). The feedback modal funnels bug reports,
// suggestions and compliments through a single message field, so we use a
// cheap, dependency-free keyword heuristic to decide which submissions look
// like bug reports and derive a structured bug from them. This is pure logic
// (no I/O) so it can be unit-tested without emulators and reused server-side.

/** Free-text feedback as captured by the feedback form / server action. */
export interface FeedbackInput {
  message: string;
  url?: string;
  email?: string;
  userId?: string;
  /** Firestore id of the persisted feedback doc, when known. */
  feedbackId?: string;
}

/** Structured bug record derived from a piece of feedback. */
export interface BugRecord {
  title: string;
  description: string;
  sourceUrl: string;
  reporterEmail: string | null;
  reporterUserId: string | null;
  feedbackId: string | null;
  status: 'open';
}

const MAX_TITLE_LEN = 80;

// Multi-word phrases that strongly signal a bug report. Matched as
// lowercased substrings so punctuation/spacing around them doesn't matter.
const BUG_PHRASES: readonly string[] = [
  "doesn't work",
  'does not work',
  'doesnt work',
  'not working',
  "isn't working",
  'isnt working',
  "won't work",
  'wont work',
  "can't",
  'cannot',
  'not loading',
  "won't load",
  'wont load',
  "doesn't load",
  'no longer works',
  'keeps crashing',
  'not showing',
  "won't save",
  'wont save',
  "didn't save",
  'nothing happens',
];

// Single-token bug indicators, matched on word boundaries so we don't fire on
// substrings inside unrelated words.
const BUG_WORDS: readonly string[] = [
  'bug',
  'buggy',
  'broken',
  'error',
  'errors',
  'crash',
  'crashes',
  'crashed',
  'crashing',
  'glitch',
  'freeze',
  'frozen',
  'froze',
  'hang',
  'hangs',
  'stuck',
  'fail',
  'fails',
  'failed',
  'failing',
  'wrong',
  'missing',
  'unresponsive',
];

const BUG_WORDS_RE = new RegExp(`\\b(${BUG_WORDS.join('|')})\\b`, 'i');

/**
 * Heuristic classifier: does this feedback message read like a bug report
 * (as opposed to a suggestion, compliment or general note)? Case-insensitive.
 */
export function looksLikeBug(message: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  if (BUG_PHRASES.some((p) => lower.includes(p))) return true;
  return BUG_WORDS_RE.test(lower);
}

/**
 * Derive a short, single-line bug title from the feedback message: the first
 * non-empty line, whitespace-collapsed and truncated with an ellipsis.
 */
export function deriveBugTitle(message: string): string {
  const firstLine = (message || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const collapsed = (firstLine ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'User-reported bug';
  if (collapsed.length <= MAX_TITLE_LEN) return collapsed;
  return collapsed.slice(0, MAX_TITLE_LEN - 1).trimEnd() + '…';
}

/** Build a structured bug record from a piece of feedback. */
export function buildBugFromFeedback(input: FeedbackInput): BugRecord {
  const email = input.email?.trim();
  return {
    title: deriveBugTitle(input.message),
    description: (input.message ?? '').trim(),
    sourceUrl: input.url ?? '',
    reporterEmail: email ? email : null,
    reporterUserId: input.userId ?? null,
    feedbackId: input.feedbackId ?? null,
    status: 'open',
  };
}
