# ORAC A1/A4/A8/A9 Release-Scope, Simulated Store & Real PostgreSQL Evidence Report

**Date:** 20 November 2026  
**Repository:** `D:\Projects\orac-ios`  
**Current Baseline Commit:** `bdb8a7c` on branch `master` (ahead of `origin/master` by 2 commits)  
**Governing Standard:** Locally tested and rehearsed remediation only; strictly **not declared production ready, not deployed, not pushed to remote**.  
**Live Target Database for Rehearsal:** Dedicated disposable PostgreSQL instance on Neon (`orac_test_rehearsal`), targeting isolated non-production storage.  

---

## 1. Current Active-Feature & Role Register

Per the A1/A4 governance directives, the following boundary rules are strictly enforced:

| Subsystem / Feature | Role / Surface | Active State | Operational Truth & Reason |
| :--- | :--- | :--- | :--- |
| **Fleet & Facilities Equipment History** | Fleet/Facilities, Operations | **DISABLED** | 14 Lane 6 tests are skipped (`lane6DispatchToTagIntegrity`, `lane6HistoryOrderingAndScope`, `lane6MaintenanceHistoryRead`). No authoritative route or table exists. |
| **Client Viewer Equipment History** | Client Viewer | **UNAVAILABLE** | Multi-tenant client tenancy and allowlist projection tests for equipment history do not exist. Blocked to prevent cross-client asset data leakage. |
| **Worksheet Three-Signature Completion** | Supervisor, Operations | **UNAVAILABLE** | 3 Lane 6 completion tests are skipped (`lane6WorksheetCompletion.test.js`). The signature field model is pending owner definition. |
| **Jobs Tracker Completion Records** | All internal roles | **NOT CAPTURED** | [jobTrackerController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/jobTrackerController.js) explicitly sets `completion_record: "Not captured"` when no authoritative field exists. Operational completion is **never** inferred from billing or settlement. |
| **Direct-Sale Stock Issue** | Operations, Sales | **DARK / DISABLED** | `ENABLE_DIRECT_SALE_STOCK_ISSUE` unset/false. Returns 404. Stock balance cannot be moved outside approved service dispatches. |
| **TOTP Two-Factor Authentication** | All roles | **DARK / DISABLED** | `ORAC_TOTP_PROTECTED_ROLES` unset. Dark pending PostgreSQL two-pool concurrency testing and emergency break-glass procedure. |
| **V5 Commercial & Invoice Writer** | Sales, Finance | **DARK / DISABLED** | `VITE_ORAC_V5_COMMERCIAL_WORKFLOW=false`, `VITE_ORAC_V5_INVOICE_WRITER=false`. 4 PostgreSQL writer tests skipped (`v5InvoiceWriterPostgres.test.js`). |
| **Advisory AI Workflow** | All roles | **DARK / READ-ONLY** | `RECORD_TRAIL_ASSISTANT_ENABLED` unset/false. No external network requests; providerless scoped summary only. |
| **Outbound Email Transport** | System-wide | **DARK / DRY-RUN** | `COMMUNICATIONS_DRY_RUN=true`. No mail packages in `package.json`. Outbound transport is blocked; previews and manual external sends are durably audited. |

---

## 2. Unskipped Outbound-Email Guard Verification

In [noOutboundEmailGuard.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/noOutboundEmailGuard.test.js), the test suite unconditionally asserts package existence and cleanliness against `package.json`:

```text
> node --test tests/noOutboundEmailGuard.test.js

✔ no mail-sending package is declared in backend/package.json (24.1368ms)
✔ no file under backend/src imports a mail-sending package or creates an SMTP transport (165.9721ms)
✔ no route under backend/src has an email or sending path (132.9776ms)
✔ the detector flags import, dynamic import, require and transport creation (1.1641ms)
✔ the detector flags a mail-service host or SMTP hostname, so a plain fetch() to a provider API is caught (0.5202ms)
✔ the detector ignores comments and unrelated imports (0.5512ms)
✔ the route detector flags email or sending paths and ignores ordinary ones (0.5556ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
**Result:** 7/7 passed, 0 skipped. Zero outbound email transport libraries exist. Delivery remains strictly dark.

---

## 3A. Simulated PostgreSQL-Store Integration Evidence (Transaction-Pool Simulator)

In [postgresIntegrationEvidence.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresIntegrationEvidence.test.js), the test suite verifies `postgresStore` transaction lifecycle, locking, and rollback semantics against an in-process transaction-pool simulator. This validates the store logic locally prior to database deployment.

```text
> node --test tests/postgresIntegrationEvidence.test.js

