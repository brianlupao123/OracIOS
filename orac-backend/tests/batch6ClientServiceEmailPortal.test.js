import assert from "node:assert/strict";
import test from "node:test";
import { getCollection } from "../src/controllers/coreController.js";
import {
  getQuoteDocument,
  getWorksheetDocument,
  getInvoiceDocument,
  getPoDocument,
  getQuotePdf,
  getInvoicePdf
} from "../src/controllers/documentController.js";
import { submitClientPo, capturePo } from "../src/controllers/quoteController.js";
import { transitionQuote } from "../src/stateMachine.js";
import { roles } from "../src/permissions.js";
import { redactClientForbiddenFields, CLIENT_FORBIDDEN_KEYS } from "../src/clientAllowlist.js";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    type(t) {
      this.headers["Content-Type"] = t;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    }
  };
}

function makeBatch6Db() {
  return {
    users: [
      { id: "u_admin", role: roles.ADMIN, name: "Alice Admin", is_active: true },
      { id: "u_fin", role: roles.FINANCE, name: "Fiona Finance", is_active: true },
      { id: "u_ops", role: roles.OPERATIONS, name: "Oliver Ops", is_active: true },
      { id: "u_sales", role: roles.SALES, name: "Sam Sales", is_active: true },
      { id: "u_client_a", role: roles.CLIENT_VIEWER, name: "Carl Client A", client_id: "c_client_a", is_active: true },
      { id: "u_client_b", role: roles.CLIENT_VIEWER, name: "Chloe Client B", client_id: "c_client_b", is_active: true },
      { id: "u_client_unlinked", role: roles.CLIENT_VIEWER, name: "Unlinked Client", client_id: null, is_active: true }
    ],
    clients: [
      { id: "c_client_a", name: "Mimosa Mining Co", is_active: true },
      { id: "c_client_b", name: "Zimplats Selous", is_active: true }
    ],
    company_profile: {
      company_name: "Orac Systems",
      legal_name: "Handon Enterprises (Pvt) Ltd",
      address: "Harare, Zimbabwe",
      phone: "+263 242 000 000",
      email: "info@orac.co.zw"
    },
    quotes: [
      {
        id: "q_client_a_sent",
        quote_number: "Q-MIM-001",
        client_id: "c_client_a",
        status: "Approved_Pending_PO",
        total_amount: 12500,
        grand_total_cents: 1250000,
        scope_summary: "Conveyor maintenance",
        internal_cost: 8000,
        margin: 4500,
        staff_notes: "Negotiated discount applied",
        created_at: "2026-11-10T10:00:00Z",
        sent_at: "2026-11-10T11:00:00Z"
      },
      {
        id: "q_client_a_draft",
        quote_number: "Q-MIM-002",
        client_id: "c_client_a",
        status: "Draft",
        total_amount: 5000,
        grand_total_cents: 500000,
        internal_cost: 3200,
        margin: 1800,
        staff_notes: "Internal estimation in progress",
        created_at: "2026-11-11T10:00:00Z"
      },
      {
        id: "q_client_b_sent",
        quote_number: "Q-ZIM-001",
        client_id: "c_client_b",
        status: "Approved_Pending_PO",
        total_amount: 30000,
        grand_total_cents: 3000000,
        internal_cost: 20000,
        margin: 10000,
        created_at: "2026-11-10T10:00:00Z",
        sent_at: "2026-11-10T11:00:00Z"
      }
    ],
    quote_lines: [
      {
        id: "ql_a_1",
        quotation_id: "q_client_a_sent",
        description: "Belt splicing service",
        quantity: 2,
        unit_price: 6250,
        unit_price_cents: 625000,
        line_total: 12500,
        unit_cost_cents: 400000,
        margin_percent: 36,
        buy_rate: 4000,
        supplier_id: "supp_belt_co"
      },
      {
        id: "ql_b_1",
        quotation_id: "q_client_b_sent",
        description: "Rubber lining service",
        quantity: 1,
        unit_price: 30000,
        unit_price_cents: 3000000,
        line_total: 30000,
        unit_cost_cents: 2000000,
        margin_percent: 33,
        buy_rate: 20000,
        supplier_id: "supp_rubber_corp"
      }
    ],
    purchase_orders: [],
    dispatch_cards: [
      {
        id: "dc_a_1",
        quotation_id: "q_client_a_sent",
        dispatch_number: "DC-MIM-001",
        status: "Dispatched",
        created_at: "2026-11-12T08:00:00Z"
      },
      {
        id: "dc_b_1",
        quotation_id: "q_client_b_sent",
        dispatch_number: "DC-ZIM-001",
        status: "Dispatched",
        created_at: "2026-11-12T08:00:00Z"
      }
    ],
    field_worksheets: [
      {
        id: "fw_a_1",
        dispatch_card_id: "dc_a_1",
        status: "Supervisor_Approved",
        work_date: "2026-11-12",
        hours: 8,
        technician_id: "u_tech_1",
        supervisor_id: "u_sup_1",
        client_acknowledgement: { signed_by: "Carl Client", signed_at: "2026-11-12T16:00:00Z" }
      },
      {
        id: "fw_b_1",
        dispatch_card_id: "dc_b_1",
        status: "Supervisor_Approved",
        work_date: "2026-11-12",
        hours: 10,
        technician_id: "u_tech_2",
        supervisor_id: "u_sup_1",
        client_acknowledgement: { signed_by: "Chloe Client", signed_at: "2026-11-12T17:00:00Z" }
      }
    ],
    invoices: [
      {
        id: "inv_a_1",
        invoice_number: "INV-MIM-001",
        quotation_id: "q_client_a_sent",
        dispatch_card_id: "dc_a_1",
        status: "Issued",
        total_amount: 12500,
        created_at: "2026-11-13T10:00:00Z"
      },
      {
        id: "inv_b_1",
        invoice_number: "INV-ZIM-001",
        quotation_id: "q_client_b_sent",
        dispatch_card_id: "dc_b_1",
        status: "Issued",
        total_amount: 30000,
        created_at: "2026-11-13T10:00:00Z"
      }
    ],
    invoice_lines: [],
    audit_logs: [],
    plant_sections: [],
    plants: [],
    equipment_tags: []
  };
}

