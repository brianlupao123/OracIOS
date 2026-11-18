# ORAC SYSTEM HANDOVER STATE: ANTIGRAVITY TO CODEX
**Date**: 2026-11-09  
**Author**: Antigravity (Frontend Agent)  
**Audience**: Codex (Backend Agent), Claude (UX Reviewer & Designer), Brian Lupao (Owner)  
**Status**: UNCOMMITTED at backend repo root per instruction H6.  
**Base Status Update**: Backend `main` has been fast-forwarded to `edbd4bd` (identical to `feature/payroll-pastel`).

---

## 1. Auth Contract Line
> **Codex will write `docs/auth-contract.md` before Antigravity wires any sign-in screen.**

---

## 2. Do-Not-Touch List for Codex

1. **Frontend Repository**:
   - Codex must **never touch or edit any frontend files** in `D:\Projects\ORAC-WORKSPACE\2-portal-frontend\orac-ios-frontend` or `D:\Projects\ORAC-WORKSPACE\2-portal-frontend\orac-ux`.
2. **Guarded Frontend Files** (protected by `ux/rules.json` and owner approval requirement):
   - `src/App.jsx`
   - `src/accessPolicy.js`
   - `src/api/client.js`
   - `src/pages/QuotationsPage.jsx`
   - `src/pages/DailyTimesheetPage.jsx`
   - `src/pages/DailyTimesheetPrintPage.jsx`
   - `src/pages/ContractorLogPage.jsx`
   - `src/pages/ContractorLogPrintPage.jsx`
   - `src/pages/TimesheetWorkflowPage.jsx`
   - `src/pages/WorksheetRegisterPage.jsx`
   - `src/pages/WorksheetRegisterPrintPage.jsx`
3. **Open UX Branches**:
   - Any branch matching `ux/*` (e.g. `ux/p5-wave-1`, `ux/p5-reconcile`, `ux/p4c-mock-parity`).
4. **Lane A Importer Backend Files** (Do NOT touch until Lane A is merged):
   - `src/store.js`
   - `src/controllers/adminController.js`
   - `src/router.js`
   - `src/controllers/importController.js`
   - `src/services/masterDataService.js`
   - `src/importers/masterDataImport.js`
   - `src/importers/csvText.js`
   - `tests/importer*.test.js`
   - `tools/time-import*.mjs`
5. **Guarded Production / Owner Decisions**:
   - Never push to remote.
   - Never delete branches.
   - Never touch production databases or deployment targets.
   - Never decide owner items (D1 to D5, VAT/overtime rates, client rate band).

---

## 3. H1: Git State of Both Repositories

### A. Backend Repository
- **Root Path**: `C:\Users\BRIAN LUPAO\Desktop\ffims-asset-register\two-concept-packet-backend-20261005-235259`
- **Active Checked-Out Branch**: `main` (fast-forwarded to `feature/payroll-pastel`)
- **Current HEAD**: `edbd4bd3d2d6a1810fe5f8039347c22ec917dc7a` (`edbd4bd`)
- **Status (`git status --short`)**:
  ```text
  ?? HANDOVER_STATE.md
  ```
  *(Working tree is 100% clean, containing commit edbd4bd which enforces Sales portfolio scoping on invoice drafts and dashboard summary).*
- **`git log -1` on main**:
  ```text
  commit edbd4bd3d2d6a1810fe5f8039347c22ec917dc7a
  Author: Brian Lupao <lupaobrian98@gmail.com>
  Date:   Mon Nov 9 12:45:44 2026 +0200

      fix(sales-portfolio): enforce Sales portfolio scoping on invoice drafts and dashboard summary
  ```
- **Branch Touch Permissions**:
  - **Codex**: Backend repo only. Branch **only from the new `main` (`edbd4bd`)**. Do not start from `1069c8a`. Merges are local to backend.

---

