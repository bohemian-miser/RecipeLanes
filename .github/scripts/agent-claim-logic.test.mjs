// Unit tests for the agent claim protocol's decision logic.
// Run: node --test .github/scripts/   (also runs in the CI `agent-scripts` job)
//
// The headline case is `REGRESSION` below: it replays the 2026-07-26 incident
// where three overlapping worker runs each opened a PR for issue #278, and
// asserts that under this protocol exactly one of them proceeds.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CLAIM_LABEL,
    DEFAULT_TTL_MINUTES,
    READY_LABEL,
    claimMarker,
    evaluateCandidate,
    formatClaimBody,
    isClaimExpired,
    openPullRequestsForIssue,
    parseClaimComment,
    parseClaimComments,
    reapableClaims,
    referencedIssueNumbers,
    resolveClaim,
} from './agent-claim-logic.mjs';

const NOW = Date.parse('2026-07-26T08:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();

const claimComment = (id, worker, createdAt, extra = {}) => ({
    id,
    created_at: createdAt,
    user: { login: 'bohemian-miser' },
    body: formatClaimBody(worker, extra),
});

const readyIssue = (over = {}) => ({
    number: 278,
    state: 'open',
    title: 'Mobile: Graph resets when deleting a node in notation view',
    labels: [{ name: 'bug' }, { name: READY_LABEL }, { name: 'feedback' }],
    ...over,
});

// ------------------------------------------------------------ marker parsing

test('claim marker round-trips through the parser', () => {
    const comment = claimComment(1, 'session-abc', minutesAgo(5), { run: 'https://example.test/run/1' });
    const parsed = parseClaimComment(comment);

    assert.equal(parsed.workerId, 'session-abc');
    assert.equal(parsed.commentId, 1);
    assert.equal(parsed.run, 'https://example.test/run/1');
    assert.equal(parsed.createdAt, minutesAgo(5));
});

test('marker survives quotes in the worker id without breaking the attribute grammar', () => {
    assert.equal(claimMarker('we"ird'), '<!-- agent-claim worker="weird" -->');
});

test('non-claim comments are ignored', () => {
    assert.equal(parseClaimComment({ id: 9, body: 'Opened #285 to fix this.' }), null);
    assert.equal(parseClaimComment({ id: 9, body: '<!-- agent-claim -->' }), null, 'marker without a worker is not a claim');
    assert.equal(parseClaimComment(null), null);
    assert.equal(parseClaimComment({ id: 9 }), null);
});

test('claims sort oldest-first, with the comment id breaking same-second ties', () => {
    const sameSecond = minutesAgo(3);
    const claims = parseClaimComments([
        claimComment(300, 'third', minutesAgo(1)),
        claimComment(202, 'second', sameSecond),
        claimComment(201, 'first', sameSecond),
        { id: 4, body: 'unrelated chatter' },
    ]);

    assert.deepEqual(
        claims.map((c) => c.workerId),
        ['first', 'second', 'third'],
    );
});

// --------------------------------------------------------- winner resolution

test('the earliest live claim wins, and every worker computes the same winner', () => {
    const claims = parseClaimComments([
        claimComment(101, 'worker-a', minutesAgo(30)),
        claimComment(102, 'worker-b', minutesAgo(29)),
        claimComment(103, 'worker-c', minutesAgo(28)),
    ]);

    for (const worker of ['worker-a', 'worker-b', 'worker-c']) {
        const { winner, heldByMe } = resolveClaim(claims, { workerId: worker, now: NOW });
        assert.equal(winner.workerId, 'worker-a', `${worker} must agree on the winner`);
        assert.equal(heldByMe, worker === 'worker-a');
    }
});

test('expired claims are skipped so a crashed worker cannot wedge the queue', () => {
    const claims = parseClaimComments([
        claimComment(101, 'crashed', minutesAgo(DEFAULT_TTL_MINUTES + 1)),
        claimComment(102, 'fresh', minutesAgo(2)),
    ]);
    const { winner, heldByMe, expired } = resolveClaim(claims, { workerId: 'fresh', now: NOW });

    assert.equal(winner.workerId, 'fresh');
    assert.equal(heldByMe, true);
    assert.deepEqual(expired.map((c) => c.workerId), ['crashed']);
});

test('a claim with an unparseable timestamp is treated as expired, not as a permanent hold', () => {
    const claim = { commentId: 1, workerId: 'ghost', createdAt: 'not-a-date' };
    assert.equal(isClaimExpired(claim, NOW), true);
    assert.equal(resolveClaim([claim], { workerId: 'other', now: NOW }).winner, null);
});

test('a claim exactly at the TTL boundary is still live', () => {
    const claim = { commentId: 1, workerId: 'edge', createdAt: minutesAgo(DEFAULT_TTL_MINUTES) };
    assert.equal(isClaimExpired(claim, NOW), false);
});

test('no claims means nobody holds the issue', () => {
    const { winner, heldByMe, mine } = resolveClaim([], { workerId: 'worker-a', now: NOW });
    assert.equal(winner, null);
    assert.equal(heldByMe, false);
    assert.equal(mine, null);
});

// ------------------------------------------------------------- PR references

test('issue references are picked up from titles, bodies and full URLs', () => {
    assert.deepEqual([...referencedIssueNumbers('fix(timeline): guard deletion (#278)')], [278]);
    assert.deepEqual([...referencedIssueNumbers('Closes #278')], [278]);
    assert.deepEqual([...referencedIssueNumbers('see https://github.com/o/r/issues/278')], [278]);
    assert.deepEqual([...referencedIssueNumbers('no refs here')], []);
});

test('an open PR referencing the issue blocks a claim', () => {
    const pulls = [
        { number: 285, title: 'fix(timeline): guard node deletion (#278)', body: 'Closes #278' },
        { number: 999, title: 'chore: unrelated', body: '' },
    ];
    assert.deepEqual(openPullRequestsForIssue(278, pulls).map((p) => p.number), [285]);

    const verdict = evaluateCandidate({ issue: readyIssue(), openPulls: pulls, workerId: 'w', now: NOW });
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.reason, 'open-pr-exists');
    assert.deepEqual(verdict.pulls, [285]);
});

