import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeedbackIssue,
  readFeedbackIssueConfig,
  createFeedbackIssue,
  MAX_ISSUE_TITLE_CHARS,
  type FeedbackIssueConfig,
} from '../lib/feedback/feedback-issue';

const CONFIG: FeedbackIssueConfig = {
  token: 'tok_secret',
  repo: 'bohemian-miser/recipelanes',
  labels: ['feedback', 'triage'],
  apiBaseUrl: 'https://api.github.test',
};

type FetchCall = { url: string; init: RequestInit };

/** A fake `fetch` that records calls and returns a canned GitHub-ish response. */
function mockFetch(response: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
  text?: string;
}) {
  const calls: FetchCall[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 201,
      statusText: response.statusText ?? 'Created',
      json: async () => response.json ?? {},
      text: async () => response.text ?? '',
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('feedback → GitHub issue (issue #148)', () => {
  describe('buildFeedbackIssue', () => {
    it('prefixes the title and uses only the first line', () => {
      const { title } = buildFeedbackIssue({ message: 'Button is broken\nmore detail here' });
      assert.equal(title, '[Feedback] Button is broken');
    });

    it('truncates an overly long title', () => {
      const { title } = buildFeedbackIssue({ message: 'x'.repeat(200) });
      assert.ok(title.startsWith('[Feedback] '));
      // "[Feedback] " (11) + capped body (MAX chars incl. the ellipsis)
      assert.equal(title.length, 11 + MAX_ISSUE_TITLE_CHARS);
      assert.ok(title.endsWith('…'));
    });

    it('falls back to a default title and body for an empty message', () => {
      const { title, body } = buildFeedbackIssue({ message: '   ' });
      assert.equal(title, '[Feedback] New feedback');
      assert.ok(body.includes('(no message)'));
    });

    it('includes page, contact and user metadata when present', () => {
      const { body } = buildFeedbackIssue({
        message: 'Hi',
        url: 'https://recipelanes.app/lanes',
        email: 'user@example.com',
        userId: 'user-123',
      });
      assert.ok(body.includes('https://recipelanes.app/lanes'));
      assert.ok(body.includes('user@example.com'));
      assert.ok(body.includes('user-123'));
    });

    it('marks the user as anonymous when no userId is given', () => {
      const { body } = buildFeedbackIssue({ message: 'Hi' });
      assert.ok(body.includes('anonymous'));
    });

    it('wraps the message in a code fence and neutralizes fence breakouts', () => {
      const { body } = buildFeedbackIssue({ message: 'evil ``` breakout @maintainer' });
      assert.ok(body.includes('```text'));
      // The literal triple-backtick from the user must not appear intact.
      assert.ok(!body.includes('evil ``` breakout'));
    });

    it('passes labels through', () => {
      const { labels } = buildFeedbackIssue({ message: 'Hi' }, ['feedback', 'bug']);
      assert.deepEqual(labels, ['feedback', 'bug']);
    });
  });

  describe('readFeedbackIssueConfig', () => {
    it('returns null when the token is missing', () => {
      assert.equal(readFeedbackIssueConfig({ FEEDBACK_GITHUB_REPO: 'a/b' }), null);
    });

    it('returns null when the repo is missing', () => {
      assert.equal(readFeedbackIssueConfig({ FEEDBACK_GITHUB_TOKEN: 'tok' }), null);
    });

    it('returns config with sensible defaults when token and repo are present', () => {
      const cfg = readFeedbackIssueConfig({ FEEDBACK_GITHUB_TOKEN: 'tok', FEEDBACK_GITHUB_REPO: 'a/b' });
      assert.deepEqual(cfg, {
        token: 'tok',
        repo: 'a/b',
        labels: ['feedback'],
        apiBaseUrl: 'https://api.github.com',
      });
    });

    it('parses custom comma-separated labels and a custom API base', () => {
      const cfg = readFeedbackIssueConfig({
        FEEDBACK_GITHUB_TOKEN: 'tok',
        FEEDBACK_GITHUB_REPO: 'a/b',
        FEEDBACK_GITHUB_LABELS: 'feedback, bug , ux',
        FEEDBACK_GITHUB_API_URL: 'https://ghe.example.com/api/v3',
      });
      assert.deepEqual(cfg?.labels, ['feedback', 'bug', 'ux']);
      assert.equal(cfg?.apiBaseUrl, 'https://ghe.example.com/api/v3');
    });
  });

  describe('createFeedbackIssue', () => {
    it('is a no-op (returns null) when the feature is not configured', async () => {
      const { impl, calls } = mockFetch({});
      const result = await createFeedbackIssue({ message: 'Hi' }, { fetch: impl, config: null });
      assert.equal(result, null);
      assert.equal(calls.length, 0, 'should not hit the network when disabled');
    });

    it('throws on a misconfigured repo', async () => {
      const { impl } = mockFetch({});
      await assert.rejects(
        () => createFeedbackIssue({ message: 'Hi' }, { fetch: impl, config: { ...CONFIG, repo: 'not-a-repo' } }),
        /Invalid FEEDBACK_GITHUB_REPO/,
      );
    });

    it('POSTs to the correct endpoint with auth + payload and returns the created issue', async () => {
      const { impl, calls } = mockFetch({ json: { html_url: 'https://github.test/x/y/issues/42', number: 42 } });
      const result = await createFeedbackIssue(
        { message: 'Broken button', url: 'https://recipelanes.app', userId: 'u1' },
        { fetch: impl, config: CONFIG },
      );

      assert.deepEqual(result, { url: 'https://github.test/x/y/issues/42', number: 42 });
      assert.equal(calls.length, 1);

      const call = calls[0];
      assert.equal(call.url, 'https://api.github.test/repos/bohemian-miser/recipelanes/issues');
      assert.equal(call.init.method, 'POST');
      const headers = call.init.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer tok_secret');
      assert.equal(headers.Accept, 'application/vnd.github+json');

      const sent = JSON.parse(call.init.body as string);
      assert.deepEqual(sent.labels, ['feedback', 'triage']);
      assert.ok(sent.title.startsWith('[Feedback] Broken button'));
      assert.ok(sent.body.includes('Broken button'));
    });

    it('throws with the status when GitHub responds non-2xx', async () => {
      const { impl } = mockFetch({ ok: false, status: 401, statusText: 'Unauthorized', text: 'Bad credentials' });
      await assert.rejects(
        () => createFeedbackIssue({ message: 'Hi' }, { fetch: impl, config: CONFIG }),
        /401/,
      );
    });

    it('throws when GitHub returns an unexpected response shape', async () => {
      const { impl } = mockFetch({ json: { message: 'weird' } });
      await assert.rejects(
        () => createFeedbackIssue({ message: 'Hi' }, { fetch: impl, config: CONFIG }),
        /unexpected response/,
      );
    });
  });
});
