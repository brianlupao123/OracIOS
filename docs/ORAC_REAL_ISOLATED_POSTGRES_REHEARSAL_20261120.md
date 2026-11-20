# ORAC Real Isolated PostgreSQL Rehearsal Report

**Date:** 20 November 2026  
**Repository:** `D:\Projects\orac-ios`  
**Test Suite File:** [postgresRealRehearsal.test.js](file:///D:/Projects/orac-ios/orac-backend/tests/postgresRealRehearsal.test.js)  
**Database Target:** Dedicated live Neon PostgreSQL instance (`orac_test_rehearsal`, PostgreSQL 17.12) via `ORAC_TEST_DATABASE_URL`  
**Classification:** Live database integration rehearsal evidence; dedicated non-production schema; strictly **not production deployed**.

---

## 1. Raw Execution Output

```text
> $env:ORAC_TEST_DATABASE_URL = "postgresql://***@ep-snowy-credit-al6x7xrz.c-3.eu-central-1.aws.neon.tech/orac_test_rehearsal?sslmode=require"; node --test tests/postgresRealRehearsal.test.js

▶ Real Isolated PostgreSQL Rehearsal Evidence Matrix
  ✔ 1. Real PostgreSQL: Inventory audit failure cleanly rolls back stock and movement (no ghost state in real PostgreSQL) (3170.6873ms)
  ✔ 2. Real PostgreSQL: Sensitive payment encryption at rest, audited Finance read, and role refusal across new connection (6314.0032ms)
  ✔ 3. Real PostgreSQL: Sales portfolio multi-tenant isolation persists across fresh connection (5967.5313ms)
  ✔ 4. Real PostgreSQL: Client Viewer allowlist strips internal secrets and refuses cross-client data (4500.1462ms)
  ✔ 5. Real PostgreSQL: Verified-PO dispatch gate blocks unverified PO and succeeds once verified (4752.0238ms)
  ✔ 6. Real PostgreSQL: Critical audit events persist intact after reconnect (4607.6562ms)
  ✔ 7. Real PostgreSQL: Concurrent connections serialized with row-level locking (race-condition protection) (5738.252ms)
✔ Real Isolated PostgreSQL Rehearsal Evidence Matrix (36635.1242ms)
ℹ tests 7
ℹ suites 1
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40679.2174
```

---

## 2. Verified Real PostgreSQL Invariants

1. **Real Inventory Rollback on Audit Failure:** In real PostgreSQL, when an audit failure is triggered, the controller invokes `result.rollback()`, restores in-memory quantity to 10, and issues `ROLLBACK` on the live transaction. An independent query on a fresh pool confirms `quantity_on_hand` remains 10 and 0 stock movements were persisted in the `store` table.
2. **Real AES-256-GCM Storage & Audited Finance Decryption:** Contractor banking details encrypted with AES-256-GCM are committed to PostgreSQL JSONB. Table inspection proves only ciphertext and auth tag exist in the database (raw bank accounts and EcoCash numbers never appear in PostgreSQL storage). A newly opened connection decrypts successfully for Finance, while non-Finance roles are refused via `requirePermission`. An audited access event is persisted with redacted details.
3. **Real Sales Portfolio Tenancy Scoping:** Commercial quotes and dispatches for separate sales representatives are committed to real PostgreSQL. Independent reader connections verify multi-tenant scoping rules prevent cross-portfolio visibility.
4. **Real Client Viewer Projection & Cross-Client Isolation:** Real documents in PostgreSQL are shaped via `shapeQuoteForClient` / `shapeInvoiceForClient`. Top-level and nested assertions prove that internal profit margins, cost breakdowns, and GL accounts are stripped. Cross-client access is refused.
5. **Real Verified-PO Dispatch Gate:** In real PostgreSQL storage, unverified POs block dispatch readiness with `VERIFIED_PO_REQUIRED`. When updated to `verified` and linked to an approved worksheet, a fresh connection confirms the gate clears cleanly.
6. **Real Critical Audit Reconnect Persistence:** Four critical audit records (`STOCK_MOVEMENT_RECORDED`, `PASTEL_EXPORT_GENERATED` with `REVIEW_NON_POSTING`, `INVOICE_SETTLEMENT_RECORDED`, and dry-run `COMMUNICATION_EVIDENCE_RECORDED`) are committed to PostgreSQL. The pool is terminated, and a completely fresh pool connects and verifies all records persist intact with uncorrupted payloads.
7. **Real PostgreSQL Concurrency & Row-Level Locking:** Two independent connection pools (`pool1`, `pool2`) simultaneously attempt to deduct 4 units from an initial stock of 5. PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) serializes the transactions: Worker 1 commits the deduction (reducing stock to 1), and Worker 2 subsequently reads the updated balance (1 < 4) and safely aborts. The real PostgreSQL row quantity is verified to be exactly 1, completely preventing oversell race conditions.
