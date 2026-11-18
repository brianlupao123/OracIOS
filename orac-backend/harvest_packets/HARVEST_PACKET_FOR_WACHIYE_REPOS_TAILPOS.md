# HARVEST PACKET FOR WACHIYE REPOS CHAT (`tailpos`, `node-ts-sequelize`, `paypal-nodejs`)
*(Copy everything below this line and paste it into your Wachiye Repos conversation)*

---

Hello Wachiye Repos Agent! We are integrating **Subsystem 13 (Native Mobile Offline Sync)** and **Enterprise Infrastructure Plumbing** into the **ORAC Industrial ERP** system.

In Zimbabwean and Zambian mining operations (underground shafts and remote sites), technicians lose cellular connectivity for 6 to 10 hours at a time. We want to harvest:
1. From **`tailpos`**: Your **offline-first local storage & sync architecture** (`boot/background_job.js`, `store/SyncStore.js`, `services/storage.js` using PouchDB/SQLite).
2. From **`node-ts-sequelize-pg-boilerplate`**: Your **Winston structured JSON logger** (`src/lib/logger.ts`) with automated PII masking and correlation IDs.
3. From **`paypal-nodejs`**: Your **asynchronous worker event processing pattern** for heavy background jobs.

### What ORAC Needs for Sprint 6 & 7:
1. **Frontend Offline Sync Hook (`frontend/src/hooks/useOfflineSync.js`):**
   - Implements offline queueing of timesheet entries, equipment inspection tags, and paper photo hashes using `IndexedDB` / local storage.
   - Listens to `window.online` / `offline` events.
   - **Conflict Resolution Engine:** Field-level non-destructive merge policy (Last-Write-Wins on distinct fields; concurrent same-field edits flagged as `CONFLICT_REVIEW`).
   - Automatically replays outbox requests when the device reconnects.
2. **Backend Structured Logger (`backend/src/config/logger.js`):**
   - Configures Winston JSON logging with `x-correlation-id` request tracing, log rotation, and automated redaction of passwords, bank account tokens, and TOTP secrets.
3. **Automated Test Suite (`backend/tests/offlineSyncAndConflict.test.js`):**
   - Native Node.js test runner (`import test from 'node:test'`, `import assert from 'node:assert'`).
   - Proves outbox replaying, field-level merge resolution, and conflict tagging.

---

### REFERENCE CONTEXT FROM ORAC MASTER TRACKER:

#### Subsystem 13: Native Mobile Field Companion & Offline Sync (Target: 100%)
| Item | Target Status | Notes & Specifications |
| :--- | :--- | :--- |
| Mobile Companion App Shell | DONE | Offline PWA / React Native mobile shell. |
| Offline SQLite / PouchDB Cache | DONE | Harvest from Wachiye `tailpos` offline storage architecture. |
| Underground Timesheet Capture | DONE | Technicians record hours without cellular connection. |
| Background Two-Way Sync | DONE | Auto-syncs field worksheets to ORAC portal when network reconnects. |

Please generate the complete, self-contained code blocks now!
