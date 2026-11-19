# ORAC Evidence-Backed Production-Readiness Report and Remediation Plan

**Date:** 19 November 2026  
**Repository:** `D:\Projects\orac-ios`  
**Current Commit:** `597e571` (pushed to `origin/master`)  
**Previous Base:** `17457de`  
**Governing Audit References:**
- `C:\Users\BRIAN LUPAO\Documents\Codex\ORAC_MONOREPO_SOURCE_EVIDENCE_AUDIT_20261119.md`
- `C:\Users\BRIAN LUPAO\Documents\Codex\ORAC_PRODUCTION_REMEDIATION_SCOPE_ADDENDUM_20261119.md`
- `docs/ORAC_REDACTED_CONFIGURATION_REGISTER_20261119.md`

---

## Executive Summary & Readiness Decision

> [!CAUTION]
> **Production Status: NOT DEPLOYED / NOT TAGGED / NOT PRODUCTION-READY.**
> Per mandatory governance rules, ORAC is **not** declared ready for live operational deployment. While core workflows, safety tripwires, and role boundaries are implemented and pass 100% of automated tests locally, the system is strictly gated pending:
> 1. An accountant-verified Sage Pastel import sample and accepted CSV schema;
> 2. An authorised production VAT registration, rate, and tax decision;
> 3. Production email provider credentials, authenticated domain, and approved test-recipient whitelist;
> 4. Real staging PostgreSQL smoke rehearsals (including backup/restore and payment decryption verification);
> 5. Owner decision on independent HSE role vs. Operations/HR safety capability.

---

## Raw Test Totals & Build Status (Commit `597e571`)

| Layer | Total Tests | Passed | Failed | Skipped | Todo | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Backend Suite (`npm test`)** | **2,287** | **2,266** | **0** | **21** | **0** | **CLEAN (0 failures, 0 todos)** |
| **Frontend Suite (`npm test`)** | **740** | **740** | **0** | **0** | **0** | **CLEAN (0 failures)** |
| **Frontend Production Build** | 187 modules | — | — | — | — | **CLEAN (`dist/` built in 1m 2s)** |

---

## 5-Tier Readiness Classification

### Tier 1: Implemented and Locally Tested
The following capabilities have verified source code, active automated test assertions, and pass locally with 0 failures:

