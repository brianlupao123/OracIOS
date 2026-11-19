# ORAC-IOS — Git Operations, Architecture & Clean Development Handbook

**Author:** ORAC Systems Engineering  
**Target Repository:** `https://github.com/brianlupao123/OracIOS`  
**Local Root:** `D:\Projects\orac-ios\`  
**Topology:** 2-in-1 Enterprise Monorepo (`orac-backend` + `orac-ios-frontend`)  
**Standard:** Clean Industrial Development, Zero Regressions, Traceable Git Operations

---

## 1. Monorepo Git Topology & Mental Model

ORAC-IOS is organized as a unified **2-in-1 Monorepo**. This means there is **one single `.git` repository** at the root (`D:\Projects\orac-ios\.git`) governing both the backend services and the frontend portal.

```
D:\Projects\orac-ios\                 <-- SINGLE GIT REPO ROOT (.git is here)
├── .dockerignore
├── docker-compose.yml
├── orac-backend/                     <-- Backend Service (Node.js ESM, Express, SQLite/Postgres)
│   ├── package.json
│   ├── server.js
│   ├── src/
│   │   ├── modules/                  <-- 20 Domain Modules
│   │   ├── services/                 <-- BaseService, Ledger, Auth
│   │   └── router.js                 <-- 89-line Clean Ingress Router
│   ├── tests/                        <-- 2,269 passing tests
│   └── Dockerfile
└── orac-ios-frontend/                <-- Frontend Client Portal (React 18, Vite, Tailwind)
    ├── package.json
    ├── vite.config.js
    ├── src/
    │   ├── features/                 <-- 14 Clean Feature Slices
    │   ├── api/                      <-- Per-feature API clients
    │   └── offlineOutboxSync.js      <-- PWA Sync Engine
    ├── tests/                        <-- 740 passing tests
    └── Dockerfile
```

> [!IMPORTANT]
> **Single Repository Root:** Always run high-level Git commands from the root directory `D:\Projects\orac-ios\`.  
> When testing or building code, run `npm test` or `npm run build` inside the specific folder (`orac-backend` or `orac-ios-frontend`).

---

## 2. Daily Development Workflow

### Step 1: Check Current Status
Before writing or modifying any code, inspect your working tree:
```powershell
# Short concise status
git status -s

# Detailed status showing branch, staged files, and untracked files
git status
```
- `??` = Untracked file (Git does not track it yet)
- ` M` = Modified file (not staged)
- `M ` = Modified file (staged for next commit)
- `A ` = Newly added file (staged)

### Step 2: Inspect Exact Changes (Diffing)
Review exactly what lines of code you changed before staging:
```powershell
# See unstaged line-by-line differences
git diff

# See differences in a specific file
git diff orac-backend/src/modules/fleet/routes.js

# See differences that are already staged
git diff --staged
```

### Step 3: Staging Clean Changes
Stage only the files related to the specific feature or fix:
```powershell
# Stage a specific file
git add orac-backend/src/modules/fleet/routes.js

# Stage an entire feature directory
git add orac-ios-frontend/src/features/fleet/

# Stage all tracked and untracked changes across the whole monorepo
git add .
```

### Step 4: Semantic, Meaningful Commits
Every commit must represent a working, verifiable milestone. Follow the **Conventional Commits** standard:

| Prefix | When to Use | Example |
| :--- | :--- | :--- |
| `feat:` | A new user-facing feature or API capability | `feat(fleet): add pre-dispatch roadworthiness certificate gate` |
| `fix:` | A bug fix or defect correction | `fix(auth): prevent session expiration during offline PWA sync` |
| `refactor:` | Code restructuring without changing functional behavior | `refactor(router): extract asset domain routes into module pattern` |
| `test:` | Adding or improving automated tests | `test(ingress): add idempotency replay verification for web leads` |
| `docs:` | Documentation, READMEs, architectural specs | `docs(topology): clarify 2-in-1 monorepo and Vercel ingress boundary` |
| `chore:` | Tooling, dependencies, or configuration updates | `chore(docker): add production frontend multi-stage Dockerfile` |

Commit command:
```powershell
git commit -m "feat(module): brief description of feature" -m "Detailed explanation of why this change was made and what was tested."
```

---

## 3. Branching & Feature Isolation

Never develop risky or experimental features directly on `master`. Use short-lived feature branches:

```
master  ●───────────────────●───────────────────●  (Production-ready)
         \                 /
