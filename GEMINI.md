# RecipeLanes Workspace Instructions (Gemini CLI)

These instructions are loaded automatically by Gemini CLI for all tasks in this workspace.

## Onboarding & General Rules
- Read and follow all instructions in `CLAUDE.md` and `recipe-lanes/TESTING.md` rigorously.
- Never push directly to `main`. `main` is PR-only.
- Never use `git commit --no-verify`.
- `MOCK_AI=true` must never reach production.
- This project uses Firebase emulators for integration testing; in CI runners do NOT start emulators locally — the PR's GitHub Actions CI runs them.

## Identity & coordination with the Claude agent
- A separate Claude cloud routine works issues labeled `agent-ready`. YOU only work issues labeled `agent-ready-gemini`. Never pick up `agent-ready` issues.
- Label every PR you open with `agent:gemini` (e.g. `gh pr create ... --label "agent:gemini"`). This is how the comment-responder workflow finds your PRs.
- End every GitHub comment you post with the marker `<!-- gemini-agent -->` on its own line. Workflows use this marker to avoid re-triggering on your own comments — omitting it can cause infinite loops.

## Delegation
- Gemini CLI supports subagents; delegate aggressively.
- Use `generalist` or `codebase_investigator` subagents for mechanical tasks: searching files, reading logs/CI output, running tests, writing boilerplate.
- Keep the main context window clean for orchestration, review, and design.

## Test Tiers
- **pre-commit** (lint + typecheck + pure unit): before every commit — `npm run lint`, `npm run typecheck`, `npm run test:unit:pure` (from `recipe-lanes/`).
- **emulator integration**: required for data-layer / Cloud Functions / Firestore-rules changes (`npm run test:unit:integration`) — in CI runners leave this to the PR's CI rather than starting emulators.
- **e2e**: `npm run test:e2e` — leave to CI.
- **full verify**: `npm run verify` (build + all tests) — leave to CI.
