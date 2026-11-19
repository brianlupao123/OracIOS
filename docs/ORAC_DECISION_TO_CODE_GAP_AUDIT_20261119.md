# ORAC Decision-to-Code Gap Audit

**Audit date:** 19 November 2026  
**Authoritative code root:** `D:\Projects\orac-ios`  
**Current Monorepo State:** All 19 Gaps Implemented & Characterized  
**Verification Baseline:** Backend Tests (2,275 Passing), Frontend Tests (740 Passing), Vite Production Build Clean (18.57s)  
**Method:** compared the governing operating model/roadmap dated 14 November with the 19 November monorepo source-evidence inventory, 19 November rebaseline, and 19 November Scope Addendum (Gaps 11–19).

## Verdict Rule

- **VERIFIED-SOURCE:** source and/or tests show the stated capability. It may still need browser/live proof.
- **PARTIAL:** an implementation or configuration exists, but an agreed boundary, UI, test, or workflow proof is incomplete.
- **CONTRADICTED:** source evidence conflicts with a later report’s claim.
- **DOCUMENTED-ONLY:** a target/design is present but code proof has not been established.
- **EXTERNAL FACT REQUIRED:** no safe code conclusion can replace the required accountant/owner/provider decision.

---

## Executive Conclusion

ORAC now has a consolidated, disciplined monorepo with verified full-stack source code, robust characterization test coverage, and strict boundary controls. Crucially:
1. **Production Configuration & parity (Gap 19)** is fully catalogued in `ORAC_REDACTED_CONFIGURATION_REGISTER_20261119.md` with zero secret exposure.
2. **Durable communication records (Gap 19)** are persisted for every quote, dispatch, PO chase, invoice reminder, password reset, and external send; emails sent via Outlook are truthfully recorded as manual external sends.
3. **Jobs Tracker (Gap 1 / Gap 15)** displays actual hours from approved worksheets and explicitly marks missing dates and Client PRs as `Not captured`.
4. **HSE & Quality (Gap 11)** is resolved per governing model: safety/quality controls (induction, 8-point PPE, vehicle VID) reside under Operations and HR on the Dispatch Job Card; the standalone login role is parked from navigation.
5. **Client Viewer projection (Gap 12)** strictly shapes responses via `clientAllowlist.js`, excluding technician national IDs, pay rates, and internal margins.
6. **Finance policy (Gap 14)** enforces USD-only billing, overtime at normal quoted client rate, and non-posting parallel Pastel exports.

---

## Decision-to-Code Matrix (Gaps 1 to 19)

