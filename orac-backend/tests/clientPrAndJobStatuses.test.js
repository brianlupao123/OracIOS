// tests/clientPrAndJobStatuses.test.js — Client PR entity + 14-status Jobs Tracker
//
// Tests the Client PR lifecycle (state machine) and the 14-status
// classification function used by the Jobs Tracker.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  PR_STATES,
  createClientPr,
  transitionPr,
  getClientPr,
  listClientPrs,
  getActivePrForQuote
} from "../src/services/clientPrService.js";

import {
  JOB_STATUSES,
  STATUS_KEYS,
  classifyJobStatus,
  statusLabel,
  statusStage
} from "../src/jobTrackerStatuses.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeStore() {
  const auditLog = [];
  return {
    audit: (db, actor, collection, entityId, action, before, after) => {
      auditLog.push({ actor: actor?.id, collection, entityId, action, before, after });
    },
    _auditLog: auditLog
  };
}

function makeDb(overrides = {}) {
  return { client_prs: [], worksheets: [], ...overrides };
}

// ═════════════════════════════════════════════════════════════════════
// Client PR Service
// ═════════════════════════════════════════════════════════════════════

describe("clientPrService — CRUD", () => {
  it("creates a PR in Received state", () => {
    const db = makeDb();
    const store = makeStore();
    const pr = createClientPr({
      quotationId: "q-1", clientId: "c-1", prNumber: "PR-001",
      description: "Rubber lining for mill", receivedBy: "u-1",
      store, db
    });

    assert.ok(pr.id.startsWith("pr_"));
    assert.equal(pr.status, "Received");
    assert.equal(pr.quotation_id, "q-1");
    assert.equal(pr.pr_number, "PR-001");
    assert.equal(db.client_prs.length, 1);
    assert.equal(store._auditLog[0].action, "PR_RECEIVED");
  });

  it("rejects missing quotationId", () => {
    const db = makeDb();
    const store = makeStore();
    assert.throws(
      () => createClientPr({ clientId: "c-1", receivedBy: "u-1", store, db }),
      /quotationId/
    );
  });

  it("rejects missing clientId", () => {
    const db = makeDb();
    const store = makeStore();
    assert.throws(
      () => createClientPr({ quotationId: "q-1", receivedBy: "u-1", store, db }),
      /clientId/
    );
  });

  it("rejects duplicate PR number for same client", () => {
    const db = makeDb();
    const store = makeStore();
    createClientPr({ quotationId: "q-1", clientId: "c-1", prNumber: "PR-001", receivedBy: "u-1", store, db });
    assert.throws(
      () => createClientPr({ quotationId: "q-2", clientId: "c-1", prNumber: "PR-001", receivedBy: "u-1", store, db }),
      /already exists/
    );
  });

  it("allows same PR number for different clients", () => {
    const db = makeDb();
    const store = makeStore();
    createClientPr({ quotationId: "q-1", clientId: "c-1", prNumber: "PR-001", receivedBy: "u-1", store, db });
    const pr2 = createClientPr({ quotationId: "q-2", clientId: "c-2", prNumber: "PR-001", receivedBy: "u-1", store, db });
    assert.equal(pr2.pr_number, "PR-001");
    assert.equal(db.client_prs.length, 2);
  });

  it("retrieves a PR by ID", () => {
    const db = makeDb();
    const store = makeStore();
    const pr = createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });
    const found = getClientPr({ prId: pr.id, db });
    assert.equal(found.id, pr.id);
  });

  it("throws 404 for unknown PR", () => {
    const db = makeDb();
    assert.throws(() => getClientPr({ prId: "pr_nonexistent", db }), /not found/i);
  });

  it("lists PRs with filters", () => {
    const db = makeDb();
    const store = makeStore();
    createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });
    createClientPr({ quotationId: "q-2", clientId: "c-2", receivedBy: "u-1", store, db });

    assert.equal(listClientPrs({ db }).length, 2);
    assert.equal(listClientPrs({ clientId: "c-1", db }).length, 1);
    assert.equal(listClientPrs({ quotationId: "q-2", db }).length, 1);
    assert.equal(listClientPrs({ status: "Approved", db }).length, 0);
  });
});

