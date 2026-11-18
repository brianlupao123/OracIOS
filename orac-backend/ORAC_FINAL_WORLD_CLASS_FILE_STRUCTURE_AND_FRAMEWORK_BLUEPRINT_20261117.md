# ORAC Final World-Class Architecture & File Structure Blueprint
**Date:** 2026-11-17  
**System Owner:** Brian Lupao  
**Engineering Directorate:** Antigravity  
**Benchmark Sources:**
1. `careers.africau.co.zw-main` (Next.js 15, Drizzle ORM, Better-Auth, Shadcn UI)
2. `FFIMS` (`ffims_backend` + `ffims_frontend`: 22 Modular Subsystems)
3. `1-feedback-system` (`api` clean Express MVC + `client` React/Redux)
4. `wachiye-repos` (30 Repositories: Clean Architecture, Vertical Slices, Node-TS Sequelize)

---

## 1. The Framework Verdict: React (Vite) vs. Next.js 15

### Evaluation Matrix

| Architectural Criterion | Current ORAC (React 18/19 + Vite) | Africa University (Next.js 15 App Router) | Industrial ERP Verdict |
| :--- | :--- | :--- | :--- |
| **Development & HMR Speed** | **Instant (10–50ms)** via ES modules | **Slower (1–4s)** on large Turbopack trees | **Winner: Vite** (Critical for rapid maintenance) |
| **Client-Side Operational State** | **Seamless** (Real-time WebSockets, WebRTC video, canvas drawing, complex timesheet matrix) | **Complex hydration** (Server vs. Client components, `"use client"` friction) | **Winner: Vite / React SPA** |
| **Offline PWA & Mobile Compilation** | **Native** (Service workers, easily wrapped in Capacitor / Expo for mine tablets) | **Edge/Server bound** (Requires live Node/Edge runtime for server actions) | **Winner: Vite / React SPA** |
| **Public Website SEO & Landing** | Basic client-rendered SPA | **Exceptional** (Server-Side Rendering, metadata, fast FCP for anonymous web) | **Winner: Next.js** |
| **Migration Risk to Existing Code** | **Zero Risk** (2,540 tests passing, 35 pages working) | **High Risk** (Rewriting React Router hooks `useNavigate` $\rightarrow$ `useRouter` across 35 pages) | **Winner: Vite** |

### The Professional Recommendation: The Enterprise Decoupled Model

**DO NOT rewrite ORAC’s core operations portal into Next.js.**  
High-performance operations platforms (Stripe Dashboard, Linear, AWS Console, Figma) run as **decoupled React SPAs** because they are interactive applications, not content blogs.

**The Optimal Setup:**
1. **Back-Office Operations & Field Portal (The 8+ Subsystems):** Keep on **Vite + React 18/19 SPA**. It delivers desktop-grade speed, zero SSR hydration bugs, instant WebRTC video calling (`Daily.co`), and direct compatibility with native offline mobile wrappers.
2. **Public Intake & Customer Marketing Website (`orac.co.zw`):** Can be served as a lightweight **Next.js** static/SSR surface (or clean Vite landing page) that talks to the same unified ORAC backend API.

---

## 2. Gap Analysis: What Is Missing in ORAC's Current Folders?

Benchmarking current ORAC against `1-feedback-system`, `FFIMS`, and `wachiye-repos`:

### Backend Gap Analysis

| Standard Folder | Current ORAC Status | What Is Missing / Why We Need It | Benchmark Source |
| :--- | :---: | :--- | :--- |
| **`backend/src/routes/`** | ❌ **MISSING** | Currently, all 433 lines of routes sit in **one giant `router.js`**. As we add Fleet, HSE, and Procurement, `router.js` will become an unmaintainable 2,000-line bottleneck. We need a dedicated `routes/` directory split by domain (`commercial.routes.js`, `fleet.routes.js`, etc.). | `1-feedback-system/api/routes` |
| **`backend/src/models/`** | ❌ **MISSING** | Data schemas sit scattered across `store.js`, `schemas.js`, and `postgresStore.js`. We need a centralized `models/` directory containing clean entity schemas and relational validation rules. | `1-feedback-system/api/models` & `FFIMS/models` |
| **`backend/src/services/`** | ⚠️ **PARTIAL** | Only `aiService.js` is in `services/`. Critical domain engines (`pdfGenerator.js`, `quoteCalculation.js`, `invoiceReadiness.js`, `payroll.js`) sit loose in `src/`. Moving them into `services/` encapsulates business math away from controllers. | `wachiye-repos` & `1-feedback-system` |
| **`backend/src/utils/` (or `lib/`)** | ❌ **MISSING** | Utility helpers (`businessTimezone.js`, `idempotency.js`, `dbUrl.js`) sit loose in `src/`. | `1-feedback-system/api/utils` |
| **`backend/src/config/`** | ❌ **MISSING** | `config.js` sits loose in `src/`. Needs dedicated folder for DB, OAuth, and Mail configs. | `1-feedback-system/api/config` |

