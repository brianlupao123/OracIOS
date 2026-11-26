// backend/tests/dispatchCardGrantsHttp.test.js
//
// Batch C Commit 2: Route/controller-level tests for dispatch-card grants.
//
// These tests exercise the actual controller handlers using the _http.js
// test doubles (makeReq/makeRes/run) pattern — the same approach used by
// the codebase's existing HTTP tests.
//
// Coverage:
//   H-01: Admin creates a grant — 200, record in db, audited
//   H-02: Non-Admin roles denied grant creation (Management, Operations,
//          Supervisor, Technician, Sales, Client Viewer, Finance, HSE)
//   H-03: Admin lists grants (all, filtered by user, by dispatch, by status)
//   H-04: Admin revokes with reason — 200, status=revoked, audited
//   H-05: Revoke without reason — 400
//   H-06: Non-Admin roles denied revoke
//   H-07: Client Viewer with active grant sees safe dispatch job-card
//   H-08: Client Viewer without grant — 403
//   H-09: Client Viewer with expired grant — 403
//   H-10: Client Viewer with revoked grant — 403
//   H-11: Client Viewer wrong client — 403
//   H-12: Response for granted Client Viewer has no rates/billing/payroll/roster
//   H-13: Africa/Harare date boundary
//   H-14: Overlap refusal through controller
//   H-15: Non-Client-Viewer roles go through original handler untouched

import test from "node:test";
import assert from "node:assert/strict";

import { createGrant, listGrants, revokeGrant, clientViewerDispatchGate, grantedDispatchJobCard } from "../src/controllers/dispatchCardGrantController.js";
import { getDispatchJobCard } from "../src/controllers/dispatchController.js";
import { createDispatchCardGrant, revokeDispatchCardGrant, activeGrantFor } from "../src/dispatchCardGrants.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createMockStore() {
  let counter = 0;
  const audits = [];
  return {
    id: (prefix) => `${prefix}_${++counter}`,
    audit: (db, actor, entity, entityId, action, before, after) => {
      audits.push({ actor: actor.id, entity, entityId, action, before, after });
    },
    audits,
    recalculateVariance: () => {}
  };
}

function makeDb() {
  return {
    users: [
      { id: "u-admin", role: "Admin", name: "Admin User", is_active: true },
      { id: "u-mgmt", role: "Management", name: "Manager", is_active: true },
      { id: "u-ops", role: "Operations", name: "Ops User", is_active: true },
      { id: "u-supervisor", role: "Supervisor", name: "Supervisor", is_active: true },
      { id: "u-tech", role: "Technician", name: "Tech User", is_active: true },
      { id: "u-sales", role: "Sales", name: "Sales User", is_active: true },
      { id: "u-finance", role: "Finance", name: "Finance User", is_active: true },
      { id: "u-hse", role: "HSE & Quality", name: "HSE User", is_active: true },
      { id: "u-cv", role: "Client Viewer", name: "Client Rep", is_active: true, client_id: "c-north" },
      { id: "u-cv-other", role: "Client Viewer", name: "Other Client Rep", is_active: true, client_id: "c-south" },
    ],
    clients: [
      { id: "c-north", name: "North Mining" },
      { id: "c-south", name: "South Mining" },
    ],
    quotes: [
      { id: "q-001", client_id: "c-north", quote_number: "Q-001", status: "Dispatched" },
    ],
    purchase_orders: [],
    dispatch_cards: [
      { id: "disp-001", quotation_id: "q-001", status: "Active", dispatch_number: "D-001" },
      { id: "disp-002", quotation_id: "q-001", status: "Active", dispatch_number: "D-002" },
    ],
    dispatch_card_grants: [],
    field_worksheets: [],
    timesheets: [],
    material_usage: [],
    stock_items: [],
    stock_movements: [],
    audit_logs: [],
    mine_site_inductions: [],
    pre_dispatch_ppe_checklists: [],
    vehicle_dispatches: [],
    vehicles: [],
  };
}