feature   ●───────●───────●                         (Isolated development)
```

### Creating & Working on a Branch:
```powershell
# 1. Ensure master is clean and up to date
git checkout master
git pull origin master

# 2. Create and switch to a new feature branch
git switch -c feat/fuel-telemetry-streaming

# 3. Work on code, run tests, and commit
git add .
git commit -m "feat(telemetry): add live fuel level sensor stream"

# 4. Switch back to master when ready to merge
git switch master

# 5. Merge the feature branch into master
git merge feat/fuel-telemetry-streaming

# 6. Delete the temporary branch once merged
git branch -d feat/fuel-telemetry-streaming
```

---

## 4. History Inspection & Auditing

Git gives you full forensic visibility into who changed what, when, and why.

### Pretty Commit Log Graphs:
```powershell
# View clean single-line history
git log --oneline -n 10

# View graphical branch tree with tags and authors
git log --graph --oneline --decorate --all

# View commits with full diff summaries
git log --stat -n 5
```

### Inspecting Specific Commits:
```powershell
# View full patch diff of a specific commit
git show 45d3a09

# View who touched each line of a file (forensic audit)
git blame orac-backend/src/services/inventoryLedger.js
```

---

## 5. Safe Undo & Emergency Operations

Every developer makes mistakes. Git allows you to recover cleanly without losing work:

### Case A: You made edits to a file and want to discard them completely
```powershell
# Revert a file back to its last committed state
git restore orac-backend/src/router.js
```

### Case B: You ran `git add .` by accident and want to unstage
```powershell
# Unstage everything without losing any code edits
git restore --staged .

# Unstage a single file
git restore --staged orac-backend/.env
```

### Case C: You committed, but forgot a file or made a typo in the message
```powershell
# Amend the last commit with new staged files or new message
git add missedFile.js
git commit --amend -m "feat(core): updated message with missed file"
```
*(Only do this before pushing to GitHub!)*

### Case D: Temporary shelf (Stashing work in progress)
If you need to switch tasks or pull updates without committing half-finished code:
```powershell
# Save dirty working tree to stash
git stash push -m "WIP: fuel sensor refactor"

# View saved stashes
git stash list

# Re-apply stashed work when ready
git stash pop
```

### Case E: Soft Reset (Uncommit while keeping all changes in your editor)
```powershell
# Undoes the last commit, leaving all your files modified and ready in staging
git reset --soft HEAD~1
```

---

## 6. Remote GitHub & Cloud Deployment Pipeline

### Remote Configuration
Your local repository is wired to:
- **Remote Name:** `origin`
- **URL:** `https://github.com/brianlupao123/OracIOS.git`
- **Primary Branch:** `master`

### Pushing to GitHub:
```powershell
# First time push (sets upstream tracking)
git -C "D:\Projects\orac-ios" push -u origin master

# Routine subsequent pushes
git push origin master
```

### How GitHub Triggers Deployments:
```
Local Monorepo (D:\Projects\orac-ios)
        │
        ▼ (git push origin master)
GitHub Repository (brianlupao123/OracIOS)
   ├── orac-backend/  ──────► Fly.io Webhook / GitHub Action ──► Deploys Node.js API (api.orac.co.zw)
   └── orac-ios-frontend/ ──► Render / Vercel Webhook        ──► Deploys React Client (portal.orac.co.zw)
```

1. When you push to `master`, GitHub notifies connected cloud providers via webhooks or GitHub Actions.
2. **Fly.io** detects changes in `orac-backend/`, builds using `orac-backend/Dockerfile`, runs tests, and rolls out the live API.
3. **Render / Vercel** detects changes in `orac-ios-frontend/`, executes `npm run build`, and distributes the compiled bundle across the global CDN.

---

## 7. Golden Rules of Clean ORAC Development

1. **Rule 1 (Zero Regressions):** Always run `node --test tests/*.test.js` before staging a commit. Never push failing tests.
2. **Rule 2 (Atomic Commits):** Keep commits focused on a single topic. Do not mix unrelated frontend UI tweaks with backend database migrations.
3. **Rule 3 (Meaningful Messages):** Avoid lazy messages like `"update"`, `"fix"`, or `"test"`. Use clear, descriptive summaries like `"feat(fleet): implement daily fuel consumption reconciliation"`.
4. **Rule 4 (No Secrets in Git):** Never commit `.env`, private keys, database passwords, or JWT secrets. Always check `.gitignore` and `.env.example`.
5. **Rule 5 (Explicit Confirmation):** Never push or force-push to `origin master` without checking status and verifying the working tree.
