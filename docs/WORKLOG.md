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

---

## 2026-07-27 — Tick off steps while cooking (#281)

**Feature.** Nodes can now be ticked off as the cook works through a recipe: a `✓` toggle on each node dims it once done. Wired into `MinimalNode` (classic + all three modern branches) and `TimelineNode`.

**Design decision — completion is store state, not node state.** The tick lives in a new top-level `completedNodeIds: string[]` on the Zustand store, *not* as a flag on `RecipeNode`. This matters: the save path (`data-service.saveRecipe*` → `removeUndefined(data)`) has **no field whitelist**, so any field present on a node at save time is written to Firestore verbatim. A `completed` flag on the node would therefore have been persisted and shown one cook's progress to **everyone** viewing a shared recipe — and would have marked the recipe dirty on every tick, triggering autosaves. Keeping it off the graph also means `toggleNodeCompleted` pushes no undo entry and leaves every node object reference untouched, so the per-node selectors don't re-render.

**Lifecycle.** Ticks are cleared for free by `reset()`, which `app/lanes/page.tsx` already calls in its `[recipeId]`-keyed effect before subscribing to the new doc — so node IDs cannot bleed from one recipe into the next. An earlier draft added bespoke clearing to the store's `setRecipeId`; that action turns out to have **no app caller at all** (recipe switching goes through `reset()`), so the guard was dead code and was dropped.

**Mobile.** The toggle is deliberately *not* hover-gated below the `sm:` breakpoint (`opacity-100 sm:opacity-0 sm:group-hover:opacity-100`), unlike the existing reroll/forge/delete controls. Ticking off steps is a phone-in-the-kitchen action, and a `group-hover`-only control is unreachable on touch.

**Tests.** `recipe-lanes/tests/recipe-store-completed.test.ts` (pure tier, auto-discovered) — toggle/untoggle, independent nodes, no-duplicate-entry, and the load-bearing guarantees: no graph mutation, `isDirty` untouched, no undo entry, **no completion field written onto the node**, ticks survive a `mergeSnapshot`, and `reset()` clears them.
---

## 2026-07-27 — `agent-claim.mjs` cannot reach the GitHub REST API from the cloud runner

Working issue #280 from a Claude-Code-on-the-web session, `node .github/scripts/agent-claim.mjs claim 280` failed with **401 Bad credentials**. The cause is the sandbox, not the script: outbound HTTPS goes through an agent proxy, `GH_TOKEN`/`GITHUB_TOKEN` are `proxy-injected` placeholders rather than real tokens, and a direct call to `api.github.com` is rejected with *"GitHub access is not enabled for this session"*. In that environment the **GitHub MCP tools are the only working GitHub path** — and Node's `fetch` does not honour `HTTPS_PROXY` by default anyway, so the script bypasses the proxy even when it is configured.

The claim protocol itself is fine and was honoured by hand for #280: post the claim comment with the same hidden `<!-- agent-claim worker="…" -->` marker (`add_issue_comment`), add `agent-claimed` (`issue_write`, which replaces the whole label set — resend the existing labels), wait out the settle window, then re-read the comments and keep the issue only if your claim is the earliest live one. Other workers parse the marker, not the poster, so a hand-staked claim arbitrates identically.

**For future runs:** if `agent-claim.mjs` exits 1 with a 401/403, do not treat it as "no claim needed" and do not skip the claim — fall back to staking it via MCP as above. Making the script proxy-aware (an undici `ProxyAgent`, or `NODE_USE_ENV_PROXY`) would only help if the proxy allowed `api.github.com` for this session, which it does not.

**Confirmed independently on #281** (same day, different run): identical 401 from `agent-claim.mjs`, resolved the same way — claim staked by hand via MCP with the same marker. Two runs raced #281; the earliest claim comment won and the loser resigned, so the protocol worked as designed even with the script unusable.

---

## 2026-08-21 — Icon credits + icon editor modal (phase 1 of paid icon generation)

**Feature (owner-directed).** First slice of the "users pay for icon generation" plan that `recipe-lanes/docs/icon-shortlist-plan.md` sketched ("Forge is the credit-gated upsell"). Two changes shipped together:

