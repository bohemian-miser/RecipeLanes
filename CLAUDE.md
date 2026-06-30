# RecipeLanes — Agent Onboarding

## What this is

RecipeLanes is a recipe-visualization web app that converts raw recipe text into interactive flowchart-style diagrams. The stack is **Next.js 16 (App Router) + React 19 + ReactFlow + Firebase (Firestore/Auth/Storage/Functions) + Google Genkit/Gemini**. The entire application lives under `recipe-lanes/`; the repo root holds docs, a root `package.json` (workspace-level), and Cloud Functions under `recipe-lanes/functions/`.

---

## Architecture map

| Concern | Location |
|---|---|
| Global client state | `recipe-lanes/lib/stores/recipe-store.ts` — Zustand store; `mergeSnapshot` is the sole Firestore ingestion point; its reference-preserving merge logic is **load-bearing** — do not degrade it |
| God files (high blast radius, edit carefully) | `recipe-lanes/lib/data-service.ts`, `recipe-lanes/app/lanes/page.tsx`, `recipe-lanes/components/recipe-lanes/react-flow-diagram.tsx` |
| LLM prompts | `recipe-lanes/lib/recipe-lanes/parser.ts` (parse raw text → graph), `recipe-lanes/lib/recipe-lanes/adjuster.ts` (AI graph adjustments) |
| Cloud Functions | `recipe-lanes/functions/` |
| DB schema docs | `docs/ARCHITECTURE.md` |

The Zustand store uses a selector pattern (`useRecipeStore(s => s.graph?.nodes.find(n => n.id === id))`) so only the mutated node re-renders. `mergeSnapshot` preserves local `shortlistIndex` / position state when icon shortlists are unchanged; it resets them only when the server shortlist itself changes.

---

## How to run & verify

**Prerequisites:** Node 20, Java 21+ (Temurin 21 on Raspberry Pi/arm64).

```bash
# Install (from recipe-lanes/)
npm install
npm install --prefix functions

# Terminal 1 — Firebase emulators (auth, firestore, storage, functions, tasks)
npm run emulators          # scripts/start-emulators.sh; sets MOCK_AI=true automatically

# Terminal 2 — Next.js dev server against emulators (includes MOCK_AI=true via .env.test)
npm run dev:emulators      # env-cmd -f .env.test next dev -p 8001
# App: http://localhost:8001   Emulator UI: http://localhost:4000
```

### Test tiers

| Tier | When to run | Command |
|---|---|---|
| **pre-commit** (lint + typecheck + pure unit) | Before every commit | `npm run lint`, `npm run typecheck`, `npm run test:unit:pure` (fast, no emulators) |
| **emulator integration** | After any data-layer or Cloud Functions change | `npm run test:unit` (runs `test:unit:pure` then `test:unit:integration`; integration auto-starts emulators if none detected on port 8080) |
| **e2e** | Before PR / after significant UI changes | `npm run test:e2e` |
| **full verify** | Mirrors the pre-commit hook | `npm run verify` (build + all tests) |

> `test:unit:pure` (pure logic, no emulators) and `test:unit:integration` (emulator-backed) are both live on `staging`. `npm run test:unit` runs both; `npm run typecheck` is `tsc --noEmit`. See `recipe-lanes/TESTING.md` for full detail.

Scoped single test: `npm run test:one -- tests/my.test.ts`

---

## Hard rules

1. **NEVER push directly to `main`.** `main` is PR-only — it advances solely through reviewed, merged PRs, and feature branches open their PR **against `main`** (`gh pr create --base main`). `staging` is a *disposable preview environment*, **not** a PR target: branches get force-pushed onto it to preview in the live env. The owner controls staging — agents/contributors do not push to staging without the owner's go-ahead. See `docs/git_workflow.md` (which is the authoritative version of this flow).
2. **NEVER use `git commit --no-verify`.** The pre-commit hook runs `lint + typecheck + test:unit:pure` (docs/config-only changes are skipped); fix failures before committing.
3. **`MOCK_AI=true` must never reach production.** It is set by `.env.test` and `start-emulators.sh` for local/test use only. There was a production incident — treat this as a hard safety rule.
4. **Do not resurrect `e2e/old_tests/`.** Those tests are retired; do not re-enable them.
5. **Regression fixes discovered mid-feature belong in their own branch and PR** with a regression test — do not bolt them onto the in-progress feature branch.
6. **This dev machine is a Raspberry Pi (arm64).** Run scoped tests (`test:one`, `test:unit`), not repeated full builds. Full `npm run verify` is slow and should be reserved for pre-commit.

---

## Deeper docs

- `docs/ARCHITECTURE.md` — DB schema (V2 `ingredients_new` collection, unified icon queue)
- `docs/DEPLOYMENT.md` — staging and production deployment
- `docs/git_workflow.md` — disposable feature branch protocol
- `recipe-lanes/TESTING.md` — full testing guide including Pi-specific pre-commit warm-up sequence and known flaky tests
- `docs/architecture-review-2026-06.md` — prioritized technical roadmap (June 2026 review)
- `docs/alerting-icon-forge.md` — pure-GCP alerting on icon-generation rate (Bug 171): the `icon_forged` log signal + Cloud Monitoring metric/policy runbook