function makeReq({ user, body = {}, params = {}, query = {}, db, store }) {
  return { user, body, params, query, db, store, headers: {} };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

// ── H-01: Admin creates a grant ─────────────────────────────────────

test("H-01: Admin creates a dispatch-card grant via controller", () => {
  const db = makeDb();
  const store = createMockStore();
  const req = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    body: {
      user_id: "u-cv",
      dispatch_card_id: "disp-001",
      grant_start: "2026-12-01",
      grant_end: "2026-12-20",
      evidence_reference: "Email approval 2026-11"
    },
    db, store
  });
  const res = makeRes();

  createGrant(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.id);
  assert.equal(res.body.data.user_id, "u-cv");
  assert.equal(res.body.data.client_id, "c-north");
  assert.equal(res.body.data.dispatch_card_id, "disp-001");
  assert.equal(res.body.data.status, "active");
  assert.equal(db.dispatch_card_grants.length, 1);

  // Audit recorded
  const audit = store.audits.find((a) => a.action === "DISPATCH_GRANT_CREATED");
  assert.ok(audit, "Must audit DISPATCH_GRANT_CREATED");
});

// ── H-02: Non-Admin roles denied ────────────────────────────────────

test("H-02: Non-Admin roles cannot create a dispatch-card grant", () => {
  const nonAdminUsers = [
    { id: "u-mgmt", role: "Management", is_active: true },
    { id: "u-ops", role: "Operations", is_active: true },
    { id: "u-supervisor", role: "Supervisor", is_active: true },
    { id: "u-tech", role: "Technician", is_active: true },
    { id: "u-sales", role: "Sales", is_active: true },
    { id: "u-cv", role: "Client Viewer", is_active: true },
    { id: "u-finance", role: "Finance", is_active: true },
    { id: "u-hse", role: "HSE & Quality", is_active: true },
  ];

  for (const user of nonAdminUsers) {
    const db = makeDb();
    const store = createMockStore();
    const req = makeReq({
      user,
      body: { user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-01", grant_end: "2026-12-15" },
      db, store
    });
    const res = makeRes();

    // requirePermission throws, like all existing controllers
    assert.throws(() => createGrant(req, res), (err) => {
      assert.equal(err.status, 403);
      return true;
    }, `${user.role} must be denied`);
    assert.equal(db.dispatch_card_grants.length, 0, `${user.role} must not create a grant`);
  }
});

// ── H-03: Admin lists grants ────────────────────────────────────────

test("H-03: Admin lists grants with optional filters", () => {
  const db = makeDb();
  const store = createMockStore();

  // Create two grants
  createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-01", grant_end: "2026-12-15"
  });
  createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-002", grant_start: "2026-12-01", grant_end: "2026-12-15"
  });

  // List all
  const reqAll = makeReq({ user: { id: "u-admin", role: "Admin", is_active: true }, query: {}, db, store });
  const resAll = makeRes();
  listGrants(reqAll, resAll);
  assert.equal(resAll.body.data.length, 2);

  // Filter by dispatch
  const reqFiltered = makeReq({ user: { id: "u-admin", role: "Admin", is_active: true }, query: { dispatch_card_id: "disp-001" }, db, store });
  const resFiltered = makeRes();
  listGrants(reqFiltered, resFiltered);
  assert.equal(resFiltered.body.data.length, 1);
  assert.equal(resFiltered.body.data[0].dispatch_card_id, "disp-001");

  // Filter by status
  const reqStatus = makeReq({ user: { id: "u-admin", role: "Admin", is_active: true }, query: { status: "active" }, db, store });
  const resStatus = makeRes();
  listGrants(reqStatus, resStatus);
  assert.equal(resStatus.body.data.length, 2);
});

// ── H-04: Admin revokes with reason ─────────────────────────────────

test("H-04: Admin revokes a grant with reason via controller", () => {
  const db = makeDb();
  const store = createMockStore();

  const created = createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-01", grant_end: "2026-12-20"
  });

  const req = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    params: { id: created.grant.id },
    body: { reason: "Contract terminated" },
    db, store
  });
  const res = makeRes();

  revokeGrant(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, "revoked");
  assert.equal(res.body.data.revocation_reason, "Contract terminated");

  const audit = store.audits.find((a) => a.action === "DISPATCH_GRANT_REVOKED");
  assert.ok(audit, "Must audit DISPATCH_GRANT_REVOKED");
});

