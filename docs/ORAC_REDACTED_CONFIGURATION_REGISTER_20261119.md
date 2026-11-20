# ORAC Redacted Configuration & Integration Register

**Document Date:** 19 November 2026  
**Status:** Canonical Production Baseline (Gap 19 Release Blocker)  
**Applies to:** `D:\Projects\orac-ios`  
**Security Classification:** Redacted (Variable Names, Ownership & Rules Only — Zero Secrets, Keys, or Connection Strings)

---

## 1. Executive Summary & Zero-Secret Protocol

Pursuant to **Gap 19** of the ORAC Production Remediation Scope Addendum, this register provides the definitive specification of all environment variables, system parameters, external integrations, failure behaviors, and audit rules across Fly.io, Render, Vercel, PostgreSQL, and local environments.

### The Zero-Secret Invariant
- **No secret values, tokens, API keys, passwords, or connection strings** are ever stored in source code, commit history, issue trackers, documentation, or client logs.
- This register specifies **variable names, parameter shapes, validation regexes, ownership, and rotation protocols only**.
- Real production values reside exclusively within the respective cloud provider secret managers (Fly Secrets, Render Environment Groups, Vercel Environment Variables).

---

## 2. Redacted Configuration Inventory by Subsystem

### 2.1 Database & Persistence Subsystem

| Variable Name | Environment(s) | Owner | Purpose | Validation Rule & Safe Default | Failure / Fallback Behavior |
|---|---|---|---|---|---|
| `STORE_DRIVER` | Fly (Prod), Staging, Dev | Lead Architect | Controls persistent store engine | Must be `"postgres"` in production. Allowed `"json"` in local dev/tests only. Default: `"json"`. | Server refuses startup with fatal error if `"json"` is detected in `NODE_ENV=production`. |
| `DATABASE_URL` | Fly (Prod), Staging | DBA / Platform Lead | Canonical PostgreSQL connection URI | Redacted URI name. Must begin with `postgres://` or `postgresql://`. TLS enforced (`ssl: { rejectUnauthorized: true }`). | Fails immediately on boot if unset when `STORE_DRIVER=postgres`. Zero silent fallbacks. |
| `PGPASSWORD` | Optional | DBA | PostgreSQL password override | Alphanumeric secret. Redacted. | Used by connection pool if present. |
| `JSON_DB_PATH` | Local Dev / CI | Developer | File path for single-file JSON store | Valid relative or absolute path. Default: `./data/db.json`. | Ignored when `STORE_DRIVER=postgres`. |

#### Database Migration & Recovery Protocol
- **Migration Order:** Strict lexicographical execution of numbered SQL files in `orac-backend/migrations/` (`001_initial_schema.sql`, `002_*.sql`).
- **Backup Schedule:** Daily automated PostgreSQL WAL snapshots managed via Fly/Supabase managed backups with 30-day retention.
- **Restore Rehearsal:** Monthly automated rehearsal restoring into an isolated ephemeral test database.

---

### 2.2 API Security & Authentication Subsystem

| Variable Name | Environment(s) | Owner | Purpose | Validation Rule & Safe Default | Rotation & Custody Procedure |
|---|---|---|---|---|---|
| `JWT_SECRET` | All environments | Security Officer | Signs session authentication JWTs | String $\ge 32$ characters. In production, cannot match development fallback. | Rotated quarterly via blue/green secret rollover with 24-hour token grace period. |
| `JWT_EXPIRES_IN` | All environments | Security Officer | Lifespan of issued session tokens | Standard time string (e.g. `"8h"`, `"24h"`). Default: `"8h"`. | Expiry enforced by JWT verification middleware. |
| `ORAC_REQUIRE_PASSWORD` | Staging, UAT | Security Officer | Enforces strict password verification in non-production | Boolean flag (`"true"` / `"false"`). Forced `true` in `NODE_ENV=production`. | Prevents dev-mode passwordless login on shared demo/UAT instances. |
| `TRUST_PROXY_HOPS` | Fly (Prod), Render | DevOps Lead | Sets Express `trust proxy` hop count | Non-negative integer (e.g. `1` or `2`). Must match ingress reverse proxy depth. | Protects client IP resolution and rate limiters against spoofed `X-Forwarded-For`. |
| `RATE_LIMIT_DISABLED` | Dev / CI Only | DevOps Lead | Disables endpoint rate limiters | Boolean string. Strictly forbidden (`fatal on startup`) in production. | In production, presence of `"true"` immediately halts process boot. |
| `GOOGLE_CLIENT_ID` | All environments | Product Lead | Google OAuth 2.0 Client ID for SSO | Redacted client identifier ending in `.apps.googleusercontent.com`. | When unset, Google SSO returns clean `503 Service Unavailable` without crashing. |
| `ORAC_QR_SECRET` | All environments | Operations Lead | HMAC secret for tamper-proof QR tokens | High-entropy string $\ge 32$ chars. Default provided for dev only. | Rotated semi-annually. Invalidates previously printed optical verification codes. |

