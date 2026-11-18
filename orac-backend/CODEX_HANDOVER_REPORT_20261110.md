# CODEX RECONCILED HANDOVER REPORT — ORAC SYSTEMS
**Date**: 2026-11-10T10:08 +02:00 (Africa/Harare)  
**Author**: Antigravity (Frontend & Integration Agent)  
**Recipient**: Codex (Backend Agent)  
**Reference**: Reconciled directly against `C:\Users\BRIAN LUPAO\Documents\Codex\ORAC_ANTIGRAVITY_RECONCILIATION_20261110.md`  
**Checkouts**:
- Backend: `C:\Users\BRIAN LUPAO\Desktop\ffims-asset-register\two-concept-packet-backend-20261005-235259`, branch `codex/auth-totp`
- Portal Frontend: `D:\Projects\ORAC-WORKSPACE\2-portal-frontend\orac-ios-frontend`, branch `main`

---

## 1. Executive Summary & Acknowledgement of Corrections

Antigravity has read Codex's reconciliation report (`ORAC_ANTIGRAVITY_RECONCILIATION_20261110.md`) and accepts all corrections:

1. **Admin Factor Reset Dual Authorization**: The initial implementation in commit `fc4e67a` accepted `approver_id` in the request body without authenticating that second Admin. Codex correctly identified this as identity lookup rather than independent approval. **This flaw is now corrected in commit `9289360`** with a strict two-step protocol (`/request` and `/approve`) requiring two separate authenticated Admin bearer tokens, with complete negative test coverage.
2. **First-Admin Bootstrap (D1)**: Reconciled as a **partial technical mechanism** (`scripts/bootstrap-totp-ticket.js`). It provides a technical path to generate a ticket under `operator:cli`, but named operator attribution, verified out-of-band delivery SOP, and break-glass governance remain operational gates.
3. **PostgreSQL Concurrency**: The architectural observation of `SELECT ... FOR UPDATE` in `postgresStore.js` is not a substitute for a live two-pool integration test. **The two-pool concurrency verification gate remains open**.
4. **Strict Release Separation**: The backend TOTP candidate is kept **strictly isolated** on `codex/auth-totp` and will not be mixed into any portal release. TOTP remains disabled by default.
5. **Portal Remote Divergence**: Local portal `main` is 75 commits ahead of local `origin/main`. No portal push will occur until the remote is fetched and reconciled.

---

## 2. Backend Commits on `codex/auth-totp`

### Commit History
| Hash | Message | Status |
|---|---|---|
| `9289360` (**HEAD**) | `fix(auth): enforce strict two-step dual-authorization for Admin factor resets` | ✅ Verified (31/31 TOTP tests pass) |
| `fc4e67a` | `feat(auth): implement D1 bootstrap, D2 factor reset, and D3 CLI reset provenance` | Checkpointed |
| `3fe12a8` | `feat(auth): add TOTP enrollment/verify candidate with Batch 1 denial audit (TOTP disabled by default)` | Checkpointed (Batch 1 applied) |
| `53c64da` (base) | `Use fictional clients in demo seed data` | Clean base (0 privacy findings) |

---

## 3. Detailed Resolution of the Admin Factor-Reset Approval Flaw (Commit `9289360`)

### The Flaw Identified by Codex
In `fc4e67a`, `resetTotpFactor` allowed an authenticated Admin A to submit `{ user_id: adminC, approver_id: adminB }` and immediately wiped Admin C's factor. Admin B was never authenticated and never took an action.

### The Corrected Implementation (Commit `9289360`)
Replaced with a strict two-step, dual-authenticated protocol:

1. **Direct Reset Blocked for Admin Targets**:
   - `POST /api/auth/totp/factor/reset` remains valid ONLY for non-Admin targets (e.g. Finance, Management) where a single Admin has verified identity.
   - Calling direct `resetTotpFactor` on an Admin target returns **403 Forbidden** with reason `admin_requires_approval_workflow`. Providing an `approver_id` in the body is ignored and rejected.

2. **Step 1: Request (`POST /api/auth/totp/factor/reset/request`)**:
   - Initiated by Admin A (`requester`, authenticated with bearer JWT).
   - Validates target is an active Admin with an enrolled factor.
   - Rejects self-request: Admin A cannot request reset of their own factor (403 `self_request`).
   - Generates a 256-bit random `request_id` (base64url).
   - Stores `target.totp_factor_reset_request`:
     - `digest: digestOpaque(request_id)`
     - `requested_by: actor.id`
     - `expires_at: Date.now() + 30_minutes`
     - `session_epoch: target.session_epoch`
     - `password_digest: digestOpaque(target.password_hash)`
     - `email: target.email`
     - `target_id: target.id`
   - Emits audit record: `TOTP_FACTOR_RESET_REQUESTED` (`actor_id: Admin A`).
   - Returns `{ success: true, data: { request_id, expires_in_seconds: 1800 } }`.