// ------------------------------------------------------------ precheck rules

test('an unclaimed, labeled, open issue is eligible', () => {
    const verdict = evaluateCandidate({ issue: readyIssue(), workerId: 'w', now: NOW });
    assert.deepEqual(verdict, { eligible: true, reason: 'unclaimed' });
});

test('our own live claim keeps the issue eligible so a resumed run can continue', () => {
    const claims = parseClaimComments([claimComment(101, 'w', minutesAgo(10))]);
    const verdict = evaluateCandidate({ issue: readyIssue(), claims, workerId: 'w', now: NOW });
    assert.deepEqual(verdict, { eligible: true, reason: 'already-mine' });
});

test('closed, unlabeled, missing and PR-shaped candidates are all rejected', () => {
    const cases = [
        [{ issue: readyIssue({ state: 'closed' }) }, 'issue-closed'],
        [{ issue: readyIssue({ labels: [{ name: 'bug' }] }) }, 'missing-ready-label'],
        [{ issue: readyIssue({ pull_request: { url: 'x' } }) }, 'not-an-issue'],
        [{ issue: null }, 'issue-not-found'],
    ];
    for (const [input, reason] of cases) {
        const verdict = evaluateCandidate({ ...input, workerId: 'w', now: NOW });
        assert.equal(verdict.eligible, false, reason);
        assert.equal(verdict.reason, reason);
    }
});

test('label names are accepted as plain strings as well as objects', () => {
    const issue = readyIssue({ labels: ['bug', READY_LABEL] });
    assert.equal(evaluateCandidate({ issue, workerId: 'w', now: NOW }).eligible, true);
});

// -------------------------------------------------------------- the incident

test('REGRESSION (#278, 2026-07-26): three overlapping workers, exactly one proceeds', () => {
    // All three precheck an unclaimed issue at the same instant and all three
    // see it as eligible — this is the time-of-check window that produced PRs
    // #285, #286 and #288.
    const issue = readyIssue();
    const workers = ['session-01PUGE', 'session-01XjUZ', 'session-01NLWD'];
    for (const workerId of workers) {
        assert.equal(evaluateCandidate({ issue, workerId, now: NOW }).eligible, true);
    }

    // Each stakes a claim. GitHub assigns ordered comment ids, so after the
    // settle window they all read the same three claims...
    const claims = parseClaimComments([
        claimComment(5081664869, workers[0], '2026-07-26T02:40:18Z'),
        claimComment(5081700642, workers[1], '2026-07-26T02:52:32Z'),
        claimComment(5082520338, workers[2], '2026-07-26T07:21:23Z'),
    ]);

    // ...and independently reach the same verdict: the first one keeps it.
    const held = workers.filter((workerId) => resolveClaim(claims, { workerId, now: NOW, ttlMinutes: 600 }).heldByMe);
    assert.deepEqual(held, [workers[0]], 'exactly one worker may hold the issue');

    // The two losers re-evaluate, see the issue is not theirs, and resign.
    for (const workerId of workers.slice(1)) {
        const verdict = evaluateCandidate({ issue, claims, workerId, now: NOW, ttlMinutes: 600 });
        assert.equal(verdict.eligible, false);
        assert.equal(verdict.reason, 'claimed-by-other');
        assert.equal(verdict.holder, workers[0]);
    }
});

// ------------------------------------------------------------------ reaping

test('reaper releases an expired claim that produced no PR', () => {
    const claims = parseClaimComments([claimComment(101, 'crashed', minutesAgo(DEFAULT_TTL_MINUTES + 30))]);
    const stale = reapableClaims({ issue: readyIssue(), claims, openPulls: [], now: NOW });
    assert.deepEqual(stale.map((c) => c.workerId), ['crashed']);
});

test('reaper leaves an expired claim alone once its PR exists', () => {
    const claims = parseClaimComments([claimComment(101, 'slow-but-done', minutesAgo(DEFAULT_TTL_MINUTES + 30))]);
    const openPulls = [{ number: 285, title: 'fix: thing (#278)', body: '' }];
    assert.deepEqual(reapableClaims({ issue: readyIssue(), claims, openPulls, now: NOW }), []);
});

test('reaper leaves live claims alone', () => {
    const claims = parseClaimComments([claimComment(101, 'working', minutesAgo(5))]);
    assert.deepEqual(reapableClaims({ issue: readyIssue(), claims, openPulls: [], now: NOW }), []);
});

// ------------------------------------------------------------------ contract

test('label constants match the values the workflows and docs use', () => {
    assert.equal(READY_LABEL, 'agent-ready');
    assert.equal(CLAIM_LABEL, 'agent-claimed');
});
