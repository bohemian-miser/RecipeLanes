# Agent worker protocol — claiming issues

Status: active (2026-07-26). Applies to every autonomous worker that picks its
own issue off the `agent-ready` queue.

## The problem

The Claude "bug worker" routine is a **scheduled cloud session with no
serialization** — several runs can be in flight at once. Its dedup rule was
*"skip any issue that already has an open PR or an origin branch"*, evaluated
when the run picks an issue.

That check happens **before** the run has opened a PR, so overlapping runs all
see the same clean slate. On **2026-07-26** three runs each selected issue
**#278** and opened **#285**, **#286** and **#288** — three different fixes for
one bug, roughly 4.5 hours apart end to end, none aware of the others. Two of
them were wasted, and reviewing them cost more than the bug did.

The Gemini solver does not have this problem: it is label-triggered and pinned
to `concurrency: group: gemini-agent`, so it cannot overlap itself.

The fix is not a better inference rule. A worker has to **publish a claim at
selection time**, so the next worker has something to see.

## Why a label alone is not enough

GitHub has no compare-and-swap on labels. Two workers can both read "unlabeled"
and both add `agent-claimed`; last-writer-wins leaves both believing they hold
it. Issue **comments** do give us an ordering — each carries a server-assigned,
monotonically increasing id — so:

- **the label** is the cheap, human-visible marker of queue state, and
- **the claim comment** is the arbiter that settles a tie.

Every worker stakes a claim comment, waits out a settle window, re-reads the
comments, and yields unless its own claim is the earliest live one. All workers
read the same total order, so they all reach the same verdict without talking
to each other.

## The protocol

```
1. PRECHECK   issue is open, labeled `agent-ready`, has no open PR
              referencing it, and has no live claim
2. STAKE      post a claim comment (hidden `<!-- agent-claim worker="…" -->`
              marker), then add the `agent-claimed` label
3. SETTLE     wait ~20s, re-read all claims — earliest live claim wins.
              Lost? delete your own claim comment and RESIGN: end the run.
4. WORK       open the PR referencing the issue
5. RELEASE    abandoning without a PR? delete your claim comment and drop the
              label so the issue returns to the queue
```

**Resign, don't reroute.** A worker is dispatched to *one* issue — the one
carrying the label — so there is no second issue to fall back to. Losing the
race is a clean, successful no-op: withdraw the claim and exit. The issue is
already being worked by whoever won, and the run that lost has nothing left to
do. Do **not** go shopping for another issue to fill the run.

Claims expire after **180 minutes** (`AGENT_CLAIM_TTL_MINUTES`). An expired
claim is ignored by step 1 and cleaned up hourly by
`.github/workflows/agent-claim-reaper.yml`, so a crashed worker cannot wedge an
issue permanently. An expired claim whose worker *did* open a PR is left in
place — the open PR is already the "someone is on this" signal.

## Using it

`.github/scripts/agent-claim.mjs` (no dependencies, Node 20) implements all of
it. It needs `GITHUB_TOKEN`/`GH_TOKEN` with `issues: write`, `GITHUB_REPOSITORY`,
and an `AGENT_WORKER_ID` that is stable for the run and distinct between
concurrent runs (a session id or `GITHUB_RUN_ID`; it falls back to
`local-<host>-<pid>`).

```bash
export AGENT_WORKER_ID="$CLAUDE_SESSION_ID"

# Claim the issue you were dispatched to. This is the first thing the run does.
# Exit 0 = it is yours, carry on. Exit 3 = someone else has it, stop here.
node .github/scripts/agent-claim.mjs claim 278 || exit 0

# Who holds it? (diagnostics)
node .github/scripts/agent-claim.mjs status 278

# What is claimed right now across the queue? (diagnostics)
node .github/scripts/agent-claim.mjs list

# Bailing out without a PR — put it back.
node .github/scripts/agent-claim.mjs release 278
```

Exit codes: `0` success, `3` not yours (ineligible or lost the race — **not** a
failure, this is the expected way a duplicate run ends), `1` a real error.

Flags mirror the env vars: `--repo`, `--worker`, `--ttl`, `--settle`,
`--dry-run true`.

`list` and `status` are for humans and debugging. They are **not** a work-finding
step: the label decides which issue a run gets, not the script.

### Rules for workers

1. **Claim before you work.** No claim, no branch, no PR.
2. **Exit 3 means resign.** End the run — quietly, and as a success. Do not work
   an issue you did not win, and do not substitute a different one.
3. **Release what you abandon.** If you finish without a PR — cannot reproduce,
   out of scope, blocked — `release` it and leave a comment saying where you
   got to. Do not leave a claim standing on work nobody is doing.
4. **A claim is not a review queue.** Once your PR is open the claim has done
   its job; the open PR keeps other workers off the issue on its own.

### Labels

| Label | Meaning |
|---|---|
| `agent-ready` | Owner-curated: the Claude worker may pick this up |
| `agent-ready-gemini` | Routed to the Gemini solver workflow instead |
| `agent-claimed` | A worker holds this right now (auto-managed — do not set by hand) |

## Tests

`node --test .github/scripts/*.test.mjs` — pure decision logic, no token
needed. Runs in the CI `agent-scripts` job, which has its own path filter
because `fast-checks` deliberately treats `.github/**` as a docs-ish path.
The suite includes a regression case that replays the #278 incident and asserts
exactly one of the three workers proceeds.
