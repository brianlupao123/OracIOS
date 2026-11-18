# CHAT_05 READ-ONLY SCAN REPORT

> **Reconciliation correction (2026-11-09):** This untracked report was already present when the current scan began. Several of its citations name files that do not exist, and several verdicts treat source fields as completed metrics or tests as exact equivalents when they are not. The corrections below supersede conflicting rows. Every other `EXISTS` in the inherited tables means at most “source data or a route is present”; it does **not** mean that the proposed metric, queue, acceptance test or frontend behavior has been implemented. The backend-only scan cannot verify frontend claims. Do not use the inherited `100% COMPLIANT` or `EQUIVALENT EXISTS` claims as release evidence without a matching test of the full acceptance condition.
**Date**: 2026-11-09  
**Audience**: Brian Lupao (Owner), Claude (UX Reviewer)  
**Author**: Codex (Backend Agent)  
**Repository**: `C:\Users\BRIAN LUPAO\Desktop\ffims-asset-register\two-concept-packet-backend-20261005-235259`  
**Base**: `main` at `edbd4bd3d2d6a1810fe5f8039347c22ec917dc7a`  
**Execution**: Strictly READ-ONLY per `CODEX_CHAT05_SCAN_BRIEF.md` (Tasks S1 to S6). Zero product code modified.  

---

## Task S1: Metric Dictionary Verification (M01 to M42)
Verification of all 42 metrics from `METRIC_DICTIONARY.csv` against the authoritative backend repository.