describe("clientPrService — state machine", () => {
  it("follows happy path: Received → Under_Review → Approved → Converted_To_PO", () => {
    const db = makeDb();
    const store = makeStore();
    const pr = createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });

    transitionPr({ prId: pr.id, toStatus: "Under_Review", userId: "u-1", store, db });
    assert.equal(pr.status, "Under_Review");
    assert.ok(pr.reviewed_at);

    transitionPr({ prId: pr.id, toStatus: "Approved", userId: "u-1", store, db });
    assert.equal(pr.status, "Approved");
    assert.ok(pr.approved_at);

    transitionPr({ prId: pr.id, toStatus: "Converted_To_PO", purchaseOrderId: "po-1", userId: "u-1", store, db });
    assert.equal(pr.status, "Converted_To_PO");
    assert.equal(pr.purchase_order_id, "po-1");
    assert.ok(pr.converted_at);
  });

  it("allows rejection from Received", () => {
    const db = makeDb();
    const store = makeStore();
    const pr = createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });

    transitionPr({ prId: pr.id, toStatus: "Rejected", reason: "Budget cut", userId: "u-1", store, db });
    assert.equal(pr.status, "Rejected");
    assert.equal(pr.rejection_reason, "Budget cut");
  });

  it("rejects invalid transition", () => {
    const db = makeDb();
    const store = makeStore();
    const pr = createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });

    assert.throws(
      () => transitionPr({ prId: pr.id, toStatus: "Converted_To_PO", userId: "u-1", store, db }),
      /Invalid PR transition/
    );
  });

  it("terminal states have no transitions", () => {
    const db = makeDb();
    const store = makeStore();
    const pr = createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });
    transitionPr({ prId: pr.id, toStatus: "Rejected", userId: "u-1", store, db });

    assert.throws(
      () => transitionPr({ prId: pr.id, toStatus: "Received", userId: "u-1", store, db }),
      /Invalid PR transition/
    );
  });

  it("getActivePrForQuote returns latest non-rejected PR", () => {
    const db = makeDb();
    const store = makeStore();

    const pr1 = createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });
    transitionPr({ prId: pr1.id, toStatus: "Rejected", userId: "u-1", store, db });

    const pr2 = createClientPr({ quotationId: "q-1", clientId: "c-1", prNumber: "PR-002", receivedBy: "u-1", store, db });

    const active = getActivePrForQuote({ quotationId: "q-1", db });
    assert.equal(active.id, pr2.id);
  });

  it("getActivePrForQuote returns null when all PRs are rejected", () => {
    const db = makeDb();
    const store = makeStore();
    const pr = createClientPr({ quotationId: "q-1", clientId: "c-1", receivedBy: "u-1", store, db });
    transitionPr({ prId: pr.id, toStatus: "Rejected", userId: "u-1", store, db });

    const active = getActivePrForQuote({ quotationId: "q-1", db });
    assert.equal(active, null);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Jobs Tracker 14 Statuses
// ═════════════════════════════════════════════════════════════════════

describe("jobTrackerStatuses — enum", () => {
  it("defines exactly 14 statuses", () => {
    assert.equal(STATUS_KEYS.length, 14);
  });

  it("every status has label, colour, stage, and order", () => {
    for (const key of STATUS_KEYS) {
      const s = JOB_STATUSES[key];
      assert.ok(s.label, `${key} missing label`);
      assert.ok(s.colour, `${key} missing colour`);
      assert.ok(s.stage, `${key} missing stage`);
      assert.equal(typeof s.order, "number", `${key} missing order`);
    }
  });

  it("orders are sequential 0–13", () => {
    const orders = STATUS_KEYS.map(k => JOB_STATUSES[k].order).sort((a, b) => a - b);
    assert.deepEqual(orders, Array.from({ length: 14 }, (_, i) => i));
  });

  it("statusLabel returns human-readable label", () => {
    assert.equal(statusLabel("WIP"), "Work in Progress");
    assert.equal(statusLabel("Awaiting_Client_PR"), "Awaiting Client PR");
    assert.equal(statusLabel("Unknown_Key"), "Unknown_Key"); // fallback
  });

  it("statusStage returns stage group", () => {
    assert.equal(statusStage("Draft"), "Pre-Award");
    assert.equal(statusStage("WIP"), "Execution");
    assert.equal(statusStage("Invoiced"), "Billing");
    assert.equal(statusStage("Completed"), "Completion");
  });
});

describe("jobTrackerStatuses — classifyJobStatus", () => {
  it("classifies a draft quote as Draft", () => {
    assert.equal(classifyJobStatus({ quote: { status: "Draft" } }), "Draft");
  });

  it("classifies a sent quote as Sent", () => {
    assert.equal(classifyJobStatus({ quote: { status: "Sent" } }), "Sent");
  });

  it("classifies approved quote without PR as Awaiting_Client_PO", () => {
    assert.equal(
      classifyJobStatus({ quote: { status: "Approved_Pending_PO" } }),
      "Awaiting_Client_PO"
    );
  });

  it("classifies quote with active PR as Awaiting_Client_PR", () => {
    assert.equal(
      classifyJobStatus({
        quote: { status: "Quoted" },
        pr: { status: "Received" }
      }),
      "Awaiting_Client_PR"
    );
  });

  it("classifies quote with approved PR as Awaiting_Client_PO", () => {
    assert.equal(
      classifyJobStatus({
        quote: { status: "Quoted" },
        pr: { status: "Approved" }
      }),
      "Awaiting_Client_PO"
    );
  });

  it("classifies unverified PO as PO_Under_Verification", () => {
    assert.equal(
      classifyJobStatus({
        quote: { status: "Sent" },
        po: { status: "Pending" }
      }),
      "PO_Under_Verification"
    );
  });

  it("classifies verified PO with mobilising dispatch as Mobilising", () => {
    const db = makeDb();
    assert.equal(
      classifyJobStatus({
        quote: { status: "PO_Verified" },
        po: { status: "Verified" },
        dispatch: { id: "d-1", status: "Mobilising" },
        invoices: [],
        db
      }),
      "Mobilising"
    );
  });

  it("classifies active dispatch as WIP", () => {
    const db = makeDb();
    assert.equal(
      classifyJobStatus({
        quote: { status: "Field_Dispatch" },
        po: { status: "Verified" },
        dispatch: { id: "d-1", status: "Active" },
        invoices: [],
        db
      }),
      "WIP"
    );
  });

  it("classifies demobilised dispatch as Demobilised", () => {
    const db = makeDb();
    assert.equal(
      classifyJobStatus({
        quote: { status: "PO_Verified" },
        po: { status: "Verified" },
        dispatch: { id: "d-1", status: "Demobilised" },
        invoices: [],
        db
      }),
      "Demobilised"
    );
  });

  it("classifies dispatch with approved worksheets as Ready_For_Invoice", () => {
    const db = makeDb({
      worksheets: [{ id: "w-1", dispatch_id: "d-1", status: "Approved" }]
    });
    assert.equal(
      classifyJobStatus({
        quote: { status: "PO_Verified" },
        po: { status: "Verified" },
        dispatch: { id: "d-1", status: "Active" },
        invoices: [],
        db
      }),
      "Ready_For_Invoice"
    );
  });

  it("classifies issued invoice as Invoiced", () => {
    assert.equal(
      classifyJobStatus({
        quote: { status: "PO_Verified" },
        invoices: [{ status: "Issued", created_at: new Date().toISOString() }]
      }),
      "Invoiced"
    );
  });

  it("classifies overdue invoice as Payment_Due", () => {
    const oldDate = new Date(Date.now() - 35 * 86400_000).toISOString();
    assert.equal(
      classifyJobStatus({
        quote: { status: "PO_Verified" },
        invoices: [{ status: "Issued", created_at: oldDate }]
      }),
      "Payment_Due"
    );
  });

  it("classifies all-settled invoices as Completed", () => {
    assert.equal(
      classifyJobStatus({
        quote: { status: "PO_Verified" },
        invoices: [
          { status: "Settled", created_at: new Date().toISOString() },
          { status: "Paid", created_at: new Date().toISOString() }
        ]
      }),
      "Completed"
    );
  });

  it("ignores voided invoices", () => {
    assert.equal(
      classifyJobStatus({
        quote: { status: "Sent" },
        invoices: [{ status: "Voided" }]
      }),
      "Sent"
    );
  });
});