### Frontend Gap Analysis

| Standard Folder | Current ORAC Status | What Is Missing / Why We Need It | Benchmark Source |
| :--- | :---: | :--- | :--- |
| **`frontend/src/context/`** | ❌ **MISSING** | No reactive global context for auth, active session, and real-time alerts. Components read localStorage manually. | `1-feedback-system/client/src/context` & `portfolio` |
| **`frontend/src/hooks/`** | ❌ **MISSING** | No custom reusable React hooks (`useAuth`, `usePermissions`, `useJobTracker`). | `careers/src/hooks` & `1-feedback` |
| **`frontend/src/services/`** | ❌ **MISSING** | API requests are made directly in components or through generic `client.js`. Domain services (`quoteService.js`, `fleetService.js`) decouple UI from network endpoints. | `1-feedback-system/client/src/services` |
| **Component Grouping by Subsystem** | ⚠️ **PARTIAL** | All 52 components sit flat in `src/components/`. Grouping them into domain subfolders (`components/commercial/`, `components/fleet/`, `components/hse/`) prevents directory clutter. | `careers/src/components` |

---

## 3. The Target World-Class File Structure

Here is the ultimate, clean, scalable architecture combining the best of all 4 ecosystems:

### Target Backend Structure (`backend/`)
```
backend/
├── fly.toml
├── package.json
├── server.js
├── src/
│   ├── config/                          <-- Centralized environment & provider configs
│   │   ├── app.config.js
│   │   ├── database.config.js
│   │   ├── google.config.js (from portfolio)
│   │   └── mail.config.js (from AU Careers)
│   │
│   ├── routes/                          <-- Split domain routing (replaces giant router.js)
│   │   ├── index.js                     <-- Root router mounting all domain routes
│   │   ├── auth.routes.js
│   │   ├── commercial.routes.js
│   │   ├── operations.routes.js
│   │   ├── procurement.routes.js        <-- Harvested from FFIMS
│   │   ├── fleet.routes.js              <-- Harvested from FFIMS
│   │   ├── hse.routes.js                <-- Harvested from FFIMS
│   │   ├── hr.routes.js                 <-- Harvested from AU Careers + FFIMS
│   │   ├── finance.routes.js
│   │   ├── survey.routes.js             <-- Harvested from MediVital
│   │   └── feedback.routes.js           <-- Harvested from 1-Feedback
│   │
│   ├── controllers/                     <-- Clean HTTP request/response handlers
│   │   ├── commercial/
│   │   │   ├── quoteController.js
│   │   │   ├── contractsController.js
│   │   │   └── jobTrackerController.js
│   │   ├── operations/
│   │   │   ├── dispatchController.js
│   │   │   ├── dailyTimesheetController.js
│   │   │   └── worksheetRegisterController.js
│   │   ├── procurement/
│   │   │   ├── procurementController.js
│   │   │   └── inventoryController.js
│   │   ├── fleet/
│   │   │   └── fleetController.js
│   │   ├── hse/
│   │   │   └── hseController.js
│   │   ├── hr/
│   │   │   ├── technicianProfilesController.js
│   │   │   └── hrQualificationsController.js
│   │   ├── finance/
│   │   │   ├── v5InvoiceWriterController.js
│   │   │   ├── invoiceSettlementController.js
│   │   │   └── pastelExportsController.js
│   │   ├── survey/
│   │   │   └── virtualSurveyController.js
│   │   └── feedback/
│   │       └── feedbackController.js
│   │
│   ├── services/                        <-- Pure business logic, math & external SDKs
│   │   ├── quoteCalculationService.js
│   │   ├── invoiceReadinessService.js
│   │   ├── threeWayMatchingService.js
│   │   ├── pdfGeneratorService.js
│   │   ├── videoMeetingService.js       <-- Daily.co WebRTC (from MediVital)
│   │   ├── audioTranscriptionService.js <-- Dash AI meeting transcription
│   │   ├── emailService.js              <-- Nodemailer SMTP (from AU Careers)
│   │   └── pptxExportService.js         <-- PptxGenJS QBR decks (from 1-Feedback)
│   │
│   ├── models/                          <-- Unified data schemas & validation rules
│   │   ├── schemas.js                   <-- Zod validation schemas
│   │   ├── commercial.models.js
│   │   ├── operations.models.js
│   │   ├── procurement.models.js
│   │   ├── fleet.models.js
│   │   ├── hse.models.js
│   │   └── hr.models.js
│   │
│   ├── middleware/                      <-- Security & request pipeline guards
│   │   ├── auth.js
│   │   ├── validate.js
│   │   ├── permissions.js (RBAC 12 roles)
│   │   ├── clientAllowlist.js (Redaction)
│   │   └── idempotency.js
│   │
│   ├── utils/                           <-- Standalone helpers
│   │   ├── businessTimezone.js
│   │   ├── cryptoHelper.js (AES-256-GCM)
│   │   └── formatters.js
│   │
│   └── database/                        <-- Persistence layer
│       ├── store.js (Unified JSON demo store)
│       ├── postgresStore.js (Production SQL)
│       └── pool.js
│
└── tests/                              <-- Automated test suites (3,000+ tests)
```

