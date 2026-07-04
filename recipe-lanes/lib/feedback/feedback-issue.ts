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

/**
 * Turn submitted feedback into a GitHub issue (issue #148 — "automate feedback
 * into bugs").
 *
 * Design notes:
 *  - The feature is *opt-in* and inert by default: unless BOTH
 *    FEEDBACK_GITHUB_TOKEN and FEEDBACK_GITHUB_REPO are configured,
 *    {@link createFeedbackIssue} short-circuits and returns null. This keeps it
 *    disabled in CI/preview/production until the owner explicitly wires the
 *    secrets, so nothing accidentally spams the issue tracker.
 *  - It uses the GitHub REST API directly via `fetch` (no new dependency).
 *  - Both the payload builder and the config reader are pure and injectable so
 *    the behaviour can be unit-tested without a network or emulator.
 */

export interface FeedbackInput {
  message: string;
  url?: string;
  email?: string;
  userId?: string;
}

export interface FeedbackIssueConfig {
  /** GitHub token with `issues:write` on the target repo. */
  token: string;
  /** Target repository as "owner/name". */
  repo: string;
  /** Labels applied to the created issue. */
  labels: string[];
  /** API base, overridable for GitHub Enterprise / tests. */
  apiBaseUrl: string;
}

export interface CreatedIssue {
  url: string;
  number: number;
}

export interface GithubIssuePayload {
  title: string;
  body: string;
  labels: string[];
}

/** Max length of the generated issue title (GitHub allows 256; we keep it tidy). */
export const MAX_ISSUE_TITLE_CHARS = 80;

const DEFAULT_API_BASE_URL = 'https://api.github.com';
const DEFAULT_LABEL = 'feedback';

/**
 * Read the feedback→issue configuration from an env-like object. Returns null
 * (feature disabled) unless both a token and a target repo are present.
 */
export function readFeedbackIssueConfig(
  env: Record<string, string | undefined> = process.env,
): FeedbackIssueConfig | null {
  const token = env.FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = env.FEEDBACK_GITHUB_REPO?.trim();
  if (!token || !repo) return null;

  const labels = (env.FEEDBACK_GITHUB_LABELS ?? DEFAULT_LABEL)
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const apiBaseUrl = env.FEEDBACK_GITHUB_API_URL?.trim() || DEFAULT_API_BASE_URL;

  return { token, repo, labels: labels.length ? labels : [DEFAULT_LABEL], apiBaseUrl };
}

/** Collapse whitespace and cap length for use as a one-line issue title. */
function toTitle(message: string): string {
  const firstLine = message.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ');
  const base = collapsed.length ? collapsed : 'New feedback';
  const capped =
    base.length > MAX_ISSUE_TITLE_CHARS ? `${base.slice(0, MAX_ISSUE_TITLE_CHARS - 1).trimEnd()}…` : base;
  return `[Feedback] ${capped}`;
}

/**
 * Build the GitHub issue payload from feedback. Pure. The raw message is placed
 * inside a fenced code block so that markdown / @-mentions in user-submitted
 * text can't render or ping people in the issue tracker.
 */
export function buildFeedbackIssue(feedback: FeedbackInput, labels: string[] = [DEFAULT_LABEL]): GithubIssuePayload {
  const message = (feedback.message ?? '').trim();

  const meta: string[] = [];
  if (feedback.url) meta.push(`- **Page:** ${feedback.url}`);
  if (feedback.email) meta.push(`- **Contact:** ${feedback.email}`);
  meta.push(`- **User:** ${feedback.userId ?? 'anonymous'}`);

  // Guard against ``` inside the message breaking out of the fence.
  const fencedMessage = message.replace(/```/g, '`​``');

  const body = [
    '_Automatically filed from the in-app feedback form._',
    '',
    '### Feedback',
    '```text',
    fencedMessage.length ? fencedMessage : '(no message)',
    '```',
    '',
    '### Details',
    ...meta,
  ].join('\n');

  return { title: toTitle(message), body, labels };
}

/**
 * Create a GitHub issue from feedback.
 *
 * Returns null when the feature is not configured (disabled). Throws on a
 * misconfigured repo or a non-2xx GitHub response — callers that treat this as
 * best-effort should catch and log.
 */
export async function createFeedbackIssue(
  feedback: FeedbackInput,
  deps: {
    fetch?: typeof fetch;
    config?: FeedbackIssueConfig | null;
  } = {},
): Promise<CreatedIssue | null> {
  const config = deps.config !== undefined ? deps.config : readFeedbackIssueConfig();
  if (!config) return null;

  if (!/^[^/\s]+\/[^/\s]+$/.test(config.repo)) {
    throw new Error(`Invalid FEEDBACK_GITHUB_REPO "${config.repo}" (expected "owner/name")`);
  }

  const fetchImpl = deps.fetch ?? fetch;
  const payload = buildFeedbackIssue(feedback, config.labels);

  const res = await fetchImpl(`${config.apiBaseUrl}/repos/${config.repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'RecipeLanes-Feedback',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub issue creation failed: ${res.status} ${res.statusText} ${detail}`.trim());
  }

  const json = (await res.json()) as { html_url?: string; number?: number };
  if (!json.html_url || typeof json.number !== 'number') {
    throw new Error('GitHub issue creation returned an unexpected response');
  }

  return { url: json.html_url, number: json.number };
}