1. **Inventory Audit Safety & Rollback:**
   - **Source:** [inventoryLedger.js](file:///D:/Projects/orac-ios/orac-backend/src/inventoryLedger.js), [inventoryController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/inventoryController.js).
   - **Mechanism:** `applyStockChange` provides an atomic `rollback()` callback restoring `stockItem.quantity_on_hand` and pruning the uncommitted `stock_movements` record. In `recordStockMovement` and `issueDirectSaleStock`, `store.audit` is wrapped in `try/catch`; any audit hook failure invokes `result.rollback()` before propagating the error.
   - **Test Proof:** `tests/inventoryAuthorizationRefusalMatrix.test.js` (19/19 pass, line 274 converted from `todo` to asserted test). `tests/inventoryPurchaseToUse.test.js` (36/36 pass).

2. **Insecure 40-bit RC4 PDF Encryption Removal:**
   - **Source:** [pdfEncryption.js](file:///D:/Projects/orac-ios/orac-backend/src/pdfEncryption.js), [pdfGenerator.js](file:///D:/Projects/orac-ios/orac-backend/src/pdfGenerator.js).
   - **Mechanism:** The deprecated, cryptographically broken 40-bit RC4 Standard Security Handler has been completely removed. `protectPdf` explicitly throws if password options are passed. Confidentiality is enforced through authenticated RBAC, TLS in transit, and audited streaming.
   - **Test Proof:** `tests/pdfPasswordProtection.test.js` (7/7 pass, asserting policy rejection of 40-bit RC4).

3. **Sage Pastel Non-Posting Boundary & CSV Byte-Level Review Marker:**
   - **Source:** [coreController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/coreController.js), [exporter.js](file:///D:/Projects/orac-ios/orac-backend/src/exporter.js).
   - **Mechanism:** In `exportPastel`, the delivered CSV bytes explicitly prepend `# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]\n`. The audit record logs `accounting_posted: false`, `designation: "REVIEW_NON_POSTING"`, and the exact SHA-256 byte hash.
   - **Test Proof:** `tests/pastelReviewExports.test.js` (7/7 pass), `tests/financePilotControls.test.js` (11/11 pass).

4. **Client Viewer Allowlist & Data Projection:**
   - **Source:** [clientAllowlist.js](file:///D:/Projects/orac-ios/orac-backend/src/clientAllowlist.js), [documentController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/documentController.js).
   - **Mechanism:** Top-level and recursive stripping of sensitive fields (worker national IDs, contacts, qualifications, contractor bank/EcoCash details, internal rates/costs/margins, GL accounts, void reasons, internal notes).
   - **Test Proof:** `tests/clientAllowlist.test.js` (10/10 pass), `tests/gap14FinancePolicyAndGap12Allowlist.test.js` (4/4 pass).

5. **Sensitive Payment Data Encryption & Access Control:**
   - **Source:** [paymentDetails.js](file:///D:/Projects/orac-ios/orac-backend/src/paymentDetails.js), [techniciansController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/techniciansController.js).
   - **Mechanism:** Contractor bank/EcoCash details encrypted at rest with AES-256-GCM. Read/write strictly restricted to `Admin` and `Finance`. Audit log captures actor and timestamp but redacts plaintext, ciphertext, and keys.
   - **Test Proof:** `tests/technicianPaymentDetails.test.js` (5/5 pass).

6. **Commercial-to-Invoice Industrial Workflow:**
   - **Source:** [stateMachine.js](file:///D:/Projects/orac-ios/orac-backend/src/stateMachine.js), [invoiceReadiness.js](file:///D:/Projects/orac-ios/orac-backend/src/invoiceReadiness.js), [settlementService.js](file:///D:/Projects/orac-ios/orac-backend/src/settlementService.js).
   - **Mechanism:** Full Quote → Verified Client PO → Dispatch Card → 3-Point Timesheet Sign-Off → USD Invoice (quoted client rates only; overtime at normal quoted client rate) → Maker-Checker Settlement.
   - **Test Proof:** `tests/endToEndIndustrialWorkflowAudit.test.js` (11/11 pass), `tests/commercialBillingPhase5.test.js` (31/31 pass).

7. **Jobs Tracker Truthful Dates & Actuals:**
   - **Source:** [jobTrackerController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/jobTrackerController.js), [jobTrackerStatuses.js](file:///D:/Projects/orac-ios/orac-backend/src/jobTrackerStatuses.js).
   - **Mechanism:** `client_pr`, `planned_start`, `actual_start`, `actual_end`, `actual_hours`, and `billable_hours` are kept distinct. Missing values display `"Not captured"` rather than inferring dates or assuming operational completion from billing status.
   - **Test Proof:** `tests/jobTracker.test.js` (8/8 pass).

8. **Durable Communication Evidence & External Send Logging:**
   - **Source:** [communicationAuditService.js](file:///D:/Projects/orac-ios/orac-backend/src/services/communicationAuditService.js), [communicationsController.js](file:///D:/Projects/orac-ios/orac-backend/src/controllers/communicationsController.js).
   - **Mechanism:** `POST /communications/record-external-send` and preview endpoints create durable audit records (`communication_evidence`) tracking template version, recipient, transport mode (`none` in dry-run), and scrubbed tokens/passwords.
   - **Test Proof:** `tests/communicationAudit.test.js` (24/24 pass).

9. **Startup Runtime Configuration Validation:**
   - **Source:** [config.js](file:///D:/Projects/orac-ios/orac-backend/src/config.js).
   - **Mechanism:** `validateRuntimeConfig()` validates environment variables at boot, enforcing PostgreSQL, secure JWT secrets, encryption keys, and disabling rate-limit overrides in production.
   - **Documentation:** [ORAC_REDACTED_CONFIGURATION_REGISTER_20261119.md](file:///D:/Projects/orac-ios/docs/ORAC_REDACTED_CONFIGURATION_REGISTER_20261119.md).

---

### Tier 2: Merged and Pushed
- **Git Commit:** `597e571`
- **Branch:** `master` (synchronized with `origin/master` at `https://github.com/brianlupao123/OracIOS.git`)
- **Changed Files (89 insertions, 374 deletions):**
  1. `orac-backend/src/controllers/coreController.js` (prepends `# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]` to invoice CSV exports)
  2. `orac-backend/src/controllers/inventoryController.js` (rollback on audit hook exception in `recordStockMovement` and `issueDirectSaleStock`)
  3. `orac-backend/src/inventoryLedger.js` (returns `rollback` closure in `applyStockChange`)
  4. `orac-backend/src/pdfEncryption.js` (removes 40-bit RC4; throws explicit rejection on password options)
  5. `orac-backend/tests/inventoryAuthorizationRefusalMatrix.test.js` (converts todo finding into passing verified test)
  6. `orac-backend/tests/pastelReviewExports.test.js` (asserts CSV byte-level review banner)
  7. `orac-backend/tests/pdfPasswordProtection.test.js` (tests 40-bit RC4 policy rejection)

---

### Tier 3: Actually Deployed and Live-Smoked
- **Current Deployed Status:** **DORMANT / PENDING RE-DEPLOYMENT.**
- The live deployments on Fly.io (backend), Render (worker/database), and Vercel (frontend) reflect earlier commits.
- **Evidence Gap:** No live HTTP smoke test or PostgreSQL production rehearsal has yet been performed on commit `597e571`.
- **Requirement Before Live Use:**
  1. Automated deployment of commit `597e571` to staging;
  2. Live TLS health probe on `/api/health`;
  3. Live PostgreSQL persistence verification of throwaway encrypted technician payment details across process restart;
  4. Client Viewer allowlist HTTP refusal assertion from external IP.

---

### Tier 4: Blocked by External Decisions

> [!IMPORTANT]
> The following items cannot be closed by code alone; they require external business, legal, or accounting decisions:

| Item | Dependency | Impact | Mitigation / Current Safe State |
| :--- | :--- | :--- | :--- |
| **Pastel Import Schema** | External accountant import sample and field-level CSV specification | Cannot post directly to Sage Pastel | Non-posting parallel review mode only (`REVIEW ONLY / NOT POSTED` stamped on actual bytes) |
| **Production VAT Registration** | Zimbabwe tax authority (ZIMRA) VAT registration number, rate confirmation, and approver identity | Commercial invoices cannot charge tax legally | USD customer billing with no unverified tax rate hardcoded; tax rate defaults to 0% unless authorized by Finance/Admin |
| **Outbound Email Transport** | Approved SMTP/Resend/Postmark provider credentials, authenticated DNS/DKIM/SPF sender domain, and approved test recipient whitelist | Real outbound email cannot be dispatched | `COMMUNICATIONS_DRY_RUN=true`; safe dry-run preview and manual external-send logging |
| **HSE Role Governance** | Owner decision: standalone HSE login role vs. safety/quality under Operations/HR | HSE permission lifecycle cannot be fully finalized | Standalone HSE login role parked; safety capabilities managed under Operations/HR |

---

### Tier 5: Unsafe or Unproven Claims (Explicitly Refuted)

The following claims are **UNPROVEN** or **UNSAFE** and are explicitly refuted:
1. *"Gaps 1–19 are 100% complete and ready for production use."* — **REFUTED.** Core features are implemented and tested, but external accounting samples, tax approvals, and live deployment smokes are unresolved.
2. *"Sage Pastel integration posts directly to the accounting ledger."* — **REFUTED.** No posting occurs. Pastel integration is strictly a parallel, non-posting reconciliation export.
3. *"Live email delivery is verified."* — **REFUTED.** Delivery is in dry-run mode (`COMMUNICATIONS_DRY_RUN=true`). No real messages have been delivered or received in production.
4. *"Client PDFs are protected by military-grade password encryption."* — **REFUTED.** 40-bit RC4 has been rejected and removed. Security is provided via authenticated RBAC and TLS.
5. *"TOTP Two-Factor Authentication is production-ready."* — **REFUTED.** TOTP remains dark pending PostgreSQL concurrency testing and emergency break-glass procedures.
6. *"V5 Commercial Engine is ready for automated billing."* — **REFUTED.** V5 flags remain dark (`VITE_ORAC_V5_COMMERCIAL_WORKFLOW=false`).

---

## Role Completeness Matrix (13 Roles Audited)

| Role | Provisioning / Onboarding | Login & Session | Navigation Menu | API Refusal Tests | UI Evidence | Readiness Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | Admin invitation & setup link | JWT session | Full admin navigation | Pinned admin permissions | User/entity/settings management | **VERIFIED** |
| **Management** | Admin invitation & setup link | JWT session | Management dashboard & reports | Forbidden on write/inventory/payroll | Executive KPI dashboard | **VERIFIED** |
| **Sales** | Admin invitation & setup link | JWT session | Quotes, Leads, Client Directory | Denied on inventory/settlement/payroll | QuotationsPage, LeadsPage | **VERIFIED** |
| **Operations** | Admin invitation & setup link | JWT session | Dispatches, Worksheets, Assets, Inventory | Denied on finance/quotes/payroll | DispatchesPage, InventoryPage | **VERIFIED** |
| **Technician** | Admin invitation & setup link | JWT session | Personal timesheet entry | Denied on all commercial/financial data | Timesheet entry & roster UI | **VERIFIED** |
| **Supervisor** | Admin invitation & setup link | JWT session | Team timesheets & sign-off | Denied on rate/billing data | Timesheet review & sign-off modal | **VERIFIED** |
| **Finance** | Admin invitation & setup link | JWT session | Invoicing, PO verification, Pastel review | Denied on inventory movement writes | InvoicingPage, PastelReviewPanel | **VERIFIED** |
| **Client Viewer** | Admin creates with mandatory `client_id` | Scoped JWT | Scoped quotes, dispatches, invoices | Refused on internal rates, notes, other clients | Shaped client portal views | **VERIFIED** |
| **Procurement & Stores** | Admin user creation | JWT session | Gated by `VITE_ORAC_PROCUREMENT_SUBSYSTEM` | Permissions in `modules/procurement` | Inventory & supplier views | **PARTIAL** (Subsystem views exist; UI docked under Operations nav) |
| **Fleet & Facilities** | Admin user creation | JWT session | Gated by `VITE_ORAC_FLEET_HSE_SUBSYSTEM` | Permissions in `modules/fleet` | Fleet asset views | **PARTIAL** (Docked under Operations nav) |
| **HSE & Quality** | Admin user creation | JWT session | Decision Gate: Standalone role parked | Permissions exist in backend | Parked | **PARTIAL / PARKED** (Awaiting owner decision gate) |
| **Human Resources** | Admin user creation | JWT session | Unified with Management/Finance | `manageEmployees`, `managePayroll` | Artisan vault & payroll review | **PARTIAL** (Standalone HR nav docked with Management) |
| **Public Prospect** | Public web lead form | None (unauthenticated) | Public website only | 401/403 on all internal API routes | Public lead capture form | **VERIFIED (Public Ingress)** |

---

## Required Secret Names Register (No Plaintext)

To deploy ORAC to production, the following secrets must be supplied via the hosting provider's secrets manager. **Zero secret values are stored in source code or documentation:**

1. `DATABASE_URL` — PostgreSQL connection string with TLS parameters (`sslmode=require`).
2. `PGPASSWORD` — PostgreSQL database user password.
3. `JWT_SECRET` — Cryptographically random secret (minimum 32 characters) for signing session tokens.
4. `ORAC_PAYMENT_ENCRYPTION_KEY` — 256-bit AES encryption key (64 hex characters) for technician banking details.
5. `ORAC_QR_SECRET` — HMAC key for technician equipment inspection QR tokens.
6. `EMAIL_PROVIDER_API_KEY` *(When email enabled)* — API key for production email service.
7. `DAILY_API_KEY` *(Optional)* — API key for WebRTC virtual surveys sidecar.
8. `GOOGLE_CLIENT_ID` *(Optional)* — OAuth client ID if Google Workspace SSO is enabled.

---

## Rollback Plan

If commit `597e571` encounters issues during staging rehearsals:
1. **Source Reversion:**
   ```bash
   git checkout master
   git revert 597e571 -m 1
   git push origin master
   ```
2. **Database Invariants:** Commit `597e571` introduces **zero schema migrations**. Rollback involves no DDL alterations.
3. **Storage Fallback:** If PostgreSQL fails, setting `STORE_DRIVER=json` restores file-based fallback operation for development without altering data structures.

---

## Exact Next Commits & Milestones

1. **Commit 1: Staging PostgreSQL Integration Test**
   - Execute and record PostgreSQL driver tests against live staging database.
   - Verify throwaway encrypted payment persistence and restart survivability.
2. **Commit 2: Email Configuration Stub & Provider Gateway Interface**
   - Add pluggable provider transport interface (`smtpProvider.js`, `resendProvider.js`) while maintaining default dry-run mode until keys are provided.
3. **Commit 3: Accountant Pastel Characterization Golden Test**
   - Stage accountant sample file and assert column mapping parity.
4. **Commit 4: HSE Decision Gate Resolution**
   - Apply owner decision on HSE role: either provision dedicated navigation/landing page or formally remove standalone role constant and document safety governance under Operations/HR.