### B. Frontend Repository
- **Root Path**: `D:\Projects\ORAC-WORKSPACE\2-portal-frontend\orac-ios-frontend`
- **Active Checked-Out Branch**: `main`
- **Current HEAD**: `1f69a66468a28e08f7aa8fdf1688c3d6cda62882` (`1f69a66`)
- **Remote Tracking**: `origin/main` (`main` is **72 commits ahead** of `origin/main` at `279242a`)
- **Status (`git status --short`)**:
  ```text
  ?? evidence/
  ```
- **Worktree List**:
  - `D:/Projects/ORAC-WORKSPACE/2-portal-frontend/orac-ios-frontend` [main] (HEAD `1f69a66`)
  - `D:/Projects/ORAC-WORKSPACE/2-portal-frontend/orac-ux` [ux/p5-wave-1] (HEAD `3d1fcf9`, already merged into main at `fa4a069`)
- **Branch Touch Permissions**:
  - **Antigravity**: Frontend repo only. `ux/*` branches for presentation work, `feat/*` or `main` for integrations.
  - **Codex**: Never touches frontend repo or branches.

---

## 4. H2: Latest Real Test Counts

### Backend (`main` at `edbd4bd`, `node --test tests/*.test.js`)
- **Total Tests**: 1,411
- **Passed**: 1,407
- **Failed**: 0
- **Skipped**: 4
- **Cancelled / Todo**: 0
- **Execution Time**: 67.31s
- **Status**: Clean 100% pass (0 failures).

### Frontend (`main` at `1f69a66`, `node --test tests/*.test.js`)
- **Total Tests**: 643
- **Passed**: 643
- **Failed**: 0
- **Skipped**: 0
- **Execution Time**: 15.51s
- **Build Status**: `npm run build` succeeds cleanly in ~10.8s.
- **Status**: Clean 100% pass (0 failures).

---

## 5. H3: Backend Facts Assumed by Codex Handoff (Verified with `file:line`)

| Fact Assumed | Verified Status | Exact File:Line Citation | Details |
|---|---|---|---|
| **1. Login route & envelope (`data.token`)** | **CONFIRMED** | `src/router.js:106`<br>`src/controllers/authController.js:15-48` | Route: `router.post("/auth/login", validate(LoginSchema), loginDemoUser);`.<br>Response envelope: `{ success: true, data: { user: toPublicUser(user), token, note: "JWT Login successful" } }`. |
| **2. Existing rate limiter** | **CONFIRMED** | `src/middleware/rateLimit.js:1-192`<br>`server.js:54` | Defined in `src/middleware/rateLimit.js`. Mounted in `server.js:54` via `app.use("/api", createPublicEndpointLimits());` **before** `persistenceMiddleware`. Uses in-memory sliding fixed window (`WindowCounter`). Returns HTTP 429 with `Retry-After`. |
| **3. JSON store vs PostgreSQL support** | **CONFIRMED** | `src/config.js:37,64-65,75-81`<br>`src/configuredStore.js:15-19`<br>`server.js:25-27` | Config switches on `STORE_DRIVER` (`"json"` default, `"postgres"` required in production). Driver loaded lazily in `src/configuredStore.js`. If postgres, `DATABASE_URL` is required and `server.js` awaits `ensureTableExists()`. |
| **4. JWT construction & revocation** | **CONFIRMED (Stateless with timestamp & deactivation checks; no blocklist)** | `src/middleware/auth.js:13-26,41-47` | Token built in `generateToken`: `jwt.sign({ id, email, role, is_active }, config.jwtSecret, { expiresIn: config.jwtExpiresIn })`.<br>Revocation: **No global token blocklist/denylist exists**. Revocation is handled per-request via `req.db.users.find(u => u.id === payload.id)`: (1) immediate refusal if `!user.is_active` (401 Account inactive), and (2) if `user.password_changed_at` exists, checks `payload.iat >= changedAt`, refusing tokens issued prior to password change (401 Session invalid). |
| **5. `.gitignore` coverage for `data/outbox`** | **ABSENT (Not covered)** | `.gitignore:1-7` | Current `.gitignore` contains `node_modules/`, `data/db.json`, `.env`, `evidence/stage-reports/`, `.lead-retry-backups/`, `.orac-v5-signature-phase/`, `*.log`. **`data/outbox` is NOT ignored**. Codex must add `data/outbox/` (or `data/`) to `.gitignore` when introducing the dev outbox. |
| **6. Existing mail code** | **NONE (Providerless / Stubbed)** | `src/controllers/authController.js:58-63,88` | "No owner-approved delivery adapter exists... delivery: 'not_configured'". In `src/controllers/accessRequestsController.js:215`, setup links are returned in the HTTP JSON response to Admin. No mailer or SMTP library is present. |
| **7. Existing audit-log mechanism** | **CONFIRMED** | `src/store.js:456-467`<br>`src/postgresStore.js:27` | `audit(db, actor, entityType, entityId, action, oldValues, newValues)` appends an entry to `db.audit_logs`. Reused identically in PostgreSQL store via `helpers.audit`. |
| **8. Env var loading & boot validation** | **CONFIRMED** | `src/config.js:9-28,47-82`<br>`server.js:8` | Env loading: `loadDotEnvFile()` reads `.env` via `readFileSync` line-by-line without overriding existing `process.env`.<br>Boot validation: `validateRuntimeConfig()` executes synchronously at module load time (`server.js:8`), checking port, proxy hops, and production invariants (`STORE_DRIVER=postgres`, strong `JWT_SECRET`, disabled `TIMESHEET_SALES_ACCESS`). |