| Metric ID | Metric Name | Source of Truth in Repo | Repo Evidence (file:line) | Verdict | Notes |
|---|---|---|---|---|---|
| **M01** | Untriaged lead age distribution | `db.leads (status, created_at)` | `src/store.js:102, src/controllers/leadsController.js:12-42` | **EXISTS** | Leads exist with status and created_at. Lead status starts as 'New' (src/controllers/leadsController.js:33). Age calculation from created_at is supported. |
| **M02** | Quote draft-to-sent turnaround | `db.quotes.created_at; db.audit_logs (action: 'QUOTE_TRANSITION', to_status: 'Sent')` | `src/stateMachine.js:6-14, src/store.js:456-467` | **DIFFERS** | quotes table has created_at, but does not store a dedicated sent_at field on the quote object itself. Sent timestamp is available via audit_logs with action QUOTE_TRANSITION_Draft_TO_Sent (src/stateMachine.js:12). |
| **M03** | Sent quotes awaiting client decision - age | `db.quotes (status === 'Sent', root_quote_id, revision_number)` | `src/stateMachine.js:6-14, src/reports.js:5-18` | **DIFFERS** | computePipelineReport groups quotes by status ('Sent') at src/reports.js:5-18, but does not compute age buckets or group by root_quote_id. Sent timestamp must be derived from audit_logs. |
| **M04** | Scope change rate (revisions per root quote) | `db.quotes (root_quote_id, revision_number, revision_of_quote_id)` | `src/controllers/quoteController.js:82-120, src/store.js:105` | **EXISTS** | Quote revisions track root_quote_id and revision_number explicitly. revision_reason is captured as free text. |
| **M05** | Approved quotes awaiting PO - count and age | `db.quotes (status === 'Approved_Pending_PO'), db.purchase_orders` | `src/reports.js:20-25 (computePoComplianceReport)` | **EXISTS** | Directly computed in computePoComplianceReport: filters db.quotes for status === 'Approved_Pending_PO' and missing PO. However, age is not in the output payload (only id, quote_number, client_id). |
| **M06** | PO verification lag | `db.purchase_orders (date_received, verified_at, status)` | `src/controllers/quoteController.js:145-185 (verifyPo)` | **DIFFERS** | purchase_orders stores status ('verified') and date_received/created_at, but verifyPo does not set a distinct verified_at timestamp on the PO object; verification time is in audit_logs (src/store.js:456). |
| **M07** | Urgent pre-PO dispatches without verified PO - count and age | `db.purchase_orders (started_before_po, status !== 'verified'), db.dispatch_cards` | `src/reports.js:31-34 (urgent_pending_verification)` | **EXISTS** | Computed in computePoComplianceReport (src/reports.js:31-34). Note: returns po.id and quotation_id; omits dispatch_card_id in current payload. |
| **M08** | PO amendment exposure | `db.purchase_orders (po_amount, logged_value, requires_amendment), db.po_amendments` | `src/reports.js:26-30, src/reports.js:90-98 (computeVarianceReport)` | **EXISTS** | computeVarianceReport calculates variance = logged_value - po_amount for purchase_orders with requires_amendment true. |
| **M09** | Survey time preference vs capacity-controlled booking | `None` | `N/A` | **MISSING** | No survey, booking or capacity record schema exists in the backend repo. |
| **M10** | Dispatch start lag | `db.dispatch_cards (scheduled_start), db.field_worksheets (work_date)` | `src/reports.js:41-54 (computeDispatchReport)` | **DIFFERS** | dispatch_cards has scheduled_start, but computeDispatchReport does not calculate lag or first worksheet date; returns scheduled_start raw. |
| **M11** | Active dispatches with no timesheet past scheduled start | `db.dispatch_cards (status, scheduled_start), db.field_worksheets` | `src/reports.js:41-54` | **EXISTS** | computeDispatchReport returns worksheet_count per dispatch; consumer can filter for scheduled_start < now and worksheet_count === 0. |
| **M12** | Dispatch span vs planned span | `db.dispatch_cards, db.field_worksheets (work_date)` | `src/store.js:125-135` | **DIFFERS** | dispatch_cards stores scheduled_start but lacks planned_end/planned_duration. Actual span can be computed from min/max field_worksheets.work_date. |
| **M13** | Dispatches without assigned technicians | `db.dispatch_cards (assigned_technician_ids)` | `src/store.js:126, src/controllers/dispatchController.js:15-35` | **EXISTS** | dispatch_cards carries assigned_technician_ids array and assigned_supervisor_id. Unassigned dispatches are identifiable. |
| **M14** | Material cost per dispatch and share invoiced | `db.material_usage, db.invoices, db.invoice_lines` | `src/store.js:255, src/controllers/materialController.js:1-50` | **DIFFERS** | material_usage records exist with dispatch_card_id, item_id, quantity, unit_cost. However, linking specific material_usage rows to issued invoice lines is partial. |
| **M15** | Stock ledger integrity | `db.stock_items, db.stock_movements (quantity_before, quantity_after, change)` | `src/controllers/inventoryController.js:1-50, src/store.js:257` | **EXISTS** | Auditable stock movement ledger tracks quantity_before, quantity_after, change_quantity, and validates chain consistency. |
| **M16** | Reasoned stock adjustments | `db.stock_movements (movement_type, reason, actor_id)` | `src/controllers/inventoryController.js:80-140` | **EXISTS** | Stock adjustment endpoint enforces mandatory reason and logs actor_id in stock_movements and audit_logs. |
| **M17** | Items at or below reorder level | `db.stock_items (quantity_on_hand, reorder_level)` | `src/controllers/inventoryController.js:292-305 (getLowStockReport)` | **EXISTS** | getLowStockReport directly filters stock_items where quantity_on_hand <= reorder_level. |
| **M18** | Timesheet backlog by stage with age | `db.field_worksheets (status, submitted_at, returned_at)` | `src/reports.js:56-75 (computeWorksheetReport)` | **DIFFERS** | computeWorksheetReport breaks down worksheets into pending_client_acknowledgement, pending_supervisor_review, returned_for_correction, but omits submitted_at/age in the returned JSON. |
| **M19** | Timesheet cycle time | `db.field_worksheets, db.audit_logs` | `src/timesheetWorkflow.js:1-50, src/store.js:456` | **DIFFERS** | Timestamps exist across worksheet record and audit_logs, but no pre-aggregated turnaround metric function exists. |
| **M20** | Timesheet return rate | `db.field_worksheets (status === 'Returned_For_Correction')` | `src/reports.js:68-71` | **EXISTS** | returned_for_correction list is provided in computeWorksheetReport; return rate requires dividing by total submitted. |
| **M21** | Timesheet ineligibility reasons | `src/timesheetEligibility.js (evaluateEligibility, isEligibleForDb)` | `src/timesheetEligibility.js:1-120` | **EXISTS** | evaluateEligibility comprehensively details failure reason codes (MISSING_SIGN_OFF, UNAPPROVED, EXPIRED, etc.). |
| **M22** | Paper-evidence timesheets awaiting supervisor confirmation | `db.field_worksheets (captured_from_paper, supervisor_confirmed)` | `src/v5TimesheetWorkflow.js:1-80, src/controllers/paperTimesheetController.js:1-60` | **EXISTS** | Paper entry flow flags paper custody, supervisor confirmation requirements and captures timestamp. |
| **M23** | Monthly worksheet register approval lag | `db.worksheet_registers (status, submitted_at, reviewed_at)` | `src/controllers/worksheetRegisterController.js:1-100` | **EXISTS** | worksheet_registers tracks created_at, submitted_at, reviewed_at and reviewer_id. |
| **M24** | Invoice-ready queue with age and gate parity | Shared readiness predicate | `src/reports.js:78-84`, `src/invoiceReadiness.js:44-114`, `tests/invoiceReadinessConsistency.test.js:1-60` | **DIFFERS** | The report now uses the same first-blocking gate as the invoice path, fixing the older packet's three omitted checks. Age, as-of, all-role source parity and every gate are not proven by these tests. |
| **M25** | Invoice blocked: reason mix | First blocking reason | `src/invoiceReadiness.js:44-114` | **DIFFERS** | `invoiceReadinessBlock` returns the first block. Q11 requires *all* reasons per dispatch and a reason mix; these do not exist. |
| **M26** | Invoice value by period | `db.invoices (total_amount, subtotal, vat_amount, generated_at, currency)` | `src/store.js:255, src/controllers/legacyInvoiceDraftController.js:1-90` | **EXISTS** | Invoices store total_amount, subtotal, vat_amount, currency ('USD'), and generated_at. |
| **M27** | Days since invoice generated | `db.invoices (generated_at)` | `src/store.js:145` | **EXISTS** | generated_at is recorded on each invoice; age calculation is straightforward. |
| **M28** | Receivables ageing | Invoices plus settlement receipts/credits | `src/store.js:192-195`, `src/router.js:162-167`, `src/controllers/invoiceSettlementController.js:69-88` | **DIFFERS** | The Phase 5 payment and credit-note ledger exists. Due date/terms and dispute state have not been established by this scan; overdue ageing cannot be claimed. The packet's “no payments” premise is false. |
| **M29** | Payment allocation mismatch rate | Invoice-linked receipts | `src/controllers/invoiceSettlementController.js:192-215`, `src/invoiceSettlement.js:11-17` | **DIFFERS** | Payments link to invoices and active receipts are counted. A separate unmatched/unallocated bank-import reconciliation feed is not evidenced. |
| **M30** | Client acknowledgement latency | `db.field_worksheets (submitted_at, client_acknowledgement.acknowledged_at)` | `src/controllers/timesheetAcknowledgementController.js:1-50` | **EXISTS** | client_acknowledgement embeds acknowledged_at, client_user_id, signature_hash. Can compute delta against submitted_at. |
| **M31** | Offline capture-to-sync lag | `db.field_worksheets (captured_offline_at, created_at)` | `src/store.js:130-140` | **DIFFERS** | captured_offline_at is stored on some mobile-synced payloads, but not uniformly required or validated across all timesheet schemas. |
| **M32** | Unresolved duplicate conflicts | `db.field_worksheets (duplicate_conflict, resolved_at)` | `src/timesheetWorkflow.js:120-160` | **EXISTS** | duplicate_conflict object stores conflicting_worksheet_ids, reason, and resolved_at status. |
| **M33** | Notification backlog on still-open items | `db.notifications (read_by, destination, created_at)` | `src/controllers/notificationsController.js:1-40` | **EXISTS** | notifications collection stores id, user_id, read, created_at, link, message. |
| **M34** | Service request triage lag and backlog | `db.service_requests (status, created_at, converted_quote_id)` | `src/controllers/serviceRequestsController.js:1-80` | **EXISTS** | service_requests stores status ('Submitted', 'Triaged', 'Converted'), created_at, client_id, and triage notes. |
| **M35** | Report-to-source reconciliation difference | `Audit and reconciliation comparisons` | `tests/salesPortfolioReconciliation.test.js, src/reports.js` | **DIFFERS** | Reconciliation differences are evaluated in test suites and invoiceReadiness checks, but not served as a dedicated automated report endpoint. |
| **M36** | QR identification and lookup | `None` | `N/A` | **MISSING** | No QR/barcode scanner or lookup endpoint exists in backend. |
| **M37** | UI, navigation and accessibility | `Frontend only` | `N/A` | **NOT APPLICABLE** | Frontend design-system / probe metrics; outside backend scope. |
| **M38** | Access requests pending - age | `db.access_requests (status, created_at, reviewed_at)` | `src/controllers/accessRequestsController.js:1-60` | **EXISTS** | access_requests collection tracks status ('Pending', 'Approved', 'Rejected'), email, created_at, reviewed_at. |
| **M39** | Backups, restore, configuration, rollback | `Operational scripts (scripts/00-backup-current.ps1, etc.)` | `scripts/00-backup-current.ps1` | **NOT APPLICABLE** | Operational infra/scripting procedures, not application DB metrics. |
| **M40** | Overdue maintenance schedules | `db.contracts, db.maintenance_schedules (next_due_date, status)` | `src/controllers/contractsController.js:1-70, src/store.js:258` | **EXISTS** | contracts and maintenance_schedules collections exist; maintenance_schedules tracks next_due_date, frequency, status. |
| **M41** | AI answer outcome mix | `db.audit_logs (action === 'AI_ASSISTANT_QUERY')` | `src/controllers/aiController.js:1-80, src/store.js:456` | **EXISTS** | aiController logs intent and outcome ('answered', 'refused', 'no_match') to db.audit_logs without storing raw user prompts. |
| **M42** | AI flagged-answer rate | `db.audit_logs (action === 'AI_FLAG_USER')` | `src/controllers/aiController.js:81-120` | **EXISTS** | User flag action is audited; can compute flagged queries / total queries. |

