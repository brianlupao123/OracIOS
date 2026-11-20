# ORAC Controlled Operational Parallel Pilot Report (PILOT-20261120)

**Document Date:** 20 November 2026  
**Status:** Completed & Evidence-Backed  
**Target Database:** Real Isolated PostgreSQL (`orac_test_rehearsal` on AWS eu-central-1 via Neon)  
**Security Classification:** Redacted Configuration & Audit Evidence (Zero Secrets Stored)  

---

## 1. Executive Summary

Following the formal acceptance of the real isolated PostgreSQL rehearsal (7/7 checks passed), the **Controlled Operational Parallel Pilot (`PILOT-20261120`)** was executed against a live PostgreSQL instance.

This pilot executed the complete end-to-end commercial lifecycle through actual HTTP endpoints, exercising database serialization, transactional row locking, role-based authorization, two-person maker-checker invoice issuance, review-only accounting export, and durable communication evidence logging.

### Key Operational Milestones Achieved
1. **Zero-Dependency Native SMTP Transport & Queue Safety:** Implemented outbound SMTP transport using native Node.js core modules (`node:net`, `node:tls`, `node:crypto`) with strict recipient allowlist gating (`RECIPIENT_NOT_ALLOWED` HTTP 403 on unapproved recipients).
2. **Complete 12-Step Operational Workflow Passed (100%):** All 12 workflow stages passed against real PostgreSQL: Quote → Quotation Email → Client PR → Verified Client PO → Dispatch → Approved Timesheet → Invoice Readiness → Two-Person Invoice Issuance → Review-Only Pastel Export → Settlement Evidence → Reconnection Proof.
3. **Pastel Accounting Parallel Non-Posting Boundary Preserved:** The generated CSV strictly begins with `# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]` and exports line-level allocations without inventing fake ledger postings.
4. **Zero Regressions Across Entire Test Suite:** Full suite execution confirmed **2,280 tests passed, 0 failures** (21 skipped).

---

## 2. Outbound Email Transport & Configuration Register

### 2.1 Native Transport Architecture
- **Location:** `src/services/communicationTransportService.js` and `src/services/communicationQueueService.js`
- **Zero External Dependencies:** Built entirely with standard Node.js libraries (`node:net`, `node:tls`, `node:crypto`), complying with repository dependency freeze rules.
- **Protocol Support:** Supports standard port 587 with opportunistic/mandatory `STARTTLS` upgrade and port 465 with direct TLS.
- **Authentication:** Standard RFC 4954 `AUTH LOGIN` mechanism.

### 2.2 Controlled Recipient Allowlist
To prevent accidental transmission to real clients or external parties during pilot operations, the transport strictly enforces a recipient allowlist:
- `Lupaobrian98@gmail.com` (Admin)
- `brianwabwile79@gmail.com` (Sales)
- `lupaob1@gmail.com` (Client Viewer)

Any dispatch request targeting an email outside this set is immediately rejected with HTTP 403 `RECIPIENT_NOT_ALLOWED` and logged to audit trails as a rejected dispatch.

### 2.3 Redacted Configuration Register Updates
The following variables are documented in `docs/ORAC_REDACTED_CONFIGURATION_REGISTER_20261119.md` (by name and parameter rules only — strictly zero secrets):

| Variable Name | Type / Format | Default | Description |
|---|---|---|---|
| `COMMUNICATIONS_DRY_RUN` | Boolean string (`"true"` / `"false"`) | `"true"` | When true, renders email and records durable audit evidence without opening network sockets. |
| `CONTROLLED_RECIPIENT_ALLOWLIST` | Comma-separated emails | Preconfigured safe emails | Hard allowlist of approved recipient email addresses. |
| `SMTP_HOST` | Hostname | *Redacted* | Outbound SMTP relay hostname (e.g. `smtp.gmail.com`). |
| `SMTP_PORT` | Integer | `587` | Relay port (`587` for STARTTLS, `465` for direct TLS). |
| `SMTP_SECURE` | Boolean string | `"false"` | Direct TLS socket switch (true for 465, false for 587). |
| `SMTP_USER` | Email address | *Redacted* | Authenticating sender mailbox user. |
| `SMTP_PASS` | Secret string | *Redacted* | Mailbox provider App Password / token. |
| `SMTP_FROM` | Bare sender email address | Defaults to `SMTP_USER` | SMTP envelope sender and From header. Display names and angle brackets are not accepted. |
| `SMTP_CONNECTION_TIMEOUT_MS` | Integer ms | `10000` | Socket connection & handshake timeout (10s). |

