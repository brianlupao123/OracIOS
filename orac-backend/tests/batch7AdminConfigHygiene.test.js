import assert from "node:assert/strict";
import test from "node:test";
import { roles } from "../src/permissions.js";
import { updateCompanyProfile } from "../src/controllers/adminController.js";
import { createUser, updateUser } from "../src/controllers/adminController.js";
import { transitionQuote, issueLegacyInvoice } from "../src/stateMachine.js";
import { submitClientPo, capturePo } from "../src/controllers/quoteController.js";
import { recordPreDispatchPpe } from "../src/controllers/hseController.js";
import { reviewWorksheet } from "../src/controllers/dispatchController.js";
import { acknowledgeWorksheet } from "../src/controllers/timesheetAcknowledgementController.js";

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
    }
  };
}

function makeBatch7Db() {
  return {
    users: [
      { id: "u_admin", role: roles.ADMIN, name: "Alice Admin", is_active: true },
      { id: "u_mgmt", role: roles.MANAGEMENT, name: "Mark Manager", is_active: true },
      { id: "u_sales", role: roles.SALES, name: "Sam Sales", is_active: true },
      { id: "u_fin", role: roles.FINANCE, name: "Fiona Finance", is_active: true },
      { id: "u_ops", role: roles.OPERATIONS, name: "Oliver Ops", is_active: true },
      { id: "u_sup", role: roles.SUPERVISOR, name: "Simon Supervisor", is_active: true },
      { id: "u_hse", role: "HSE & Quality", name: "Helen HSE", is_active: true },
      { id: "u_tech_lead", role: roles.TECHNICIAN, name: "Tendai Lead Artisan", trade: "Boilermaker", is_active: true },
      { id: "u_client_rep", role: roles.CLIENT_VIEWER, name: "Farai Mine Rep", client_id: "c_mimosa", is_active: true }
    ],
    clients: [
      { id: "c_mimosa", name: "Mimosa Mining Company", is_active: true }
    ],
    mine_sites: [
      { id: "ms_mimosa_south", client_id: "c_mimosa", name: "Mimosa South Shaft", is_active: true }
    ],
    company_profile: {
      company_name: "Orac Systems",
      legal_name: "Handon Enterprises (Pvt) Ltd",
      physical_address: "12 Kelvin Road North, Graniteside, Harare",
      email: "operations@orac.co.zw",
      phone: "+263 242 771 000"
    },
    quotes: [
      {
        id: "q_shutdown_2026",
        quote_number: "Q-MIM-2026-901",
        client_id: "c_mimosa",
        mine_site_id: "ms_mimosa_south",
        status: "Draft",
        total_amount: 45000,
        grand_total_cents: 4500000,
        created_by: "u_sales",
        sales_owner_id: "u_sales",
        created_at: "2026-11-20T08:00:00Z"
      }
    ],
    quote_lines: [
      {
        id: "ql_shut_1",
        quotation_id: "q_shutdown_2026",
        description: "Primary crusher discharge chute relining",
        quantity: 1,
        unit_price: 45000,
        unit_price_cents: 4500000,
        line_total: 45000
      }
    ],
    purchase_orders: [],
    dispatch_cards: [],
    field_worksheets: [],
    invoices: [],
    invoice_lines: [],
    pre_dispatch_ppe_checklists: [],
    artisan_inductions: [
      {
        id: "ind_mim_001",
        technician_id: "u_tech_lead",
        mine_site_id: "ms_mimosa_south",
        induction_number: "MIM-IND-2026-442",
        valid_until: "2027-11-20T00:00:00Z",
        is_active: true
      }
    ],
    audit_logs: [],
    notifications: [],
    pastel_export_batches: [],
    equipment_tags: [],
    plant_sections: [],
    plants: []
  };
}

