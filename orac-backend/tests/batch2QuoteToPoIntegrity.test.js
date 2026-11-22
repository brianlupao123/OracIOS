import assert from "node:assert/strict";
import test from "node:test";
import { getJobTracker } from "../src/controllers/jobTrackerController.js";
import { transitionQuote, createLegacyInvoice } from "../src/stateMachine.js";
import { COST_TYPES, calculateQuoteFinancials } from "../src/quoteCalculation.js";
import { roles } from "../src/permissions.js";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

function makeBatch2Db() {
  return {
    users: [
      { id: "u_admin", role: roles.ADMIN, name: "Alice Admin", is_active: true },
      { id: "u_mgmt", role: roles.MANAGEMENT, name: "Mark Manager", is_active: true },
      { id: "u_sales", role: roles.SALES, name: "Sam Sales", is_active: true },
      { id: "u_ops", role: roles.OPERATIONS, name: "Oliver Ops", is_active: true },
      { id: "u_fin", role: roles.FINANCE, name: "Fiona Finance", is_active: true },
      { id: "u_tech", role: roles.TECHNICIAN, name: "Tom Tech", is_active: true }
    ],
    clients: [
      { id: "c_mimosa", name: "Mimosa Mining Company", is_active: true }
    ],
    mine_sites: [
      { id: "ms_mimosa", client_id: "c_mimosa", name: "Mimosa Shaft 1" }
    ],
    quotes: [
      {
        id: "q_multi_dispatch",
        quote_number: "Q-MIM-001",
        client_id: "c_mimosa",
        mine_site_id: "ms_mimosa",
        status: "Field_Dispatch",
        sales_owner_id: "u_sales",
        total_amount: 15000,
        grand_total_cents: 1500000,
        created_at: "2026-11-01T08:00:00Z"
      },
      {
        id: "q_paid_unfinished",
        quote_number: "Q-MIM-002",
        client_id: "c_mimosa",
        mine_site_id: "ms_mimosa",
        status: "Field_Dispatch",
        sales_owner_id: "u_sales",
        total_amount: 8000,
        grand_total_cents: 800000,
        created_at: "2026-11-02T08:00:00Z"
      }
    ],
    purchase_orders: [
      {
        id: "po_mim_001",
        quotation_id: "q_multi_dispatch",
        po_reference: "PO-MIM-9001",
        po_number: "PO-MIM-9001",
        po_amount: 15000,
        status: "verified",
        verified_at: "2026-11-01T10:00:00Z"
      },
      {
        id: "po_mim_002",
        quotation_id: "q_paid_unfinished",
        po_reference: "PO-MIM-9002",
        po_number: "PO-MIM-9002",
        po_amount: 8000,
        status: "verified",
        verified_at: "2026-11-02T10:00:00Z"
      }
    ],
    dispatch_cards: [
      // 3 dispatches for q_multi_dispatch
      {
        id: "d_mim_01",
        quotation_id: "q_multi_dispatch",
        dispatch_number: "DISP-MIM-01",
        purchase_order_id: "po_mim_001",
        status: "active",
        scheduled_start: "2026-11-05",
        actual_start: "2026-11-05",
        created_at: "2026-11-03T08:00:00Z"
      },
      {
        id: "d_mim_02",
        quotation_id: "q_multi_dispatch",
        dispatch_number: "DISP-MIM-02",
        purchase_order_id: "po_mim_001",
        status: "active",
        scheduled_start: "2026-11-08",
        actual_start: "2026-11-08",
        created_at: "2026-11-04T08:00:00Z"
      },
      {
        id: "d_mim_03",
        quotation_id: "q_multi_dispatch",
        dispatch_number: "DISP-MIM-03",
        purchase_order_id: "po_mim_001",
        status: "active",
        scheduled_start: "2026-11-12",
        actual_start: "2026-11-12",
        created_at: "2026-11-05T08:00:00Z"
      },
      // 1 dispatch for q_paid_unfinished without completion record
      {
        id: "d_mim_unfin",
        quotation_id: "q_paid_unfinished",
        dispatch_number: "DISP-MIM-04",
        purchase_order_id: "po_mim_002",
        status: "active",
        scheduled_start: "2026-11-10",
        actual_start: "2026-11-10",
        completion_record: null,
        completed_at: null,
        created_at: "2026-11-06T08:00:00Z"
      }
    ],
    field_worksheets: [
      {
        id: "ws_d1",
        timesheet_version: 2,
        dispatch_card_id: "d_mim_01",
        technician_id: "u_tech",
        status: "Supervisor_Approved",
        hours: 8,
        hours_breakdown: { normal: 8, ot_15: 0, ot_20: 0 },
        superseded_by: null
      },
      {
        id: "ws_d2",
        timesheet_version: 2,
        dispatch_card_id: "d_mim_02",
        technician_id: "u_tech",
        status: "Supervisor_Approved",
        hours: 6,
        hours_breakdown: { normal: 4, ot_15: 2, ot_20: 0 },
        superseded_by: null
      },
      {
        id: "ws_d3",
        timesheet_version: 2,
        dispatch_card_id: "d_mim_03",
        technician_id: "u_tech",
        status: "Supervisor_Approved",
        hours: 10,
        hours_breakdown: { normal: 8, ot_15: 0, ot_20: 2 },
        superseded_by: null
      }
    ],
    invoices: [
      // Fully settled invoice for q_paid_unfinished
      {
        id: "inv_mim_002",
        invoice_number: "INV-MIM-002",
        quotation_id: "q_paid_unfinished",
        dispatch_card_id: "d_mim_unfin",
        purchase_order_id: "po_mim_002",
        total_amount: 8000,
        status: "Settled",
        created_at: "2026-11-15T08:00:00Z"
      }
    ],
    invoice_lines: [],
    material_usage: [],
    audit_logs: []
  };
}

