#!/usr/bin/env node
// Agent issue-claim CLI — the network shell around agent-claim-logic.mjs.
// No dependencies (Node 20 global fetch), same style as mint-app-token.mjs.
//
// Protocol (full rationale in docs/agent-worker-protocol.md):
//   1. PRECHECK  — issue open, labeled `agent-ready`, no open PR, no live claim.
//   2. STAKE     — post a claim comment (hidden marker) + add `agent-claimed`.
//   3. SETTLE    — wait, re-read all claims, and yield unless ours is earliest.
//   4. RELEASE   — on abandon, delete our claim comment and drop the label.
//
// Step 3 is the whole point: adding a label is not atomic, so two workers can
// both observe "unclaimed" and both label it. Comment ids are server-assigned
// and ordered, so after the settle window every worker computes the same
// winner from the same comment list and all but one back off.
//
// Usage:
//   node .github/scripts/agent-claim.mjs list                 # eligible issues, JSON
//   node .github/scripts/agent-claim.mjs status <issue>       # who holds it, JSON
//   node .github/scripts/agent-claim.mjs claim <issue>        # exit 0 held, 3 lost
//   node .github/scripts/agent-claim.mjs release <issue>      # give it back
//   node .github/scripts/agent-claim.mjs reap                 # release expired claims
//
// Env:
//   GITHUB_TOKEN / GH_TOKEN   required — issues: write
//   GITHUB_REPOSITORY         "owner/name" (or pass --repo)
//   AGENT_WORKER_ID           stable id for this run (or pass --worker)
//   AGENT_CLAIM_TTL_MINUTES   claim lifetime, default 180
//   AGENT_CLAIM_SETTLE_MS     settle window before verifying, default 20000

import os from 'node:os';
import {
    CLAIM_LABEL,
    DEFAULT_TTL_MINUTES,
    READY_LABEL,
    evaluateCandidate,
    formatClaimBody,
    openPullRequestsForIssue,
    parseClaimComments,
    reapableClaims,
    resolveClaim,
} from './agent-claim-logic.mjs';

// ---------------------------------------------------------------- args & env

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
        const key = argv[i].slice(2);
        const eq = key.indexOf('=');
        if (eq !== -1) flags[key.slice(0, eq)] = key.slice(eq + 1);
        else flags[key] = argv[++i] ?? 'true';
    } else {
        positional.push(argv[i]);
    }
}

const command = positional[0];
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const REPO = flags.repo || process.env.GITHUB_REPOSITORY;
const TTL = Number(flags.ttl || process.env.AGENT_CLAIM_TTL_MINUTES || DEFAULT_TTL_MINUTES);
const SETTLE_MS = Number(flags.settle ?? process.env.AGENT_CLAIM_SETTLE_MS ?? 20000);
const READY = flags.label || process.env.AGENT_READY_LABEL || READY_LABEL;
const DRY_RUN = flags['dry-run'] === 'true' || process.env.AGENT_CLAIM_DRY_RUN === 'true';