---

### 2.3 Portal Frontend (Render / Vite) Subsystem

| Variable Name | Environment(s) | Owner | Purpose | Build vs Runtime Behavior | Failure State |
|---|---|---|---|---|---|
| `VITE_API_BASE_URL` | Render (Prod), Dev | Frontend Lead | API backend root endpoint | Baked at build time by Vite. Must match authorized backend domain. | When API is down, portal renders graceful `PageLoadingSkeleton` / `ErrorBanner` with retry. |
| `VITE_ORAC_BUSINESS_TZ` | All environments | Operations Lead | Canonical operational timezone | String (e.g. `"Africa/Harare"`). Default: `"Africa/Harare"`. | All date/time displays lock to CAT (UTC+2) to prevent timezone drift across mining shifts. |
| `VITE_UAT_STATE_MODE` | Staging / UAT | QA Lead | Toggles UAT state indicator pill | Boolean string (`"enabled"` / `"disabled"`). Default: disabled. | Displays visible UAT indicator in portal header when active. |

---

### 2.4 Communications, Outbound Email & Evidence Engine

| Variable Name | Environment(s) | Owner | Purpose | Validation Rule & Safe Default | Operational Behavior |
|---|---|---|---|---|---|
| `COMMUNICATIONS_DRY_RUN` | All environments | Lead Architect | Outbound mail safety interlock | String: `"true"` or `"false"`. **Default: `"true"`**. | When `"true"`, all outbound emails transition to `Dispatched (Dry Run)` and log durable evidence. Zero live SMTP network calls. |
| `CONTROLLED_RECIPIENT_ALLOWLIST` | Staging / Pilot / Prod | Security Officer | Hard allowlist of approved recipient email addresses | Comma-delimited list of emails. Safe default: `Lupaobrian98@gmail.com,brianwabwile79@gmail.com,lupaob1@gmail.com`. | Any outbound attempt to a recipient outside this allowlist is rejected with HTTP 403 `RECIPIENT_NOT_ALLOWED`. Case-insensitive matching. |
| `SMTP_HOST` | Production, Pilot | DevOps Lead | Outbound SMTP relay hostname | Hostname (e.g. `smtp.gmail.com` or custom relay). Redacted. | Unused while `COMMUNICATIONS_DRY_RUN=true`. Throws `SMTP_CONFIG_MISSING` if live dispatch attempted when unset. |
| `SMTP_PORT` | Production, Pilot | DevOps Lead | Outbound SMTP relay TCP port | Integer: `587` (STARTTLS) or `465` (direct TLS). Default: `587`. | Dictates encryption protocol handshake on connection establishment. |
| `SMTP_SECURE` | Production, Pilot | DevOps Lead | Direct TLS socket switch | Boolean string (`"true"` for port 465, `"false"` for port 587 STARTTLS). Default: `"false"`. | When `"true"`, initiates TLS on immediate connect; when `"false"`, negotiates STARTTLS command upgrade. |
| `SMTP_USER` | Production, Pilot | DevOps Lead | Authenticating sender mailbox user | Valid email address / account name. Redacted. | Used during SMTP AUTH LOGIN handshake. |
| `SMTP_PASS` | Production, Pilot | DevOps Lead | Mailbox provider authentication credential | App-specific password (16 characters) or API token. **Strictly Redacted. Zero Secrets in Docs/Git.** | Base64-encoded during AUTH LOGIN. Never echoed to logs or error messages. |
| `SMTP_FROM` | Production, Pilot | DevOps Lead | Sender mailbox | One bare email address (e.g. `"sender@oracservices.com"`), with no display name or angle brackets. Defaults to `SMTP_USER` when unset. | Used in SMTP `MAIL FROM` and the message From header. Invalid values are refused before sending. |
| `SMTP_CONNECTION_TIMEOUT_MS` | Production, Pilot | DevOps Lead | TCP socket connection & handshake timeout | Integer milliseconds. Default: `10000` (10 seconds). | Prevents event-loop stalls on unreachable or hanging mail relays. |