---

## 6. H4: Safety Check on `ORAC_STATUS_SNAPSHOT.mjs`
- **Network calls**: **ZERO**. Uses standard Node core modules. Makes no HTTP/HTTPS/fetch/socket requests.
- **Deletes / Modifies Repo Files**: **NONE**. Writes only a single archive (`ORAC_STATUS_<label>_<date>.zip`) into `--out <dir>`.
- **Secrets & Privacy**: Automatically redacts local file paths and usernames (`~`), ignores `.env*` files without opening them, ignores `data/` store content.
- **Permission for Codex**: **YES, Codex may run it safely**. When running, specify `--out <dir>` if desired to keep the output zip in a dedicated folder.

---

## 7. H5: Backend Files Touched by Importer Patch (Lane A)
When Antigravity applies Lane A (`ORAC-IMPORTER-V1-REBASED.zip`), the following backend files are touched. **Codex must not edit these files**:
- `src/store.js`
- `src/controllers/adminController.js`
- `src/router.js`
- `src/controllers/importController.js`
- `src/services/masterDataService.js`
- `src/importers/masterDataImport.js`
- `src/importers/csvText.js`
- `tests/importerHardening.test.js`
- `tests/importerHttp.test.js`
- `tests/importerTimingTool.test.js`
- `tests/masterDataServiceParity.test.js`
- `tests/importerCsvText.test.js`
- `tests/importerRows.test.js`
- `tests/importerRefusals.test.js`
- `tools/time-import-http.mjs`
- `tools/time-import.mjs`

---

## 8. H7: Discrepancies and Conflicts Between Pack Files and Repositories

1. **Backend Branch State**: Fast-forwarded to `edbd4bd`. Backend `main` is now synchronized with `feature/payroll-pastel` and passes all 1,407 tests.
2. **Frontend Commit Ahead Count**: Frontend `main` is at `1f69a66` and is **72 commits ahead** of `origin/main` (not 43). Working tree has `?? evidence/`.
3. **`.gitignore` Coverage**: `data/outbox` is not currently in `.gitignore`.
4. **Rate Limiting**: Rate limiter already exists and is mounted ahead of the store lock (`src/middleware/rateLimit.js`, `server.js:54`).
5. **No Existing Email Infrastructure**: No mail package exists in `package.json`. Auth delivery is currently stubbed with `delivery: "not_configured"`.

---
*Updated by Antigravity on 2026-11-09 after fast-forwarding backend main to edbd4bd.*
