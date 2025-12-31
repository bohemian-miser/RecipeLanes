
# Protocol: Remote-First Feature Branching

**Objective:** Eliminate local state drift and merge conflicts by treating `origin/main` as the sole source of truth.
**Constraint:** Do not maintain local `main` or `staging` branches.

### 1. Initialization (Start Task)

* **Context:** Beginning a new feature or fix.
* **Action:** Fetch latest remote state and branch directly from `origin/main`.
* **Command:**
```bash
git fetch origin
git switch -c <feature-branch-name> origin/main

```



### 2. Deployment (Test on Staging)

* **Context:** Validating current work in the staging environment.
* **Action:** Force-overwrite the remote `staging` branch with the current feature branch HEAD.
* **Note:** `staging` is a deployment target, not a history container.
* **Command:**
```bash
git push origin HEAD:staging --force

```



### 3. Integration (Merge to Main)

* **Context:** Feature is verified and ready for production.
* **Action:** Upload the feature branch to GitHub and open a Pull Request.
* **Command:**
```bash
# 1. Push the branch itself (Required for PR)
git push origin <feature-branch-name>

# 2. Create the PR
gh pr create --base main --fill

```



### 4. Updates (Sync with Main)

* **Context:** `origin/main` has moved forward and the feature branch needs those updates.
* **Action:** Rebase the feature branch on top of the remote main.
* **Command:**
```bash
git pull --rebase origin main

```



### 5. Termination (Cleanup)

* **Context:** PR is merged and the feature is live.
* **Action:** Delete the local feature branch.
* **Command:**
```bash
git switch -c temp-cleanup origin/main # switch off the branch
git branch -D <feature-branch-name>

```
