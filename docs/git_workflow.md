
# Protocol: Disposable Feature Branch Workflow (Remote-First)

**Objective:** Prevent history divergence and merge conflicts by enforcing atomic, short-lived branches.
**Core Rule:** Branches are disposable "cattle," not pets. Never reuse a branch after it has been merged.

### 1. Spin Up (Atomic Start)

* **Context:** Starting a **single** specific task (fix, feature, or doc).
* **Action:** Create a fresh branch from the latest remote state. Use a category prefix (`feat/`, `fix/`, `docs/`).
* **Command:**
```bash
git fetch origin
git switch -c <category>/<desc> origin/main
# Example: git switch -c docs/update-git-guide origin/main

```



### 2. Validation (Staging Preview)

* **Context:** Checking if the code works in the live environment.
* **Action:** Force-overwrite the remote `staging` branch with your current work.
* **Command:**
```bash
git push origin HEAD:staging --force

```



### 3. Integration (Ship It)

* **Context:** Task is complete.
* **Action:** Upload the branch and auto-generate a PR.
* **Strategy:** **Squash and Merge** (Combines all commits into one clean entry on `main`).
* **Command:**
```bash
# 1. Upload your specific branch
git push origin HEAD

# 2. Create PR with a detailed description
# Write description to a temporary file (recommended for multi-line context)
echo -e "Summary:\n- Change A\n- Change B\n\nFixes #123" > .pr_body.txt
gh pr create --base main --title "<Descriptive Title>" --body-file .pr_body.txt
rm .pr_body.txt

# OR use --fill if the commit messages are sufficient
# gh pr create --base main --fill
```



### 4. Sync (Optional Update)

* **Context:** `main` updated while you were working, and you need those updates before merging.
* **Action:** Rebase your branch on top of the new `main`.
* **Command:**
```bash
git pull --rebase origin main
# If you push after this, you must use force-with-lease
git push --force-with-lease

```



### 5. Tear Down (Total Cleanup)

* **Context:** PR is successfully merged. The branch is now dead.
* **Action:** Switch to main, pull the new changes, and destroy the branch **both locally and remotely**.
* **Command:**
```bash
git switch main
git pull                                # Get the new main
git branch -D <branch-name>             # Delete local copy
git push origin --delete <branch-name>  # Delete remote copy

```



> **Pro Tip:** If you merge using the CLI, you can do Step 5 automatically:
> `gh pr merge --squash --delete-branch`