// ── 1. One-Row-Per-Quotation Tests ──────────────────────────────────────────
test("Batch 2: Jobs Tracker guarantees exactly one row per quotation regardless of dispatch count", () => {
  const db = makeBatch2Db();
  const req = { db, user: { id: "u_admin" } };
  const res = mockRes();
  getJobTracker(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);

  // Filter for the multi-dispatch quote
  const multiRows = res.body.data.filter((j) => j.quote_number === "Q-MIM-001");
  assert.equal(multiRows.length, 1, "Must emit exactly ONE row for quotation Q-MIM-001 despite having 3 dispatches");

  const row = multiRows[0];
  assert.equal(row.dispatches_count, 3);
  assert.equal(row.dispatches.length, 3);
  assert.ok(row.dispatch_number.includes("DISP-MIM-01"));
  assert.ok(row.dispatch_number.includes("DISP-MIM-02"));
  assert.ok(row.dispatch_number.includes("DISP-MIM-03"));

  // Actual hours must be aggregated across all 3 dispatches: 8 + 6 + 10 = 24
  assert.equal(row.actual_hours, 24);
  assert.equal(row.actual_hours_breakdown.normal, 20); // 8 + 4 + 8
  assert.equal(row.actual_hours_breakdown.ot_15, 2);   // 0 + 2 + 0
  assert.equal(row.actual_hours_breakdown.ot_20, 2);   // 0 + 0 + 2
});

// ── 2. Decoupling Work Completion from Invoice Settlement ───────────────────
test("Batch 2: Settled invoice does NOT mark job as Completed when fieldwork is uncompleted", () => {
  const db = makeBatch2Db();
  const req = { db, user: { id: "u_admin" } };
  const res = mockRes();
  getJobTracker(req, res);

  assert.equal(res.statusCode, 200);
  const row = res.body.data.find((j) => j.quote_number === "Q-MIM-002");
  assert.ok(row, "Q-MIM-002 must exist in tracker");

  // Invoicing is settled, but work is still in progress (no completion record)
  assert.equal(row.invoice_status, "Settled");
  assert.equal(row.payment_status, "Paid");
  assert.equal(row.work_status, "WIP");

  // Overall status must be Paid_WIP rather than misleading 'Completed'
  assert.equal(row.status, "Paid_WIP");
  assert.equal(row.stage, "Settled (Field Work Incomplete)");
});

