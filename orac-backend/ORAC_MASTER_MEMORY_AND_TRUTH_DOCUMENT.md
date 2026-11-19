# ORAC MASTER MEMORY & SINGLE SOURCE OF TRUTH

> **Document Purpose:** This is the DEFINITIVE reference for the entire ORAC ERP project. Every decision, file path, role, configuration, gap, and agreement is recorded here. No other document overrides this one.
> **Last Updated:** 2026-11-18T11:34 CAT (Africa/Harare, UTC+2)
> **Status:** ✅ APPROVED — Unified Monorepo + Full Architecture locked by Brian on 18 Nov 2026.
> **Owner:** Brian Lupao (System Owner) + Antigravity (Engineering Agent)

---

## TABLE OF CONTENTS
1. [System Map: All File Locations](#1-system-map)
2. [Backend Codebase Inventory](#2-backend-inventory)
3. [Frontend Codebase Inventory](#3-frontend-inventory)
4. [The 13-Role Credential Matrix](#4-roles)
5. [The 37-Item Configuration Matrix](#5-configurations)
6. [Architecture Decisions (Agreed)](#6-architecture-decisions)
7. [Public Web Integration Solution](#7-public-web-integration)
8. [Integration Kit: Files to Absorb](#8-integration-kit)
9. [8 Backend↔Frontend Route Mismatches](#9-route-mismatches)
10. [Security Gaps & Missing Infrastructure](#10-security-gaps)
11. [All Architecture Documents Index](#11-documents-index)
12. [Standing Rules (Non-Negotiable)](#12-standing-rules)
13. [Accountability Register](#13-accountability)
14. [Target Restructured Folder Architecture](#14-target-structure)

---

## 1. SYSTEM MAP: ALL FILE LOCATIONS {#1-system-map}

### Unified Monorepo (Decision D18 — Agreed 18 Nov 2026)

> [!IMPORTANT]
> ORAC is a **single Git repository (Monorepo)**. The root directory is `orac-ios/`.
> Backend and Frontend are sibling directories inside the monorepo.

**Target Root:** `orac-ios/` (to be established in Phase 0)

| Folder | Purpose | Tech Stack |
|--------|---------|------------|
| `orac-ios/orac-backend/` | Authoritative ORAC-IOS ERP Backend | Node.js, Express, ESM, Zod, bcrypt, pg, jsonwebtoken |
| `orac-ios/orac-ios-frontend/` | Operations Portal (Vite + React 18 SPA) | React 18, React Router 6, Vite, Tailwind CSS |
| `orac-ios/docs/` | Root-level system documentation | MASTER_MEMORY.md, ARCHITECTURE.md, API_CONTRACTS.md |
| `orac-ios/docker-compose.yml` | One-command dev environment | Postgres + Backend + Frontend |

### Current Physical Locations (Pre-Consolidation)

| System | Current Path | Destination |
|--------|-------------|-------------|
| **Backend API** | `C:\Users\BRIAN LUPAO\Desktop\ffims-asset-register\two-concept-packet-backend-20261005-235259` | → `orac-ios/orac-backend/` |
| **Frontend Portal** | `D:\Projects\ORAC-WORKSPACE\2-portal-frontend\orac-ios-frontend` | → `orac-ios/orac-ios-frontend/` |

### Reference & Prototype Systems (NOT Production)

| System | Path | Purpose | Fate |
|--------|------|---------|------|
| **Public Website (`orac-systems-demo`)** | `D:\Projects\orac-systems-operational\orac-systems-demo` (Git: `brianlupao123/Orac-system-web`) | Public customer marketing website (React 18 + Vite) deployed to **Vercel** (`https://orac-system-web.vercel.app`) | **SEPARATE REPO & DEPLOYMENT.** Relies on `orac-backend` on Fly.io via HTTP (`POST /api/leads`). Demo Express server RETIRED. |
| **Integration Kit** | `D:\Projects\orac-systems-operational\integration-kit\orac-ios-integration-kit` | Booking engine, rate limiter, websiteController | **ABSORBED into orac-backend/src/modules/public/** |
| **Integration Staging** | `D:\Projects\orac-systems-operational\orac-ios-integration` | Historical handover bundle with older backend+frontend snapshots | **Archived reference** |
| **External Chatbot** | `D:\Projects\orac-systems-operational\orac-chatbot-external` | Standalone chatbot prototype | Reference only |

### Operational Documents Directory

| Path | Contents |
|------|----------|
| `D:\Projects\orac-systems-operational` | 6 PUBLIC_WEB docs, handover docs, evidence, academic proposal |
| `c:\Users\BRIAN LUPAO\Downloads\orac-systems-operational` | CWD workspace, master tracker |
| `C:\Users\BRIAN LUPAO\.gemini\antigravity\brain\796e2400-706b-49a0-8424-2f8af0202094` | Artifact directory (this doc, audit plan, restructure plan, all harvest packets) |

### Repository Harvest Sources (50 repos scanned, 6 tier-one)

| Repository | Path | Harvested Pattern |
|------------|------|-------------------|
| `node-ts-sequelize-pg-boilerplate` | `C:\Users\BRIAN LUPAO\Desktop\wachiye-repos\` | Clean Architecture: Component Controllers & Services |
| `mpesa-offramp-backend` | Same | 5-Tier Layered REST |
| `tailpos` | Same | Offline-First PouchDB/SQLite Sync |
| `paypal-nodejs` | Same | RabbitMQ + Winston Structured Logger |
| `eclectics-jwt-auth` | Same | Hardened JWT Auth + Token Rotation |
| `Prompt-Engineering-Guide` | Same | LLM Prompt Engineering for AI extraction |

---

## 2. BACKEND CODEBASE INVENTORY {#2-backend-inventory}

### Entry Point & Config
- **`server.js`** (root) — Express setup, securityHeaders, rateLimit, cors, persistenceMiddleware, /healthz, 6-line error handler, SPA fallback
- **`src/config.js`** — Built-in `.env` loader, production validation, Google OAuth `googleClientId`, store driver, JWT
- **`src/store.js`** — Monolith store using **arrays** for collections (NOT Maps). Seeds 8 demo users + 3 demo clients.
- **`src/configuredStore.js`** — Wires JSON or Postgres driver
- **`src/postgresStore.js`** — PostgreSQL adapter
- **`package.json`** — `name: "orac-ios"`, `type: "module"` (ESM), 5 deps: bcrypt, express, jsonwebtoken, pg, zod. Zero devDeps.

### Flat Source Files (57 files in `src/`)

```
accountTokens.js, businessTimezone.js, clientAllowlist.js, config.js, configuredStore.js,
contractorLogValidation.js, curatedDemoData.js, dailyTimesheetValidation.js, dbUrl.js,
dispatchFreeze.js, exporter.js, idempotency.js, internalWorkRequestRules.js,
inventoryLedger.js, invoiceReadiness.js, invoiceSettlement.js, jobActuals.js,
jobHoursVariance.js, jobTrackerStatuses.js, legacyAdapters.js, notificationDestinations.js,
notifications.js, paperEntry.js, paymentDetails.js, payroll.js, pdfEncryption.js,
pdfGenerator.js, permissions.js, persistenceMiddleware.js, pool.js, postgresStore.js,
poVariance.js, quoteCalculation.js, recordTrail.js, reports.js, router.js, schemas.js,
serviceRequestRules.js, setupTokens.js, stateMachine.js, store.js, technicianProfiles.js,
timesheetEligibility.js, timesheetModel.js, timesheetReview.js, timesheetSchemasV2.js,
timesheetWorkflow.js, totp.js, totpPolicy.js, trades.js, v5CommercialWorkflow.js,
v5InvoicePreview.js, v5InvoiceWriter.js, v5InvoiceWriterPolicy.js, v5QuoteRules.js,
v5SignatureEvidence.js, v5SignatureSchemas.js, worksheetRegisterLogic.js, worksheetRegisterSchemas.js
```

### Controllers (56 files in `src/controllers/`)

```
accessRequestsController.js, adminController.js, aiController.js, artisanController.js,
artisanDocumentController.js, authController.js, communicationsController.js,
contractorLogController.js, contractsController.js, coreController.js,
dailyTimesheetController.js, dashboardController.js, dispatchController.js,
documentController.js, feedbackController.js, fileUploadController.js,
fleetComplianceController.js, fleetController.js, ganttSchedulingController.js,
hseController.js, hseQualityController.js, importController.js,
internalWorkRequestsController.js, inventoryController.js, invoiceSettlementController.js,
jobTrackerController.js, kioskController.js, leaveController.js,
legacyInvoiceDraftController.js, makerCheckerController.js, notificationController.js,
operationalDataController.js, operationalDocumentsController.js, procurementController.js,
quoteController.js, reorderAlertController.js, reportsController.js,
salesPortfolioController.js, serviceRequestsController.js, surveyController.js,
syncController.js, technicianProfilesController.js, technicianRegistrationController.js,
technicianSettlementController.js, telemetryController.js,
timesheetAcknowledgementController.js, timesheetReviewController.js,
timesheetWorkflowController.js, totpController.js, trailController.js,
v5AmendmentEvidenceAllocationController.js, v5AmendmentLinkController.js,
v5InvoicePreviewController.js, v5InvoiceWriterController.js,
v5MaterialAllocationController.js, v5SignatureController.js, worksheetRegisterController.js
```

### Services (20 files in `src/services/`)

```
aiKnowledgeBase.js, aiTemplates.js, aiWorkflowAssistant.js, aiWorkflowKnowledge.js,
artisanDocumentService.js, clientPrService.js, communicationAuditService.js,
communicationQueueService.js, communicationTemplateService.js, entityHierarchy.js,
expiryWatcherService.js, fileUploadService.js, fleetComplianceService.js,
ganttSchedulingService.js, googleOAuthService.js, hseQualityService.js,
iotTelemetryService.js, knowledgeBase.js, leaveService.js, makerCheckerService.js,
masterDataService.js, meetingAiService.js, offlineSyncService.js, qbrReportService.js,
qrCodeService.js, reorderAlertService.js, structuredLoggingService.js,
threeWayMatchingService.js, videoMeetingService.js
```

### Middleware (6 files in `src/middleware/`)

```
auth.js, clientScope.js, cors.js, rateLimit.js, securityHeaders.js, validate.js
```

### Prematurely Created (Additive, Unused, No Breakage)

```
src/shared/errors/AppError.js, AuthenticationError.js, BusinessRuleError.js,
  ConflictError.js, ForbiddenError.js, NotFoundError.js, ValidationError.js, index.js
src/shared/base/BaseController.js, BaseModel.js, BaseService.js, index.js
src/shared/utils/ (empty directory)
```

> [!WARNING]
> **BaseService.js uses Maps** but `store.js` uses **arrays**. Must be rewritten before wiring.

### Other Directories
- `src/commands/` — `reconcileCommercialOwnership.js`
- `src/importers/` — `csvText.js`, `masterDataImport.js`

### Key File Sizes
- **`router.js`**: 636 lines (all routes wired, CRLF line endings)
- **`schemas.js`**: 988 lines of Zod schemas
- **`permissions.js`**: 12 roles + ~70 permission keys
- **`store.js`**: Seeds demo data, array-based collections

### Tests: 205 test files in `tests/`

---

## 3. FRONTEND CODEBASE INVENTORY {#3-frontend-inventory}

**Path:** `D:\Projects\ORAC-WORKSPACE\2-portal-frontend\orac-ios-frontend`

- **155 files** total
- **~38 pages** built
- **API Client:** `src/api/client.js` — 1,100+ lines covering 23 subsystem modules
- **Package.json:** 3 deps (react, react-dom, react-router-dom), 8 devDeps
- **Scripts:** 20+ including dev, build, test, UAT audit, UX checks

### Frontend API Modules (23 total in client.js)
auth, quotes, collections, dispatch, timesheets, worksheets, invoices, reports, inventory, fleet, hse, artisans, surveys, feedback, qr, telemetry, sync, admin, notifications, documents, internalWorkRequests, communications, serviceRequests, contracts

---

## 4. THE 13-ROLE CREDENTIAL MATRIX {#4-roles}

### Current State in `permissions.js` (12 Roles Defined)

```javascript
export const roles = {
  ADMIN: "Admin",
  MANAGEMENT: "Management",
  SALES: "Sales",
  OPERATIONS: "Operations",
  TECHNICIAN: "Technician",
  SUPERVISOR: "Supervisor",
  FINANCE: "Finance",
  CLIENT_VIEWER: "Client Viewer",
  PROCUREMENT: "Procurement & Stores",    // Added 2026-11-17
  FLEET: "Fleet & Facilities",            // Added 2026-11-17
  HSE: "HSE & Quality",                   // Added 2026-11-17
  HR: "Human Resources"                   // Added 2026-11-17
};
```

### Missing 13th Role: `PUBLIC_PROSPECT` — NOT YET ADDED

### Seeded Demo Users in `store.js` (8 of 13)

| # | User ID | Email | Role | Password | Notes |
|---|---------|-------|------|----------|-------|
| 1 | `u_admin` | `admin@orac.co.zw` | Admin | `password123` | Full access |
| 2 | `u_management` | `management@orac.co.zw` | Management | `password123` | Executive KPIs |
| 3 | `u_sales` | `sales@orac.co.zw` | Sales | `password123` | CRM, quotes |
| 4 | `u_finance` | `finance@orac.co.zw` | Finance | `password123` | Invoicing, PO verify |
| 5 | `u_ops` | `ops@orac.co.zw` | Operations | `password123` | Dispatch, scheduling |
| 6 | `u_tech` | `tech@orac.co.zw` | Technician | `password123` | Field worksheets (trade: Fitter) |
| 7 | `u_supervisor` | `supervisor@orac.co.zw` | Supervisor | `password123` | Site sign-offs |
| 8 | `u_client` | `client@orac.co.zw` | Client Viewer | `password123` | Scoped to `c_example_north` |

### NOT YET SEEDED (5 new roles):

| # | Proposed User ID | Email | Role | Status |
|---|-----------------|-------|------|--------|
| 9 | `u_procurement` | `procurement@orac.co.zw` | Procurement & Stores | **TO ADD** |
| 10 | `u_fleet` | `fleet@orac.co.zw` | Fleet & Facilities | **TO ADD** |
| 11 | `u_hse` | `hse@orac.co.zw` | HSE & Quality | **TO ADD** |
| 12 | `u_hr` | `hr@orac.co.zw` | Human Resources | **TO ADD** |
| 13 | `u_prospect` | `prospect@orac.co.zw` | Public Prospect | **TO ADD** (role + user) |

### Permission Keys Gap: Roles 9-12 have ZERO permission keys assigned
The 4 new roles (PROCUREMENT, FLEET, HSE, HR) appear in the roles enum but have zero `permissions[key]` entries that include them. They are decorative until wired.

---

## 5. THE 37-ITEM CONFIGURATION MATRIX {#5-configurations}

### Summary: 30 run on zero-cost defaults. 7 external keys needed for live cloud.

### Current `.env.example` (what actually exists today — 29 lines):
```
NODE_ENV, PORT, STORE_DRIVER, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN,
ORAC_REQUIRE_PASSWORD, ORAC_REQUIRE_APPROVED_TAX, CORS_ORIGINS,
TRUST_PROXY_HOPS, RATE_LIMIT_DISABLED, ORAC_TOTP_* (3 items),
ORAC_V5_COMMERCIAL_WORKFLOW, ORAC_V5_INVOICE_WRITER
```

### What `.env.example` is MISSING (must be added):
```
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL,
SESSION_SECRET, ALLOWED_GOOGLE_DOMAINS,
DAILY_API_KEY, DAILY_DOMAIN, ANTHROPIC_API_KEY, AI_TRANSCRIPTION_MODEL,
SURVEY_RECORDING_STORAGE,
COMMUNICATIONS_DRY_RUN, ORAC_OUTBOUND_EMAIL_ENABLED,
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL,
STORAGE_DRIVER, UPLOAD_MAX_FILE_SIZE_MB, SUPABASE_URL, SUPABASE_KEY,
PR_APPROVAL_THRESHOLD_USD, PO_VARIANCE_TOLERANCE_PERCENT,
CERT_EXPIRY_ALERT_DAYS, FLEET_FUEL_CONSUMPTION_THRESHOLD,
PASTEL_VAT_ACCOUNT_CODE, FEEDBACK_SURVEY_AUTO_DISPATCH,
COMPANY_CURRENCY
```

### The 7 External Keys Needed for Full Live Deployment:
1. `GOOGLE_CLIENT_ID` — Google Cloud Console (Free)
2. `GOOGLE_CLIENT_SECRET` — Google Cloud Console (Free)
3. `DAILY_API_KEY` — Daily.co (Free: 10,000 mins/mo)
4. `ANTHROPIC_API_KEY` — Claude API (Paid per token)
5. `SMTP_HOST` — Company mail server
6. `SMTP_USER` — Company email account
7. `SMTP_PASS` — Company email password

---

## 6. ARCHITECTURE DECISIONS (AGREED) {#6-architecture-decisions}

| ID | Decision | Status |
|----|----------|--------|
| **D1** | Two Clean Production Systems (ZERO WordPress): 1) Public marketing website (`orac-systems-demo` deployed to Vercel, repo `brianlupao123/Orac-system-web`), and 2) Operational ERP system (`orac-ios` monorepo: backend on Fly.io, portal on Render). | ✅ AGREED (Clarified 19 Nov 2026) |
| **D2** | `orac-systems-demo` is a SEPARATE React application, deployed differently (Vercel), whose forms and booking engine rely on the `orac-backend` API over HTTP (`POST /api/leads`). | ✅ AGREED |
| **D3** | Demo standalone Express server (`orac-systems-demo/server/`) is completely RETIRED — all public endpoints are served by `orac-backend/src/modules/public/`. | ✅ AGREED |
| **D4** | All public intake → `POST /api/leads` and `POST /api/public/enquiries` on ORAC-backend | ✅ AGREED |
| **D5** | `POST /api/access-requests` is public (Client Viewer only on public form) | ✅ AGREED |
| **D6** | Public chat & enquiry intake → Native in modern React frontend & backend routes (no WordPress embed required) | ✅ AGREED (Clarified 19 Nov 2026) |
| **D7** | Survey booking = Lead with requested datetime until backend calendar exists | ✅ AGREED |
| **D8** | No parallel databases (quotes, bookings, clients) | ✅ AGREED |
| **D9** | Backend uses ESM (`import`/`export`) throughout | ✅ AGREED |
| **D10** | Only 5 npm deps (bcrypt, express, jsonwebtoken, pg, zod) | ✅ AGREED |
| **D11** | `store.js` uses arrays, NOT Maps — all code must match this | ✅ AGREED |
| **D12** | `router.js` has CRLF endings — use PowerShell for edits | ✅ AGREED |
| **D13** | `routeInventory.test.js` will break if router structure changes — guard it | ✅ AGREED |
| **D14** | USD-only billing (S-08 tripwire) | ✅ AGREED |
| **D15** | Absorb integration kit INTO main backend then drop `orac-ios-integration` | ✅ AGREED |
| **D16** | Zero test regressions at every step | ✅ AGREED |
| **D17** | No new npm dependencies without discussion | ✅ AGREED |
| **D18** | **Unified Operations Monorepo:** Exactly ONE single Git repository (`orac-ios/`) consolidating the **TWO** operational repositories (`orac-backend/` + `orac-ios-frontend/`). Backend deploys to Fly.io, Portal deploys to Render. `orac-systems-demo` remains a separate repository on Vercel connecting via HTTP. | ✅ AGREED (18 Nov 2026, Confirmed 19 Nov 2026) |

---

## 7. PUBLIC WEB INTEGRATION SOLUTION {#7-public-web-integration}

### The 6 PUBLIC_WEB Documents (at `D:\Projects\orac-systems-operational\`)

| Document | Key Content |
|----------|-------------|
| `PUBLIC_WEB_INTEGRATION_BOUNDARY.md` (v2.0) | 6 strict boundary rules: no auto-dispatch, chat isolation, PO evidence only, access request approval, no unsupported promises, survey = requested time only |
| `PUBLIC_WEB_REUSE_MAP.md` (v2.0) | 10-row source-backed mapping: every public feature → existing backend handler |
| `PUBLIC_WEB_PHASED_PLAN.md` (v2.0) | 5-phase roadmap: P0 Handshake → P1 Local Lead Ingress → P2 Access Requests → P3 Client Portal → P4 Scheduling Engine → P5 Production Hardening |
| `PUBLIC_WEB_SECURITY_AND_DATA_SCOPE.md` (v2.1) | Dual-baseline verification, fictional test fixtures (.invalid TLD), port 5050, rate limiting, dispatch mechanism verification |
| `PUBLIC_WEB_CONTRACT_SNAPSHOTS.md` (v2.0) | Schema snapshots of CreateLeadSchema, ClientSubmitPoSchema, VerifyPoSchema, Access Request schema |
| `PUBLIC_WEB_ARCHITECTURE_CLARIFICATION.md` (v1.0) | Historical October 2026 draft: superseded by Brian's confirmation that NO WordPress is used and the public site is the modern React application itself (`LandingPage.jsx` at `/`) |

### Ingress Route Matrix

| Route | Status | Handler |
|-------|--------|---------|
| `POST /api/leads` | **EXISTS (Public)** | `coreController.js:createLead` |
| `POST /api/access-requests` | **EXISTS (Public)** | `accessRequestsController.js:createAccessRequest` |
| `POST /api/quotes/:id/client-po` | **EXISTS (Protected)** | `quoteController.js:submitClientPo` |
| `GET /api/public/slots` | **TO BUILD** (from integration kit) | `websiteController.js:getPublicSlots` |
| `POST /api/public/enquiries` | **TO BUILD** (from integration kit) | `websiteController.js:createWebsiteEnquiry` |

---

## 8. INTEGRATION KIT: FILES TO ABSORB {#8-integration-kit}

**Source:** `D:\Projects\orac-systems-operational\integration-kit\orac-ios-integration-kit\`

### Source Code Files (Copy into main backend)

| Kit File | Target in Restructured Backend | Purpose |
|----------|-------------------------------|---------|
| `backend/src/booking/schedule.js` | `src/modules/public/services/scheduleService.js` | Harare UTC+2 calendar, slot capacity, lead times, blocked dates |
| `backend/src/booking/bookingState.js` | `src/modules/public/services/bookingStateService.js` | Atomic slot mutex (passed 25-way race test) |
| `backend/src/booking/leadMapper.js` | `src/modules/public/services/leadMapperService.js` | Maps public forms → internal Lead |
| `backend/src/booking/validateEnquiry.js` | `src/modules/public/schemas/enquirySchema.js` | Public enquiry Zod validation |
| `backend/src/controllers/websiteController.js` | `src/modules/public/controllers/websiteController.js` | 6 endpoints: public slots, enquiries, booking settings, booking status |
| `backend/src/middleware/publicRateLimit.js` | `src/middleware/publicRateLimit.js` | Pre-persistence rate limiter |

### Test Files (Copy into main tests)

| Kit Test | Tests |
|----------|-------|
| `website-booking.test.js` | Slot booking, 25-way race condition, duplicate prevention |
| `website-leadMapper.test.js` | Form → Lead mapping |
| `website-rateLimit.test.js` | Rate limit enforcement |
| `website-schedule.test.js` | Harare timezone, capacity, blocked dates |
| `website-validateEnquiry.test.js` | Input validation |

### Patches to Apply

| Patch | What It Does |
|-------|-------------|
| `patches/permissions.patch.txt` | Adds `manageBookings` and `manageBookingSettings` permission keys |
| `patches/router.patch.txt` | Adds 6 new routes: 2 public + 4 staff booking management |
| `patches/server.patch.txt` | Adds `publicRateLimit` before persistence middleware, `trust proxy`, rate limits on 6 endpoints |

---

## 9. EIGHT BACKEND↔FRONTEND ROUTE MISMATCHES {#9-route-mismatches}

| ID | Frontend Calls | Backend Has | Fix Required |
|----|----------------|-------------|--------------|
| **M1** | `/fleet/vehicles` | `/fleet/odometer/*`, `/fleet/compliance/*` | Align or add vehicle CRUD routes |
| **M2** | `/hse/incidents`, `/hse/ppe-checklists`, `/hse/toolbox-talks` | `/hse/jsa/*`, `/hse/inspections/*` | Align naming or add missing endpoints |
| **M3** | `/artisans/qualifications`, `/artisans/inductions` | `/artisan/documents/*` | Align or extend artisan routes |
| **M4** | `/surveys/book` | `videoMeetingService.js` exists, routes may not match | Absorb integration kit survey booking |
| **M5** | `/feedback` | `qbrReportService.js` exists, routes missing | Wire feedback routes |
| **M6** | `/qr/generate` | `qrCodeService.js` exists, routes missing | Wire QR routes |
| **M7** | `/telemetry/ingest` | `iotTelemetryService.js` exists, routes missing | Wire telemetry routes |
| **M8** | `/sync/batch` | `offlineSyncService.js` exists, routes missing | Wire offline sync routes |

---

## 10. SECURITY GAPS & MISSING INFRASTRUCTURE {#10-security-gaps}

### Critical Security Gaps

| # | Gap | Severity | Current State |
|---|-----|----------|---------------|
| **S1** | ZERO route-level authorization | 🔴 CRITICAL | `permissions.js` defines 70 keys but `router.js` has 0 `requirePermission` calls |
| **S2** | Missing `PUBLIC_PROSPECT` role | 🟡 MEDIUM | 12 roles exist, 13th not added |
| **S3** | 4 new roles have 0 permission keys | 🟡 MEDIUM | PROCUREMENT, FLEET, HSE, HR are decorative |
| **S4** | Structured logging not wired | 🟡 MEDIUM | Service built but not in server.js middleware |
| **S5** | No `errorHandler.js` middleware | 🟡 MEDIUM | 6-line catch-all in server.js |
| **S6** | No public rate limiting on main backend | 🟡 MEDIUM | Integration kit has the solution |
| **S7** | `getActor()` falls back to `users[0]` for public | 🟡 MEDIUM | Public leads attributed to Admin |

### Missing Infrastructure

| # | Infrastructure | Status |
|---|---------------|--------|
| **I1** | Global error handler middleware | Prematurely created (`src/shared/errors/`) but not wired |
| **I2** | Role guard middleware | NOT created |
| **I3** | Audit logger middleware | NOT created |
| **I4** | Base classes | Prematurely created (`src/shared/base/`) — BaseService needs Map→Array fix |
| **I5** | `.env.example` incomplete | Missing 20+ config entries |

---

## 11. ALL ARCHITECTURE DOCUMENTS INDEX {#11-documents-index}

### In Artifact Directory (`C:\Users\BRIAN LUPAO\.gemini\antigravity\brain\796e2400-706b-49a0-8424-2f8af0202094\`)

| Document | Content |
|----------|---------|
| `ORAC_FINAL_AUDIT_AND_RESTRUCTURE_PLAN.md` | Comprehensive audit: inventory, gaps, 10 recommendations, Sprint A-G |
| `ORAC_RESTRUCTURE_IMPLEMENTATION_PLAN.md` | 17 decisions (D1-D17), Sprint A-G breakdown |
| `ORAC_FULLSTACK_LAYER_GAP_ANALYSIS.md` | Backend layer analysis: what exists vs what's missing |
| `ORAC_ENTERPRISE_FOLDER_ARCHITECTURE.md` | Target folder structure with all professional layers |
| `ORAC_HONEST_TRACKER_CORRECTED_20261117.md` | Corrected completion tracker |
| `ORAC_ADVANCED_ENTERPRISE_SYSTEMS_BENCHMARK_20261117.md` | 7 infrastructure dimensions benchmark |
| `ORAC_MASTER_QR_AND_ECOSYSTEM_HARDENING_DOSSIER_20261117.md` | QR code system across 7 operational roles |
| `ORAC_UNIFIED_WORLD_CLASS_ARCHITECTURE_AND_HARVEST_BENCHMARK_20261117.md` | wachiye-repos harvest, 4-system benchmark |
| `ORAC_WORLD_CLASS_UI_UX_AND_ROLE_WIRING_BLUEPRINT_20261117.md` | 13-role dashboards |
| **THIS DOCUMENT** | Master memory & single source of truth |

### In `D:\Projects\orac-systems-operational\`

| Document | Content |
|----------|---------|
| `PUBLIC_WEB_INTEGRATION_BOUNDARY.md` | Strict ingress/egress rules (v2.0) |
| `PUBLIC_WEB_REUSE_MAP.md` | Component → backend mapping (v2.0) |
| `PUBLIC_WEB_PHASED_PLAN.md` | 5-phase roadmap (v2.0) |
| `PUBLIC_WEB_SECURITY_AND_DATA_SCOPE.md` | Security spec & test matrix (v2.1) |
| `PUBLIC_WEB_CONTRACT_SNAPSHOTS.md` | Schema snapshots (v2.0) |
| `PUBLIC_WEB_ARCHITECTURE_CLARIFICATION.md` | 2-app architecture verdict (v1.0) |

### In Backend Root (`C:\Users\BRIAN LUPAO\Desktop\ffims-asset-register\two-concept-packet-backend-20261005-235259\`)

| Document | Content |
|----------|---------|
| `ORAC_UNIFIED_WORLD_CLASS_ARCHITECTURE_AND_HARVEST_BENCHMARK_20261117.md` | Copy of harvest benchmark |

---

## 12. STANDING RULES (NON-NEGOTIABLE) {#12-standing-rules}

1. **Zero Regressions:** All existing tests must pass at every step
2. **Single Source of Truth for Stock:** `quantity_on_hand` mutated ONLY via `applyStockChange` in `inventoryLedger.js`
3. **Tripwire Compliance:** `noOutboundEmailGuard`, `directSaleSeamGuard`, `normalizeDbProductionGuard`
4. **S-08:** USD-only billing across all financial line items
5. **Git Safety:** NEVER push to git remotes without explicit confirmation from Brian
6. **Tracker Rule 8:** No item marked DONE without File Path + Line Number + Passing Test Name
7. **No dependencies added** to the PDF generator — must remain dependency-free
8. **Honest reporting:** Do NOT claim 100% completion
9. **Router.js edits:** Use PowerShell `[System.IO.File]::ReadAllText()` approach for CRLF
10. **ESM only:** All new files must use `import`/`export`
11. **"proceed" means:** Follow established build order without asking
12. **No new npm dependencies without discussion/approval**
13. **Store uses arrays** — all services must use array patterns (`find`, `filter`, `push`), NOT Maps
14. **Discussion mode** until Brian agrees — no implementation until then

---

## 13. ACCOUNTABILITY REGISTER {#13-accountability}

### What Brian Must Provide/Decide:
1. ☐ **Approve the restructure plan** before implementation begins
2. ☐ **7 Cloud Secrets** (when ready for live deployment): Google OAuth (2), Daily.co (1), Claude API (1), SMTP (3)
3. ~~WordPress admin access~~ (RETIRED — No WordPress used; public web is native React in `orac-ios-frontend`)
4. ☐ **Confirm survey workflow**: Lead workaround vs proper calendar module
5. ☐ **Written authorization** for email OTP (S-03 tripwire)
6. ☐ **Pastel CSV format verification** with accountant

### What the Agent Must Do (After Brian Approves):
1. ☐ Add `PUBLIC_PROSPECT` role to `permissions.js`
2. ☐ Seed 5 new demo users in `store.js` (Procurement, Fleet, HSE, HR, Public Prospect)
3. ☐ Add permission keys for 4 new operational roles
4. ☐ Fix `BaseService.js` (Map → array pattern)
5. ☐ Wire global error handler in `server.js`
6. ☐ Update `.env.example` with all 37 config items
7. ☐ Absorb integration kit files (booking engine, rate limiter, websiteController)
8. ☐ Split `router.js` (636 lines) into per-module routes
9. ☐ Split `schemas.js` (988 lines) into per-module schemas
10. ☐ Wire `requirePermission` on EVERY route
11. ☐ Fix 8 route mismatches (M1-M8)
12. ☐ Wire structured logging as middleware
13. ☐ Modularize flat src/ into `src/modules/<domain>/`
14. ☐ Run full test suite after every step (205 test files)

### BLOCKED Items (7):
1. Email OTP via SMTP — needs Brian's written authorization
2. Daily.co video rooms — needs API key + billing
3. Real sensor data (MQTT/OPC-UA) — hardware
4. Socket.IO/SSE push — infrastructure decision
5. Native mobile app — separate codebase
6. PWA service worker — offline strategy decision
7. Pastel CSV format — needs Brian's accountant

---

## 14. TARGET RESTRUCTURED FOLDER ARCHITECTURE {#14-target-structure}

```
src/
├── config/                              # Centralized configuration
│   ├── index.js                         # Master config (absorbs current config.js)
│   ├── database.js                      # DB connection setup
│   └── constants.js                     # Business rule thresholds
│
├── shared/                              # Cross-cutting reusable code
│   ├── errors/                          # ✅ ALREADY CREATED (7 files)
│   │   ├── AppError.js
│   │   ├── ValidationError.js
│   │   ├── AuthenticationError.js
│   │   ├── ForbiddenError.js
│   │   ├── NotFoundError.js
│   │   ├── ConflictError.js
│   │   ├── BusinessRuleError.js
│   │   └── index.js
│   ├── base/                            # ✅ ALREADY CREATED (needs Map→Array fix)
│   │   ├── BaseController.js
│   │   ├── BaseService.js               # ⚠️ NEEDS FIX: uses Maps, store uses arrays
│   │   ├── BaseModel.js
│   │   └── index.js
│   └── utils/                           # TO BUILD
│       ├── dates.js
│       ├── currency.js
│       ├── pagination.js
│       ├── sanitize.js
│       ├── crypto.js
│       └── id.js
│
├── middleware/                           # Global middleware
│   ├── auth.js                          # ✅ EXISTS
│   ├── clientScope.js                   # ✅ EXISTS
│   ├── cors.js                          # ✅ EXISTS
│   ├── rateLimit.js                     # ✅ EXISTS
│   ├── securityHeaders.js               # ✅ EXISTS
│   ├── validate.js                      # ✅ EXISTS
│   ├── errorHandler.js                  # TO BUILD (replace 6-line catch-all)
│   ├── roleGuard.js                     # TO BUILD
│   ├── auditLogger.js                   # TO BUILD
│   └── publicRateLimit.js               # FROM INTEGRATION KIT
│
├── modules/                             # Domain-grouped business modules
│   ├── commercial/                      # Quotes, Leads, Invoices, Contracts
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── operations/                      # Dispatch, Worksheets, Timesheets, Gantt
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── procurement/                     # PRs, POs, 3-Way Matching, Suppliers
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── fleet/                           # Vehicles, Odometer, Fuel, COF/ZINARA
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── hse/                             # JSA, Incidents, PPE, Inspections
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── hr/                              # Artisans, Certifications, Leave
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── finance/                         # Invoices, Payments, Pastel Export
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── admin/                           # Users, Roles, System Config
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── communications/                  # Email, Notifications, Templates
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── surveys/                         # Video meetings, AI minutes, Booking
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── feedback/                        # QBR Reports, NPS, Client Feedback
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── iot/                             # Telemetry Ingestion, Plant Sensors
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   ├── uploads/                         # File Upload, Document Storage
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   └── routes/
│   └── public/                          # ← ABSORBS INTEGRATION KIT
│       ├── controllers/
│       │   └── websiteController.js     # FROM integration kit
│       ├── services/
│       │   ├── scheduleService.js       # FROM integration kit (schedule.js)
│       │   ├── bookingStateService.js   # FROM integration kit (bookingState.js)
│       │   └── leadMapperService.js     # FROM integration kit (leadMapper.js)
│       ├── schemas/
│       │   └── enquirySchema.js         # FROM integration kit (validateEnquiry.js)
│       └── routes/
│           ├── publicRoutes.js          # /api/public/slots, /api/public/enquiries
│           └── staffBookingRoutes.js    # /api/admin/booking-settings, /api/bookings
│
├── store/                               # Data layer (keep existing, modularize later)
│   ├── store.js                         # ✅ EXISTS (array-based collections)
│   ├── configuredStore.js               # ✅ EXISTS
│   ├── postgresStore.js                 # ✅ EXISTS
│   └── persistenceMiddleware.js         # ✅ EXISTS
│
├── router.js                            # Mount-only hub (delegates to module routes)
├── schemas.js                           # SPLIT into per-module schemas (Phase B)
└── permissions.js                       # ✅ EXISTS (needs 13th role + new permission keys)
```

---

> [!IMPORTANT]
> **This document is the SINGLE SOURCE OF TRUTH.** If any other document contradicts this one, THIS ONE wins. Update this document first whenever a decision changes.