▶ A1/A4/A8/A9: Simulated PostgreSQL-Store Integration Evidence Matrix (Transaction-Pool Simulator)
  ✔ 1. Simulated PostgreSQL: Inventory audit failure cleanly rolls back stock and movement (no ghost state after reconnect) (54.4513ms)
  ✔ 2. Simulated PostgreSQL: Sensitive payment encryption at rest, audited Finance read, and role refusal across new connection (29.1718ms)
  ✔ 3. Simulated PostgreSQL: Sales portfolio multi-tenant isolation persists across fresh connection (3.5104ms)
  ✔ 4. Simulated PostgreSQL: Client Viewer allowlist strips internal secrets and refuses cross-client data (2.3837ms)
  ✔ 5. Simulated PostgreSQL: Verified-PO dispatch gate blocks unverified PO and succeeds once verified (4.3222ms)
  ✔ 6. Simulated PostgreSQL: Critical audit events persist intact after new connection (7.2177ms)
✔ A1/A4/A8/A9: Simulated PostgreSQL-Store Integration Evidence Matrix (Transaction-Pool Simulator) (106.621ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

---

## 3B. Real Isolated PostgreSQL Rehearsal Evidence Matrix (Live Dedicated Neon Database)

In [postgresRealRehearsal.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresRealRehearsal.test.js), all 7 integration proofs were executed directly against a real, live PostgreSQL 17 database on Neon (`orac_test_rehearsal`), supplied via `ORAC_TEST_DATABASE_URL`:

### Raw Test Execution Output
```text
> $env:ORAC_TEST_DATABASE_URL = "postgresql://***@ep-snowy-credit-al6x7xrz.c-3.eu-central-1.aws.neon.tech/orac_test_rehearsal?sslmode=require"; node --test tests/postgresRealRehearsal.test.js

▶ Real Isolated PostgreSQL Rehearsal Evidence Matrix
  ✔ 1. Real PostgreSQL: Inventory audit failure cleanly rolls back stock and movement (no ghost state in real PostgreSQL) (3170.6873ms)
  ✔ 2. Real PostgreSQL: Sensitive payment encryption at rest, audited Finance read, and role refusal across new connection (6314.0032ms)
  ✔ 3. Real PostgreSQL: Sales portfolio multi-tenant isolation persists across fresh connection (5967.5313ms)
  ✔ 4. Real PostgreSQL: Client Viewer allowlist strips internal secrets and refuses cross-client data (4500.1462ms)
  ✔ 5. Real PostgreSQL: Verified-PO dispatch gate blocks unverified PO and succeeds once verified (4752.0238ms)
  ✔ 6. Real PostgreSQL: Critical audit events persist intact after reconnect (4607.6562ms)
  ✔ 7. Real PostgreSQL: Concurrent connections serialized with row-level locking (race-condition protection) (5738.252ms)
✔ Real Isolated PostgreSQL Rehearsal Evidence Matrix (36635.1242ms)
ℹ tests 7
ℹ suites 1
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40679.2174
```

### Verified Real PostgreSQL Invariants
1. **Real Inventory Rollback on Audit Failure:** In real PostgreSQL, when an audit failure is triggered, the controller invokes `result.rollback()`, restores in-memory quantity to 10, and issues `ROLLBACK` on the live transaction. An independent query on a fresh pool confirms `quantity_on_hand` remains 10 and 0 stock movements were persisted in the `store` table.
2. **Real AES-256-GCM Storage & Audited Finance Decryption:** Contractor banking details encrypted with AES-256-GCM are committed to PostgreSQL JSONB. Table inspection proves only ciphertext and auth tag exist in the database (raw bank accounts and EcoCash numbers never appear in PostgreSQL storage). A newly opened connection decrypts successfully for Finance, while non-Finance roles are refused via `requirePermission`. An audited access event is persisted with redacted details.
3. **Real Sales Portfolio Tenancy Scoping:** Commercial quotes and dispatches for separate sales representatives are committed to real PostgreSQL. Independent reader connections verify multi-tenant scoping rules prevent cross-portfolio visibility.
4. **Real Client Viewer Projection & Cross-Client Isolation:** Real documents in PostgreSQL are shaped via `shapeQuoteForClient` / `shapeInvoiceForClient`. Top-level and nested assertions prove that internal profit margins, cost breakdowns, and GL accounts are stripped. Cross-client access is refused.
5. **Real Verified-PO Dispatch Gate:** In real PostgreSQL storage, unverified POs block dispatch readiness with `VERIFIED_PO_REQUIRED`. When updated to `verified` and linked to an approved worksheet, a fresh connection confirms the gate clears cleanly.
6. **Real Critical Audit Reconnect Persistence:** Four critical audit records (`STOCK_MOVEMENT_RECORDED`, `PASTEL_EXPORT_GENERATED` with `REVIEW_NON_POSTING`, `INVOICE_SETTLEMENT_RECORDED`, and dry-run `COMMUNICATION_EVIDENCE_RECORDED`) are committed to PostgreSQL. The pool is terminated, and a completely fresh pool connects and verifies all records persist intact with uncorrupted payloads.
7. **Real PostgreSQL Concurrency & Row-Level Locking:** Two independent connection pools (`pool1`, `pool2`) simultaneously attempt to deduct 4 units from an initial stock of 5. PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) serializes the transactions: Worker 1 commits the deduction (reducing stock to 1), and Worker 2 subsequently reads the updated balance (1 < 4) and safely aborts. The real PostgreSQL row quantity is verified to be exactly 1, completely preventing oversell race conditions.

