# RecipeLanes Workspace Instructions

These instructions are loaded automatically by Gemini CLI for all tasks in this workspace.

## Onboarding & General Rules
- Read and follow all instructions in `CLAUDE.md` and `recipe-lanes/TESTING.md` rigorously.
- Never push directly to `main`. `main` is PR-only.
- Never use `git commit --no-verify`.
- `MOCK_AI=true` must never reach production.
- Our project uses Firebase emulators for integration testing.

## Model Mapping & Delegation
- Since Gemini CLI automatically supports subagents, delegate aggressively.
- Use `generalist` or specialized subagents for mechanical tasks, such as searching files, reading logs, running tests, or writing boilerplate.
- Keep the main context window clean for high-level orchestration, review, and design.

## Test Tiers
- **pre-commit** (lint + typecheck + pure unit): Run before every commit (`npm run lint`, `npm run typecheck`, `npm run test:unit:pure`).
- **emulator integration**: After data-layer/Cloud Functions changes (`npm run test:unit` - runs both pure and integration).
- **e2e**: Before PR / after UI changes (`npm run test:e2e`).
- **full verify**: `npm run verify` (build + all tests).