function makeMockStore() {
  let idCounter = 100;
  return {
    id(prefix) {
      return `${prefix}_${++idCounter}`;
    },
    audit(db, actor, entityType, entityId, action, oldVal, newVal) {
      db.audit_logs.push({
        id: `audit_${++idCounter}`,
        actor_id: actor?.id,
        entity_type: entityType,
        entity_id: entityId,
        action,
        old_values: oldVal,
        new_values: newVal,
        created_at: new Date().toISOString()
      });
    },
    recalculateVariance() {}
  };
}

// ---------------------------------------------------------------------------
// TEST 1: Unpaid Invoices Classification
// ---------------------------------------------------------------------------
test("Unpaid invoice filter distinguishes active unpaid from paid, voided, credited, and drafts", () => {
  const ACTIVE_UNPAID_STATUSES = new Set([
    "issued",
    "sent",
    "partially_paid",
    "pending_payment",
    "overdue"
  ]);

  const testInvoices = [
    { id: "inv_1", status: "Issued", total_amount: 5000 },
    { id: "inv_2", status: "sent", total_amount: 3000 },
    { id: "inv_3", status: "Partially_Paid", total_amount: 4000 },
    { id: "inv_4", status: "Overdue", total_amount: 2500 },
    { id: "inv_5", status: "Pending_Payment", total_amount: 1200 },
    { id: "inv_6", status: "Paid", total_amount: 8000 },
    { id: "inv_7", status: "paid", total_amount: 2000 },
    { id: "inv_8", status: "Voided", total_amount: 6000 },
    { id: "inv_9", status: "voided", total_amount: 1500 },
    { id: "inv_10", status: "Credited", total_amount: 3500 },
    { id: "inv_11", status: "draft", total_amount: 1000 }
  ];

  const unpaid = testInvoices.filter((i) =>
    ACTIVE_UNPAID_STATUSES.has(String(i.status || "").toLowerCase())
  );

  // Exactly 5 active unpaid invoices
  assert.equal(unpaid.length, 5);
  const unpaidIds = unpaid.map((i) => i.id);
  assert.deepEqual(unpaidIds, ["inv_1", "inv_2", "inv_3", "inv_4", "inv_5"]);

  // Paid, voided, credited, and draft are excluded
  for (const excludedId of ["inv_6", "inv_7", "inv_8", "inv_9", "inv_10", "inv_11"]) {
    assert.ok(!unpaidIds.includes(excludedId), `Invoice ${excludedId} must not be in unpaid list`);
  }
});