---

## 4. Skipped-Test Disposition (All 21 Test Skips Accounted For)

| Test File | Skipped Count | Reason Documented in Source | Governing Action / Disposition |
| :--- | :--- | :--- | :--- |
| `tests/lane6DispatchTagIdentity.test.js:120` | 1 | "no writer exists in the package" | **Lane 6 Tag Writer:** Feature disabled. Equipment tag write path not implemented. |
| `tests/lane6DispatchToTagIntegrity.test.js:207` | 1 | "owner decision pending (client-level rule approved; mine-site-strict not decided)" | **Lane 6 Policy:** Optional mine-site strict policy pending owner decision. Client-level rule active. |
| `tests/lane6DispatchToTagIntegrity.test.js:216` | 1 | "needs the invoice fixture shape and signature of dispatchHasActiveInvoice" | **Lane 6 Freeze:** Invoice freeze check pending formal fixture shape. |
| `tests/lane6DispatchToTagIntegrity.test.js:217` | 1 | "the single-valued equipment_tag field — is its value an id or a code?" | **Lane 6 Data Model:** Field semantics pending owner decision. |
| `tests/lane6DispatchToTagIntegrity.test.js:266` | 1 | "needs dispatch creation code and idempotency fingerprint inputs" | **Lane 6 Dispatch:** Creation idempotency for tag links pending specification. |
| `tests/lane6HistoryOrderingAndScope.test.js:198-201` | 4 | "tie-break order not stated; unknown tag status (403 vs 404) not stated; route/permission does not exist" | **Lane 6 History Route:** Fleet equipment history read disabled. Route does not exist. |
| `tests/lane6MaintenanceHistoryRead.test.js:202-206` | 5 | "incident link not stated; worksheet completion not defined; Client Viewer scope not stated; role matrix not stated" | **Lane 6 Maintenance History:** Client Viewer equipment history unavailable; incident links undefined. |
| `tests/lane6WorksheetCompletion.test.js:83-85` | 3 | "the fields that hold the three signatures are not in the package; evaluateForDb signature not in package" | **Lane 6 Completion:** 3-signature completion model unavailable. Jobs Tracker shows `Not captured`. |
| `tests/v5InvoiceWriterPostgres.test.js:148, 159, 175, 191` | 4 | "ORAC_TEST_DATABASE_URL is not set; real PostgreSQL V5 writer tests were not executed" | **V5 Engine:** Kept dark by default (`VITE_ORAC_V5_COMMERCIAL_WORKFLOW=false`). Writer tests dormant. |
| **Total Skipped** | **21** | — | **All 21 accounted for. Zero unexpected skips. Zero failures.** |