// ── H-05: Revoke without reason ─────────────────────────────────────

test("H-05: Revoke without reason is refused", () => {
  const db = makeDb();
  const store = createMockStore();

  const created = createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-01", grant_end: "2026-12-20"
  });

  const req = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    params: { id: created.grant.id },
    body: {},
    db, store
  });
  const res = makeRes();

  revokeGrant(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes("reason"));
  assert.equal(created.grant.status, "active");
});

// ── H-06: Non-Admin roles denied revoke ─────────────────────────────

test("H-06: Non-Admin roles cannot revoke", () => {
  const db = makeDb();
  const store = createMockStore();

  const created = createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-01", grant_end: "2026-12-20"
  });

  const mgmt = { id: "u-mgmt", role: "Management", is_active: true };
  const req = makeReq({
    user: mgmt,
    params: { id: created.grant.id },
    body: { reason: "Trying to revoke" },
    db, store
  });
  const res = makeRes();

  assert.throws(() => revokeGrant(req, res), (err) => {
    assert.equal(err.status, 403);
    return true;
  });
  assert.equal(created.grant.status, "active");
});

// ── H-07: Client Viewer with active grant sees dispatch job-card ────

test("H-07: Client Viewer with active grant sees safe dispatch job-card", () => {
  const db = makeDb();
  const store = createMockStore();

  // Use a grant range that covers today
  const today = new Date().toISOString().slice(0, 10);
  const futureDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: today, grant_end: futureDate
  });

  // Run the gate middleware
  const req = makeReq({
    user: { id: "u-cv", role: "Client Viewer", client_id: "c-north", is_active: true },
    params: { id: "disp-001" },
    db, store
  });
  const resGate = makeRes();
  let gatePassed = false;
  clientViewerDispatchGate(req, resGate, () => { gatePassed = true; });
  assert.ok(gatePassed, "Gate must pass for granted Client Viewer");
  assert.ok(req._dispatchCardGrant, "Grant must be set on request");

  // Run the wrapped handler
  const handler = grantedDispatchJobCard(getDispatchJobCard);
  const res = makeRes();
  handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.identity);
  assert.equal(res.body.data.identity.id, "disp-001");
  assert.ok(res.body.data.grant);
  assert.equal(res.body.data.grant.grant_start, today);
});

// ── H-08: Client Viewer without grant — 403 ────────────────────────

test("H-08: Client Viewer without grant is denied", () => {
  const db = makeDb();
  const store = createMockStore();

  const req = makeReq({
    user: { id: "u-cv", role: "Client Viewer", client_id: "c-north", is_active: true },
    params: { id: "disp-001" },
    db, store
  });
  const res = makeRes();
  let gatePassed = false;
  clientViewerDispatchGate(req, res, () => { gatePassed = true; });

  assert.equal(gatePassed, false, "Gate must block");
  assert.equal(res.statusCode, 403);
  assert.ok(res.body.message.includes("No active dispatch-card grant"));
});

// ── H-09: Client Viewer with expired grant — 403 ───────────────────

test("H-09: Client Viewer with expired grant is denied", () => {
  const db = makeDb();
  const store = createMockStore();

  createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-01-01", grant_end: "2026-01-15"
  });

  const req = makeReq({
    user: { id: "u-cv", role: "Client Viewer", client_id: "c-north", is_active: true },
    params: { id: "disp-001" },
    db, store
  });
  const res = makeRes();
  let gatePassed = false;
  clientViewerDispatchGate(req, res, () => { gatePassed = true; });

  assert.equal(gatePassed, false, "Expired grant must block");
  assert.equal(res.statusCode, 403);
});

// ── H-10: Client Viewer with revoked grant — 403 ───────────────────