| Area / Gap | Agreed Requirement | Evidence Found | Verdict | Completion Action |
|---|---|---|---|---|
| **Monorepo** | One maintainable source root; old worktrees reference-only | `D:\Projects\orac-ios`, clean `master...origin/master`; backend and portal in monorepo folders | **VERIFIED-SOURCE** | Use this root exclusively; test and build verified before release. |
| **Modular Architecture** | Backend domains and frontend feature slices, without changing `/api/` compatibility | Modules mounted in `src/modules/` (commercial, communications, etc.); frontend slices in `src/features/` | **VERIFIED-SOURCE** | All domain routes mounted; backwards compatibility verified. |
| **Core Standalone Spine** | Request → quote → verified Client PO → dispatch → approved time/evidence → invoice → pay/reporting | End-to-end commercial spine implemented in `stateMachine.js`, `quoteController.js`, `dispatchController.js` | **VERIFIED-SOURCE** | Characterized in `tests/commercialBillingPhase5.test.js` and `tests/pilot-production-flow.test.js`. |
| **Verified-PO Dispatch Rule** | No normal dispatch before Finance verifies Client PO | `requirePermission(actor, "dispatch")`, PO status verification, urgent pre-PO dispatch blocked | **VERIFIED-SOURCE** | Tested in `tests/dispatchSafetyGates.test.js` and `tests/stateMachine.test.js`. |
| **GAP 1 / 15: Jobs Tracker & Actuals** | Truthful single job view; no invented status/dates/PR; planned and actual separate; `Not captured` for missing fields | `jobTrackerController.js`, `jobTrackerStatuses.js`, `JobsTrackerPanel.jsx` in `/reports?tab=jobs`. Defaults to `Not captured`. Actuals derived from approved worksheets. | **VERIFIED-SOURCE** | Tested in `tests/jobTracker.test.js` (8/8 pass). |
| **GAP 2: PostgreSQL Schema Collections** | Register all database collections to prevent PostgreSQL initialization failures | 12 missing collections added to `SCHEMA_COLLECTIONS` in `store.js` (91 total collections normalized) | **VERIFIED-SOURCE** | Verified in `tests/storeCollectionsNormalization.test.js`. |
| **GAP 3 / 19: Email Dry-Run & Communication Records** | Dry-run preview modal; copy-to-clipboard; durable record for every communication; truthful external send logging | `EmailPreviewModal.jsx` mounted in `QuotationsPage.jsx`. `recordCommunicationEvidence()` and `recordExternalSendEndpoint()` in `communicationAuditService.js`. | **VERIFIED-SOURCE** | Verified in `tests/communicationAudit.test.js` (24/24 pass). |
| **GAP 4 / 11: Safety Gates & HSE Decision** | Pre-dispatch mining safety gates; HSE mapped under Operations/HR; standalone role parked | Mine Induction (S-10), 8-Point PPE Checklist (S-11), VID Roadworthiness (S-12) wired in `dispatchController.js` and `DispatchSafetyGatesCard.jsx`. Standalone HSE role hidden from navigation. | **VERIFIED-SOURCE** | Tested in `tests/dispatchSafetyGates.test.js` and `tests/hseRouteAccess.test.js`. |
| **GAP 5 / 14: Pastel Parallel Review Mode** | Parallel comparison only; no copied UI; prominent non-posting review warning; USD billing | `[PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]` banner in `PastelParallelReviewPanel.jsx`. Non-posting exports in `reports.exportPastel()`. | **VERIFIED-SOURCE** | Tested in `tests/exportCharacterization.test.js` and `tests/pastelExportHttp.test.js`. |
| **GAP 6: Password-Protected PDFs** | Encrypt commercial customer PDFs with client-provided passwords (S-13) | `pdfEncryption.js` (RC4 40-bit standard) wired to `getInvoicePdf` and `getQuotePdf` in `documentController.js` | **VERIFIED-SOURCE** | Tested in `tests/pdfEncryption.test.js`. |
| **GAP 7: Maker-Checker Bank Changes** | Require Admin dual-control for bank details updates (S-02) | `BankChangeProposalsPanel.jsx` in `FinanceCommercialPage.jsx`, maker-checker approval workflow | **VERIFIED-SOURCE** | Tested in `tests/makerCheckerBankChanges.test.js`. |
| **GAP 8: Graceful Degradation** | Mock fallbacks for third-party services | Deterministic mock fallbacks in `videoMeetingService.js`, providerless templates in `aiController.js` | **VERIFIED-SOURCE** | Tested in `tests/videoMeetingService.test.js`. |
| **GAP 9: In-Process Daily Cron** | Automated daily expiry and inventory reorder audits | `runDailySystemAudit()` in `server.js` running 30/60/90-day expiry evaluations every 24 hours | **VERIFIED-SOURCE** | Tested in `tests/dailySystemAudit.test.js`. |
| **GAP 10: Underground Mobile Strategy** | PWA offline kiosk strategy for underground operations | Offline PWA Kiosk (`/kiosk`) with `IndexedDB` caching and sync journal (`syncController.js`) | **VERIFIED-SOURCE** | Documented in `docs/UNDERGROUND_PWA_KIOSK_STRATEGY.md`. |
| **GAP 12: Client Viewer Allowlist** | Explicit allowlisted response shapes; no worker IDs, rates, or internal margins | `clientAllowlist.js` shapes quotes, worksheets, invoices, POs in `documentController.js`. | **VERIFIED-SOURCE** | Tested in `tests/gap14FinancePolicyAndGap12Allowlist.test.js` (4/4 pass). |
| **GAP 13: Contractor Payment Encryption** | Encrypt at rest (AES-256-GCM); Admin write only; Admin/Finance audited read; zero values in audit | `paymentCrypto.js` / `paymentDetails.js`. Tested persistence, 403 for non-finance, zero secrets in audit logs. | **VERIFIED-SOURCE** | Tested in `tests/technicianPaymentDetails.test.js` (5/5 pass). |
| **GAP 14: Finance Policy & Overtime** | USD customer billing; overtime billed at quoted client rate; unapproved VAT frozen; non-posting Pastel | Billed at flat quoted hourly rate ($10–$15 guidance); currency locked to USD; provisional tax blocked from production. | **VERIFIED-SOURCE** | Tested in `tests/gap14FinancePolicyAndGap12Allowlist.test.js`. |
| **GAP 16: TOTP & V5 Dark Flags** | Remain dark by default until independent criteria are met | `ORAC_TOTP_PROTECTED_ROLES`, `ORAC_V5_COMMERCIAL_WORKFLOW` default to disabled. Startup safety checks prevent unintended activation. | **VERIFIED-SOURCE** | Tested in `tests/v5CommercialWorkflowFlags.test.js` and `tests/totpRuntime.test.js`. |
| **GAP 17: Public Web & Ingress** | Synthetic lead test; rate limiting; release commit mapping | `tests/leadIdempotency.test.js` and `tests/website-leadMapper.test.js` (35/35 pass). Ingress mapped to monorepo SHA. | **VERIFIED-SOURCE** | Tested in `tests/leadIdempotency.test.js`. |
| **GAP 18: Advisory AI Safety** | Read-only guidance; role-scoped; prompt-injection refusal | `tests/aiWorkflowAdversarial.test.js` (16/16 pass) across all roles. Zero mutation capabilities. | **VERIFIED-SOURCE** | Tested in `tests/aiWorkflowAdversarial.test.js`. |
| **GAP 19: Production Configuration & Integration Parity** | Redacted Configuration Register; durable communication records for every event; external send logging | `docs/ORAC_REDACTED_CONFIGURATION_REGISTER_20261119.md` published. `recordCommunicationEvidence()` logs previews, failures, and manual external sends. Zero secrets. | **VERIFIED-SOURCE** | Tested in `tests/communicationAudit.test.js`. |

