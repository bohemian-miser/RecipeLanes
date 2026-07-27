# Agent Worklog

A shared, curated log of significant decisions, incidents, and infra/process changes — so new contributors and **cloud bots** can get up to speed fast. This is the *narrative* companion to `CLAUDE.md` (which holds the durable rules) and to the per-PR/issue history on GitHub.

**How to use:** append a dated entry for anything a future person/bot would need context on — a decision and its *why*, an incident, an infra or process change. Link the PRs/issues/commits. Keep it curated (not every small PR — those are self-documenting). Newest entries at the **bottom**.

---

## 2026-07-04 / 07-05 — Autonomy & triage build-out

**Cloud "bug worker" routine.** Stood up a scheduled cloud agent (RemoteTrigger `trig_01Y2dZ2qT6cxxaepXXpcCrsi`, hourly) that fixes **one GitHub issue per run** and opens a PR. Opus orchestrator + cheap Haiku/Sonnet subagents; one-issue-per-run; tests mandatory; waits for CI green; **human-gated merge**. Selection is **label-driven**: it only works issues labeled `agent-ready` (owner curates the queue; honors `P1`/`P2`/`P3`). Robust dedup skips any issue that already has an open PR *or* origin branch (see incident below). Details in memory `project_cloud_bug_worker`.

**PR-preview infra.**
- `#199` (merged) — PR previews now auto-register their Cloud Run hostname in staging's Firebase **authorized domains** (and deregister on teardown), fixing `auth/unauthorized-domain` on preview sign-in.
- The required `roles/firebaseauth.admin` grant is scripted in `recipe-lanes/scripts/setup-preview-pipeline.sh` (IaC per the `gcp/` convention; Terraform is the eventual target).
- `#201` (merged) — teardown hardened: Cloud Run tag/image cleanup now runs **unconditionally** (`if: always()`), so a failing domain-deregister can't orphan previews again; the deregister PATCH now snapshots + refuses to empty/over-shrink the domain list.

**⚠️ INCIDENT — staging login outage (self-inflicted).** A buggy read-modify-write while cleaning a stale preview domain **wiped the entire `authorizedDomains` list** on `recipe-lanes-staging` (6 → 0). Empty list → Firebase client throws `TypeError: t is not iterable` in `validate_origin` → **all logins failed**. Recovered by reconstructing the list (3 Firebase defaults + `staging.recipelanes.com` + `recipe-lanes.firebaseapp.com` + the live preview host). Lesson (now a rule): never blind-PATCH shared live config — snapshot first, assert non-empty, refuse unexpected shrink. The Identity Toolkit admin API also needs `X-Goog-User-Project` with user creds or it 403s (not an IAM problem).

**Issue triage (47 open issues).** Fanned out read-only triage in batches of 5. Result: closed **11** (fixed/junk/dup), re-scoped/commented **9** with concrete repros/decisions, and created new issues: `#205` (Firestore data-validation rules + anomaly cleanup checker), `#206` (concise labels + hover, delivered as a standalone 5-option chooser page), `#210` (see below). Backlog 47 → ~36.

**Feedback → bugs pivot.** Two duplicate inline PRs (`#207`, `#208`) for issue #148 were both **closed**. Decided against inline per-submission issue-creation (no dedup, spam-prone). New design in **`#210`**: a **daily triage bot** drains the existing `feedback` Firestore collection directly (no new `bugs` collection), with real classification, **multi-topic splitting** (one feedback → many issues), **dedup against existing open issues**, and repro-via-emulators as a stretch goal; reuses #207's GitHub-POST code. Interim host = local Pi cron; later = Gemini Cloud Function.

**Routine PR review — key learning.** Reviewed the worker's first batch (`#202`, `#203`, `#204`, `#209`). Three were **CI-green but wrong**: they unit-tested the subsystem they changed while the actual user-visible behavior stayed broken (e.g. #204 clears the input but an untouched `onSnapshot` listener repopulates it; #202 truncates labels but the rotation bug persists). Takeaway: for UI/behavior issues the test-mandate must require an **e2e/browser check of the real outcome**, not just any passing unit test. `#209` (legal pages) is mergeable pending human review of the ToS copy.

---

## 2026-07-26 — Duplicate-work incident: three workers, one issue

**⚠️ INCIDENT — three PRs for one bug.** Issue **#278** ("mobile: graph resets when deleting a node in notation view") was picked up by **three separate bug-worker runs**, which opened **#285** (02:40), **#286** (02:52) and **#288** (07:21) — three independent fixes for the same bug, none aware of the others. All three diagnosed it correctly (the timeline delete path skips `markNodeDeleted`, so `mergeSnapshot` resurrects the node from the next server echo), and they differ mainly in how much they change: #285 routes through the existing `markNodeDeleted`/`restoreNodes`; #288 adds `deleteNode`/`restoreGraph` store actions; #286 additionally force-persists via `onSave` and adds an e2e. Two of the three are pure waste, and triaging them costs more than the bug did.

**Root cause — a TOCTOU race, not a missing check.** The routine *did* have a dedup rule ("skip any issue that already has an open PR or origin branch"), but it is evaluated when a run *picks* an issue — before that run has opened anything. The routine is a scheduled cloud session with **no serialization**, so overlapping runs all see the same clean slate. Note #288 started ~4.5h after #285 and still collided: the window is however long a run takes, not a few minutes. (The Gemini solver is immune — it is label-triggered and pinned to `concurrency: group: gemini-agent`.)

**Fix — publish the claim at selection time.** New label-based claim protocol (`docs/agent-worker-protocol.md`, `.github/scripts/agent-claim.mjs`). A worker posts a claim comment carrying a hidden `<!-- agent-claim worker="…" -->` marker, adds `agent-claimed`, waits out a settle window, then re-reads: **the earliest live claim wins** and everyone else backs off. Comment ids are server-assigned and ordered, which is what makes this safe — adding a *label* is not atomic (two workers can both read "unlabeled" and both write it), but every worker reading the same comment list computes the same winner without coordinating. Claims expire after 180min and `.github/workflows/agent-claim-reaper.yml` releases stale ones hourly, so a crashed run cannot wedge the queue; an expired claim that *did* produce a PR is left alone, since the open PR is already the "someone is on this" signal. Enforced as hard rule #7 in `CLAUDE.md`; the routine prompt must call `claim` before starting and treat **exit 3 as "pick a different issue"**.

**Testing note.** The claim logic is pure and lives in `.github/scripts/agent-claim-logic.mjs` with `node --test` coverage (including a regression case replaying the #278 collision). CI's `changes` filter deliberately excludes `.github/**` from the `code` signal, so these tests needed their own `agent-scripts` job with its own path filter — otherwise a PR touching only agent tooling would silently skip every check.

**Amendment (same day).** Contract tightened after owner feedback: a worker is dispatched to **one** labeled issue, so losing the claim race means **resign** — end the run quietly as a success — not "pick a different issue". A losing run has nothing to fall back to and must not go shopping for other work to fill itself. `list`/`status` are diagnostics only (`list` now always exits 0), so exit 3 unambiguously means "resign".