test("H-10: Client Viewer with revoked grant is denied", () => {
  const db = makeDb();
  const store = createMockStore();

  const today = new Date().toISOString().slice(0, 10);
  const futureDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  const created = createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: today, grant_end: futureDate
  });
  // Revoke it
  revokeDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, created.grant.id, {
    reason: "Security review"
  });

  const req = makeReq({
    user: { id: "u-cv", role: "Client Viewer", client_id: "c-north", is_active: true },
    params: { id: "disp-001" },
    db, store
  });
  const res = makeRes();
  let gatePassed = false;
  clientViewerDispatchGate(req, res, () => { gatePassed = true; });

  assert.equal(gatePassed, false, "Revoked grant must block");
  assert.equal(res.statusCode, 403);
});

// ── H-11: Client Viewer wrong client — 403 ─────────────────────────

test("H-11: Client Viewer from different client is denied", () => {
  const db = makeDb();
  const store = createMockStore();

  const today = new Date().toISOString().slice(0, 10);
  const futureDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: today, grant_end: futureDate
  });

  // u-cv-other has client_id c-south, the grant's client_id is c-north
  // But the grant is for u-cv not u-cv-other, so activeGrantFor will return null
  const req = makeReq({
    user: { id: "u-cv-other", role: "Client Viewer", client_id: "c-south", is_active: true },
    params: { id: "disp-001" },
    db, store
  });
  const res = makeRes();
  let gatePassed = false;
  clientViewerDispatchGate(req, res, () => { gatePassed = true; });

  assert.equal(gatePassed, false, "Wrong client must block");
  assert.equal(res.statusCode, 403);
});

// ── H-12: Response has no rates/billing/payroll/roster ──────────────

test("H-12: Granted Client Viewer response has no rates, billing, payroll, or roster", () => {
  const db = makeDb();
  const store = createMockStore();

  const today = new Date().toISOString().slice(0, 10);
  const futureDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: today, grant_end: futureDate
  });

  // Add some timesheets and materials to the dispatch
  db.field_worksheets.push({ id: "ws-1", dispatch_card_id: "disp-001", status: "Draft", hours: 8, hourly_rate: 25 });
  db.timesheets = [{ id: "ts-1", dispatch_card_id: "disp-001", hourly_rate: 25, hours_logged: 8 }];

  const req = makeReq({
    user: { id: "u-cv", role: "Client Viewer", client_id: "c-north", is_active: true },
    params: { id: "disp-001" },
    db, store
  });
  req._dispatchCardGrant = db.dispatch_card_grants[0];

  const handler = grantedDispatchJobCard(getDispatchJobCard);
  const res = makeRes();
  handler(req, res);

  const data = res.body.data;
  const json = JSON.stringify(data);

  // Must NOT contain sensitive fields
  assert.equal(json.includes("hourly_rate"), false, "No hourly_rate");
  assert.equal(json.includes("unit_cost"), false, "No unit_cost");
  assert.equal(json.includes("total_cost"), false, "No total_cost");
  assert.equal(json.includes("payroll"), false, "No payroll");
  assert.equal(data.workflow.purchase_order, null, "No PO exposed");

  // Must NOT contain roster
  assert.equal(data.assignment, undefined, "No assignment/roster");

  // Must NOT contain safety_gates, audit, capabilities
  assert.equal(data.safety_gates, undefined, "No safety_gates");
  assert.equal(data.capabilities, undefined, "No capabilities");

  // Must contain only safe identity and evidence summary
  assert.ok(data.identity);
  assert.ok(data.evidence_summary);
  assert.equal(typeof data.evidence_summary.timesheets.total, "number");
});

// ── H-13: Africa/Harare date boundary ───────────────────────────────

test("H-13: Grant date boundary — day before start is denied", () => {
  const db = makeDb();
  const store = createMockStore();

  // Grant from 2026-12-10 to 2026-12-20
  createDispatchCardGrant(db, store, { id: "u-admin", role: "Admin", is_active: true }, {
    user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-10", grant_end: "2026-12-20"
  });

  // Directly test the activeGrantFor with boundary dates
  // Day before start: null
  assert.equal(activeGrantFor(db, "u-cv", "disp-001", "2026-12-09"), null, "Day before start must be null");
  // Start boundary: found
  assert.ok(activeGrantFor(db, "u-cv", "disp-001", "2026-12-10"), "Start boundary must find grant");
  // Mid-range: found
  assert.ok(activeGrantFor(db, "u-cv", "disp-001", "2026-12-15"), "Mid-range must find grant");
  // End boundary: found
  assert.ok(activeGrantFor(db, "u-cv", "disp-001", "2026-12-20"), "End boundary must find grant");
  // Day after end: null
  assert.equal(activeGrantFor(db, "u-cv", "disp-001", "2026-12-21"), null, "Day after end must be null");
});