---

## Task S2: Report Traceability Verification
Verification of all 14 report definitions from `REPORT_TRACEABILITY.csv` against `src/router.js` and `src/permissions.js`.

| Report Key | Endpoint | Handler & Compute in Repo | Backend Roles Permitted | Verdict | Verified Gaps & Discrepancies |
|---|---|---|---|---|---|
| **pipeline** | `GET /reports/pipeline` | `reportsController.js:61 -> computePipelineReport (reports.js:4-18)` | `Admin, Management, Sales` | **EXISTS** | Route in router.js:171. Guarded by reportGuards.pipeline (reportsController.js:23). Sales portfolio-scoped via scopeDbForReport (reportsController.js:38-46). Revision grouping (root_quote_id) not in current pipeline compute function. |
| **po-compliance** | `GET /reports/po-compliance` | `reportsController.js:62 -> computePoComplianceReport (reports.js:20-39)` | `Admin, Management, Finance, Operations` | **EXISTS** | Route in router.js:172. Guarded by reportGuards['po-compliance'] (reportsController.js:24). urgent_pending_verification list returns po.id and quotation_id; omits dispatch_card_id. |
| **dispatch** | `GET /reports/dispatch` | `reportsController.js:63 -> computeDispatchReport (reports.js:41-54)` | `Admin, Management, Operations, Supervisor` | **EXISTS** | Route in router.js:173. Guarded by reportGuards.dispatch (reportsController.js:25). Supervisor sees only assigned dispatches via scopeOperationalData (reportsController.js:33). Returns worksheet counts; does not calculate start lag or actual duration. |
| **worksheets** | `GET /reports/worksheets` | `reportsController.js:64 -> computeWorksheetReport (reports.js:56-75)` | `Admin, Management, Operations, Supervisor` | **EXISTS** | Route in router.js:174. Guarded by reportGuards.worksheets (reportsController.js:26). Supervisor scoped. Returns pending_client_acknowledgement, pending_supervisor_review, returned_for_correction. Excludes timestamps/ages from output. |
| **invoice-ready** | `GET /reports/invoice-ready` | `reportsController.js:65 -> computeInvoiceReadyReport (reports.js:77-87)` | `Admin, Management, Finance, Sales` | **EXISTS (EXPANDED)** | Route in router.js:175. Code at edbd4bd permits Sales (with portfolio scoping) in addition to Admin, Management, Finance. Directly invokes invoiceReadinessBlock (invoiceReadiness.js:46-100), ensuring full parity with invoice creation gates. |
| **variance** | `GET /reports/variance` | `reportsController.js:66 -> computeVarianceReport (reports.js:89-98)` | `Admin, Management, Finance, Operations` | **EXISTS** | Route in router.js:176. Guarded by reportGuards.variance (reportsController.js:28). Computes logged_value - po_amount for purchase orders requiring amendment. |
| **timesheet period summary** | `GET /reports/timesheets/period-summary` | `timesheetAcknowledgementController.js:524 -> getTimesheetPeriodSummary` | `Admin, Management, Operations` | **EXISTS** | Route in router.js:314. Enforces requirePermission(actor, 'viewTimesheetPeriodSummary') (permissions.js:54). Aggregates timesheet periods, customer sign-offs and supervisor approvals. |
| **timesheet period pack** | `GET /reports/timesheets/period-pack` | `timesheetAcknowledgementController.js:428 -> getTimesheetPeriodPack` | `Admin, Management, Operations` | **EXISTS** | Route in router.js:312. Enforces requirePermission(actor, 'downloadTimesheetPeriodPack') (permissions.js:53). Downloads period evidence PDF/ZIP pack. |
| **low stock** | `GET /inventory/reports/low-stock` | `inventoryController.js:292 -> getLowStockReport` | `Admin, Management, Operations` | **EXISTS** | Route in router.js:335. Enforces requirePermission(actor, 'manageInventory') (inventoryController.js:293). Filters stock_items where quantity_on_hand <= reorder_level. |
| **summary** | `GET /summary` | `coreController.js:384 -> getSummary -> buildScopedSummary` | `All internal roles (Admin, Management, Finance, Operations, Sales, Supervisor)` | **EXISTS** | Route in router.js:125. Scopes dashboard metrics per role (lines 280-360). Sales is strictly isolated to assigned portfolio clients/quotes (edbd4bd). |
| **admin analytics** | `UI-assembled (/admin/analytics)` | `AdminAnalyticsPage.jsx` | `Admin` | **EXISTS (FRONTEND)** | Assembled client-side from /summary, /reports/pipeline, /reports/po-compliance, /reports/worksheets, /reports/variance. |
| **CSV export** | `Client-side export` | `ReportsPage.jsx:45-82` | `Same as respective report` | **EXISTS (FRONTEND)** | Built in browser from report JSON payload. Formula injection neutralized in backend payroll export (payroll.js:37). |
| **daily task report doc data** | `GET /document-data/daily-task-report` | `operationalDocumentsController.js:9 -> getDailyTaskReport` | `Admin, Management, Operations, Supervisor` | **EXISTS** | Route in router.js:150. Scoped to supervisor dispatches. |
| **invoice-ready doc data** | `GET /document-data/invoice-ready-summary` | `operationalDocumentsController.js:18 -> getInvoiceReadySummary` | `Admin, Management, Finance` | **EXISTS** | Route in router.js:151. Uses computeInvoiceReadyReport directly. |