---

### Target Frontend Structure (`frontend/`)
```
frontend/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── App.jsx
    ├── index.css
    ├── main.jsx
    │
    ├── context/                         <-- Global reactive state
    │   ├── AuthContext.jsx              <-- User session & Google OAuth state
    │   ├── NotificationContext.jsx      <-- Live alert badges
    │   └── VideoMeetingContext.jsx      <-- Active Daily.co room session
    │
    ├── hooks/                           <-- Reusable UI hooks
    │   ├── useAuth.js
    │   ├── usePermissions.js
    │   ├── useJobTracker.js
    │   └── useDebounce.js
    │
    ├── services/                        <-- Domain API services
    │   ├── api.js (Axios / Fetch base client)
    │   ├── commercialService.js
    │   ├── operationsService.js
    │   ├── procurementService.js
    │   ├── fleetService.js
    │   ├── hseService.js
    │   ├── hrService.js
    │   └── surveyService.js
    │
    ├── components/                      <-- Grouped by subsystem domain
    │   ├── common/                      <-- Reusable UI primitives (DataTable, StatCard, Modal)
    │   ├── commercial/                  <-- JobsTrackerPanel, QuoteRevisionDrawer
    │   ├── operations/                  <-- WorksheetGrid, KioskReviewPanel
    │   ├── procurement/                 <-- ThreeWayMatchCard, StockLedgerTable
    │   ├── fleet/                       <-- VehicleCard, TripRosterTable
    │   ├── hse/                         <-- PpeChecklistModal, IncidentBadge
    │   ├── hr/                          <-- QualificationCard, ExpiryAlertBadge
    │   ├── survey/                      <-- DailyVideoRoom, MeetingMinutesBox
    │   └── feedback/                    <-- StarRatingModal, QbrExportButton
    │
    ├── layouts/                         <-- Shell layouts
    │   ├── PortalLayout.jsx (Authenticated Operations Shell)
    │   └── PublicLayout.jsx (Public Landing & Customer Intake Shell)
    │
    └── pages/                           <-- High-level page views
        ├── public/
        │   ├── LandingPage.jsx
        │   ├── ServiceCatalogPage.jsx
        │   └── BookSurveyPage.jsx
        ├── commercial/
        │   ├── QuotationsPage.jsx
        │   ├── ContractsPage.jsx
        │   └── JobsTrackerPage.jsx
        ├── operations/
        │   ├── DashboardPage.jsx
        │   ├── WorksheetsPage.jsx
        │   └── KioskModePage.jsx
        ├── procurement/
        │   ├── ProcurementPage.jsx
        │   └── InventoryPage.jsx
        ├── fleet/
        │   ├── FleetManagementPage.jsx
        │   └── HseCompliancePage.jsx
        ├── hr/
        │   └── HrWorkforcePage.jsx
        ├── finance/
        │   ├── InvoiceReadinessPage.jsx
        │   └── ReportsPage.jsx
        └── admin/
            ├── AdminPage.jsx
            └── AccessRequestsPage.jsx
```

---

## 4. Phased Implementation Strategy: Safe Migration Without Breaking Tests

To transition to this world-class architecture without ever breaking the **2,540 passing tests**:

1. **Step 1 (Zero-Risk Folder Creation):**  
   Create the missing directories (`backend/src/routes/`, `backend/src/services/`, `backend/src/config/`, `frontend/src/context/`, `frontend/src/hooks/`).
2. **Step 2 (Non-Breaking Re-Exports):**  
   When moving loose files (e.g. `pdfGenerator.js` $\rightarrow$ `services/pdfGeneratorService.js`), keep a 1-line re-export stub at the old path so no existing tests break during migration.
3. **Step 3 (Harvest Ingestion):**  
   Add the harvested modules (Fleet, Procurement, HSE, HR, Video Meeting) directly into their respective clean target folders.
4. **Step 4 (Final Cleanup):**  
   Once all test imports are updated and green, remove the backward-compatibility stubs.
