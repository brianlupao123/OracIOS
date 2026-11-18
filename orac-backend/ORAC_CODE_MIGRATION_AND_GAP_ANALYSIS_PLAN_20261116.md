# ORAC External Code Migration Plan & Post-Migration Gap Analysis
**Date:** 2026-11-16  
**Authority:** Brian Lupao (System Owner)  
**Engineering Agent:** Antigravity  
**Target:** Fast-track ORAC from 47% to ~90% ERP completion via code harvest from `FFIMS`, `AU Careers Platform`, and `wachiye-repos`.

---

## 1. Executive Summary & Source Inventory

Three substantial software systems already exist locally on the developer workstation:
1. **Whole Class FFIMS System (`C:\Users\BRIAN LUPAO\Desktop\ffims-asset-register\FFIMS`):**
   - `ffims_backend`: 70+ Node.js/Mongoose models covering Fleet (`vehicle`, `driver`, `trip`, `fuel-record`), Procurement (`procurement-request`, `supplier`), HSE/Compliance (`compliance-record`, `ppe-allocation`, `incident`), and Workforce (`worker`, `shift-schedule`).
   - `ffims_frontend`: 22 pre-built React modular UI directories including `Fleet-Management`, `Procurement-Supplier-Management`, `Compliance-Safety-Management`, and `Faults-Ticketing-System`.
2. **Africa University Careers Platform (`C:\Users\BRIAN LUPAO\Desktop\careers.africau.co.zw-main`):**
   - Full Applicant Tracking & HR portal with PostgreSQL Drizzle schemas for candidate qualification documents (`applicantDocuments`, `applicationAttachment`), timeline activity logs, and Nodemailer SMTP Email OTP verification.
3. **Wachiye Portfolio (`C:\Users\BRIAN LUPAO\Desktop\wachiye-repos`):**
   - 30 microservices and components including `tailpos` (offline SQLite/PouchDB POS architecture) and payment integrations.

---

## 2. The 4-Sprint Migration Plan

### Sprint 1: Supply Chain & Procurement (ORAC Subsystem 3: 25% → 100%)
* **Source Files:**
  - `FFIMS/ffims_backend/models/procurement-request.model.js`
  - `FFIMS/ffims_backend/models/procurement-request-item.model.js`
  - `FFIMS/ffims_backend/models/supplier.model.js` & `supplier-item.model.js`
  - `FFIMS/ffims_frontend/src/modules/Procurement-Supplier-Management/`
* **Target ORAC Implementation:**
  - Backend: `src/controllers/procurementController.js`, `src/procurementLedger.js`
  - Collections: `procurement_requests` (Internal PR), `supplier_purchase_orders` (Supplier PO), `goods_received_notes` (GRN), `store_issue_vouchers` (SIV).
  - Schema: Zod schemas in `src/schemas.js` enforcing 3-way matching (PO qty vs. GRN received qty vs. Invoice billed qty).
  - Frontend: `frontend/src/pages/ProcurementPage.jsx` adapted into `PortalLayout.jsx`.
  - Tests: `tests/procurementLifecycle.test.js` (PR creation, approval, supplier PO dispatch, GRN receipt).

### Sprint 2: Fleet & Facilities (ORAC Subsystem 4: 0% → 100%)
* **Source Files:**
  - `FFIMS/ffims_backend/models/vehicle.model.js`, `driver.model.js`, `trip.model.js`
  - `FFIMS/ffims_backend/models/fuel-record.model.js`, `vehicle-maintenance.model.js`
  - `FFIMS/ffims_frontend/src/modules/Fleet-Management/`
* **Target ORAC Implementation:**
  - Backend: `src/controllers/fleetController.js`
  - Collections: `vehicles`, `drivers`, `trips`, `fuel_logs`, `vehicle_maintenance_records`.
  - Relational Anchor: Every trip explicitly accepts `dispatch_card_id` and `driver_id`.
  - Frontend: `frontend/src/pages/FleetManagementPage.jsx`.
  - Tests: `tests/fleetManagement.test.js` (Vehicle registration, dispatch trip booking, fuel consumption logging, license expiry).

### Sprint 3: HSE & Quality Compliance (ORAC Subsystem 5: 0% → 100%)
* **Source Files:**
  - `FFIMS/ffims_backend/models/compliance-record.model.js`, `compliance-certificate.model.js`
  - `FFIMS/ffims_backend/models/ppe-allocation.model.js`, `ppe-item.model.js`
  - `FFIMS/ffims_backend/models/incident.model.js`, `security-incident.model.js`
  - `FFIMS/fault-ticketing-system/`
  - `FFIMS/ffims_frontend/src/modules/Compliance-Safety-Management/`