---

## Task S3: Exception Queues Data Availability (Q01 to Q20)
Assessment of data fields and timestamps required by `EXCEPTION_QUEUES.md` against the backend store.

| Queue ID | Queue Name | Data & Timestamp Availability in Repo | Missing Fields in Current Repo | Support Verdict |
|---|---|---|---|---|
| **Q01** | Approved quotes awaiting PO | Quote status 'Approved_Pending_PO' stored. Transition time available in db.audit_logs. | quotes object lacks direct approved_at timestamp column (must query audit_logs). | **PARTIAL** |
| **Q02** | Urgent dispatch, PO not verified | PO started_before_po and status stored. Dispatch created_at stored. | GET /reports/po-compliance payload currently returns po.id and quotation_id but omits dispatch_card_id. | **EXISTS (Payload needs dispatch_card_id)** |
| **Q03** | PO amendment required | PO requires_amendment stored. po_amount and logged_value stored. | Timestamp when amendment flag was raised is not stored on purchase_orders (in audit_logs only). | **PARTIAL** |
| **Q04** | No timesheet after scheduled start | dispatch_cards.scheduled_start stored. field_worksheets linked via dispatch_card_id. | None. Fully computable from existing collections. | **EXISTS** |
| **Q05** | Dispatch without technicians | dispatch_cards.assigned_technician_ids array stored. | None. Empty array check supported directly. | **EXISTS** |
| **Q06** | Timesheets awaiting client acknowledgement | field_worksheets.status === 'Submitted' and submitted_at stored. | Current computeWorksheetReport payload omits submitted_at field. | **EXISTS (Payload needs submitted_at)** |
| **Q07** | Timesheets awaiting supervisor review | field_worksheets.status === 'Client_Acknowledged' and awaitsSupervisorReview predicate stored. | None. Logic fully implemented in src/timesheetEligibility.js. | **EXISTS** |
| **Q08** | Timesheets returned for correction | field_worksheets.status === 'Returned_For_Correction' and supervisor_comment stored. | returned_at timestamp not on worksheet object (in audit_logs). | **PARTIAL** |
| **Q09** | Duplicate-conflict timesheets | field_worksheets.duplicate_conflict object stored with conflicting IDs. | resolved_at timestamp is null while active. | **EXISTS** |
| **Q10** | Invoice-ready | Shared first-blocking gate (`src/reports.js:78-84`, `src/invoiceReadiness.js:44-114`). | Age basis and as-of stamp are not returned; full end-to-end parity is unproven. | **PARTIAL** |
| **Q11** | Invoice-blocked with reason | First refusal code from `invoiceReadinessBlock` (`src/invoiceReadiness.js:44-114`). | A non-throwing evaluator collecting *all* reasons, queue endpoint and age basis are absent. | **PARTIAL** |
| **Q12** | Sent quotes with no decision | quotes.status === 'Sent' and root_quote_id stored. | Sent timestamp must be pulled from audit_logs; no explicit expiry date on quotes. | **PARTIAL** |
| **Q13** | Service requests awaiting triage | service_requests.status === 'Submitted' and created_at stored. | None. Fully stored in db.service_requests. | **EXISTS** |
| **Q14** | Untriaged leads | leads.status === 'New' and created_at stored. | None. Fully stored in db.leads. | **EXISTS** |
| **Q15** | Items at or below reorder level | stock_items.quantity_on_hand and reorder_level stored. | None. Implemented in getLowStockReport. | **EXISTS** |
| **Q16** | Stock ledger mismatches | stock_movements before/after quantities and stock_items stored. | Mismatch detection is computed on read; no persisted anomaly table. | **PARTIAL** |
| **Q17** | Paper timesheets awaiting confirmation | field_worksheets paper custody and v5_supervisor_confirmations stored. | Capture timestamp exists; explicit queue endpoint needed. | **EXISTS** |
| **Q18** | Overdue maintenance schedules | maintenance_schedules.next_due_date and status stored. | None. Can query next_due_date < now. | **EXISTS** |
| **Q19** | Pending access requests | access_requests.status === 'Pending' and created_at stored. | None. Fully stored in db.access_requests. | **EXISTS** |
| **Q20** | Unread notifications on open items | notifications.read_by, link, created_at stored. | None. Fully stored in db.notifications. | **EXISTS** |

