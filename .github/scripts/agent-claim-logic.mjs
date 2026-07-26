// Pure decision logic for the agent issue-claim protocol. No I/O, no network —
// every function here takes plain data so it can be unit-tested without a
// GitHub token (see agent-claim-logic.test.mjs). The network shell lives in
// agent-claim.mjs.
//
// WHY THIS EXISTS: the Claude "bug worker" routine fires on a schedule with no
// serialization, so several runs can be in flight at once. Its dedup rule was
// "skip issues that already have an open PR or branch" — evaluated at selection
// time, before any run has opened a PR. That is a time-of-check/time-of-use
// race, and on 2026-07-26 three overlapping runs each picked issue #278 and
// opened PRs #285, #286 and #288 for it. A claim has to be *published* at
// selection time, not inferred from work that does not exist yet.
//
// GitHub has no compare-and-swap on labels, so the label alone cannot arbitrate
// a tie: two workers can both read "unclaimed" and both add it. Comments can —
// they carry server-assigned, monotonically increasing ids. So the label is the
// cheap human-visible marker, and the *claim comment* is the arbiter: every
// worker stakes a claim comment, then re-reads and yields unless its own claim
// is the earliest live one.

/** Label the owner puts on issues the Claude worker may pick up. */
export const READY_LABEL = 'agent-ready';

/** Label a worker adds while it holds an issue. Human-visible queue state. */
export const CLAIM_LABEL = 'agent-claimed';

/** How long a claim stays valid without a PR before the reaper releases it. */
export const DEFAULT_TTL_MINUTES = 180;

const MARKER_RE = /<!--\s*agent-claim\s+(?<attrs>[^>]*?)-->/;
const ATTR_RE = /(?<key>[a-zA-Z][\w-]*)="(?<value>[^"]*)"/g;

/**
 * The hidden marker that makes a comment machine-identifiable as a claim.
 * Kept on one line so the parser never has to deal with wrapping.
 */
export function claimMarker(workerId, meta = {}) {
    const attrs = [['worker', workerId], ...Object.entries(meta)]
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`)
        .join(' ');
    return `<!-- agent-claim ${attrs} -->`;
}

/** Full body of a claim comment: the marker plus a line humans can read. */
export function formatClaimBody(workerId, meta = {}) {
    const where = meta.run ? ` ([run](${meta.run}))` : '';
    return [
        claimMarker(workerId, meta),
        `🤖 Claimed by agent worker \`${workerId}\`${where}.`,
        '',
        `Another worker should pick a different issue while this claim is live. ` +
            `The claim is released automatically if no PR appears within ` +
            `${meta.ttlMinutes ?? DEFAULT_TTL_MINUTES} minutes.`,
    ].join('\n');
}

/**
 * Extract the claim from a single comment, or null if it is not a claim.
 * @param {{id:number, body?:string, created_at?:string, user?:{login?:string}}} comment
 */
export function parseClaimComment(comment) {
    if (!comment || typeof comment.body !== 'string') return null;
    const marker = MARKER_RE.exec(comment.body);
    if (!marker) return null;

    const attrs = {};
    for (const m of marker.groups.attrs.matchAll(ATTR_RE)) {
        attrs[m.groups.key] = m.groups.value;
    }
    if (!attrs.worker) return null;

    return {
        commentId: comment.id,
        workerId: attrs.worker,
        run: attrs.run ?? null,
        createdAt: comment.created_at ?? null,
        author: comment.user?.login ?? null,
    };
}

/** All claims on an issue, oldest first (createdAt, then comment id as tiebreak). */
export function parseClaimComments(comments = []) {
    return comments
        .map(parseClaimComment)
        .filter(Boolean)
        .sort((a, b) => {
            const at = Date.parse(a.createdAt ?? '') || 0;
            const bt = Date.parse(b.createdAt ?? '') || 0;
            if (at !== bt) return at - bt;
            return a.commentId - b.commentId;
        });
}

function ageMinutes(claim, now) {
    const t = Date.parse(claim.createdAt ?? '');
    if (Number.isNaN(t)) return Infinity; // undatable claim → treat as expired
    return (now - t) / 60000;
}