---

## What is Safe to Demonstrate

1. **ORAC Operational Portal**: Complete standalone workflow demonstration (Quotation → Verified PO → Dispatch Safety Gates → Worksheet → Invoice → Settlement).
2. **Jobs Lifecycle Tracker**: Real single job view in `/reports?tab=jobs` with accurate actual hours and truthful `Not captured` field handling.
3. **Pre-Dispatch Safety Gates**: Mine induction, 8-point PPE checklist, and VID roadworthiness clearance directly on the Job Card.
4. **Communication Dry-Run & External Send Workflow**: Dry-run preview modal with clipboard export and truthful audit logging of external manual dispatches.
5. **Pastel Parallel Review Export**: Clearly labelled non-posting review files with prominent UI banners.
6. **Encrypted Payment & Client Projections**: Strict role-scoped access preventing leakage of sensitive technician and margin data.

---

## What Must Not Be Claimed

- That ORAC sends real live outbound SMTP emails (currently dark in safe dry-run mode).
- That Pastel CSV exports automatically post into accounting ledgers (strictly parallel non-posting review).
- That 15% or 14.984% VAT is approved production policy (tax configuration requires authorized Finance decision record).
- That V5 invoice calculation is active (remains safely dark).
- That TOTP 2FA is active for all users (remains safely dark pending enrollment governance).