function makeMockStore() {
  let counter = 500;
  return {
    id(prefix) {
      return `${prefix}_${++counter}`;
    },
    audit(db, actor, entityType, entityId, action, oldVal, newVal) {
      db.audit_logs.push({
        id: `audit_${++counter}`,
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
// TEST 1: Admin Configuration Hygiene & No Silent Defaults
// ---------------------------------------------------------------------------
test("Company profile updates do not silently inject unapproved tax status or rates", () => {
  const db = makeBatch7Db();
  const store = makeMockStore();

  const req = {
    user: { id: "u_admin" },
    db,
    store,
    body: {
      company_name: "Orac Systems (Pvt) Ltd",
      legal_name: "Handon Enterprises (Pvt) Ltd",
      quotation_tax_configuration: {
        approval_reference: "ACC-TAX-2026-V1"
      }
    }
  };
  const res = mockRes();
  updateCompanyProfile(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.success);
  // Tax status must NOT be defaulted to "taxable" when not explicitly supplied
  assert.equal(
    res.body.data.quotation_tax_configuration?.tax_status,
    undefined,
    "Unspecified tax status must remain undefined, requiring explicit accountant selection"
  );
});

test("Admin user creation does not invent hourly pay rates", () => {
  const db = makeBatch7Db();
  const store = makeMockStore();

  const req = {
    user: { id: "u_admin" },
    db,
    store,
    body: {
      name: "New Artisan",
      email: "artisan.new@handon.co.zw",
      password: "ArtisanPassword2026!",
      role: roles.TECHNICIAN,
      trade: "Fitter"
    }
  };
  const res = mockRes();
  createUser(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.success);

  const createdUser = db.users.find((u) => u.email === "artisan.new@handon.co.zw");
  assert.ok(createdUser);
  assert.equal(createdUser.hourly_rate, undefined, "hourly_rate must not be defaulted to 1.06");
  assert.equal(createdUser.ot_15_rate, undefined, "ot_15_rate must not be defaulted to 1.59");
  assert.equal(createdUser.ot_20_rate, undefined, "ot_20_rate must not be defaulted to 2.12");
});

// ---------------------------------------------------------------------------
// TEST 2: Complete Controlled Real Company Workflow Rehearsal
// ---------------------------------------------------------------------------
test("End-to-End Controlled Real Company Commercial & Operational Journey", () => {
  const db = makeBatch7Db();
  const store = makeMockStore();

  // STAGE 1: Sales transitions Quote from Draft -> Sent
  const salesActor = { id: "u_sales", role: roles.SALES, is_active: true };
  transitionQuote(db, store, "q_shutdown_2026", "Sent", {}, salesActor);
  const quote = db.quotes.find((q) => q.id === "q_shutdown_2026");
  assert.equal(quote.status, "Sent");

  // STAGE 2: Management approves Quote for Client PO submission
  const mgmtActor = { id: "u_mgmt", role: roles.MANAGEMENT, is_active: true };
  transitionQuote(db, store, "q_shutdown_2026", "Approved_Pending_PO", {}, mgmtActor);
  assert.equal(quote.status, "Approved_Pending_PO");

  // STAGE 3: Client Viewer submits Purchase Order
  const clientActor = { id: "u_client_rep", role: roles.CLIENT_VIEWER, client_id: "c_mimosa", is_active: true };
  const reqClientPo = {
    user: { id: clientActor.id },
    db,
    store,
    params: { id: quote.id },
    body: {
      po_reference: "MIM-PO-778899",
      po_amount: 45000,
      document_reference: "MIMOSA-SHUTDOWN-CONFIRMATION-2026"
    }
  };
  const resClientPo = mockRes();
  submitClientPo(reqClientPo, resClientPo);
  assert.equal(resClientPo.statusCode, 200);

  // Quote gets commercial acceptance record
  assert.equal(quote.commercial_acceptance_status, "client_accepted");
  assert.equal(quote.commercial_acceptance_reference, "MIM-PO-778899");
  const po = db.purchase_orders.find((p) => p.quotation_id === quote.id);
  assert.ok(po);
  assert.equal(po.status, "pending");

  // Verified-PO Gate: Dispatch is strictly blocked while PO is pending
  assert.throws(
    () => transitionQuote(db, store, quote.id, "Field_Dispatch", {}, { id: "u_ops", role: roles.OPERATIONS, is_active: true }),
    /(Illegal transition|Dispatch is permitted only from PO_Verified status)/i
  );

  // STAGE 4: Finance independently verifies PO
  const finActor = { id: "u_fin", role: roles.FINANCE, is_active: true };
  const reqVerify = {
    user: { id: finActor.id },
    db,
    store,
    params: { id: quote.id },
    body: {
      po_reference: "MIM-PO-778899",
      po_amount: 45000,
      started_before_po: false
    }
  };
  const resVerify = mockRes();
  capturePo(reqVerify, resVerify);
  assert.equal(resVerify.statusCode, 200);
  assert.equal(po.status, "verified");
  assert.equal(quote.status, "PO_Verified");

  // STAGE 5: Operations creates Field Dispatch from PO_Verified quote
  const opsActor = { id: "u_ops", role: roles.OPERATIONS, is_active: true };
  const { created: dispatchCard } = transitionQuote(db, store, quote.id, "Field_Dispatch", {
    assigned_supervisor_id: "u_sup"
  }, opsActor);
  assert.equal(quote.status, "Field_Dispatch");
  assert.ok(dispatchCard);
  dispatchCard.assigned_technician_id = "u_tech_lead";
  dispatchCard.assigned_technician_ids = ["u_tech_lead"];
  dispatchCard.mine_site_id = quote.mine_site_id;

  // STAGE 6: HSE Pre-Dispatch PPE Check & Compliance
  const reqPpe = {
    user: { id: "u_hse" },
    db,
    store,
    body: {
      dispatch_card_id: dispatchCard.id,
      technician_id: "u_tech_lead",
      technician_name: "Tendai Lead Artisan",
      site_location: "Mimosa South Shaft",
      hard_hat_pass: true,
      metatarsal_boots_pass: true,
      heavy_chemical_gloves_pass: true,
      safety_glasses_pass: true,
      high_vis_vest_pass: true,
      respirator_mask_pass: true,
      ear_protection_pass: true,
      fall_arrest_harness_pass: true
    }
  };
  const resPpe = mockRes();
  recordPreDispatchPpe(reqPpe, resPpe);
  assert.equal(resPpe.statusCode, 201);
  assert.ok(resPpe.body.success);

  // STAGE 7: Technician logs Field Worksheet
  const worksheet = {
    id: "fw_shutdown_01",
    worksheet_reference: "FW-MIM-2026-001",
    dispatch_card_id: dispatchCard.id,
    quotation_id: quote.id,
    work_date: "2026-11-21",
    hours: 12,
    hours_logged: 12,
    technician_id: "u_tech_lead",
    submitted_by: "u_tech_lead",
    supervisor_id: "u_sup",
    status: "Submitted",
    activity_description: "Relined crusher feed chutes with 50mm Hardox liner plates",
    created_at: new Date().toISOString()
  };
  db.field_worksheets.push(worksheet);

  // STAGE 8: Client representative acknowledges worksheet on site
  const reqAck = {
    user: { id: clientActor.id },
    db,
    store,
    params: { id: worksheet.id },
    body: {
      client_representative_name: "Farai Mine Rep",
      client_role: "Section Engineer",
      comments: "Crusher chute relining inspected and verified satisfactory"
    }
  };
  const resAck = mockRes();
  acknowledgeWorksheet(reqAck, resAck);
  assert.equal(resAck.statusCode, 200);
  assert.equal(worksheet.status, "Client_Acknowledged");

  // STAGE 9: ORAC Supervisor reviews and approves worksheet
  const supActor = { id: "u_sup", role: roles.SUPERVISOR, is_active: true };
  const reqReview = {
    user: { id: supActor.id },
    db,
    store,
    params: { id: worksheet.id },
    body: {
      decision: "approve",
      comment: "Quality and dimensional checks approved by Simon Supervisor"
    }
  };
  const resReview = mockRes();
  reviewWorksheet(reqReview, resReview);
  assert.equal(resReview.statusCode, 200);
  assert.equal(worksheet.status, "Supervisor_Approved");

  // STAGE 10: Invoicing & Quote completion
  const invoice = issueLegacyInvoice(db, store, quote.id, { id: "u_fin", role: roles.FINANCE, is_active: true });
  assert.ok(invoice);
  assert.equal(invoice.purchase_order_id, po.id);
  assert.equal(invoice.dispatch_card_id, dispatchCard.id);
  assert.equal(invoice.status, "sent");
  assert.equal(quote.status, "Invoiced");

  // Audit trail verification
  assert.ok(db.audit_logs.length >= 8, "Audit trail must record every transition and event");
});