#### Durable Communication Records Specification (Non-Negotiable)
For **every** outbound communication event (Quote issuance, PO chase, Dispatch alert, Invoice reminder, Password reset, Manual send):
1. **Durable Persistence:** An immutable record is created in `communication_evidence` with:
   - `business_record_type`: (`quote`, `invoice`, `dispatch`, `user`, `po_chase`)
   - `business_record_id`: Target entity primary key
   - `template_version`: Version identifier (e.g. `"v1"`)
   - `subject`: Communication subject line
   - `recipient_email`: Target address
   - `recipient_name`: Client/recipient display name
   - `status`: (`"previewed"`, `"queued"`, `"dispatched"`, `"delivered"`, `"failed"`, `"manual-external"`)
   - `transport_mode`: (`"dry-run"`, `"manual-external"`, `"live-smtp"`, `"none"`)
   - `requested_by` / `recorded_by`: Actor ID
   - `approved_by`: Verifying authority ID (where required)
   - `sent_at` / `recorded_at`: ISO 8601 timestamps
   - `provider_message_id`: Upstream ID (or null)
   - `failure_reason`: Human-readable error description (or null)
2. **External Send Truthfulness:** When sent manually via Outlook or desktop mail, the record is tagged `status: "manual-external"`. ORAC records that the user logged an external send; it **never falsely claims ORAC delivered it**.
3. **Zero Token/Secret Invariant:** Password reset tokens, session credentials, and bank details are strictly scrubbed from communication logs.

---

### 2.5 Password Reset & Identity Delivery Lifecycle

| Parameter | Specification | Compliance Evidence |
|---|---|---|
| **Public Reset URL Base** | `/reset-password` | Verified in `ForgotPassword.jsx` and `authController.js` |
| **Token Lifespan (TTL)** | 60 minutes single-use | Enforced via `accountTokens.js` with SHA-256 token hashing |
| **Anti-Enumeration Response** | Generic success message whether email exists or not | `"If that email has an account, its recovery request has been received."` |
| **Session Invalidation** | Password change terminates all pre-existing JWTs | `user.password_changed_at` timestamp checked in `auth.js` |
| **Delivery Failure Handling** | Durable record persisted with `delivery: "not_configured"`; zero tokens in audit log | Enforced in `authController.js` with `recordCommunicationEvidence()` |

---

### 2.6 Pastel Integration & Accounting Boundary

| Parameter | Production Standard | Guardrails |
|---|---|---|
| **Operating Mode** | **Parallel Mode Only** | ORAC is standalone operational system; Pastel is parallel backup/reconciliation |
| **Export Labelling** | **`[PASTEL PARALLEL MODE — REVIEW ONLY / NOT POSTED]`** | Prominently displayed in UI panel (`PastelParallelReviewPanel.jsx`) and export files |
| **File Naming Convention** | `ORAC_PASTEL_PREVIEW_<CATEGORY>_<DATE>.csv` | Distinct non-posting naming convention |
| **Import / Posting Restriction** | **Zero Automated Posting** | All exports are non-posting review files until accountant signs off with golden sample |
| **Pay Codes & Mappings** | `pastelPayCodes(env)` | Normal, Overtime 1.5, Overtime 2.0 mapped to agreed nominal codes |
| **Reconciliation Custody** | Finance Manager / Chartered Accountant | Monthly parallel review ledger signed by certified accountant |

---

### 2.7 Tax, Currency & Commercial Policy

| Policy | Status / Setting | Production Boundary |
|---|---|---|
| **Billing Currency** | **USD Only** | All quotes, invoices, job cards, and worksheets strictly denominated in USD (`currency: "USD"`). |
| **Overtime Billing Rate** | **Normal Quoted Client Rate** | Billed at normal quoted client hourly rate ($10–$15/hr guidance). No unagreed client multiplier. |
| **VAT Production Rate** | **Unconfigured / Unapproved** | The development fixture rate (15%) is strictly prohibited from production promotion. `ORAC_REQUIRE_APPROVED_TAX=true` halts quote issue until authorized Finance tax decision record is signed. |
| **Invoice Numbering** | `INV-YYYY-XXXX` | Sequential prefix generated server-side upon verified PO clearance. |

