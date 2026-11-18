# HARVEST PROMPT: journey_hub (Vehicle Dispatch Tracking, File Upload Security & Migration Runner)

**Copy and paste everything below the line into the chat for `journey_hub`:**

---

### Instructions for AI Agent in `journey_hub`

You are contributing code to the **ORAC Industrial ERP System** (specialized ERP for mining plant maintenance contractors).
We are harvesting three critical operational and security capabilities from your repository:
1. **Vehicle Dispatch Journey & Trip Tracking Engine:** Real-time trip logging, route waypoints, start/end odometer capture, driver site check-in, and fuel burn rate calculation.
2. **Hardened File Upload Security Scanner (`fileUploadSecurity.js`):** Multi-layered file upload defense verifying MIME types, magic numbers (preventing polyglot executable payloads disguised as `.pdf` or `.png`), and sanitized UUID file storage.
3. **Idempotent Migration Runner (`migrationRunner.js`):** Enterprise SQL migration ledger ensuring reproducible schema versions without data loss.

---

### Strict ORAC Architectural Constraints:
- **Language / Runtime:** Node.js (CommonJS `require` syntax).
- **Zero Regressions:** Must integrate with existing `backend/src/store.js` or standard PostgreSQL/SQLite connections.
- **Sensitive Control S-12:** Trip allocation must verify Vehicle VID fitness and Driver License expiry before trip initiation.

---

### Deliverable 1: `backend/src/services/tripTrackingService.js`
Please supply the complete Trip & Dispatch Tracking service:
- Function `startTrip(dispatchCardId, vehicleId, driverId, startKm, startFuelLevel, destinationMine)`:
  - Checks vehicle VID roadworthiness and driver medical fitness.
  - Generates a unique `trip_id`, sets status to `EN_ROUTE`, records initial timestamp.
- Function `recordWaypoint(tripId, { latitude, longitude, checkpointName, remarks })`:
  - Appends breadcrumb telemetry coordinates for driver transit to mining site (e.g. Harare $\rightarrow$ Selous $\rightarrow$ Zimplats SMC).
- Function `completeTrip(tripId, endKm, endFuelLevel, returnDate)`:
  - Calculates total distance ($km = end - start$) and estimated fuel consumption ($L/100km$).
  - Updates vehicle master odometer.
  - Updates dispatch card status to `DELIVERED_ON_SITE`.

### Deliverable 2: `backend/src/middleware/secureUploadMiddleware.js`
Please supply the hardened file upload validator:
- Utilizes `multer` memory storage or temp directory.
- Magic byte validation for:
  - PDF (`%PDF-` / `25 50 44 46`)
  - PNG (`89 50 4E 47 0D 0A 1A 0A`)
  - JPEG (`FF D8 FF`)
  - DOCX / XLSX (`50 4B 03 04` PK zip header)
- Rejects any file containing executable signatures (`MZ` for `.exe`, `7F 45 4C 46` for ELF, `<?php`, `<script>`).
- Generates cryptographically secure random file names (`uuidv4() + ext`).

### Deliverable 3: `backend/src/services/migrationRunner.js`
Please supply the migration execution engine:
- Reads all `.sql` files in `backend/migrations/` ordered by version prefix (`001_...`, `002_...`).
- Checks a tracking table `schema_migrations (version VARCHAR PRIMARY KEY, applied_at TIMESTAMP)`.
- Applies unapplied migrations inside a transaction.
- Logs exact success/failure per migration file.

Please output the complete, production-ready code blocks ready for instant integration into ORAC!