/** A worker id that is stable for a run and distinct between concurrent runs. */
function defaultWorkerId() {
    if (process.env.AGENT_WORKER_ID) return process.env.AGENT_WORKER_ID;
    if (process.env.GITHUB_RUN_ID) return `gha-${process.env.GITHUB_RUN_ID}`;
    return `local-${os.hostname()}-${process.pid}`;
}
const WORKER_ID = flags.worker || defaultWorkerId();
const RUN_URL =
    flags.run ||
    (process.env.GITHUB_RUN_ID && REPO
        ? `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined);

function die(message, code = 1) {
    console.error(`agent-claim: ${message}`);
    process.exit(code);
}

const EXIT_LOST = 3; // "not yours — pick a different issue", not a failure

// ------------------------------------------------------------------- github

async function gh(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (raw) return res;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
}

async function ghPaged(path) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
        const sep = path.includes('?') ? '&' : '?';
        const batch = await gh(`${path}${sep}per_page=100&page=${page}`);
        out.push(...batch);
        if (batch.length < 100) break;
    }
    return out;
}

const getIssue = (n) => gh(`/repos/${REPO}/issues/${n}`);
const getComments = (n) => ghPaged(`/repos/${REPO}/issues/${n}/comments`);
const getOpenPulls = () => ghPaged(`/repos/${REPO}/pulls?state=open`);

async function getClaims(issueNumber) {
    return parseClaimComments(await getComments(issueNumber));
}

/** Adding a label to an issue does not create it, so make sure it exists first. */
async function ensureClaimLabel() {
    const res = await gh(`/repos/${REPO}/labels/${encodeURIComponent(CLAIM_LABEL)}`, { raw: true });
    if (res.ok) return;
    if (res.status !== 404) throw new Error(`label lookup -> ${res.status} ${await res.text()}`);
    await gh(`/repos/${REPO}/labels`, {
        method: 'POST',
        body: {
            name: CLAIM_LABEL,
            color: 'fbca04',
            description: 'An agent worker is currently working this issue',
        },
    });
}

const addClaimLabel = (n) => gh(`/repos/${REPO}/issues/${n}/labels`, { method: 'POST', body: { labels: [CLAIM_LABEL] } });

async function removeClaimLabel(n) {
    // 404 just means it was not labeled — that is the desired end state anyway.
    const res = await gh(`/repos/${REPO}/issues/${n}/labels/${encodeURIComponent(CLAIM_LABEL)}`, {
        method: 'DELETE',
        raw: true,
    });
    if (!res.ok && res.status !== 404) throw new Error(`unlabel -> ${res.status} ${await res.text()}`);
}

const postComment = (n, body) => gh(`/repos/${REPO}/issues/${n}/comments`, { method: 'POST', body: { body } });

async function deleteComment(id) {
    const res = await gh(`/repos/${REPO}/issues/comments/${id}`, { method: 'DELETE', raw: true });
    if (!res.ok && res.status !== 404) throw new Error(`delete comment -> ${res.status} ${await res.text()}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- commands

async function cmdList() {
    const [issues, openPulls] = await Promise.all([
        ghPaged(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(READY)}`),
        getOpenPulls(),
    ]);
    const now = Date.now();
    const results = [];

    for (const issue of issues) {
        if (issue.pull_request) continue; // the issues API returns PRs too
        const claims = await getClaims(issue.number);
        const verdict = evaluateCandidate({
            issue,
            claims,
            openPulls,
            workerId: WORKER_ID,
            now,
            ttlMinutes: TTL,
            readyLabel: READY,
        });
        results.push({ number: issue.number, title: issue.title, ...verdict });
    }

    // Oldest first: the queue should drain in the order the owner filled it.
    results.sort((a, b) => a.number - b.number);
    console.log(JSON.stringify(results, null, 2));
    return results.some((r) => r.eligible) ? 0 : EXIT_LOST;
}

async function cmdStatus(issueNumber) {
    const [issue, claims, openPulls] = await Promise.all([
        getIssue(issueNumber),
        getClaims(issueNumber),
        getOpenPulls(),
    ]);
    const now = Date.now();
    const { winner, heldByMe, expired } = resolveClaim(claims, { workerId: WORKER_ID, now, ttlMinutes: TTL });
    console.log(
        JSON.stringify(
            {
                issue: issue.number,
                state: issue.state,
                workerId: WORKER_ID,
                heldByMe,
                holder: winner?.workerId ?? null,
                claims: claims.length,
                expiredClaims: expired.length,
                openPulls: openPullRequestsForIssue(issue.number, openPulls).map((p) => p.number),
                verdict: evaluateCandidate({
                    issue,
                    claims,
                    openPulls,
                    workerId: WORKER_ID,
                    now,
                    ttlMinutes: TTL,
                    readyLabel: READY,
                }),
            },
            null,
            2,
        ),
    );
    return 0;
}

async function cmdClaim(issueNumber) {
    // 1. PRECHECK — cheap rejection before we write anything.
    const [issue, preClaims, openPulls] = await Promise.all([
        getIssue(issueNumber),
        getClaims(issueNumber),
        getOpenPulls(),
    ]);
    const pre = evaluateCandidate({
        issue,
        claims: preClaims,
        openPulls,
        workerId: WORKER_ID,
        now: Date.now(),
        ttlMinutes: TTL,
        readyLabel: READY,
    });
    if (!pre.eligible) {
        console.error(`agent-claim: #${issueNumber} not claimable (${pre.reason})`);
        console.log(JSON.stringify({ claimed: false, ...pre }));
        return EXIT_LOST;
    }
    if (DRY_RUN) {
        console.log(JSON.stringify({ claimed: false, dryRun: true, ...pre }));
        return 0;
    }

    // 2. STAKE — the comment is the arbiter, so post it before the label.
    const comment = await postComment(
        issueNumber,
        formatClaimBody(WORKER_ID, { run: RUN_URL, ttlMinutes: TTL }),
    );

    // 3. SETTLE — give concurrent stakes time to land, then let the earliest win.
    await sleep(SETTLE_MS);
    const claims = await getClaims(issueNumber);
    const { winner, heldByMe } = resolveClaim(claims, { workerId: WORKER_ID, now: Date.now(), ttlMinutes: TTL });

    if (!heldByMe) {
        // Someone staked first. Withdraw our comment and leave their label alone.
        await deleteComment(comment.id);
        console.error(`agent-claim: #${issueNumber} lost the claim race to ${winner?.workerId ?? 'unknown'}`);
        console.log(JSON.stringify({ claimed: false, reason: 'claimed-by-other', holder: winner?.workerId ?? null }));
        return EXIT_LOST;
    }

    await ensureClaimLabel();
    await addClaimLabel(issueNumber);
    console.log(JSON.stringify({ claimed: true, issue: issueNumber, workerId: WORKER_ID, commentId: comment.id }));
    return 0;
}

async function cmdRelease(issueNumber) {
    const claims = await getClaims(issueNumber);
    const mine = claims.filter((c) => c.workerId === WORKER_ID);
    if (mine.length === 0) {
        console.error(`agent-claim: #${issueNumber} has no claim by ${WORKER_ID} — nothing to release`);
        return 0;
    }
    if (DRY_RUN) {
        console.log(JSON.stringify({ released: false, dryRun: true, comments: mine.map((c) => c.commentId) }));
        return 0;
    }
    for (const claim of mine) await deleteComment(claim.commentId);

    // Only drop the label if no other live claim is queued behind ours —
    // otherwise we would strip the marker off an issue someone else now holds.
    const remaining = await getClaims(issueNumber);
    const { winner } = resolveClaim(remaining, { workerId: WORKER_ID, now: Date.now(), ttlMinutes: TTL });
    if (!winner) await removeClaimLabel(issueNumber);

    console.log(JSON.stringify({ released: true, issue: issueNumber, workerId: WORKER_ID }));
    return 0;
}

async function cmdReap() {
    const [issues, openPulls] = await Promise.all([
        ghPaged(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(CLAIM_LABEL)}`),
        getOpenPulls(),
    ]);
    const now = Date.now();
    const reaped = [];

    for (const issue of issues) {
        if (issue.pull_request) continue;
        const claims = await getClaims(issue.number);
        const stale = reapableClaims({ issue, claims, openPulls, now, ttlMinutes: TTL });
        if (stale.length === 0 || stale.length !== claims.length) continue; // a live claim remains

        if (!DRY_RUN) {
            for (const claim of stale) await deleteComment(claim.commentId);
            await removeClaimLabel(issue.number);
        }
        reaped.push({ issue: issue.number, workers: stale.map((c) => c.workerId) });
    }

    console.log(JSON.stringify({ dryRun: DRY_RUN, ttlMinutes: TTL, reaped }, null, 2));
    return 0;
}

// --------------------------------------------------------------------- main

const USAGE = `usage: agent-claim.mjs <list|status|claim|release|reap> [issue] [--repo owner/name] [--worker id] [--ttl minutes] [--settle ms] [--dry-run true]`;

if (!command) die(USAGE);
if (!TOKEN) die('GITHUB_TOKEN (or GH_TOKEN) is required');
if (!REPO) die('GITHUB_REPOSITORY (or --repo owner/name) is required');

const needsIssue = ['status', 'claim', 'release'];
const issueNumber = Number(positional[1]);
if (needsIssue.includes(command) && !Number.isInteger(issueNumber)) {
    die(`${command} requires an issue number\n${USAGE}`);
}

const handlers = {
    list: cmdList,
    status: () => cmdStatus(issueNumber),
    claim: () => cmdClaim(issueNumber),
    release: () => cmdRelease(issueNumber),
    reap: cmdReap,
};

const handler = handlers[command];
if (!handler) die(`unknown command "${command}"\n${USAGE}`);

try {
    process.exit(await handler());
} catch (err) {
    die(err?.message ?? String(err));
}