---

## 3. Sender Mailbox Configuration Checklist for Brian

Before setting `COMMUNICATIONS_DRY_RUN=false` for live internal delivery testing, Brian should execute the following checklist in the hosting provider (Fly.io / Render) secret manager:

1. **Dedicated Sender Mailbox Setup:**
   - Create or identify a dedicated mailbox (e.g., Google Workspace account or transactional SMTP provider).
   - If using Google Workspace / Gmail:
     - Enable 2-Step Verification on the mailbox account.
     - Generate a dedicated **16-character App Password** (under *Security → 2-Step Verification → App Passwords*).
     - **NEVER** use Brian's primary Google account password.
2. **Environment Secret Injection (Fly.io / Render):**
   ```bash
   # Set secrets in Fly.io (or Render Environment Group)
   fly secrets set \
     SMTP_HOST="smtp.gmail.com" \
     SMTP_PORT="587" \
     SMTP_SECURE="false" \
     SMTP_USER="<SENDER_EMAIL_ADDRESS>" \
     SMTP_PASS="<16_CHAR_APP_PASSWORD>" \
 SMTP_FROM="<SENDER_EMAIL_ADDRESS>" \
     COMMUNICATIONS_DRY_RUN="false" \
     CONTROLLED_RECIPIENT_ALLOWLIST="Lupaobrian98@gmail.com,brianwabwile79@gmail.com,lupaob1@gmail.com"
   ```
3. **Safety Verification:**
   - Verify that `CONTROLLED_RECIPIENT_ALLOWLIST` contains ONLY the three authorized test recipients.
   - Run verification send via `POST /api/communications/queue/:id/dispatch`.
   - Inspect delivery in recipient inboxes and verify audit event `MESSAGE_DISPATCHED_LIVE`.

---

## 4. Controlled Pilot Dataset (`PILOT-20261120`) Execution & Evidence

### 4.1 Test Suite Specification
- **Test File:** `tests/pilotOperationalWorkflowPostgres.test.js`
- **Database Engine:** PostgreSQL 16 on Neon AWS eu-central-1 (`ep-snowy-credit-al6x7xrz...`)
- **Execution Command:**
  ```powershell
  $env:ORAC_TEST_DATABASE_URL="<REDACTED_TEST_DATABASE_URL>"; node --test tests/pilotOperationalWorkflowPostgres.test.js
  ```
- **Raw Result:**
  ```text
  ==> [PILOT-20261120] STEP 1: Quote Creation
  ==> [PILOT-20261120] STEP 2: Quotation Email & Transition
  ==> [PILOT-20261120] STEP 3: Client PR Logging
  ==> [PILOT-20261120] STEP 4: Client PO Capture
  ==> [PILOT-20261120] STEP 5: Dispatch Creation
  ==> [PILOT-20261120] STEP 6: Field Worksheets
  ==> [PILOT-20261120] STEP 7: Timesheets & Materials
  ==> [PILOT-20261120] STEP 8: Invoice Readiness
  ==> [PILOT-20261120] STEP 9: Legacy Invoice Draft & Issuance
  ==> [PILOT-20261120] STEP 10: Review-Only Pastel Export
  ==> [PILOT-20261120] STEP 11: Settlement & Portfolio Visibility
  ==> [PILOT-20261120] STEP 12: Reconnection Proof
  ▶ ORAC Operational Parallel Pilot (PILOT-20261120) - Real PostgreSQL Suite
    ✔ Run complete PILOT-20261120 operational lifecycle against real PostgreSQL (86161.0269ms)
  ✔ ORAC Operational Parallel Pilot (PILOT-20261120) - Real PostgreSQL Suite (86164.4138ms)
  ℹ tests 1
  ℹ suites 1
  ℹ pass 1
  ℹ fail 0
  ```

### 4.2 Lifecycle Entity & Audit Evidence Record