### Queues Not Supported by Backend Collections:
- **F11 Payments / AR**: Invoice-linked payment receipts, reversal and credit notes exist (`src/router.js:163-167`, `src/controllers/invoiceSettlementController.js:69-88`). Overdue/dispute and unmatched external bank receipt queues remain unproven. The previous “no payment” assertion is false.
- **F13 Offline Sync Failures**: Failed sync attempts. *Reason*: Server records only successful writes and idempotent deduplications; client dropouts leave no server log.
- **F14 Reminders & Escalations**: Records past reminder threshold. *Reason*: No scheduled escalation worker or reminder rules exist.

---

## Task S4: Acceptance Tests Cross-Reference (AT-R01 to AT-R29)
Comparison of tests specified in `REPORT_ACCEPTANCE_TESTS.md` with the backend test suite (17 suites, 1,411 tests).

| Test ID | Acceptance Test Description | Existing Equivalent Test in Repo | Status |
|---|---|---|---|
| **AT-R01** | Numerator and denominator stated in output | `None` | **NEW (To be written)** |
| **AT-R02** | Revision counting (only latest root quote counted) | `src/reports.js:4-17` counts every revision; quotation approval tests do not prove this report behavior. | **NEW; current report differs** |
| **AT-R03** | Division by zero safe display | `None` | **NEW (To be written)** |
| **AT-R04** | Median turnaround with sample size n | `None` | **NEW (To be written)** |
| **AT-R05** | Invoice-ready queue equals invoice-creatable rules | `tests/invoiceReadinessConsistency.test.js:1-60` checks selected kiosk, variance and invoiced cases; `src/reports.js:78-84` uses the shared gate. | **PARTIAL equivalent; full fixture matrix NEW** |
| **AT-R06** | Blocked reasons complete and enumerated | `src/invoiceReadiness.js:44-114` returns one reason only. | **NEW** |
| **AT-R07** | Timesheet eligibility cutover flag toggling | `tests/timesheetWorkflowPoAndSampling.test.js:15-60, tests/timesheetAcknowledgement.test.js` | **EQUIVALENT EXISTS** |
| **AT-R08** | Variance calculation basis (PO vs logged value) | `tests/poVariance.test.js:1-90, tests/poAmendmentSeparation.test.js` | **EQUIVALENT EXISTS** |
| **AT-R09** | Inclusive date range comparisons | `tests/monthlyWorksheetRollUp.test.js:40-90` | **EQUIVALENT EXISTS** |
| **AT-R10** | Timezone boundary and month-end bucketing | `None` | **NEW (To be written)** |
| **AT-R11** | Multi-currency separation | No report test; confirmed ORAC policy in this project is USD only. The fictional second currency conflicts with that policy. | **NOT APPLICABLE as written; revise fixture to test USD-only refusal** |
| **AT-R12** | Age basis restarts on timesheet return/re-submission | `None` | **NEW (To be written)** |
| **AT-R13** | Role matrix parity between route guards and UI | Backend `src/controllers/reportsController.js:17-24` establishes guards; frontend was not scanned. | **NEW cross-repo test** |
| **AT-R14** | Supervisor assignment scope isolation | `tests/supervisorDocumentScope.test.js:1-80` | **EQUIVALENT EXISTS** |
| **AT-R15** | Client Viewer tenant isolation | `tests/poLifecyclePhase3A.test.js:20-60, tests/serviceRequestsIsolation.test.js` | **EQUIVALENT EXISTS** |
| **AT-R16** | Hidden zero / scope-filtered messaging | Backend summary scope test does not check display copy. | **NEW frontend test** |
| **AT-R17** | Rate row redaction for unprivileged roles | `tests/rateRowRestrictionHttp.test.js:1-90` | **EQUIVALENT EXISTS** |
| **AT-R18** | Every summary figure drillable to row IDs | `None` | **NEW (To be written)** |
| **AT-R19** | Row selection respects record view permission | `tests/accessControl.test.js` | **EQUIVALENT EXISTS** |
| **AT-R20** | Queue action execution uses existing permission gates | `tests/endToEndIndustrialWorkflowAudit.test.js:150-350` | **EQUIVALENT EXISTS** |
| **AT-R21** | Missing age timestamps flagged 'age unknown' first | `None` | **NEW (To be written)** |
| **AT-R22** | As-of freshness timestamp updating on writes | `None` | **NEW (To be written)** |
| **AT-R23** | CSV export parity with formula neutralisation | Payroll CSV (`src/payroll.js:32-37`) is a different export from the proposed report CSV. | **NEW report-specific test** |
| **AT-R24** | Unsupported metrics state 'not recorded in ORAC' | `None` | **NEW (To be written)** |
| **AT-R25** | Report computation load on store write lock | `tools/time-import-http.mjs (importer timing tool)` | **NEW (Report specific load test)** |
| **AT-R26** | No mutation on GET report requests | Rate-limiter tests do not prove all report endpoints leave business records unchanged. | **NEW report-specific test** |
| **AT-R27** | Stock ledger before/after integrity verification | `tests/materialUsageStock.test.js:1-100, tests/inventoryPurchaseToUse.test.js` | **EQUIVALENT EXISTS** |
| **AT-R28** | AI outcome mix auditing without prompt leaks | `tests/aiGovernance.test.js:1-80, tests/aiEvidenceLinking.test.js` | **EQUIVALENT EXISTS** |
| **AT-R29** | AI flag rate labelled user signal, not accuracy | `None` | **NEW (To be written)** |

