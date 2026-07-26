# Gemini autonomous agent

A Gemini CLI-based counterpart to the Claude cloud bug-worker routine. Two GitHub Actions workflows drive it:

| Workflow | Trigger | What it does |
|---|---|---|
| `gemini-issue-solver.yml` | applying the `agent-ready-gemini` label to an issue, or manual dispatch (optionally with an issue number) | Fixes ONE issue with tests, opens a PR against `main` labeled `agent:gemini`, watches CI to green |
| `gemini-comment-responder.yml` | maintainer comment on a PR labeled `agent:gemini` | Checks out the PR branch, addresses the feedback (code change or reply), pushes, re-watches CI |

## Label routing

- `agent-ready` → Claude cloud routine.
- `agent-ready-gemini` → this Gemini worker (fires on label application; no schedule).
- Apply exactly one of the two to an issue. Dedup is defensive on both sides (any open PR or `*issue-<n>*` branch makes an issue ineligible), so even a double-labeled issue won't get two PRs — but don't rely on it.
- `agent:gemini` on a PR marks it as Gemini-authored; the comment responder only wakes for PRs carrying it.

## Loop guard

Every comment the agent posts ends with `<!-- gemini-agent -->`. The responder workflow ignores comments containing that marker and only triggers for OWNER/MEMBER/COLLABORATOR authors.

## Agent identity: GitHub App

The agent acts as the **`recipelanes-agent` GitHub App** (a service account — no extra email/user account needed). Each run mints a short-lived installation token via `actions/create-github-app-token`. This matters because PRs opened with the default `GITHUB_TOKEN` never trigger CI, which would permanently fail the solver's wait-for-CI gate; app-minted tokens trigger CI normally. PRs/comments are authored by `recipelanes-agent[bot]`, so the owner can approve them (with the machine-account/PAT-from-owner approach you couldn't — GitHub forbids approving your own PRs), and the app has no admin bypass, so `main`'s required-review protection is a hard human gate.

One-time setup (owner, in browser): Settings → Developer settings → GitHub Apps → New GitHub App — name `recipelanes-agent`, webhook disabled, repository permissions **Contents: rw, Pull requests: rw, Issues: rw**, "Only on this account" → create, **generate a private key**, then **Install App** on the RecipeLanes repo.

| Config | Kind | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | secret | Gemini CLI auth (already configured) |
| `AGENT_APP_ID` | repo **variable** | The GitHub App's numeric App ID |
| `AGENT_APP_PRIVATE_KEY` | secret | The app's private key (.pem contents) |
| `AGENT_GH_PAT` | secret (optional fallback) | Fine-grained PAT used only if the app isn't configured |

## Agent brain

Prompts live in-repo: `GEMINI.md` (workspace rules), `.gemini/agents/orchestrator.md` (the solver contract — dedup, tests-mandatory, CI gate), `.gemini/commands/resolve-issue.toml` and `.gemini/commands/address-comment.toml` (the entry points the workflows invoke).
