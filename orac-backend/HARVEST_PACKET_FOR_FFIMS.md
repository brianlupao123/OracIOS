# HARVEST PACKET FOR FFIMS CHAT
*(Copy everything below this line and paste it into your FFIMS conversation)*

---

Hello FFIMS Agent! I am currently completing the **ORAC Industrial Service Management ERP** system (our specialized ERP for mining plant rubber lining, conveyor splicing, and slurry pump maintenance serving Zimplats, Unki, and Mimosa).

ORAC has **2,540 passing automated tests** (1,830 backend, 710 frontend). The core commercial and financial engine is mature (85%), but our secondary subsystems are ready for harvest:
- **Subsystem 3: Supply Chain & Procurement (at 25% → Target 100%)**
- **Subsystem 4: Fleet & Logistics (at 0% → Target 100%)**
- **Subsystem 5: HSE & Compliance (at 0% → Target 100%)**
- **Sensitive Controls: S-02 (Maker-Checker on Bank Changes), S-11 (Pre-Dispatch PPE Gate), S-12 (Vehicle VID Roadworthiness Expiry Lock)**

Because FFIMS is the single largest harvest donor across these domains, we want you to generate the **complete, plug-and-play code packet for Sprint 1 (Supply Chain & Procurement + 3-Way Matching)**.

### ORAC Architectural Adapter Contract:
To ensure your code drops into ORAC with zero regressions:
1. **Dual-Mode Store:** Use ORAC's store syntax (`db.collection.insert()`, `update()`, `find()`, `findById()`).
2. **Validation:** Use **Zod schemas** (not Joi or Mongoose) for `backend/src/schemas.js`.
3. **Controller:** Provide `backend/src/controllers/procurementController.js` with non-blocking Express endpoints.
4. **Pure Service:** Provide `backend/src/services/threeWayMatchingService.js` comparing PO Line Qty/Cost ↔ GRN Received Qty ↔ Supplier Invoice Amount.
5. **Idempotent SQL Migration:** Provide `backend/migrations/002_procurement_subsystem.sql` using `CREATE TABLE IF NOT EXISTS`.
6. **Tests:** Write `backend/tests/procurementLifecycle.test.js` using native Node.js test runner (`import test from 'node:test'`, `import assert from 'node:assert'`).

---

### REFERENCE CONTEXT FROM ORAC MASTER TRACKER:

#### Subsystem 3: Procurement & Stores
| Item | Target Status | Notes & Specifications |
| :--- | :--- | :--- |
| Internal PR | DONE | Departmental material requisition (rubber rolls, adhesive, fasteners) with supervisor approval. |
| Supplier PO | DONE | Issued to verified suppliers (e.g. Dunlop, Truco, Rema Tip Top) with ceiling amounts. |
| GRN (Goods Received Note) | DONE | Warehouse receiving inspection checklist, quantity check, and batch QA verification. |
| Store Issue Voucher (SIV) | DONE | Deducts raw stock from inventory ledger against active ORAC `dispatch_card_id`. |
| 3-Way Matching Gate | DONE | Automatic validation: Supplier PO vs GRN Received vs Supplier Invoice. Flags discrepancies. |
| Reorder Alerts | DONE | Stock monitor alerting when Neoprene or ChemVulc cement drops below minimum stock. |

#### Relevant Sensitive Controls (Section 14)
- **S-02: Maker-Checker Dual Control on Bank Modifications:** User A edits bank account → User B (Finance) must approve before release.
- **S-06: Invoice Readiness Gate & Verified PO Lock:** Invoices blocked until PO verified and worksheets approved.
- **S-09: Idempotency-Key Protection on Financial Writes:** Prevents duplicate procurement or payment records.

Please generate the complete, self-contained code blocks for Sprint 1 now!