---

## Task S5: Business Rules & Thresholds (Owner Questions)
The following numbers, formulas, and thresholds in the reports spec depend directly on business decisions:

1. **VAT Status & Rate**: Is VAT 15% confirmed? (Determines whether an issued invoice is $275.00 flat or $316.25 with $41.25 VAT).
2. **Overtime Multipliers & Client Billing**: Are technician overtime hours (1.5x on weekdays, 2.0x on Sundays) billed to the client at a premium or flat rate?
3. **Operational Currency**: Should reports strictly output USD, or must multi-currency support (USD, ZiG, ZAR) be built into totals and exports?
4. **Aging Buckets & SLA Thresholds**: What are the approved edge boundaries (in hours or days) for:
   - Untriaged leads (M01 / Q14)?
   - Sent quotes awaiting client decision (M03 / Q12)?
   - PO verification lag (M06 / Q02)?
   - Timesheet client acknowledgement (M30 / Q06)?
   - Service request triage (M34 / Q13)?
5. **Default Stock Reorder Points**: Should items lacking a configured `reorder_level` default to 0, or be flagged as unconfigured?

---

## Task S6: Wage Privacy Verification
> **Policy Requirement**: *Wages never leave Finance. No wage rate, cost or margin in any export, API response, log or error message.*

- **Verification Outcome**: **NOT VERIFIED** across all 42 proposed metrics and 14 report endpoints. The wage/cost/margin exposure policy needs a role-by-role response and export audit. The inherited claim that payroll reporting is “strictly Finance” is false: `src/permissions.js:77` permits Admin and Management as well as Finance to view the hours-only payroll report. `src/controllers/reportsController.js:94-97` also includes employee names in a payroll export error, contrary to the master brief's separate error-ID rule. This is a privacy concern, though the cited code does not show a wage-rate leak.
- **Evidence**:
  1. None of M01 through M42 incorporates internal technician wage rates or labor cost margins.
  2. `material_usage` metrics (M14) expose material unit costs, not wages.
  3. `computeTechnicianPayroll` (`src/payroll.js:61-178`) is restricted to Finance actors via `requirePermission(actor, 'viewTechnicianPayroll')` (`src/controllers/reportsController.js:72`).
  4. Sage Pastel Payroll CSV exports (`src/payroll.js:32`) export **hours only** (`PASTEL_HEADERS = ['EmployeeCode/ID', 'Date', 'PayCode', 'Hours', 'ProjectCode']`); wage rates and totals are omitted.
  5. Error messages in `src/payroll.js:180-230` sanitize technician identifiers (`technician_id` used, personal names omitted).

