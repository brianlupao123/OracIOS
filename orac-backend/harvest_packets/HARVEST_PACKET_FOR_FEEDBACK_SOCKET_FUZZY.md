# HARVEST PROMPT: Course-assessment-feedback & Feedback Ecosystem (Socket.IO, Fuzzy Search & Cron Schedulers)

**Copy and paste everything below the line into the chat for `Course-assessment-feedback-` / `1-feedback-system`:**

---

### Instructions for AI Agent in `Course-assessment-feedback-` / `feedback-ecosystem`

You are contributing code to the **ORAC Industrial ERP System** (heavy mining engineering contractor management).
We are harvesting three high-performance real-time and utility modules from your codebase:
1. **Real-Time WebSocket Gateway (`socket.io`):** Instant notifications, live job progress streaming, low-stock alerts, and approval notifications to connected browsers without polling.
2. **Fuzzy Search & Part Catalog Matching Engine (`fuzzball`):** Intelligent text matching for complex mining spare parts, equipment models (e.g. Warman slurry pumps, Continental conveyor belts), and client site names.
3. **Automated Enterprise Background Scheduler (`node-cron`):** Recurring cron jobs that automatically sweep database records for compliance expiry alerts (30/60/90 days) and automated inventory reorder recommendations.

---

### Strict ORAC Architectural Constraints:
- **Language / Runtime:** Node.js (CommonJS `require` syntax).
- **Socket Security:** Socket connections must authenticate using JWT tokens passed in handshake auth or query.
- **Zero Polling Goal:** Push critical state changes directly to the Vite frontend SPA.

---

### Deliverable 1: `backend/src/services/socketService.js` (Socket.IO Server Gateway)
Please provide the complete Socket.IO initialization and broadcasting service:
- Initializes Socket.IO on the existing Node HTTP server instance (`io.attach(httpServer)`).
- Authenticates incoming socket handshakes via JWT (`socket.handshake.auth.token`).
- Automatically joins clients to role-based rooms (e.g. `role:ROLE_STOREKEEPER`, `role:ROLE_FINANCE_OFFICER`, `role:ROLE_SAFETY_OFFICER`) and user-specific rooms (`user:<userId>`).
- Exported functions:
  - `notifyRole(role, eventName, payload)`
  - `notifyUser(userId, eventName, payload)`
  - `broadcastJobUpdate(jobCardId, updateData)`
  - `emitInventoryAlert(itemId, alertDetails)`

### Deliverable 2: `backend/src/services/fuzzyCatalogService.js` (`fuzzball`)
Please provide the fuzzy search utility service:
- Function `searchCatalog(query, itemsList, options)`:
  - Performs multi-field fuzzy search using `fuzzball.token_set_ratio` and `fuzzball.partial_ratio`.
  - Searches part numbers, brand names, equipment tags, specifications, and descriptions.
  - Returns ranked matches with relevance percentage score ($\ge 65\%$).
  - Example: "rubber sheet 6mm viton" correctly matches "SHEET-RUBBER-VITON-BLACK-6MM-ROLL".

### Deliverable 3: `backend/src/services/cronSchedulerService.js` (`node-cron`)
Please provide the background scheduled jobs service:
- Job 1 (`0 6 * * *` - 6:00 AM daily):
  - Sweeps `artisan_documents` and identifies mine inductions, medical certificates, and trade licenses expiring in 30, 60, or 90 days.
  - Dispatches automated in-app alerts and flags compliance warnings.
- Job 2 (`0 7 * * *` - 7:00 AM daily):
  - Sweeps `vehicles` register and checks VID Certificates of Fitness, insurance, and road tax expiry dates.
  - Automatically flags vehicles as `MAINTENANCE_REQUIRED` if expired.
- Job 3 (`*/30 * * * *` - Every 30 minutes):
  - Checks inventory stock levels against `reorder_threshold`. Emits real-time alerts to storekeepers for critically depleted consumables (e.g. Vulcol / Chemcure cement, splicing patches).

Please output the complete, production-ready code ready to be integrated into ORAC!