* **Target ORAC Implementation:**
  - Backend: `src/controllers/hseController.js`
  - Collections: `ppe_allocations`, `safety_incidents`, `toolbox_talks`, `inspection_checklists`.
  - Relational Anchor: Pre-dispatch PPE signoff required before field worksheet status progresses to `Client_Acknowledged`.
  - Frontend: `frontend/src/pages/HseCompliancePage.jsx`.
  - Tests: `tests/hseCompliance.test.js` (PPE allocation, incident reporting, safety signoff).

### Sprint 4: HR & Artisan Qualifications + Email OTP (ORAC Subsystem 6: 25% → 100%)
* **Source Files:**
  - `AU Careers`: `src/lib/db/schema.ts` (`applicantDocuments`, `applicationAttachment`, `verification`)
  - `AU Careers`: `src/lib/mailer.ts` (Nodemailer SMTP integration)
  - `FFIMS/ffims_backend/models/shift-schedule.model.js`, `worker.model.js`
* **Target ORAC Implementation:**
  - Backend: Extend `src/controllers/technicianProfilesController.js`, add `src/services/emailService.js`.
  - Collections: `artisan_qualifications`, `worker_certifications`, `shift_schedules`, `verification_tokens`.
  - Features: Document storage metadata for certificates, 30/60/90-day expiry calculation in `src/payroll.js`, 6-digit Email OTP via Nodemailer.
  - Tests: `tests/hrQualifications.test.js`, `tests/emailOtpAuth.test.js`.

---

## 3. Post-Migration Gap Analysis: What Will STILL Be Left Out?

Assuming the entire migration above is executed to completion, here is the honest, item-by-item comparison against [`ORAC-MASTER-TRACKER.md`](file:///C:/Users/BRIAN%20LUPAO/Desktop/ffims-asset-register/two-concept-packet-backend-20261005-235259/ORAC-MASTER-TRACKER.md):

| Subsystem / Item in Master Tracker | Covered by Harvest? | Status Post-Migration | Why It Is Left Out / Remaining Work |
| :--- | :---: | :---: | :--- |
| **Client PR Entity (Commercial)** | ❌ NO | **SPEC ONLY** | FFIMS has *Internal PRs* (to suppliers), NOT mining *Client PRs* (formal requisition numbers issued by Zimplats/Mimosa). Must be manually added as an entity if client insists. |
| **Jobs Tracker 14 Statuses (Commercial)** | ❌ NO | **SPEC ONLY** | FFIMS uses generic approval states. The 14 granular commercial stages proposed by Codex are ORAC-specific and do not exist in FFIMS. (Current 5 stages remain). |
| **Awaiting Client PR Status (Commercial)** | ❌ NO | **SPEC ONLY** | Same as above. Client PR is not a gating state in FFIMS. |
| **Interactive Visual Gantt Chart (Operations)** | ❌ NO | **MISSING** | FFIMS has tabular shift schedules and duty lists, but NO drag-and-drop SVG/Canvas interactive Gantt chart. Roster will remain tabular. |
| **Offline Mobile Sync (Operations)** | ⚠️ PARTIAL | **MISSING (in Web)** | FFIMS and AU Careers are strictly online web applications. Wachiye's `tailpos` has local SQLite/PouchDB, but porting offline sync to ORAC's web frontend requires a full PWA/ServiceWorker architecture. |
| **PDF Password Protection (Security)** | ❌ NO | **MISSING** | Neither FFIMS nor AU Careers encrypts PDFs with user passwords. AU Careers exports unencrypted Excel/PDF via presigned URLs. Password encryption requires dedicated `pdf-lib` / crypto work. |
| **Maker-Checker 2-Person on Bank (Admin)** | ❌ NO | **SPEC ONLY** | FFIMS has multi-tier purchase approvals, but NO dual-control lock requiring User A to edit bank info and User B to approve it. Admin audit log remains the defense. |
| **Pastel 2-Way Auto-Sync (Finance)** | ❌ NO | **INTENTIONALLY NOT BUILT** | Excluded by safety policy to prevent ERP general ledger corruption. |
| **Subsystem Folders Restructure (Structure)** | ❌ NO | **FLAT (by decision)** | Files will be integrated into ORAC's flat `controllers/` and `pages/` structure to protect existing import paths and passing tests. |

---

## 4. Final Post-Migration Scorecard

* **Core Operations Engine:** **95%** (Only Offline Mobile Sync and Visual Gantt omitted).
* **Full 8-Subsystem ERP:** **~90%** (Up from **47%** today).
* **Items Truly Left Out:** Exactly **6 items**:
  1. Client PR entity (mining-specific client requisition tracking)
  2. Jobs Tracker 14 statuses enum (remains at 5 operational stages)
  3. Interactive Visual Gantt Chart (remains tabular shift roster)
  4. Offline Mobile Sync (remains online web client)
  5. PDF Password Protection (PDFs remain standard unencrypted PDF-1.4)
  6. 2-Person Maker-Checker on Bank Accounts (remains Admin + Audit Trail)
