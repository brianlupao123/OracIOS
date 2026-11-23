import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  approveProcurementRequest,
  createSupplierPo,
  receiveGrn,
  issueStoreVoucher
} from "../src/controllers/procurementController.js";
import { addMaterialUsage } from "../src/controllers/dispatchController.js";
import { hasPermission, roles } from "../src/permissions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    }
  };
}

function makeMockDb() {
  return {
    users: [
      { id: "u_admin", role: roles.ADMIN, name: "Alice Admin", is_active: true },
      { id: "u_mgmt", role: roles.MANAGEMENT, name: "Mark Manager", is_active: true },
      { id: "u_proc", role: roles.PROCUREMENT, name: "Penny Procurement", is_active: true },
      { id: "u_ops", role: roles.OPERATIONS, name: "Oliver Ops", is_active: true },
      { id: "u_tech", role: roles.TECHNICIAN, name: "Tom Tech", is_active: true }
    ],
    suppliers: [
      { id: "sup_active", name: "Rubber Products Ltd", is_active: true, lead_time_days: 3 },
      { id: "sup_inactive", name: "Defunct Chem Supplies", is_active: false, lead_time_days: 10 }
    ],
    stock_items: [
      {
        id: "si_rubber",
        item_code: "RUBBER-LIN-4MM",
        item_name: "4mm Pre-cured Neoprene Rubber",
        unit_of_measure: "rolls",
        quantity_on_hand: 50,
        reorder_level: 10,
        unit_cost: 120,
        catalog_item_id: "cat_rubber"
      }
    ],
    procurement_requests: [
      {
        id: "pr_001",
        request_number: "PR-202611-001",
        department: "Maintenance",
        priority: "HIGH",
        justification: "Critical reline stock",
        status: "PENDING_APPROVAL",
        requested_by: "u_proc",
        requested_by_name: "Penny Procurement",
        items: [
          { item_name: "Rubber Lining", quantity: 10, unit_of_measure: "rolls", estimated_unit_cost: 120 }
        ]
      }
    ],
    supplier_pos: [],
    goods_received_notes: [],
    store_issue_vouchers: [],
    material_usage: [],
    stock_movements: [],
    dispatch_cards: [
      {
        id: "dc_job_1",
        dispatch_number: "JOB-2026-001",
        quotation_id: "q_1",
        purchase_order_id: "po_client_1",
        assigned_supervisor_id: "u_ops",
        assigned_technician_ids: ["u_tech"],
        assigned_technician_id: "u_tech",
        status: "In_Progress"
      }
    ],
    audit_log: []
  };
}