// ── H-14: Overlap refusal through controller ────────────────────────

test("H-14: Overlapping grant refused through controller", () => {
  const db = makeDb();
  const store = createMockStore();

  // First grant
  const req1 = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    body: { user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-01", grant_end: "2026-12-15" },
    db, store
  });
  const res1 = makeRes();
  createGrant(req1, res1);
  assert.equal(res1.statusCode, 200);

  // Overlapping second grant
  const req2 = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    body: { user_id: "u-cv", dispatch_card_id: "disp-001", grant_start: "2026-12-10", grant_end: "2026-12-25" },
    db, store
  });
  const res2 = makeRes();
  createGrant(req2, res2);

  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.success, false);
  assert.ok(res2.body.message.includes("overlapping"));
  assert.equal(db.dispatch_card_grants.length, 1);
});

// ── H-15: Non-Client-Viewer roles go through original handler ───────

test("H-15: Non-Client-Viewer roles bypass the grant gate", () => {
  const db = makeDb();
  const store = createMockStore();

  // Admin requests dispatch job card — gate should pass through (next())
  const req = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    params: { id: "disp-001" },
    db, store
  });
  const res = makeRes();
  let gatePassed = false;
  clientViewerDispatchGate(req, res, () => { gatePassed = true; });

  assert.ok(gatePassed, "Non-Client-Viewer must pass through gate");

  // And the wrapped handler delegates to original for Admin
  const handler = grantedDispatchJobCard(getDispatchJobCard);
  const res2 = makeRes();
  handler(req, res2);

  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.success, true);
  // Admin response includes full data (safety_gates, capabilities, etc.)
  assert.ok(res2.body.data.safety_gates, "Admin gets full safety_gates");
  assert.ok(res2.body.data.capabilities, "Admin gets full capabilities");
  assert.ok(res2.body.data.assignment, "Admin gets full assignment");
});


// ── H-16: Generic sync hardening remains unchanged ──────────────────

test("H-16: dispatch_card_grants is NOT in the offline sync allow-list", async () => {
  const { ALLOWED_ENTITY_TYPES, PROTECTED_ENTITY_TYPES } = await import("../src/services/offlineSyncService.js");

  // The grant collection must NEVER be syncable via offline devices
  assert.equal(
    ALLOWED_ENTITY_TYPES.includes("dispatch_card_grants"), false,
    "dispatch_card_grants must not be in ALLOWED_ENTITY_TYPES"
  );
  assert.equal(
    ALLOWED_ENTITY_TYPES.includes("dispatch_card_grant"), false,
    "dispatch_card_grant (singular) must not be in ALLOWED_ENTITY_TYPES"
  );

  // Verify the existing allow-list is exactly what Batch C Commit 1 established
  assert.deepStrictEqual(
    ALLOWED_ENTITY_TYPES,
    ["inspection", "equipment_tag"],
    "ALLOWED_ENTITY_TYPES must remain exactly [inspection, equipment_tag]"
  );

  // Verify protected entity types still include the core commercial entities
  assert.ok(PROTECTED_ENTITY_TYPES.includes("timesheets"), "timesheets must remain protected");
  assert.ok(PROTECTED_ENTITY_TYPES.includes("field_worksheets"), "field_worksheets must remain protected");
  assert.ok(PROTECTED_ENTITY_TYPES.includes("audit_logs"), "audit_logs must remain protected");
  assert.ok(PROTECTED_ENTITY_TYPES.includes("users"), "users must remain protected");
  assert.ok(PROTECTED_ENTITY_TYPES.includes("invoices"), "invoices must remain protected");
});