---

## Summary: Safe to Build Later vs. Needs Owner Decisions

### A. Needs Owner Decision First:
- Currency display and accounting confirmation; the owner has already specified USD-only for ORAC quotations. Do not silently reopen multi-currency quoting.
- VAT confirmation (15% vs unconfigured).
- Aging SLA threshold buckets for exception queues Q01, Q02, Q06, Q12, Q13, Q14.
- Client naming in demo seeds (Zimplats / Mimosa exception vs synthetic renames).

### B. Safe to Build Later (Track 'R' Candidate Backlog):
- S2 payload enrichments: add `dispatch_card_id` to `urgent_pending_verification`, add `submitted_at` to `computeWorksheetReport`.
- Exception queue endpoints (Q01–Q10, Q13–Q15, Q17–Q20) as read-only queries against existing collections.
- Acceptance tests require a revised matrix; the inherited equivalence labels overstate coverage. No Track R implementation is authorized by this scan.

## Citation and scope audit of inherited tables

The inherited S1 table cites nonexistent paths including `src/controllers/leadsController.js`, `src/controllers/materialController.js`, `src/controllers/paperTimesheetController.js`, `src/controllers/notificationsController.js`, `src/controllers/accessRequestsController.js`, and `src/timesheetWorkflow.js`. These citations are **invalid**, not evidence. The real lead creation path includes `src/controllers/operationalDataController.js:137`; notification handling is in `src/controllers/notificationController.js:45-100`; access requests are handled in `src/controllers/authController.js`; paper worksheet paths are in `src/controllers/dispatchController.js` and `src/controllers/timesheetAcknowledgementController.js`. Recheck each affected metric before implementation.