---

## 5. A1 Claim Ledger

| Claim Area | Claim Scope | Verified Local Reality | Production Status |
| :--- | :--- | :--- | :--- |
| **Claim 1: Inventory Safety** | Atomic stock movement rollback on audit failure | Verified in [inventoryController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/inventoryController.js), [postgresIntegrationEvidence.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresIntegrationEvidence.test.js) (simulator), and [postgresRealRehearsal.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresRealRehearsal.test.js) (live Neon) | Implemented & locally rehearsed |
| **Claim 2: Payment Details Encryption** | AES-256-GCM authenticated encryption at rest; Admin/Finance read; non-Finance refusal | Verified in [paymentDetails.js](file:///D:/Projects/orac-ios/orac-backend/src/paymentDetails.js), [postgresIntegrationEvidence.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresIntegrationEvidence.test.js) (simulator), and [postgresRealRehearsal.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresRealRehearsal.test.js) (live Neon) | Implemented & locally rehearsed |
| **Claim 3: Client Viewer Projection** | Strip sensitive wage, margin, worker ID, and GL data; isolate by client | Verified in [clientAllowlist.js](file:///D:/Projects/orac-ios/orac-backend/src/clientAllowlist.js), [postgresIntegrationEvidence.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresIntegrationEvidence.test.js) (simulator), and [postgresRealRehearsal.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresRealRehearsal.test.js) (live Neon) | Implemented & locally rehearsed |
| **Claim 4: Pastel Parallel Review** | Non-posting parallel review mode; `# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]` on actual bytes | Verified in [coreController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/coreController.js) and [pastelReviewExports.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/pastelReviewExports.test.js) | Implemented & locally tested; posting blocked pending accountant sample |
| **Claim 5: Email Transport** | No real outbound email sending; safe dry-run preview and manual external logging | Verified in [noOutboundEmailGuard.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/noOutboundEmailGuard.test.js) and [communicationAudit.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/communicationAudit.test.js) | Implemented & locally tested; live email delivery dark |
| **Claim 6: PDF Security** | 40-bit RC4 encryption rejected; document security enforced by authenticated RBAC & TLS | Verified in [pdfEncryption.js](file:///D:/Projects/orac-ios/orac-backend/src/pdfEncryption.js) and [pdfPasswordProtection.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/pdfPasswordProtection.test.js) | Implemented & locally tested |
| **Claim 7: Jobs Tracker Dates & Completion** | Planned/actual dates distinct; completion shows `Not captured` without authoritative source | Verified in [jobTrackerController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/jobTrackerController.js) and [jobTracker.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/jobTracker.test.js) | Implemented & locally tested |

---

## 6. A9 Redacted Configuration Register (Environment Parity)

> [!NOTE]
> All configuration variables are documented by name only. Zero plaintext secrets, credentials, or keys are recorded.

### Backend Required Secrets & Variables
- `DATABASE_URL` — Production PostgreSQL connection URI (`sslmode=require`).
- `PGPASSWORD` — PostgreSQL password.
- `STORE_DRIVER` — Must be `postgres` in production; `json` for local isolated test runs.
- `JWT_SECRET` — High-entropy session signing secret (minimum 32 characters).
- `JWT_EXPIRES_IN` — Session token lifetime (default `24h`).
- `ORAC_PAYMENT_ENCRYPTION_KEY` — 32-byte AES-256-GCM key encoded as 44-character base64 string.
- `ORAC_QR_SECRET` — HMAC key for QR token verification.
- `COMMUNICATIONS_DRY_RUN` — Boolean flag (`true` in production until email provider is approved).
- `ORAC_REQUIRE_PASSWORD` — Boolean flag enforcing strong password requirements.
- `NODE_ENV` — `production` for live deployments; `test` for automated runner.
- `PORT` — HTTP listener port.

### Frontend (Vite) Environment Variables
- `VITE_API_BASE_URL` — Backend API base endpoint.
- `VITE_ORAC_BUSINESS_TZ` — Business timezone (`Africa/Harare`).
- `VITE_ORAC_V5_COMMERCIAL_WORKFLOW` — Commercial V5 dark flag (`false`).
- `VITE_ORAC_V5_INVOICE_WRITER` — V5 invoice writer dark flag (`false`).
- `VITE_ORAC_TOTP_ENROLLMENT_UI` — TOTP UI dark flag (`false`).
- `VITE_ORAC_PROCUREMENT_SUBSYSTEM` — Procurement subsystem UI toggle.
- `VITE_ORAC_FLEET_HSE_SUBSYSTEM` — Fleet/HSE subsystem UI toggle.
- `VITE_ORAC_RECORD_TRAIL_V1` — Advisory AI assistant UI toggle.

### Deployed vs. Local State
| Environment | Host / Engine | Active Commit | Database Driver | Live Email | Pastel Mode |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Local Remediation** | Node.js (Windows) | `bdb8a7c` | In-memory / Isolated Simulator | Disabled (`COMMUNICATIONS_DRY_RUN=true`) | Non-posting parallel review (`REVIEW ONLY / NOT POSTED`) |
| **Rehearsal Database** | Neon (Dedicated) | `bdb8a7c` | PostgreSQL 17 (`orac_test_rehearsal`) | Disabled (`COMMUNICATIONS_DRY_RUN=true`) | Non-posting parallel review |
| **Staging (Dormant)** | Fly.io / Render | `22fdd87` / `597e571` | PostgreSQL (Neon) | Disabled (`COMMUNICATIONS_DRY_RUN=true`) | Non-posting parallel review |
| **Production** | Unreleased | **NOT DEPLOYED** | Gated pending rehearsal | Gated pending provider | Gated pending accountant sample |

---

## 7. Migration State & Safe Production Rollback Reference

- **DDL Migration State:** Zero schema migrations introduced. The `store` aggregate structure remains backward and forward compatible.
- **Production Rollback Policy (NO `git reset --hard`):**
  > [!IMPORTANT]
  > `git reset --hard` is strictly forbidden in production operations. It rewrites git history, drops untracked artifacts, and risks diverged branches requiring force-pushes.
  
  **Safe Production Rollback Procedures:**
  1. **Deployment Host Rollback (Primary):**
     - **Fly.io:** Execute `fly deploy --image <previous-immutable-digest>` or roll back to previous release ID via `fly releases`.
     - **Render / Vercel:** Revert to previous successful immutable deployment via dashboard or deploy CLI without rebuilding from dirty git state.
  2. **Safe Git Rollback (Source Control):**
     - Execute a non-destructive forward revert commit:
       ```bash
       git revert <commit-sha> -m 1 --no-edit
       git push origin master
       ```
     - Preserves complete linear history, auditability, and requires zero `--force` operations.
  3. **Database State Rollback:**
     - Point-in-time recovery (PITR) restore using PostgreSQL base backup and WAL logs, or restoring from verified pre-cutover logical dump (`pg_dump`).

---

## 8. Safe Non-Force Push & Deploy Plan

When release authority authorizes push and deployment, the procedure is:
1. **Local Pre-Flight Check:**
   - Execute full test suite (`npm test`) on backend and frontend. Ensure 0 failures.
   - Run `tests/postgresRealRehearsal.test.js` against dedicated test Neon database. Ensure 7/7 pass.
2. **Non-Force Fast-Forward Push:**
   ```bash
   git push origin master
   ```
   (Strictly no `--force` or `--force-with-lease`).
3. **Staging Smoke Rehearsal:**
   - Deploy build artifact to staging environment.
   - Execute UAT health check routes (`/api/health`, authenticated landing paths).
4. **Production Gate Checklist:**
   - Verify all 4 external blockers (Accountant Pastel sample, ZIMRA VAT rate, email sender domain, HSE role gate) have written owner approval before production cutover.