| Step | Operation | Entity ID | Key Parameters & State Transitions | Audit Event Recorded |
|---|---|---|---|---|
| **1** | Quote Creation | `quote_mwoqioxg_gktq42` | Q-0001, Client `cli_pilot_01`, 2 lines ($400 labour + $350 material = $750 total). Status: `Draft`. | `QUOTE_CREATED` |
| **2** | Quotation Email & Approval | `comm_mwoqiqlk_23i48f` | Queue message created for `lupaob1@gmail.com`. Dispatched (dry-run). Independent Admin approval: `Draft → Sent → Approved_Pending_PO`. | `MESSAGE_QUEUED`, `MESSAGE_DISPATCHED_DRY_RUN`, `QUOTE_TRANSITION_Draft_TO_Sent`, `QUOTE_TRANSITION_Sent_TO_Approved_Pending_PO` |
| **3** | Client PR Logging | `pr_mwoqiv70_kwhm38` | Reference `PR-MINE-2026-0091`, amount $750 USD, linked to quote. | `CLIENT_PR_CREATED` |
| **4** | Verified Client PO | `po_mwoqizbj_d8bmpw` | Reference `PILOT-PO-20261120`, amount $750 USD. Transitions quote to `PO_Verified`. | `PO_VERIFIED`, `QUOTE_TRANSITION_Approved_Pending_PO_TO_PO_Verified` |
| **5** | Field Dispatch & Roster | `job_mwoqj0lt_tkiix6` | JOB-0001, Supervisor `usr_pilot_sup`, Technician `usr_pilot_tech`. Quote transitions to `Field_Dispatch`. | `DISPATCH_CARD_CREATED`, `DISPATCH_SUPERVISOR_ASSIGNED`, `QUOTE_TRANSITION_PO_Verified_TO_Field_Dispatch` |
| **6** | Field Worksheets | `ws_mwoqj4l4_f566p8` | 8 hours conveyor overhaul. `Draft → Submitted → Client_Acknowledged → Supervisor_Approved`. | `WORKSHEET_CREATED`, `WORKSHEET_SUBMITTED`, `WORKSHEET_CLIENT_ACKNOWLEDGED`, `WORKSHEET_APPROVED` |
| **7** | Billable Time & Materials | `ts_mwoqj9dc_cqalsq`, `mat_mwoqjacf_k382nd` | 8 hrs @ $50/hr ($400) linked to approved worksheet; 1 belt @ $350 ($350). | `TIMESHEET_ADDED`, `MATERIAL_USAGE_ADDED` |
| **8** | Invoice Readiness Gate | N/A | Calculated: $400 labour, $350 material, $750 total. `ready_for_invoice_review: true`, `blocker: null`. | Read-only check |
| **9** | Maker-Checker Invoice Issuance | `lidraft_mwoqjd1l_3nks8`, `inv_mwoqje1x_719xsa` | Finance 1 prepares draft ($750); Finance 1 self-issue refused (403); Finance 2 issues INV-0001. Quote transitions to `Invoiced`. | `LEGACY_INVOICE_DRAFT_PREPARED`, `LEGACY_INVOICE_DRAFT_ISSUED`, `INVOICE_GENERATED`, `QUOTE_TRANSITION_Field_Dispatch_TO_Invoiced` |
| **10** | Review-Only Pastel Export | CSV stream | Header: `# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]`. Allocated lines: 400 labour + 350 material. | `PASTEL_EXPORT_GENERATED` |
| **11** | Settlement & Sales Scoping | `pay_mwoqjh45_71m39x` | Full payment $750 received via Bank Transfer `STANBIC-REF-99201`. Invoice status: `paid`. Sales user reads settlement summary with payments array strictly redacted. | `INVOICE_PAYMENT_RECORDED`, `INVOICE_SETTLEMENT_UPDATED` |
| **12** | Reconnection & Persistence Proof | DB Row `main` | Pool terminated and re-established. Verified quote (`Invoiced`), PO (`verified`), dispatch (`active`), invoice (`paid`), payment ($750), and 10+ critical audit actions in PostgreSQL JSONB store. | Verified on cold re-read |

---

## 5. Defect Register & Resolution

