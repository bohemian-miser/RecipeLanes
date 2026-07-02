# Agent Isolation & Preview-Environment Roadmap

Status: proposed (2026-07). Goal: let multiple AI agents work in parallel isolation,
roll changes out to reviewable environments, and gate everything with CI + prod health
checks — without agents clobbering each other on a single shared `staging` slot.

## The problem we're fixing

`staging` is a **single shared mutable slot**. Agents force-push their branch to it to
get a preview, so they overwrite each other; and because each branch has diverged from
`main`, landing one PR forces the rest into a rebase/conflict cascade. The bottleneck is
the shared slot, not git itself.

## Verify-by-change-type (the core principle)

Not every change needs a live isolated environment. Match the verification lane to what
changed:

| Change type | Where it lives today | Verification lane |
|---|---|---|
| Frontend / UI / SSR / **Server Actions** (incl. AI recipe parsing) | `app/`, `lib/` — runs inline in the Next.js App Hosting server | **Per-PR preview environment** (Tier 1) |
| HTTP / callable functions | *(none today — parsing is a Server Action)* | Per-PR Cloud Run revision tag, wired to the preview frontend |
| Firestore/Storage **triggers**, Cloud **Tasks** queue (`processIconTask`) | `functions/` | **Emulator integration tests** — do NOT try to isolate on a shared live env |
| `firestore.rules` / `indexes` / `storage.rules` | shared per-project resources | Emulator + post-merge staging |
| Post-merge integrated smoke | staging project | Shared `staging` (its real job) |
| Prod health | prod project | Synthetic uptime + smoke checks (Tier 3) |

Key architectural facts that make this favourable:
- Recipe AI parsing runs **inline in a Next.js Server Action** (`app/actions.ts`,
  `createVisualRecipeAction` → `getAIService()` → Vertex Gemini in `lib/genkit.ts`), not a
  Cloud Function. So most AI feature work rides entirely in the preview lane.
- The only background workers are the **Cloud Tasks** icon queue (`processIconTask`,
  `onTaskDispatched`). There are **no Firestore/Storage triggers**. Triggers are the one
  thing that genuinely can't be isolated within a single shared project, and we don't have
  any — so keep it that way (prefer Server Actions / Cloud Tasks over triggers).

## Tiers

### Tier 0 — Stop the collisions (do first)
- Enable **GitHub merge queue** on `main`. PRs queue; GitHub auto-rebases + re-tests each
  against latest `main` before merging, eliminating the manual rebase cascade.
- **Two ordered steps (order matters):**
  1. Add a `merge_group:` trigger to `.github/workflows/ci.yml` and merge to `main`. The
     merge queue runs checks on a `merge_group` ref; without this trigger the required
     checks never report and PRs hang in the queue forever.
  2. Apply the ruleset in `.github/main-merge-queue-ruleset.json`:
     `gh api repos/:owner/:repo/rulesets --method POST --input .github/main-merge-queue-ruleset.json`
     (SQUASH merge to match current flow; ALLGREEN grouping so a failing PR doesn't sink the
     batch). Do step 2 only after step 1 is on `main`.
- Retire "force-push to shared `staging`" as the review gate — replace with Tier 1.
- `staging` stays as a **post-merge** integrated-smoke env, force-pushed only for the
  occasional integrated dress rehearsal, not as the per-PR review mechanism.

### Tier 1 — Per-PR preview environments (the sweet spot)
- Each PR gets its own preview URL, built in isolation, pointed at the **staging** project's
  data. Agents stop overwriting each other; you review N PRs side-by-side.
- **Resolved:** Firebase **App Hosting has no native per-PR preview feature** (unlike
  Vercel/Netlify). Confirmed against 2026 Firebase docs. Options, in order of recommendation:
  1. **Cloud Run per-PR revision tag (recommended).** Prod stays on App Hosting; in CI,
     build the Next.js container once and deploy to Cloud Run with `--tag pr-<n>` for a
     stable, cheap, fast, genuinely isolated preview URL; tear down on PR close. High runtime
     parity because App Hosting is Cloud Run underneath.
     ([alt-deploy](https://firebase.google.com/docs/app-hosting/alt-deploy))
  2. **One persistent App Hosting "preview" backend** on the `staging` branch. Zero new
     infra, but *no per-PR isolation* — i.e. it doesn't actually fix the collision problem.
  3. **Scripted throwaway App Hosting backend per PR** via Terraform
     (`google_firebase_app_hosting_backend`). Real isolation but slow (full container build
     per backend, minutes) and you own create/destroy lifecycle glue.
  - Avoid resurrecting classic Hosting preview channels just for previews: works with SSR
    but breaks Next image optimization and forces a second divergent deploy toolchain.
- Accepted limitation: preview frontends share staging's Firestore/Auth/Storage data. Fine
  for most UI/logic review.

### Tier 2 — Data isolation (only if Tier 1's shared data bites)
- Prefer **per-PR namespacing** (collection/path prefix keyed by PR number) over a fresh
  GCP project per PR. Ephemeral projects are the purest isolation but the worst ergonomics
  (provisioning latency, quota, secret plumbing).

### Tier 3 — IaC + prod health (long game)
- Migrate the two projects + the `gcp/monitoring/` alerting-YAML into **Terraform**
  (alerting-as-code is the seed — we're already ~30% there). This also makes ephemeral envs
  tractable if we ever want Tier 2 via real projects.
- Add **synthetic monitoring**: GCP Uptime Checks + a scheduled Playwright "prod smoke" job
  hitting the critical path (load app → parse a recipe → render), alerting on breakage.

## Worked example: "photos → recipe meta"

A user uploads a photo; Gemini vision extracts recipe metadata into the graph. Following the
existing pattern this is a **new Server Action** (`createRecipeFromPhotoAction`) calling
Gemini vision (`inlineData`) inline — sibling to `createVisualRecipeAction`. It therefore
lives **entirely in the preview lane** (Tier 1): no functions to isolate, no triggers.

Design fork that keeps it easy:
- **Send image bytes inline** (FormData → Server Action) — recommended. No Storage, no
  `storage.rules` change, nothing deploys to a shared project. Fully isolatable preview.
- Upload to Storage first — only if retaining photos; touches shared bucket + rules.
- Cloud Tasks async — only if vision latency times out a request; reuses `processIconTask`
  pattern, verified in the emulator.

## Open items
- [x] Resolve App Hosting per-PR preview mechanism → Cloud Run per-PR `--tag` (Tier 1).
- [ ] Land the `merge_group` CI trigger on `main`, then apply the merge-queue ruleset.
- [ ] Build the Cloud Run per-PR preview workflow (Tier 1) — next PR.
- [ ] Decide inline-bytes vs Storage for the photo feature.
- [ ] Revisit: `main` currently requires **0** approving reviews (expected 1 per team norms).