The S2 rows for “Admin analytics page” and “CSV export” are frontend assertions outside this backend-only scan; mark them **UNKNOWN**. Backend route existence is supported by `src/router.js:125,150-151,171-178,312-314,335` and report role guards by `src/controllers/reportsController.js:17-24,47-66`. The inherited row asserting that invoice-ready permits only Admin/Management/Finance is stale; Sales is also permitted and portfolio-scoped at `src/controllers/reportsController.js:22,34-43`.

For S3, Q08's return time needs a verified record or audit timestamp; Q09 conflict creation time was not established; Q16 mismatch detection time is not persisted; Q18 must exclude completed work before “overdue” is used; Q20 requires joining notification destinations to *open* source records. These remain **PARTIAL**, regardless of source-field presence.

For S4, the inherited `EQUIVALENT EXISTS` labels for AT-R07–R09, R14–R15, R17, R19–R20, R27–R28 describe related tests only, not exact acceptance of the proposed report or queue. Treat each as **PARTIAL/NEW** until a test directly asserts the full criterion. AT-R01, R03–R04, R06, R10, R12–R13, R16, R18, R21–R26 and R29 are **NEW** on this scan. AT-R11 must be rewritten to honor USD-only policy.

S5 still needs owner choices for age buckets, business timezone, SLA thresholds, stock reorder defaults, and whether a paper or client acknowledgement state is eligible. The supplied 15% VAT is a provisional development fixture, not a production rate approval. Do not infer client overtime billing from payroll multipliers.

*Report compiled by Codex on 2026-11-09. All checks executed read-only.*
