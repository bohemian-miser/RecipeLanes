# docs/ index

Not every file here is current truth. Use this index to tell **authoritative reference** from **point-in-time plans** before you act on a doc.

Start with `/CLAUDE.md` (repo root) for agent onboarding and the architecture map.

## Reference — authoritative, keep in sync with code

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Firestore schema (V2): `ingredients_new`, `icon_queue`, `feed_icons`, `recipes`, `icon_index` (vector search); the unified icon queue |
| [../recipe-lanes/docs/STATE_AND_PERSISTENCE.md](../recipe-lanes/docs/STATE_AND_PERSISTENCE.md) | Client state model: `mergeSnapshot` ingestion, server-authoritative vs ephemeral state, save triggers, `isDirty` |
| [sharing_overrides.md](sharing_overrides.md) | Sharing/forking/override state machine ("Safe Viewing, Explicit Saving") |
| [score_logic.md](score_logic.md) | Wilson score icon ranking + cache-first generation gating |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Staging/production deploy |
| [git_workflow.md](git_workflow.md) | Disposable feature-branch protocol |
| [tools.md](tools.md) | Dev/agent tools and commands |
| [../recipe-lanes/TESTING.md](../recipe-lanes/TESTING.md) | Full testing guide (incl. Pi-specific pre-commit warm-up) |
| [../recipe-lanes/prompt.md](../recipe-lanes/prompt.md) | Application overview (the three modules) — despite the name, this is a reference doc, **not** the LLM parse prompt. The recipe-parse prompt lives inline in `recipe-lanes/lib/recipe-lanes/parser.ts`. |

## Plans & roadmaps — intent, not necessarily implemented

| Doc | Status |
|---|---|
| [architecture-review-2026-06.md](architecture-review-2026-06.md) | June 2026 technical roadmap (prioritised) |
| [FEATURES.md](FEATURES.md) | Feature roadmap / wishlist |
| [../recipe-lanes/docs/icon-shortlist-plan.md](../recipe-lanes/docs/icon-shortlist-plan.md) | Icon shortlist/forge design plan |
| [refactor_test_plan.md](refactor_test_plan.md) | Historical test-strategy discussion (LLM transcript) — superseded by TESTING.md |
| [../recipe-lanes/docs/TEST_REFACTOR_PLAN.md](../recipe-lanes/docs/TEST_REFACTOR_PLAN.md) | Test suite overhaul plan |

## Historical write-ups — past investigations, may describe already-fixed behaviour

| Doc | Note |
|---|---|
| [recipe_title_edit_bug.md](recipe_title_edit_bug.md) | Bug investigation write-up; verify against current code before trusting |
| [prompt.md](prompt.md) | A coding-agent kickoff prompt (not application docs) |
