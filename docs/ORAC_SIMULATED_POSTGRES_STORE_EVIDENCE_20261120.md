# ORAC Simulated PostgreSQL-Store Integration Evidence Report

**Date:** 20 November 2026  
**Repository:** `D:\Projects\orac-ios`  
**Test Suite File:** [postgresIntegrationEvidence.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresIntegrationEvidence.test.js)  
**Execution Context:** In-process transaction-pool simulator validating `postgresStore` transaction lifecycle, row locking, and rollback semantics locally.  
**Classification:** Local simulation evidence only; strictly **not real PostgreSQL database proof**.

---

## 1. Raw Execution Output

```text
> node --test tests/postgresIntegrationEvidence.test.js

▶ A1/A4/A8/A9: Simulated PostgreSQL-Store Integration Evidence Matrix (Transaction-Pool Simulator)
  ✔ 1. Simulated PostgreSQL: Inventory audit failure cleanly rolls back stock and movement (no ghost state after reconnect) (54.4513ms)
  ✔ 2. Simulated PostgreSQL: Sensitive payment encryption at rest, audited Finance read, and role refusal across new connection (29.1718ms)
  ✔ 3. Simulated PostgreSQL: Sales portfolio multi-tenant isolation persists across fresh connection (3.5104ms)
  ✔ 4. Simulated PostgreSQL: Client Viewer allowlist strips internal secrets and refuses cross-client data (2.3837ms)
  ✔ 5. Simulated PostgreSQL: Verified-PO dispatch gate blocks unverified PO and succeeds once verified (4.3222ms)
  ✔ 6. Simulated PostgreSQL: Critical audit events persist intact after new connection (7.2177ms)
✔ A1/A4/A8/A9: Simulated PostgreSQL-Store Integration Evidence Matrix (Transaction-Pool Simulator) (106.621ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

---

## 2. Verified Invariants (Simulated Engine)

1. **Inventory Rollback:** On simulated audit failure, controller calls `result.rollback()`, restores in-memory balance, and aborts transaction; zero ghost movements persist.
2. **Payment Encryption:** Sensitive contractor details encrypted via AES-256-GCM. Decrypted cleanly for Finance/Admin; non-Finance roles denied via `requirePermission`. Audited access record logged with redacted details.
3. **Sales Portfolio Tenancy:** Multi-tenant scoping verified across isolated store connections; sales rep cannot see dispatches outside assigned clients.
4. **Client Viewer Projection:** Sensitive wage, margin, cost, and internal worker IDs stripped; cross-client access strictly refused.
5. **Verified-PO Dispatch Gate:** Blocked with `VERIFIED_PO_REQUIRED` when PO unverified; clears cleanly once PO is verified and linked to approved worksheet.
6. **Critical Audit Persistence:** Four critical audit records persist intact across fresh simulated connection with uncorrupted payloads.