/** True when a claim has outlived its TTL and may be reaped. */
export function isClaimExpired(claim, now, ttlMinutes = DEFAULT_TTL_MINUTES) {
    return ageMinutes(claim, now) > ttlMinutes;
}

/**
 * Decide who actually holds an issue.
 *
 * Expired claims are ignored so a crashed worker cannot wedge the queue
 * forever; among the survivors the earliest wins, because every worker sees the
 * same total order and therefore reaches the same verdict without coordinating.
 *
 * @returns {{winner: object|null, heldByMe: boolean, mine: object|null, expired: object[]}}
 */
export function resolveClaim(claims, { workerId, now = Date.now(), ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
    const live = [];
    const expired = [];
    for (const claim of claims) {
        (isClaimExpired(claim, now, ttlMinutes) ? expired : live).push(claim);
    }
    const winner = live[0] ?? null;
    const mine = claims.find((c) => c.workerId === workerId) ?? null;
    return {
        winner,
        mine,
        heldByMe: Boolean(winner && workerId && winner.workerId === workerId),
        expired,
    };
}

/**
 * Issue numbers referenced by a PR title/body — `#278`, `Closes #278`, and full
 * `https://github.com/owner/repo/issues/278` URLs all count.
 */
export function referencedIssueNumbers(text = '') {
    const numbers = new Set();
    for (const m of String(text).matchAll(/#(\d+)\b/g)) numbers.add(Number(m[1]));
    for (const m of String(text).matchAll(/\/issues\/(\d+)\b/g)) numbers.add(Number(m[1]));
    return numbers;
}

/** Open PRs that already reference this issue — the pre-existing dedup signal. */
export function openPullRequestsForIssue(issueNumber, pulls = []) {
    return pulls.filter((pr) => referencedIssueNumbers(`${pr.title ?? ''}\n${pr.body ?? ''}`).has(issueNumber));
}

const labelNames = (issue) => (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

/**
 * Can this worker start on this issue? Returns a machine-readable reason so the
 * caller can log why a candidate was skipped.
 *
 * `eligible` here means "nothing visible blocks a claim" — it is the *pre*check.
 * Winning the claim still requires staking and re-reading (see resolveClaim).
 */
export function evaluateCandidate({
    issue,
    claims = [],
    openPulls = [],
    workerId,
    now = Date.now(),
    ttlMinutes = DEFAULT_TTL_MINUTES,
    readyLabel = READY_LABEL,
}) {
    if (!issue) return { eligible: false, reason: 'issue-not-found' };
    if (issue.state && issue.state !== 'open') return { eligible: false, reason: 'issue-closed' };
    if (issue.pull_request) return { eligible: false, reason: 'not-an-issue' };
    if (readyLabel && !labelNames(issue).includes(readyLabel)) {
        return { eligible: false, reason: 'missing-ready-label' };
    }

    const blockingPulls = openPullRequestsForIssue(issue.number, openPulls);
    if (blockingPulls.length > 0) {
        return { eligible: false, reason: 'open-pr-exists', pulls: blockingPulls.map((p) => p.number) };
    }

    const { winner, heldByMe } = resolveClaim(claims, { workerId, now, ttlMinutes });
    if (winner && !heldByMe) {
        return { eligible: false, reason: 'claimed-by-other', holder: winner.workerId };
    }

    return { eligible: true, reason: heldByMe ? 'already-mine' : 'unclaimed' };
}

/**
 * Claims the reaper should release: expired, and with no open PR to show for it.
 * An expired claim that *did* produce a PR is left alone — the PR is the proof
 * the work happened, and `open-pr-exists` keeps other workers off the issue.
 */
export function reapableClaims({ issue, claims = [], openPulls = [], now = Date.now(), ttlMinutes = DEFAULT_TTL_MINUTES }) {
    if (openPullRequestsForIssue(issue.number, openPulls).length > 0) return [];
    return claims.filter((c) => isClaimExpired(c, now, ttlMinutes));
}
