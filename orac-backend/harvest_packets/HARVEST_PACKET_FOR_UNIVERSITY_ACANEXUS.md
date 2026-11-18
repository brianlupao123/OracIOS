# HARVEST PROMPT: UniversitySystem & AcaNexus (Multi-Tier Clearance Engine, Audit Ledger & Artisan Grading)

**Copy and paste everything below the line into the chat for `UniversitySystem` / `AcaNexus` / `ffu africauniversity`:**

---

### Instructions for AI Agent in `UniversitySystem` / `AcaNexus`

You are contributing code to the **ORAC Industrial ERP System** (heavy engineering operations ERP).
We are harvesting three enterprise governance modules proven in your academic and administrative clearance systems:
1. **Sequential Multi-Tier Clearance Engine (`clearanceGateService.js`):** Ported from academic graduation/exam clearance gates to enforce ORAC industrial gates (e.g., Commercial Deposit Clearance $\rightarrow$ HSE Safety Clearance $\rightarrow$ Store Material Issue Clearance $\rightarrow$ Dispatch Authorization).
2. **Immutable Audit Ledger Service (`auditTrailService.js`):** Cryptographically tamper-evident event logging tracking every critical status transition with actor ID, role, IP address, timestamp, pre-state, post-state, and change justification.
3. **Artisan Competency Assessment & Grading Matrix (`artisanGradingService.js`):** Scoring and tracking certified skills for industrial artisans (e.g. Hot Vulcanizing Splicer Class 1, Slurry Pump Mechanic Level 3, Coded Welder AWS D1.1).

---

### Strict ORAC Architectural Constraints:
- **Language / Runtime:** Node.js (CommonJS `require` syntax).
- **Sensitive Controls Enforced:** S-01 (No job dispatch without quotation and client deposit), S-10 (Mine induction hard stop), S-11 (Pre-dispatch PPE gate).

---

### Deliverable 1: `backend/src/services/clearanceGateService.js`
Please supply the sequential clearance verification service:
- Function `evaluateJobClearance(jobCardId)`:
  - Step 1: **Commercial Check:** Validates if Job has an approved Quotation and (if required by client terms) a 10% to 50% deposit payment or valid Mining Purchase Order (PO).
  - Step 2: **HSE & Safety Check:** Validates that all assigned technicians have unexpired mine inductions (Zimplats/Unki/Mimosa) and pre-dispatch PPE checklist is 100% signed off.
  - Step 3: **Materials & Stores Check:** Validates that all Bill of Materials (BOM) items are issued via Store Issue Voucher (SIV).
  - Step 4: **Logistics Check:** Validates that the assigned vehicle has valid VID Certificate of Fitness and insurance.
  - Returns `{ cleared: boolean, pendingGates: [...], details: {...} }`.
- Function `signClearanceGate(jobCardId, gateKey, user, comment)`:
  - Approves a specific gate (e.g. `GATE_FINANCE_CLEARANCE`, `GATE_HSE_CLEARANCE`) with audit logging.

### Deliverable 2: `backend/src/services/auditTrailService.js`
Please supply the immutable enterprise audit service:
- Function `logAuditEvent({ entityType, entityId, action, actorId, actorRole, ipAddress, oldValues, newValues, reason })`:
  - Records the event into the `audit_ledger` store/table.
  - Generates a SHA-256 rolling tamper-evident hash (`previous_hash + current_event_payload`).
- Function `queryAuditHistory(entityType, entityId)`:
  - Returns the full chronological lifecycle history of an entity (e.g. full history of Quotation `Q-2026-084` from Draft $\rightarrow$ Approved $\rightarrow$ Billed $\rightarrow$ Paid).

### Deliverable 3: `backend/src/services/artisanGradingService.js`
Please supply the artisan certification & competency tracking service:
- Master trade skills: Rubber Lining, Hot Conveyor Splicing, Cold Conveyor Splicing, Slurry Pump Rebuilds, Arc/MIG Welding.
- Evaluates if an assigned artisan has the requisite qualification level for high-risk mining work orders.

Please output the complete, tested source code ready for immediate use in ORAC!