| Defect ID | Severity | Component | Root Cause | Remediation Applied | Status |
|---|---|---|---|---|---|
| **D-PILOT-01** | High | `src/persistenceMiddleware.js` | HTTP GET requests were unconditionally treated as read-only (skipping PostgreSQL write) unless matching Daily Timesheet paths. `exportPastel` logs `PASTEL_EXPORT_GENERATED` on a GET request, so its audit row was never saved to PostgreSQL. | Added `/^\/exports\/pastel(?:\.csv|-review\/.*)?$/` to `AUDITED_READS` in `persistenceMiddleware.js`. | **Resolved & Verified** |
| **D-PILOT-02** | Medium | `src/invoiceReadiness.js` | `linkedTimesheetEvidenceBlock` verifies that the timesheet creator (`entry.user_id`) matches the approved worksheet's technician (`worksheet.technician_id`). Initial test called with `adminActor` instead of `techActor`. | Updated test suite Step 7 to submit timesheet as `techActor` linked to their approved worksheet. | **Resolved & Verified** |
| **D-PILOT-03** | Medium | `src/controllers/invoiceSettlementController.js` | `recordInvoicePayment` enforces strict idempotency via RFC 4122 v4 UUID header `Idempotency-Key` and returns HTTP 201 with `{ success: true, data: payment, settlement }`. Initial test sent string in body and checked 200. | Updated test to pass valid UUID v4 `Idempotency-Key` header and assert HTTP 201 with `settlement.outstanding_amount === 0`. | **Resolved & Verified** |
| **D-PILOT-04** | Low | `src/controllers/dispatchController.js` | `assignDispatchSupervisor` expects `{ supervisor_id: "<id>" }`; initial test sent `supervisor_user_id`. | Schema contract alignment in pilot test suite. | **Resolved & Verified** |

---

## 6. Commit & Version Control Evidence

Per prompt instructions, code changes and test/documentation assets are separated into distinct commits:

### Commit 1: Implementation
- **Changed Files:**
  - `src/controllers/communicationsController.js`
  - `src/modules/communications/routes.js`
  - `src/persistenceMiddleware.js`
  - `src/services/communicationQueueService.js`
  - `src/services/communicationTransportService.js`
- **Summary:** Native dependency-free SMTP client, safe recipient allowlist filtering, queue dispatch handlers, and audited read support for Pastel exports.

### Commit 2: Tests, Config Register & Pilot Documentation
- **Changed Files:**
  - `tests/communicationQueue.test.js`
  - `tests/communicationTransport.test.js`
  - `tests/pilotOperationalWorkflowPostgres.test.js`
  - `docs/ORAC_REDACTED_CONFIGURATION_REGISTER_20261119.md`
  - `docs/ORAC_OPERATIONAL_PARALLEL_PILOT_REPORT_20261120.md`
- **Summary:** Unit tests for transport and queue (25/25 pass), complete 12-step PostgreSQL pilot test suite (1/1 pass), configuration register update, and pilot report.

---

## 7. Remaining External Facts & Safe Deployment Plan

### 7.1 Remaining External Facts (Unblocked for Production Operation)
1. **Physical Provider Credentials:** Real email delivery is gated by `COMMUNICATIONS_DRY_RUN=true`. Once Brian configures `SMTP_USER` and `SMTP_PASS` in Fly/Render secrets, live transmission can be safely enabled.
2. **Pastel Partner / Evolution File Ingestion:** Pastel remains strictly in **parallel review mode**. The output file `orac-review-invoices-YYYY-MM-DD.csv` carries `# [PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]` and must be reviewed by accounting personnel; no automatic posting script is connected.

### 7.2 Safe Deployment Plan
1. **Pre-Deployment:**
   - Confirm Fly.io / Supabase PostgreSQL instance has running `001_initial_schema.sql` migration.
   - Inject environment variables using Fly Secrets (zero secrets in repo).
2. **Deployment Execution:**
   - Deploy backend to Fly.io (`fly deploy`).
   - Run health probe: `GET /health` → `{ "status": "ok", "store": "postgres" }`.
3. **Post-Deployment Verification:**
   - Run automated read probe on `/api/summary`.
   - Perform test quotation issuance with `COMMUNICATIONS_DRY_RUN=false` targeted to `Lupaobrian98@gmail.com`.
   - Confirm receipt in inbox and inspect PostgreSQL `audit_logs` for `MESSAGE_DISPATCHED_LIVE`.