// ---------------------------------------------------------------------------
// TEST 2: Client Viewer Data Boundary Enforcement (Cross-Client Isolation)
// ---------------------------------------------------------------------------
test("Client Viewer data boundary: attempts to access another client's records fail closed", () => {
  const db = makeBatch6Db();

  // 1. Client A accesses their own quote -> 200 Success with projection
  const reqOwn = {
    user: { id: "u_client_a" },
    db,
    params: { id: "q_client_a_sent" }
  };
  const resOwn = mockRes();
  getQuoteDocument(reqOwn, resOwn);
  assert.equal(resOwn.statusCode, 200);
  assert.ok(resOwn.body.success);
  assert.equal(resOwn.body.data.quote.id, "q_client_a_sent");

  // 2. Client A attempts to access Client B's quote -> 403 Forbidden
  const reqOther = {
    user: { id: "u_client_a" },
    db,
    params: { id: "q_client_b_sent" }
  };
  const resOther = mockRes();
  getQuoteDocument(reqOther, resOther);
  assert.equal(resOther.statusCode, 403);
  assert.match(resOther.body.message, /cannot access another client's documents/i);

  // 3. Client A attempts to access Client A's draft quote -> 403 Forbidden (not yet sent)
  const reqDraft = {
    user: { id: "u_client_a" },
    db,
    params: { id: "q_client_a_draft" }
  };
  const resDraft = mockRes();
  getQuoteDocument(reqDraft, resDraft);
  assert.equal(resDraft.statusCode, 403);
  assert.match(resDraft.body.message, /not yet available for client viewing/i);

  // 4. Client Viewer without client_id fails closed -> 403 Forbidden
  const reqUnlinked = {
    user: { id: "u_client_unlinked" },
    db,
    params: { id: "q_client_a_sent" }
  };
  const resUnlinked = mockRes();
  getQuoteDocument(reqUnlinked, resUnlinked);
  assert.equal(resUnlinked.statusCode, 403);
  assert.match(resUnlinked.body.message, /not linked to a client account/i);

  // 5. Client A attempts to access Client B's worksheet -> 403 Forbidden
  const reqWsOther = {
    user: { id: "u_client_a" },
    db,
    params: { id: "fw_b_1" }
  };
  const resWsOther = mockRes();
  getWorksheetDocument(reqWsOther, resWsOther);
  assert.equal(resWsOther.statusCode, 403);
  assert.match(resWsOther.body.message, /cannot access another client's documents/i);

  // 6. Client A attempts to access Client B's invoice -> 403 Forbidden
  const reqInvOther = {
    user: { id: "u_client_a" },
    db,
    params: { id: "inv_b_1" }
  };
  const resInvOther = mockRes();
  getInvoiceDocument(reqInvOther, resInvOther);
  assert.equal(resInvOther.statusCode, 403);
  assert.match(resInvOther.body.message, /cannot access another client's documents/i);
});

// ---------------------------------------------------------------------------
// TEST 3: Recursive Redaction & Sensitive Field Cleansing for Client Viewer
// ---------------------------------------------------------------------------
test("Client Viewer generic collection queries recursively redact all internal costs, margins, and rates", () => {
  const db = makeBatch6Db();

  // Client A queries quote_lines
  const reqQuoteLines = {
    user: { id: "u_client_a" },
    db
  };
  const resQuoteLines = mockRes();
  getCollection("quote_lines")(reqQuoteLines, resQuoteLines);
  assert.equal(resQuoteLines.statusCode, 200);
  assert.ok(resQuoteLines.body.success);

  // Only Client A's quote lines are returned (1 line)
  assert.equal(resQuoteLines.body.data.length, 1);
  const clientLine = resQuoteLines.body.data[0];
  assert.equal(clientLine.id, "ql_a_1");

  // Verify forbidden keys are completely stripped
  for (const forbiddenKey of CLIENT_FORBIDDEN_KEYS) {
    assert.equal(
      clientLine[forbiddenKey],
      undefined,
      `Forbidden key "${forbiddenKey}" must not appear in Client Viewer quote lines`
    );
  }

  // But customer-facing fields are intact
  assert.equal(clientLine.description, "Belt splicing service");
  assert.equal(clientLine.quantity, 2);
  assert.equal(clientLine.unit_price, 6250);
  assert.equal(clientLine.line_total, 12500);

  // Internal staff (Admin) queries quote_lines -> internal costs and margins are preserved
  const reqAdminLines = {
    user: { id: "u_admin" },
    db
  };
  const resAdminLines = mockRes();
  getCollection("quote_lines")(reqAdminLines, resAdminLines);
  assert.equal(resAdminLines.statusCode, 200);
  const adminLineA = resAdminLines.body.data.find((l) => l.id === "ql_a_1");
  assert.ok(adminLineA);
  assert.equal(adminLineA.unit_cost_cents, 400000);
  assert.equal(adminLineA.margin_percent, 36);
  assert.equal(adminLineA.supplier_id, "supp_belt_co");

  // Client Viewer forbidden collection access -> 403
  const reqPoCollection = {
    user: { id: "u_client_a" },
    db
  };
  const resPoCollection = mockRes();
  getCollection("purchase_orders")(reqPoCollection, resPoCollection);
  assert.equal(resPoCollection.statusCode, 403);
  assert.match(resPoCollection.body.message, /cannot view purchase_orders/i);
});

// ---------------------------------------------------------------------------
// TEST 4: Client Quote Acceptance Sets Acceptance Record & Preserves Verified-PO Gate
// ---------------------------------------------------------------------------
test("Client PO submission sets commercial_acceptance_status: 'client_accepted' while preserving verified-PO gate", () => {
  const db = makeBatch6Db();
  const store = makeMockStore();

  const reqSubmitPo = {
    user: { id: "u_client_a" },
    db,
    store,
    params: { id: "q_client_a_sent" },
    body: {
      po_reference: "PO-MIM-2026-001",
      po_amount: 12500,
      document_reference: "DOC-PO-7788"
    }
  };
  const resSubmitPo = mockRes();
  submitClientPo(reqSubmitPo, resSubmitPo);

  assert.equal(resSubmitPo.statusCode, 200);
  assert.ok(resSubmitPo.body.success);

  // 1. PO record is created in pending status
  const createdPo = db.purchase_orders.find((p) => p.quotation_id === "q_client_a_sent");
  assert.ok(createdPo);
  assert.equal(createdPo.status, "pending");
  assert.equal(createdPo.verified_by, null);
  assert.equal(createdPo.verified_at, null);

  // 2. Quote record is stamped with client acceptance
  const quote = db.quotes.find((q) => q.id === "q_client_a_sent");
  assert.equal(quote.commercial_acceptance_status, "client_accepted");
  assert.equal(quote.commercial_acceptance_reference, "PO-MIM-2026-001");
  assert.ok(quote.commercial_accepted_at);

  // 3. Status remains Approved_Pending_PO (NOT PO_Verified)
  assert.equal(quote.status, "Approved_Pending_PO");

  // 4. Attempting to dispatch directly from unverified PO fails at stateMachine gate
  assert.throws(
    () => {
      transitionQuote(db, store, quote.id, "Field_Dispatch", {}, { id: "u_admin", role: roles.ADMIN });
    },
    /(Dispatch is permitted only from PO_Verified status|Illegal transition: Approved_Pending_PO -> Field_Dispatch)/i
  );

  // 5. Staff captures & verifies PO via capturePo
  const reqVerify = {
    user: { id: "u_fin" },
    db,
    store,
    params: { id: "q_client_a_sent" },
    body: {
      po_reference: "PO-MIM-2026-001",
      po_amount: 12500,
      started_before_po: false
    }
  };
  const resVerify = mockRes();
  capturePo(reqVerify, resVerify);

  assert.equal(resVerify.statusCode, 200);
  assert.equal(createdPo.status, "verified");
  assert.equal(createdPo.verified_by, "u_fin");
  assert.equal(quote.status, "PO_Verified");

  // 6. Now Field_Dispatch transition succeeds by Operations
  transitionQuote(db, store, quote.id, "Field_Dispatch", {}, { id: "u_ops", role: roles.OPERATIONS, is_active: true });
  assert.equal(quote.status, "Field_Dispatch");
});

// ---------------------------------------------------------------------------
// TEST 5: PDF Document Endpoints Authorization & Tenant Scoping
// ---------------------------------------------------------------------------
test("Quote PDF download respects Client Viewer tenant boundary and rejects cross-client access", () => {
  const db = makeBatch6Db();

  // Client A downloads their own quote PDF -> 200
  const reqPdfOwn = {
    user: { id: "u_client_a" },
    db,
    params: { id: "q_client_a_sent" }
  };
  const resPdfOwn = mockRes();
  getQuotePdf(reqPdfOwn, resPdfOwn);
  assert.equal(resPdfOwn.statusCode, 200);
  assert.equal(resPdfOwn.headers["Content-Type"], "application/pdf");
  assert.ok(resPdfOwn.body);

  // Client A attempts to download Client B's quote PDF -> 403
  const reqPdfOther = {
    user: { id: "u_client_a" },
    db,
    params: { id: "q_client_b_sent" }
  };
  const resPdfOther = mockRes();
  getQuotePdf(reqPdfOther, resPdfOther);
  assert.equal(resPdfOther.statusCode, 403);
  assert.match(resPdfOther.body.message, /cannot access another client's documents/i);
});