3. **Step 2: Approval (`POST /api/auth/totp/factor/reset/approve`)**:
   - Executed by Admin B (`approver`, authenticated with their **own distinct bearer JWT**).
   - Takes `{ user_id, request_id }`.
   - Rejects target self-approval: Admin C cannot approve their own reset (403 `target_approval`).
   - Rejects requester self-approval: Admin A cannot approve their own request (403 `self_approval`).
   - Rejects missing request: 404 `no_pending_request`.
   - Rejects mismatched `request_id`: 400 `bad_request_id` (via constant-time `equalDigest`).
   - Rejects expired request: 400 `request_expired`.
   - Rejects stale request: 409 `request_stale` if target password hash, email, or `session_epoch` changed.
   - **Single-Use Consumption**: `target.totp_factor_reset_request` is wiped immediately. Replay calls immediately return 404 `no_pending_request`.
   - Clears `target.totp = null`, `target.totp_enrollment_ticket = null`, revokes all active sessions via `revokeSessions(target)`.
   - Emits distinct audit rows:
     - `TOTP_FACTOR_RESET_APPROVED` (`actor_id: Admin B`, `after: { requested_by: Admin A, approved_by: Admin B }`).
     - `TOTP_FACTOR_RESET` (`actor_id: Admin B`, `after: { reset_by: Admin B, requested_by: Admin A }`).

### Negative Test Suite (`tests/totpFactorReset.test.js`)
All 9 tests pass:
1. `resetTotpFactor is 404 when enrollment is dark`
2. `resetTotpFactor requires manageUsers permission`
3. `resetTotpFactor refuses self reset` (403 `self_reset`)
4. `resetTotpFactor refuses target without enrolled factor` (409 `not_enrolled`)
5. `resetTotpFactor strictly refuses Admin targets even with approver_id` (403 `admin_requires_approval_workflow`)
6. `resetTotpFactor resets non-Admin user directly with single Admin` (200, session revoked, audited)
7. `requestTotpFactorReset validates caller and target constraints` (rejects unknown, non-admin, self-request; returns `request_id`, audits)
8. `approveTotpFactorReset enforces dual-authorization gates, single-use, and replay resistance` (rejects target approval, self-approval, bad ID, stale session, replay; verifies distinct audit rows)
9. `approveTotpFactorReset rejects expired requests` (400 `request_expired`)

---

## 4. Reconciled Contract & Documentation Status

### `docs/auth-contract.md`
- Reconciled line 9 and rollout gates: accurately states that technical bootstrap and dual-authorization reset routes are built in source, while independent delivery channels, break-glass SOP, two-pool PostgreSQL testing, and browser UAT remain open release gates.
- Table updated with explicit endpoints:
  - `POST /api/auth/totp/factor/reset` (non-Admin direct)
  - `POST /api/auth/totp/factor/reset/request` (Admin request initiation)
  - `POST /api/auth/totp/factor/reset/approve` (Admin independent approval)

### `scripts/reset-admin-password.js` & `scripts/bootstrap-totp-ticket.js`
- Both scripts clear `totp_factor_reset_request` alongside `totp_enrollment_ticket` and pending enrollments, preventing stale reset state after an operator reset.

---

## 5. Test Suite Verification Summary

| Suite | Command | Result |
|---|---|---|
| Factor Reset Suite | `node --test tests/totpFactorReset.test.js` | **9/9 pass** |
| Destructive Guard Suite | `node --test tests/destructiveGuard.test.js` | **7/7 pass** |
| All TOTP Tests | `node --test tests/totp*.test.js` | **31/31 pass** |
| Timesheet/Worksheet TZ Sweep | `dailyTimesheetValidation`, etc. across UTC, Harare, Kiritimati | **122/122 pass** |
| Release Archive Privacy Scan | `scan-backend-release-archive` rules on `53c64da` | **0 findings (116 files)** |

---

## 6. Open Operational Gates (What Remains Before Production Activation)

1. **Two-Pool PostgreSQL Concurrency Verification**: Run an actual integration test with two concurrent database connections testing race conditions on challenge consumption, ticket consumption, and attempt lockout.
2. **First-Admin Bootstrap Governance (D1)**: Define the operational SOP for running `bootstrap-totp-ticket.js`, including named operator logging, out-of-band delivery channel, and verified acceptance.
3. **Lost-Factor Break-Glass Custodian SOP (D2)**: Document the identity-verification standard, notice channel, and break-glass custodian procedure for lost devices.
4. **Portal Remote Reconciliation**: Fetch and reconcile portal `origin/main` to understand the 75-commit delta before publishing portal `main` at `a2fbcc4`.
5. **Portal TOTP Screen Wiring**: With file-level owner approval on guarded files (`App.jsx`, `accessPolicy.js`, `client.js`), wire `status: "verification_required"` to the 6-digit authenticator code and recovery code inputs (authenticator app only, no emailed code, no resend countdown).
6. **Production Cutover Runbook**: Coordinate deployment order, flag activation, smoke tests, and rollback triggers.
