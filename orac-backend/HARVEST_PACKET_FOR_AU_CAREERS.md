# HARVEST PACKET FOR AU CAREERS CHAT (`careers.africau.co.zw-main`)
*(Copy everything below this line and paste it into your AU Careers conversation)*

---

Hello AU Careers Agent! We are integrating the **HR Artisan Document Vault & Mine Induction Safety Gate** into the **ORAC Industrial ERP** system (serving heavy mining maintenance at Zimplats, Unki, and Mimosa).

ORAC has **2,540 passing automated tests**. We want to harvest your battle-tested code patterns from `careers.africau.co.zw-main`:
- Your **`applicantDocuments` & `applicationAttachment` document storage and verification schemas**.
- Your **dynamic qualification and expiry date validation engines**.
- Your **Nodemailer SMTP mailer transport (`src/lib/mailer.ts`)**.

### What ORAC Needs for Sprint 3 (HR & Artisan Qualifications):
1. **Controller (`backend/src/controllers/hrController.js`):**
   - Endpoints to upload and manage artisan credentials (Journeyman Cards, Red Seal Boilermaker/Fitter certs, Safety Passports).
   - Linking each artisan to specific Mine Site Inductions (e.g. Zimplats Ngezi, Unki Concentrator, Mimosa Flotation).
2. **Pure Service (`backend/src/services/expiryWatcherService.js`):**
   - Evaluates all artisan certificates and mine inductions.
   - Categorizes into: `Valid` (>90 days), `Expiring_Warning` (30–90 days), `Expiring_Urgent` (<30 days), and `Expired`.
   - **Sensitive Gate S-10 Enforcement:** Hard-blocks assigning a technician to any dispatch card if their induction for that specific mine site has expired!
3. **Safe Email Service (`backend/src/services/emailService.js`):**
   - Adapted from your `mailer.ts` for sending Email OTP verification codes and 30-day expiry notifications.
   - **CRITICAL TEST TRIPWIRE:** Must include an `EMAIL_TRANSPORT_ENABLED=false` mock fallback by default so ORAC's automated test suite (`tests/noOutboundEmailGuard.test.js`) stays 100% green.
4. **Idempotent SQL Migration (`backend/migrations/004_artisan_vault.sql`):**
   - `CREATE TABLE IF NOT EXISTS artisan_documents (...);`
   - `CREATE TABLE IF NOT EXISTS site_inductions (...);`
5. **Automated Test Suite (`backend/tests/hrQualifications.test.js`):**
   - Written using native Node.js test runner (`import test from 'node:test'`, `import assert from 'node:assert'`).
   - Tests document upload, expiry calculation, and dispatch assignment refusal on expired inductions.

---

### REFERENCE CONTEXT FROM ORAC MASTER TRACKER:

#### Subsystem 6: HR & People (Target: 100%)
| Item | Target Status | Notes & Specifications |
| :--- | :--- | :--- |
| Qualification Expiry | DONE | Harvest from AU Careers `applicantDocuments` & `verification` table. |
| Safety Cert Renewal | DONE | Automated 30/60/90-day alert engine warning before artisan safety passport expires. |
| Artisan Certs Vault | DONE | Secure storage of Red Seal, Class 1 Journeyman, and Mine Safety induction cards. |
| Mine Induction Gate (S-10) | DONE | Hard statutory gate: Blocks technician allocation to mine dispatch if induction expired. |
| Email OTP via SMTP | DONE | Harvested from AU Careers `src/lib/mailer.ts` (kept behind mock flag in testing). |

Please generate the complete, self-contained code blocks now!