1. **Icon credits.** New Admin-SDK-only collection `user_credits/{uid}` (`lib/user-credits.ts`): `balance` / `granted` / `spent`, with a lazy **starter grant** (`STARTER_ICON_CREDITS = 10`) seeded transactionally on first touch — no backfill. `forgeIconAction` now requires sign-in and spends `FORGE_CREDIT_COST = 1` per generation (transactional spend, refund if the enqueue fails, `creditsRemaining` returned to the UI). The daily cap (`checkForgeAllowed`) stays as an abuse backstop. Purchase flow is deliberately NOT built yet. **Placement rationale:** the balance must not live on `users/{uid}` — firestore.rules gives users full write access to their own user doc, so it would be self-editable; `user_credits` follows the `icon_forge_usage` no-rules-block precedent. Anonymous users can no longer forge regardless of `allowAnonForge` (credits need an account); `allowAnonForge` still governs the recipe-creation generation gates.

2. **Icon editor modal replaces cycle+forge buttons.** The per-node reroll (`RefreshCw`) and forge (`Hammer`) buttons — on RF nodes, timeline nodes, the SVG timeline, and the ingredients sidebar — are replaced by a single pencil "Edit icon" button opening `components/icon-shortlist-modal.tsx`: the whole shortlist as a grid (click to pick — new store action `setShortlistIndex`), plus the credit-gated "Generate a new icon" button with the live balance. Modal state lives in the store (`iconEditorNodeId`) because the openers sit deep inside ReactFlow while the modal renders at page level.

**Impression semantics.** Opening the modal shows every shortlist entry at once, so it must count as an impression for each — but NOT as a rejection (unlike cycling past). New client-owned node flag `shortlistSeenAll` (registered in the #220 ownership map): `stampShortlistFlags` now stamps `hasImpressed` on all entries when it is set, while rejections keep the existing selected-index contiguity rules. Existing `shortlistCycled` semantics are untouched. Selection/seen state still reaches Firestore only with the next save — per `STATE_AND_PERSISTENCE.md`, no per-interaction write was reintroduced.

**Tests.** `tests/shortlist-seen-all.test.ts` + `tests/recipe-store-icon-editor.test.ts` (pure), `tests/user-credits.test.ts` (integration: starter grant, atomic spend/insufficient/refund, forge gate incl. refund-on-failure). Next phase (per owner): generation offers multiple options and a chosen icon becomes a named donation from the generating user.

---

## 2026-08-26 — Firestore rules lockdown: clients read, backend writes (phase 2a step 1)

**Security hardening (owner-directed).** First step of the paid-credits phase 2 plan (agreed sequencing: rules lockdown → credit ledger → uid propagation/refunds → optional attribution → Stripe Checkout). Audit confirmed the architecture invariant: **no client code writes Firestore at all** — every write path (recipes, users, stars, feedback, queue, credits) already goes through server actions / Cloud Functions on the Admin SDK; the only client "write capability" was the `window._firebaseFirestore` debug helper. The rules now encode that invariant: no `write` grant anywhere.

Changes from the old rules: `icon_queue` was `allow read, write: if true` — **world-writable** — meaning a client could inject/tamper queue docs and bypass the credit spend in `forgeIconAction`; now public-read only (queue monitor keeps working). `users/{uid}` (and stars) drop from owner read+write to owner **read-only**, so display names shown publicly later (icon attribution) can never be forged client-side. `feedback` loses its public `create` (submissions go through data-service). Deny-by-default collections (`user_credits`, future `credit_ledger`, `icon_forge_usage`, `config`) are now documented in the rules header instead of being implicit.

**Tests.** New emulator-backed `tests/firestore-rules.test.ts` (integration tier) pins the contract with `@firebase/rules-unit-testing` (new devDependency): public catalog reads, recipe visibility gating, owner-only profile reads, and explicit deny assertions for every client write incl. `user_credits` self-inflation and `icon_queue` injection. Runs under its own emulator project id (`rules-spec`) so loading rules there can't affect the shared `local-project-id` data other integration tests use. Rules deploy automatically via deploy-backend (`firestore:rules` on main/staging pushes).
