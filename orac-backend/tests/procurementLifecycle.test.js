import test from "node:test";
import assert from "node:assert/strict";

import {
  createProcurementRequest,
  approveProcurementRequest,
  createSupplierPo,
  receiveGrn,
  issueStoreVoucher,
  performThreeWayMatch
} from "../src/controllers/procurementController.js";

import { verifyThreeWayMatch } from "../src/services/threeWayMatchingService.js";

// Test Harness conforming to ORAC Test World Specifications
function res() {
  return {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

const ROLES = ["Admin", "Management", "Operations", "Finance", "Supervisor", "Technician", "Client Viewer"];

function createTestWorld() {
  let counter = 0;
  const users = ROLES.map(role => ({
    id: `u-${role.toLowerCase()}`,
    role,
    name: `${role} User`,
    is_active: true
  }));

  const db = {
    users,
    suppliers: [
      { id: "sup-1", name: "Dunlop Belting & Rubber Zimbabwe", contact_person: "Tendai Moyo", is_approved: true }
    ],
    procurement_requests: [],
    supplier_pos: [],
    goods_received_notes: [],
    stock_items: [
      { id: "si-1", item_code: "RL-60", item_name: "Rubber Lining Sheet 60 Duro", quantity_on_hand: 5, unit_cost: 120.0, unit_of_measure: "rolls" }
    ],
    stock_movements: [],
    store_issue_vouchers: [],
    audit_logs: []
  };

  const store = {
    id: (prefix) => `${prefix}-${++counter}`,
    audit: (dbRef, actor, entityType, entityId, action, before, after) => {
      dbRef.audit_logs.push({
        id: `aud-${++counter}`,
        actor_id: actor?.id || "u-sys",
        entity_type: entityType,
        entity_id: entityId,
        action,
        timestamp: new Date().toISOString()
      });
    }
  };

  return { db, store };
}

const as = (w, role, req = {}) => ({
  user: { id: `u-${role.toLowerCase()}` },
  db: w.db,
  store: w.store,
  params: {},
  query: {},
  headers: {},
  ...req
});

// ── Test 1: Full Procurement Lifecycle Happy Path ────────────────────────────
test("procurement lifecycle: PR creation -> Approval -> PO Issuance -> GRN Receipt -> SIV -> 3-Way Match", () => {
  const w = createTestWorld();

  // 1. Create Procurement Request
  const prReq = as(w, "Operations", {
    body: {
      department: "Plant Rubber Lining Operations",
      priority: "HIGH",
      justification: "Urgent relining materials for Zimplats Concentrator Sump",
      required_by_date: "2026-11-25",
      items: [
        {
          item_name: "Rubber Lining Sheet 60 Duro",
          item_code: "RL-60",
          category: "Rubber Lining",
          quantity: 10,
          unit_of_measure: "rolls",
          estimated_unit_cost: 120.0
        }
      ]
    }
  });
  const prRes = res();
  createProcurementRequest(prReq, prRes);
  assert.equal(prRes.statusCode, 201);
  const pr = prRes.body.data;
  assert.equal(pr.status, "PENDING_APPROVAL");
  assert.equal(pr.total_estimated_amount, 1200.0);

  // 2. Supervisor / Management Approval
  const appReq = as(w, "Management", {
    params: { id: pr.id },
    body: { action: "APPROVE", comments: "Budget approved against Zimplats PO" }
  });
  const appRes = res();
  approveProcurementRequest(appReq, appRes);
  assert.equal(appRes.statusCode, 200);
  assert.equal(appRes.body.data.status, "APPROVED");

  // 3. Issue Supplier PO
  const poReq = as(w, "Finance", {
    body: {
      procurement_request_id: pr.id,
      supplier_id: "sup-1",
      expected_delivery_date: "2026-11-22",
      payment_terms: "Net 30",
      items: [
        {
          item_code: "RL-60",
          description: "Rubber Lining Sheet 60 Duro 10m",
          quantity: 10,
          unit_price: 115.0,
          unit_of_measure: "rolls",
          tax_rate: 0.15
        }
      ]
    }
  });
  const poRes = res();
  createSupplierPo(poReq, poRes);
  assert.equal(poRes.statusCode, 201);
  const po = poRes.body.data;
  assert.equal(po.status, "ISSUED");
  assert.equal(po.subtotal, 1150.0);
  assert.equal(po.total_amount, 1322.5); // 1150 + 15% tax

  // 4. Storekeeper Receives GRN (Physical Delivery Slip verification)
  const grnReq = as(w, "Operations", {
    body: {
      supplier_po_id: po.id,
      delivery_note_ref: "DN-DUNLOP-88219",
      received_date: "2026-11-20",
      items: [
        {
          item_code: "RL-60",
          received_quantity: 10,
          rejected_quantity: 0,
          storage_location: "Warehouse Bay R-3"
        }
      ]
    }
  });
  const grnRes = res();
  receiveGrn(grnReq, grnRes);
  assert.equal(grnRes.statusCode, 201);
  const grn = grnRes.body.data;
  assert.equal(grn.delivery_note_ref, "DN-DUNLOP-88219");

  // Verify stock was incremented: Initial 5 + Received 10 = 15 rolls
  const stockItem = w.db.stock_items.find(s => s.item_code === "RL-60");
  assert.equal(stockItem.quantity_on_hand, 15);
  // Verify stock movement logged with source document reference
  const movIn = w.db.stock_movements.find(m => m.movement_type === "in");
  assert.equal(movIn.source_document_ref, "DN-DUNLOP-88219");
  assert.equal(movIn.quantity, 10);

  // 5. Issue Store Issue Voucher (SIV) for Technician Dispatch Job
  const sivReq = as(w, "Operations", {
    body: {
      dispatch_card_id: "JOB-2026-ZIMPLATS-01",
      technician_id: "u-technician",
      requested_by: "Supervisor Lead",
      purpose: "Slurry Sump Reline Execution",
      items: [
        {
          stock_item_id: stockItem.id,
          quantity: 4
        }
      ]
    }
  });
  const sivRes = res();
  issueStoreVoucher(sivReq, sivRes);
  assert.equal(sivRes.statusCode, 201);
  assert.equal(stockItem.quantity_on_hand, 11); // 15 - 4 = 11

  // 6. Perform 3-Way Match with Supplier Commercial Invoice
  const matchReq = as(w, "Finance", {
    body: {
      supplier_po_id: po.id,
      grn_id: grn.id,
      invoice: {
        invoice_number: "INV-DUNLOP-2026-904",
        total_amount: 1150.0,
        items: [
          {
            item_code: "RL-60",
            description: "Rubber Lining Sheet 60 Duro",
            quantity: 10,
            unit_price: 115.0
          }
        ]
      }
    }
  });
  const matchRes = res();
  performThreeWayMatch(matchReq, matchRes);
  assert.equal(matchRes.statusCode, 200);
  const match = matchRes.body.data;
  assert.equal(match.is_match, true);
  assert.equal(match.can_proceed_to_payment, true);
  assert.equal(match.match_status, "MATCH_PASSED");
  assert.equal(match.discrepancies.length, 0);
});

// ── Test 2: Unapproved PR blocks PO Issuance ─────────────────────────────────
test("security gate: PO cannot be issued against an unapproved or pending PR", () => {
  const w = createTestWorld();

  // Create pending PR
  const prRes = res();
  createProcurementRequest(as(w, "Operations", {
    body: {
      department: "Conveyor Splicing",
      priority: "MEDIUM",
      justification: "Cold bonding cement",
      required_by_date: "2026-11-30",
      items: [{ item_name: "Bonding Cement", category: "Consumables", quantity: 5, unit_of_measure: "cans", estimated_unit_cost: 30 }]
    }
  }), prRes);
  const pr = prRes.body.data;

  // Attempt to issue PO immediately without approval
  const poRes = res();
  createSupplierPo(as(w, "Finance", {
    body: {
      procurement_request_id: pr.id,
      supplier_id: "sup-1",
      expected_delivery_date: "2026-12-01",
      items: [{ item_code: "BC-1", description: "Bonding Cement", quantity: 5, unit_price: 30, unit_of_measure: "cans" }]
    }
  }), poRes);

  assert.equal(poRes.statusCode, 400);
  assert.match(poRes.body.message, /PR must be APPROVED first/);
});

// ── Test 3: Positive Balance Guard: SIV blocked on insufficient stock ─────────
test("stores safeguard: SIV is strictly rejected when requested quantity exceeds stock on hand", () => {
  const w = createTestWorld();
  const stockItem = w.db.stock_items[0]; // quantity_on_hand: 5

  const sivRes = res();
  issueStoreVoucher(as(w, "Operations", {
    body: {
      technician_id: "u-technician",
      requested_by: "Supervisor Lead",
      purpose: "Unauthorized bulk pull",
      items: [
        {
          stock_item_id: stockItem.id,
          quantity: 20 // Exceeds available stock of 5
        }
      ]
    }
  }), sivRes);

  assert.equal(sivRes.statusCode, 400);
  assert.match(sivRes.body.message, /Insufficient stock/);
  assert.equal(stockItem.quantity_on_hand, 5, "Stock level must remain completely unchanged");
});

// ── Test 4: Three-Way Match: Price variance discrepancy blocks payment ───────
test("fraud prevention: 3-Way Match blocks payment when supplier overbills unit price", () => {
  const supplierPo = {
    id: "po-101",
    po_number: "PO-101",
    items: [{ item_code: "PUMP-IMP-01", description: "Slurry Impeller 4/3", quantity: 2, unit_price: 450.0 }]
  };
  const grn = {
    id: "grn-201",
    grn_number: "GRN-201",
    items: [{ item_code: "PUMP-IMP-01", received_quantity: 2 }]
  };
  // Supplier invoices at $500 instead of agreed PO price of $450
  const inflatedInvoice = {
    invoice_number: "INV-OVERBILL-99",
    total_amount: 1000.0,
    items: [{ item_code: "PUMP-IMP-01", quantity: 2, unit_price: 500.0 }]
  };

  const result = verifyThreeWayMatch({
    supplierPo,
    grn,
    supplierInvoice: inflatedInvoice,
    tolerancePercent: 0.0
  });

  assert.equal(result.is_match, false);
  assert.equal(result.can_proceed_to_payment, false);
  assert.equal(result.match_status, "DISCREPANCY_BLOCKED");
  assert.match(result.discrepancies[0], /Price mismatch on 'PUMP-IMP-01'/);
});

// ── Test 5: Three-Way Match: Invoicing for unreceived goods blocks payment ────
test("fraud prevention: 3-Way Match blocks payment when supplier bills for unreceived items", () => {
  const supplierPo = {
    id: "po-102",
    po_number: "PO-102",
    items: [{ item_code: "VALVE-KNIFE-8", description: "Knife Gate Valve 8 inch", quantity: 4, unit_price: 300.0 }]
  };
  // Only 2 valves arrived physically at the warehouse
  const grn = {
    id: "grn-202",
    grn_number: "GRN-202",
    items: [{ item_code: "VALVE-KNIFE-8", received_quantity: 2 }]
  };
  // Supplier bills for all 4 valves ($1,200)
  const prematureInvoice = {
    invoice_number: "INV-PREMATURE-01",
    total_amount: 1200.0,
    items: [{ item_code: "VALVE-KNIFE-8", quantity: 4, unit_price: 300.0 }]
  };

  const result = verifyThreeWayMatch({
    supplierPo,
    grn,
    supplierInvoice: prematureInvoice,
    tolerancePercent: 0.0
  });

  assert.equal(result.is_match, false);
  assert.equal(result.can_proceed_to_payment, false);
  assert.match(result.discrepancies[0], /Quantity mismatch on 'VALVE-KNIFE-8': Billed 4 units, but only 2 units were verified/);
});