test("Batch 2: Explicit completion record marks job as Completed when settled", () => {
  const db = makeBatch2Db();
  // Provide explicit completion record
  const dispatch = db.dispatch_cards.find((d) => d.id === "d_mim_unfin");
  dispatch.completion_record = "Site sign-off signed by Mimosa Resident Engineer on 2026-11-18";
  dispatch.completed_at = "2026-11-18T16:00:00Z";

  const req = { db, user: { id: "u_admin" } };
  const res = mockRes();
  getJobTracker(req, res);

  assert.equal(res.statusCode, 200);
  const row = res.body.data.find((j) => j.quote_number === "Q-MIM-002");
  assert.equal(row.work_status, "Completed");
  assert.equal(row.invoice_status, "Settled");
  assert.equal(row.status, "Completed");
  assert.equal(row.stage, "Completed");
  assert.ok(row.completion_record.includes("Mimosa Resident Engineer"));
});

// ── 3. Preservation of Verified-PO Gate ──────────────────────────────────────
test("Batch 2: Verified-PO gate strictly forbids emergency/pre-PO dispatch bypass", () => {
  const db = makeBatch2Db();
  const quote = db.quotes.find((q) => q.id === "q_multi_dispatch");
  quote.status = "PO_Verified"; // Valid predecessor state for Field_Dispatch
  const actor = db.users.find((u) => u.role === roles.OPERATIONS);

  // Attempt pre-PO dispatch with urgent flag
  assert.throws(
    () => {
      transitionQuote(
        db,
        { id: () => "mock_id", audit: () => {} },
        quote.id,
        "Field_Dispatch",
        { started_before_po: true, urgent_reason: "Emergency shutdown repair" },
        actor
      );
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Urgent pre-PO dispatch is not permitted; a verified PO is required before dispatch/);
      return true;
    }
  );
});

test("Batch 2: Dispatch requires quote in PO_Verified status and verified PO record", () => {
  const db = makeBatch2Db();
  const quote = db.quotes.find((q) => q.id === "q_multi_dispatch");
  const actor = db.users.find((u) => u.role === roles.OPERATIONS);

  // Attempt dispatch from unverified quote status
  quote.status = "Approved_Pending_PO";
  assert.throws(
    () => {
      transitionQuote(
        db,
        { id: () => "mock_id", audit: () => {} },
        quote.id,
        "Field_Dispatch",
        {},
        actor
      );
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Illegal transition: Approved_Pending_PO -> Field_Dispatch/);
      return true;
    }
  );
});

// ── 4. Four-Stream Billing Characterisation ─────────────────────────────────
test("Batch 2 Characterisation: Quotes support four streams (Labour, Material, Equipment, Transport)", () => {
  assert.deepEqual(COST_TYPES, ["labour", "material", "equipment", "transport"]);

  const lines = [
    { description: "Lead Artisan Labour", cost_type: "labour", quantity: 10, unit_price: 50, unit_of_measure: "hours" },
    { description: "Wear Resistant Casing Material", cost_type: "material", quantity: 2, unit_price: 1200, unit_of_measure: "each" },
    { description: "Hydraulic Torque Rig Equipment", cost_type: "equipment", quantity: 3, unit_price: 300, unit_of_measure: "days" },
    { description: "Heavy Lowbed Haulage Transport", cost_type: "transport", quantity: 1, unit_price: 850, unit_of_measure: "lot" }
  ];

  const financials = calculateQuoteFinancials({
    lines,
    discountPercent: 5,
    taxStatus: "taxable",
    appliedTaxRate: 0.15
  });

  // Pre-tax = 10*50 + 2*1200 + 3*300 + 1*850 = 500 + 2400 + 900 + 850 = 4650
  assert.equal(financials.pre_tax_total, 4650);
  // Discount 5% of 4650 = 232.50
  assert.equal(financials.discount_amount, 232.5);
  // Net subtotal = 4650 - 232.50 = 4417.50
  assert.equal(financials.net_subtotal, 4417.5);
  // Tax 15% of 4417.50 = 662.63
  assert.equal(financials.tax_total, 662.63);
  // Grand total = 4417.50 + 662.63 = 5080.13
  assert.equal(financials.total_amount, 5080.13);

  // Confirm all 4 streams exist in processed lines
  const costTypes = financials.lines.map((l) => l.cost_type);
  assert.ok(costTypes.includes("labour"));
  assert.ok(costTypes.includes("material"));
  assert.ok(costTypes.includes("equipment"));
  assert.ok(costTypes.includes("transport"));
});
