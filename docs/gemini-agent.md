# Gemini autonomous agent

A Gemini CLI-based counterpart to the Claude cloud bug-worker routine. Two GitHub Actions workflows drive it:

| Workflow | Trigger | What it does |
|---|---|---|
| `gemini-issue-solver.yml` | hourly at :37, or manual dispatch (optionally with an issue number) | Picks ONE open issue labeled `agent-ready-gemini`, fixes it with tests, opens a PR against `main` labeled `agent:gemini`, watches CI to green |
| `gemini-comment-responder.yml` | maintainer comment on a PR labeled `agent:gemini` | Checks out the PR branch, addresses the feedback (code change or reply), pushes, re-watches CI |

## Label routing

- `agent-ready` → Claude cloud routine (hourly at :17).
- `agent-ready-gemini` → this Gemini worker (hourly at :37).
- Apply exactly one of the two to an issue. Dedup is defensive on both sides (any open PR or `*issue-<n>*` branch makes an issue ineligible), so even a double-labeled issue won't get two PRs — but don't rely on it.
- `agent:gemini` on a PR marks it as Gemini-authored; the comment responder only wakes for PRs carrying it.

## Loop guard

Every comment the agent posts ends with `<!-- gemini-agent -->`. The responder workflow ignores comments containing that marker and only triggers for OWNER/MEMBER/COLLABORATOR authors.

## Secrets

| Secret | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini CLI auth (already configured) |
| `AGENT_GH_PAT` | Fine-grained PAT (this repo; contents rw, pull-requests rw, issues rw). **Required**: PRs opened with the default `GITHUB_TOKEN` never trigger CI, so without it every solver run fails its wait-for-CI gate. |

## Agent brain

Prompts live in-repo: `GEMINI.md` (workspace rules), `.gemini/agents/orchestrator.md` (the solver contract — dedup, tests-mandatory, CI gate), `.gemini/commands/resolve-issue.toml` and `.gemini/commands/address-comment.toml` (the entry points the workflows invoke).