---

### 2.8 Contractor Settlement Encryption Subsystem

| Parameter | Setting | Security Protocol |
|---|---|---|
| **Variable Name** | `ORAC_PAYMENT_ENCRYPTION_KEY` | High-entropy 32-byte key (Base64 encoded). Redacted. |
| **Cipher Algorithm** | AES-256-GCM with authenticated tag | Prevents tampering with bank account and EcoCash numbers |
| **Write Permission** | **Admin Only** | All other roles receive `403 Forbidden` (`assertUserUpdateRole()`) |
| **Read Permission** | **Admin & Finance Only** | Audited via `POST /technicians/:id/settlement-details/access` |
| **Audit Payload Rule** | **Zero Values Stored** | Audit logs record actor, timestamp, and field names; **never** plain text or ciphertext values |
| **Key Absence Behavior** | Immediate fail-safe | Returns `503 Service Unavailable`; zero plaintext fallback to database |

---

### 2.9 Dark Feature Flags & Gate Controls

All of the following flags **default to dark (`false` / `disabled`)** in production:

| Flag Name | Area | Activation Prerequisite |
|---|---|---|
| `ORAC_TOTP_PROTECTED_ROLES` | TOTP 2FA | PostgreSQL two-pool concurrency verification, recovery code lifecycle, break-glass admin protocol. |
| `ORAC_TOTP_ENCRYPTION_KEY` | TOTP Secrets | Secure key custody procedure established. |
| `VITE_ORAC_TOTP_ENROLLMENT_UI` | Portal TOTP | Backend TOTP activation confirmed. |
| `ORAC_V5_COMMERCIAL_WORKFLOW` | V5 Engine | Commercial maker-checker sign-off; approved production tax decision. |
| `ORAC_V5_INVOICE_WRITER` | V5 Invoicing | V5 invoice calculation engine implemented and tested against golden fixtures. |
| `VITE_ORAC_V5_COMMERCIAL_WORKFLOW`| Portal V5 | Backend V5 master flag enabled. |
| `TIMESHEET_SALES_ACCESS` | Sales Capture | **STRICTLY PROHIBITED IN PRODUCTION.** Boot halts if `"enabled"` in `NODE_ENV=production`. |
| `ENABLE_DIRECT_SALE_STOCK_ISSUE` | Inventory | Stores controller sign-off. |

---

### 2.10 Advisory AI Safety Boundary

| Policy | Implementation | Guardrail |
|---|---|---|
| **Operational Role** | Advisory / Read-Only | AI acts as a workflow guide; never executes mutations, approvals, or sends. |
| **Data Scope** | Role-Filtered Retrieval | AI queries respect calling user's role permissions; zero cross-role leakage. |
| **Prompt Injection Defense** | System instructions lock context | Refuses off-topic instructions or requests to bypass validation rules. |
| **Fallback Response** | Truthful unknown | Responds `"I cannot verify that from ORAC records"` when data is missing. |

---

### 2.11 Cloud Deployment Parity & Commit Tracking

| Platform | Role | Build Command | Output / Start Command | Rollback Procedure |
|---|---|---|---|---|
| **Fly.io** | Backend API | `docker build` | `node src/server.js` | `fly deploy --image <previous-sha-image>` |
| **Render** | Operations Portal | `npm run build` | Static files (`dist/`) | Rollback to prior successful deploy in Render dashboard |
| **Vercel** | Public Intake & Lead Site | `npm run build` | Static / Edge | Immediate instant rollback in Vercel project deployments |

Every release requires:
1. Monorepo commit SHA match across all three platforms.
2. Full test suite passing in CI (`npm test` backend + frontend).
3. Redacted configuration register verified against cloud secret managers by authorized owner.

---

## 3. Configuration Audit & Verification Checklist

- [x] Variable names catalogued with zero values or secrets disclosed.
- [x] Safe dark defaults configured for all pending/unapproved subsystems (TOTP, V5, Live Email).
- [x] Durable communication records mandated for quote, dispatch, PO, invoice, and reset flows.
- [x] External send logging supported truthfully without claiming automated dispatch.
- [x] Payment encryption AES-256-GCM locked to Admin-write and Admin/Finance audited-read.
- [x] Pastel exports locked to parallel review non-posting mode.
- [x] Single billing currency locked to USD.
- [x] Overtime billing locked to quoted client hourly rate.