const mockStore = {
  id: (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  audit: (db, actor, entity, entityId, action, details) => {
    db.audit_log = db.audit_log || [];
    db.audit_log.push({ at: new Date().toISOString(), actor, entity, entityId, action, details });
  },
  recalculateVariance: () => {}
};

test("Batch 4: Procurement Request Maker-Checker Segregation — self-approval refused", () => {
  const db = makeMockDb();

  // 1. Requester (Penny Procurement) cannot approve their own PR
  const reqSelf = {
    params: { id: "pr_001" },
    body: { action: "APPROVE", comments: "Self approving" },
    user: { id: "u_proc", role: roles.PROCUREMENT },
    db,
    store: mockStore
  };
  const resSelf = mockRes();
  approveProcurementRequest(reqSelf, resSelf);
  assert.equal(resSelf.statusCode, 403);
  assert.match(resSelf.body.message, /Cannot approve or reject your own procurement request/i);

  // 2. Independent Management Officer approves successfully
  const reqMgmt = {
    params: { id: "pr_001" },
    body: { action: "APPROVE", comments: "Approved for ordering" },
    user: { id: "u_mgmt", role: roles.MANAGEMENT },
    db,
    store: mockStore
  };
  const resMgmt = mockRes();
  approveProcurementRequest(reqMgmt, resMgmt);
  assert.equal(resMgmt.statusCode, 200);
  assert.equal(resMgmt.body.data.status, "APPROVED");
});

test("Batch 4: Supplier PO — inactive supplier refusal", () => {
  const db = makeMockDb();

  // 1. Attempting to issue Supplier PO to inactive supplier is refused
  const reqInactive = {
    body: {
      supplier_id: "sup_inactive",
      expected_delivery_date: "2026-12-15",
      payment_terms: "Net 30",
      items: [
        { item_code: "RUBBER-LIN-4MM", description: "Rubber", quantity: 5, unit_price: 120, unit_of_measure: "rolls" }
      ]
    },
    user: { id: "u_proc", role: roles.PROCUREMENT },
    db,
    store: mockStore
  };
  const resInactive = mockRes();
  createSupplierPo(reqInactive, resInactive);
  assert.equal(resInactive.statusCode, 400);
  assert.match(resInactive.body.message, /Cannot issue purchase order to inactive supplier/i);

  // 2. Issuing Supplier PO to active supplier succeeds
  const reqActive = {
    body: {
      supplier_id: "sup_active",
      expected_delivery_date: "2026-12-15",
      payment_terms: "Net 30",
      items: [
        { item_code: "RUBBER-LIN-4MM", description: "Rubber", quantity: 20, unit_price: 120, unit_of_measure: "rolls" }
      ]
    },
    user: { id: "u_proc", role: roles.PROCUREMENT },
    db,
    store: mockStore
  };
  const resActive = mockRes();
  createSupplierPo(reqActive, resActive);
  assert.equal(resActive.statusCode, 201);
  assert.equal(resActive.body.data.supplier_id, "sup_active");
  assert.equal(resActive.body.data.status, "ISSUED");
});

test("Batch 4: Goods Receipt (GRN) — over-receipt refused & partial receipt status", () => {
  const db = makeMockDb();

  // Setup issued supplier PO for 10 units
  const po = {
    id: "po_sup_1",
    po_number: "PO-SUP-001",
    supplier_id: "sup_active",
    supplier_name: "Rubber Products Ltd",
    status: "ISSUED",
    items: [
      { item_code: "RUBBER-LIN-4MM", description: "4mm Rubber", quantity: 10, unit_price: 120, unit_of_measure: "rolls" }
    ]
  };
  db.supplier_pos.push(po);

  // 1. Over-receipt attempt (15 units when 10 authorized) is refused
  const reqOver = {
    body: {
      supplier_po_id: "po_sup_1",
      delivery_note_ref: "DN-9901",
      received_date: "2026-11-22",
      items: [
        { item_code: "RUBBER-LIN-4MM", received_quantity: 15, storage_location: "Central Stores" }
      ]
    },
    user: { id: "u_proc", role: roles.PROCUREMENT },
    db,
    store: mockStore
  };
  const resOver = mockRes();
  receiveGrn(reqOver, resOver);
  assert.equal(resOver.statusCode, 400);
  assert.match(resOver.body.message, /Over-receipt rejected/i);

  // 2. Partial receipt (4 units) sets PO to PARTIALLY_RECEIVED
  const reqPartial = {
    body: {
      supplier_po_id: "po_sup_1",
      delivery_note_ref: "DN-9902",
      received_date: "2026-11-22",
      items: [
        { item_code: "RUBBER-LIN-4MM", received_quantity: 4, storage_location: "Central Stores" }
      ]
    },
    user: { id: "u_proc", role: roles.PROCUREMENT },
    db,
    store: mockStore
  };
  const beforeRefusal = structuredClone(db);
  const refused = mockRes();
  receiveGrn({ ...reqPartial, user: { id: "u_tech" } }, refused);
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(db, beforeRefusal);

  const resPartial = mockRes();
  receiveGrn(reqPartial, resPartial);
  assert.equal(resPartial.statusCode, 201);
  assert.equal(po.status, "PARTIALLY_RECEIVED");
  assert.equal(db.stock_items.find((s) => s.id === "si_rubber").quantity_on_hand, 54);

  // 3. Final receipt (remaining 6 units) sets PO to RECEIVED
  const reqFinal = {
    body: {
      supplier_po_id: "po_sup_1",
      delivery_note_ref: "DN-9903",
      received_date: "2026-11-23",
      items: [
        { item_code: "RUBBER-LIN-4MM", received_quantity: 6, storage_location: "Central Stores" }
      ]
    },
    user: { id: "u_proc", role: roles.PROCUREMENT },
    db,
    store: mockStore
  };
  const resFinal = mockRes();
  receiveGrn(reqFinal, resFinal);
  assert.equal(resFinal.statusCode, 201);
  assert.equal(po.status, "RECEIVED");
  assert.equal(db.stock_items.find((s) => s.id === "si_rubber").quantity_on_hand, 60);
});

test("Batch 4: Stock Double-Deduction Prevention — SIV issuance vs Worksheet Material Usage", () => {
  const db = makeMockDb();
  const stockItem = db.stock_items[0]; // starts with 50 rolls

  // 1. Issue Store Issue Voucher (SIV) for 10 rolls to dispatch dc_job_1
  const reqSiv = {
    body: {
      dispatch_card_id: "dc_job_1",
      technician_id: "u_tech",
      requested_by: "Oliver Ops",
      purpose: "Conveyor chute relining",
      items: [{ stock_item_id: "si_rubber", quantity: 10 }]
    },
    user: { id: "u_proc", role: roles.PROCUREMENT },
    db,
    store: mockStore
  };
  const resSiv = mockRes();
  issueStoreVoucher(reqSiv, resSiv);
  assert.equal(resSiv.statusCode, 201);
  assert.equal(stockItem.quantity_on_hand, 40, "Central Stores stock deducted by 10 upon SIV issuance");

  // 2. Technician records field usage of 10 rolls against the dispatch card
  // This must NOT deduct Central Stores stock again (already deducted via SIV)
  const reqUsage1 = {
    params: { id: "dc_job_1" },
    headers: {},
    body: {
      catalog_item_id: "cat_rubber",
      description: "4mm Neoprene lining installed on chute",
      quantity_used: 10,
      unit_cost: 120,
      unit_of_measure: "rolls"
    },
    user: { id: "u_tech", role: roles.TECHNICIAN },
    db,
    store: mockStore
  };
  const resUsage1 = mockRes();
  addMaterialUsage(reqUsage1, resUsage1);
  assert.equal(resUsage1.statusCode, 200);
  assert.equal(resUsage1.body.success, true);
  assert.equal(stockItem.quantity_on_hand, 40, "Central Stores stock remains 40 — NO double deduction!");
  assert.equal(resUsage1.body.stock_deducted?.quantity, 0, "Deduction quantity is 0 because SIV custody covered it");
  assert.equal(resUsage1.body.stock_deducted?.siv_custody_drawn, 10);

  // 3. Excess usage (technician used 3 additional rolls not on the SIV)
  // Only the excess 3 rolls should be deducted from Central Stores
  const reqUsage2 = {
    params: { id: "dc_job_1" },
    headers: {},
    body: {
      catalog_item_id: "cat_rubber",
      description: "Extra 3 rolls needed for chute extension",
      quantity_used: 3,
      unit_cost: 120,
      unit_of_measure: "rolls"
    },
    user: { id: "u_tech", role: roles.TECHNICIAN },
    db,
    store: mockStore
  };
  const resUsage2 = mockRes();
  addMaterialUsage(reqUsage2, resUsage2);
  assert.equal(resUsage2.statusCode, 200);
  assert.equal(resUsage2.body.success, true);
  assert.equal(stockItem.quantity_on_hand, 37, "Central Stores stock reduced by 3 for the un-issued excess");
  assert.equal(Math.abs(resUsage2.body.stock_deducted?.quantity), 3);
});

test("Batch 4: Role Parity & Clean UI Defaults", () => {
  // Procurement & Stores has dedicated stores governance permissions
  const procActor = { id: "u_proc", role: roles.PROCUREMENT, is_active: true };
  assert.equal(hasPermission(procActor, "receiveGoods"), true, "Procurement & Stores must hold receiveGoods");
  assert.equal(hasPermission(procActor, "issueFromStore"), true, "Procurement & Stores must hold issueFromStore");
  assert.equal(hasPermission(procActor, "manageThreeWayMatch"), true, "Procurement & Stores must hold manageThreeWayMatch");

  // Pinned legacy manageInventory is Admin, Management and Operations only
  assert.equal(hasPermission(procActor, "manageInventory"), false, "Procurement operates via dedicated stores endpoints");

  // ProcurementPage.jsx contains zero synthetic u-tech fallbacks or fake defaults
  const pagePath = path.resolve(__dirname, "../../orac-ios-frontend/src/pages/ProcurementPage.jsx");
  assert.ok(fs.existsSync(pagePath));
  const content = fs.readFileSync(pagePath, "utf8");
  assert.equal(content.includes('|| "u-tech"'), false, "Must not contain synthetic 'u-tech' fallback");
  assert.equal(content.includes('purpose: "Conveyor Belt Cold Splicing & Rubber Lining"'), false, "Must not contain fake dummy purpose string");
});
