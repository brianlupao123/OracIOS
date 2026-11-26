// backend/tests/acknowledgementHistory.test.js
//
// Batch C Commit 3: Client acknowledgement history, supersession, signer identity,
// dispatch-card grant gate, online-only enforcement, strict schemas, and dispatch freeze.
//
// Verified in both Feature Off and Feature On modes.

import test from "node:test";
import assert from "node:assert/strict";

process.env.ORAC_BATCH_C_ENABLED = "enabled";
process.env.TIMESHEET_BATCH_CONFIRM = "enabled";
process.env.TIMESHEET_CLIENT_RETURN = "enabled";
process.env.TIMESHEET_ELIGIBILITY_CUTOVER = "enabled";

function withBatchCOff(fn) {
  const prev = process.env.ORAC_BATCH_C_ENABLED;
  const prevC = process.env.TIMESHEET_BATCH_C;
  delete process.env.ORAC_BATCH_C_ENABLED;
  delete process.env.TIMESHEET_BATCH_C;
  try {
    fn();
  } finally {
    process.env.ORAC_BATCH_C_ENABLED = prev || "enabled";
    if (prevC) process.env.TIMESHEET_BATCH_C = prevC;
  }
}


import {
  acknowledgeWorksheet,
  returnWorksheetByClient,
  reviseWorksheet,
  listOwnClientTimesheets
} from "../src/controllers/timesheetAcknowledgementController.js";
import { batchConfirmTimesheets } from "../src/controllers/timesheetWorkflowController.js";
import {
  createGrant,
  listGrants,
  revokeGrant
} from "../src/controllers/dispatchCardGrantController.js";
import {
  ClientAcknowledgeWorksheetSchema,
  ClientReturnWorksheetSchema,
  BatchConfirmTimesheetsSchema
} from "../src/schemas.js";
import { evaluateForDb, isEligibleForDb } from "../src/timesheetEligibility.js";
import { ALLOWED_ENTITY_TYPES, PROTECTED_ENTITY_TYPES, PROTECTED_FIELDS } from "../src/services/offlineSyncService.js";
import { computeContentHash, canonicalJson } from "../src/timesheetAcknowledgementHistory.js";
import { swapRevisionIfEligible } from "../src/timesheetWorkflow.js";
import commercialRouter from "../src/modules/commercial/routes.js";

// ── Test Helpers ─────────────────────────────────────────────────────

function dispatchRouter(router, req, res) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    const origJson = res.json.bind(res);
    res.json = (b) => {
      origJson(b);
      finish();
      return res;
    };
    if (res.send) {
      const origSend = res.send.bind(res);
      res.send = (b) => {
        origSend(b);
        finish();
        return res;
      };
    }
    router(req, res, (err) => {
      if (err) res.status(500).json({ success: false, error: err.message });
      finish();
    });
  });
}

function createMockStore(db) {
  let counter = 0;
  return {
    id: (prefix) => `${prefix}_${++counter}`,
    audit: (_db, actor, entityType, entityId, action, before, after) => {
      db.audit_logs.push({
        id: `audit_${++counter}`,
        actor_id: actor?.id || null,
        entity_type: entityType,
        entity_id: entityId,
        action,
        before: before ? JSON.parse(JSON.stringify(before)) : null,
        after: after ? JSON.parse(JSON.stringify(after)) : null,
        created_at: new Date().toISOString()
      });
    }
  };
}

function makeDb() {
  const today = new Date().toISOString().slice(0, 10);
  const futureDate = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

  return {
    users: [
      { id: "u-admin", role: "Admin", name: "Admin System", is_active: true },
      { id: "u-cv-valid", role: "Client Viewer", name: "Farai Ncube", is_active: true, client_id: "c-zimplats" },
      { id: "u-cv-noname", role: "Client Viewer", name: "", is_active: true, client_id: "c-zimplats" },
      { id: "u-cv-other", role: "Client Viewer", name: "Other Rep", is_active: true, client_id: "c-mimosa" },
      { id: "u-cv-inactive", role: "Client Viewer", name: "Inactive Rep", is_active: false, client_id: "c-zimplats" },
      { id: "u-tech", role: "Technician", name: "Tapiwa Moyo", is_active: true },
      { id: "u-ops", role: "Operations", name: "Ops Manager", is_active: true },
      { id: "u-sup", role: "Supervisor", name: "Supervisor Jim", is_active: true }
    ],
    clients: [
      { id: "c-zimplats", name: "Zimplats Holdings", timesheet_cutover_date: null },
      { id: "c-mimosa", name: "Mimosa Mining", timesheet_cutover_date: null }
    ],
    quotes: [
      { id: "q-001", client_id: "c-zimplats", quote_number: "Q-ZIMP-001", status: "Dispatched" },
      { id: "q-002", client_id: "c-mimosa", quote_number: "Q-MIMO-001", status: "Dispatched" }
    ],
    dispatch_cards: [
      { id: "disp-001", quotation_id: "q-001", dispatch_number: "DC-001", status: "Active" },
      { id: "disp-002", quotation_id: "q-001", dispatch_number: "DC-002", status: "Active" },
      { id: "disp-invoiced", quotation_id: "q-001", dispatch_number: "DC-INV", status: "Active" }
    ],
    dispatch_card_grants: [
      {
        id: "dcg-valid",
        user_id: "u-cv-valid",
        client_id: "c-zimplats",
        dispatch_card_id: "disp-001",
        granted_by_id: "u-admin",
        grant_start: today,
        grant_end: futureDate,
        status: "active",
        created_at: new Date().toISOString()
      },
      {
        id: "dcg-expired",
        user_id: "u-cv-valid",
        client_id: "c-zimplats",
        dispatch_card_id: "disp-002",
        granted_by_id: "u-admin",
        grant_start: "2026-01-01",
        grant_end: "2026-01-15",
        status: "active",
        created_at: "2026-01-01T00:00:00Z"
      }
    ],
    field_worksheets: [
      {
        id: "ws-001",
        dispatch_card_id: "disp-001",
        technician_id: "u-tech",
        work_date: today,
        hours: 8,
        status: "Submitted",
        revision_number: 1,
        acknowledgement_history: []
      },
      {
        id: "ws-on-invoiced",
        dispatch_card_id: "disp-invoiced",
        technician_id: "u-tech",
        work_date: today,
        hours: 8,
        status: "Submitted",
        revision_number: 1,
        acknowledgement_history: []
      },
      {
        id: "ws-ack-invoiced",
        dispatch_card_id: "disp-invoiced",
        technician_id: "u-tech",
        work_date: today,
        hours: 8,
        status: "Client_Acknowledged",
        revision_number: 1,
        acknowledgement_history: []
      }
    ],
    invoices: [
      {
        id: "inv-001",
        dispatch_card_id: "disp-invoiced",
        status: "Issued"
      }
    ],
    timesheet_authorities: [
      {
        id: "auth-001",
        user_id: "u-cv-valid",
        client_id: "c-zimplats",
        kind: "authoriser",
        status: "active",
        start_date: "2026-01-01",
        end_date: null,
        evidence_reference: "Board Resolution 2026-A"
      }
    ],
    timesheets: [],
    material_usage: [],
    audit_logs: [],
    equipment_tags: [],
    plant_sections: [],
    plants: [],
    mine_sites: []
  };
}

function makeReq({ user, body = {}, params = {}, query = {}, headers = {}, db }) {
  return {
    user,
    body,
    params,
    query,
    headers,
    db,
    store: createMockStore(db)
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

// ── PART 1: FEATURE OFF MODE (Backward Compatibility) ────────────────

test("C3-F01: Feature OFF: ClientAcknowledgeWorksheetSchema enforces signer_name is required", () => {
  delete process.env.ORAC_BATCH_C_ENABLED;
  delete process.env.TIMESHEET_BATCH_C;

  // Missing signer_name fails in legacy mode
  const parseMissing = ClientAcknowledgeWorksheetSchema.safeParse({
    signer_role: "Site Manager",
    acknowledgement: true
  });
  assert.equal(parseMissing.success, false);

  // Present signer_name succeeds
  const parseValid = ClientAcknowledgeWorksheetSchema.safeParse({
    signer_name: "Any Legacy Name",
    signer_role: "Site Manager",
    acknowledgement: true
  });
  assert.equal(parseValid.success, true);
});

test("C3-F02: Feature OFF: Caller can provide free-text signer_name without identity mismatch", () => {
  delete process.env.ORAC_BATCH_C_ENABLED;
  delete process.env.TIMESHEET_BATCH_C;

  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_name: "Arbitrary Different Name", signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws.client_acknowledgement.signer_name, "Arbitrary Different Name");
});

test("C3-F03: Feature OFF: Acknowledge does NOT write acknowledgement_history", () => {
  delete process.env.ORAC_BATCH_C_ENABLED;
  delete process.env.TIMESHEET_BATCH_C;

  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_name: "Farai Ncube", signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 200);
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws.acknowledgement_history.length, 0);
  // Summary does not expose acknowledgement_history
  assert.equal(res.body.data.acknowledgement_history, undefined);
});

test("C3-F04: Feature OFF: Non-granted Client Viewer can acknowledge in legacy mode", () => {
  delete process.env.ORAC_BATCH_C_ENABLED;
  delete process.env.TIMESHEET_BATCH_C;

  const db = makeDb();
  // Clear all grants
  db.dispatch_card_grants = [];

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_name: "Farai Ncube", signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(db.field_worksheets[0].status, "Client_Acknowledged");
});

test("C3-F05: Router-level regression: Batch confirm preserves legacy contract when Batch C is off", async () => {
  delete process.env.ORAC_BATCH_C_ENABLED;
  delete process.env.TIMESHEET_BATCH_C;

  const db = makeDb();
  // Clear all grants to prove non-granted Client Viewer can batch-confirm in legacy mode
  db.dispatch_card_grants = [];

  const legacyBody = {
    ids: ["ws-001"],
    signer_name: "Arbitrary Legacy Representative",
    acknowledgement: true,
    legacy_extra_field: "allowed_when_batch_c_off"
  };

  const req = {
    method: "POST",
    url: "/field_worksheets/batch-confirm",
    headers: {},
    body: legacyBody,
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const res = makeRes();

  await dispatchRouter(commercialRouter, req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.confirmed, 1);
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws.status, "Client_Acknowledged");
  assert.equal(ws.client_acknowledgement.signer_name, "Arbitrary Legacy Representative");
  // Zero history rows in legacy mode
  assert.equal(ws.acknowledgement_history.length, 0);
});

test("C3-F06: Router-level regression: Feature OFF: Multi-dispatch batch rejected with 400 under legacy contract", async () => {
  delete process.env.ORAC_BATCH_C_ENABLED;
  delete process.env.TIMESHEET_BATCH_C;

  const db = makeDb();
  db.field_worksheets.push({
    id: "ws-legacy-disp2",
    dispatch_card_id: "disp-002",
    technician_id: "u-tech",
    work_date: new Date().toISOString().slice(0, 10),
    hours: 6,
    status: "Submitted",
    revision_number: 1,
    acknowledgement_history: []
  });

  const req = {
    method: "POST",
    url: "/field_worksheets/batch-confirm",
    headers: {},
    body: {
      ids: ["ws-001", "ws-legacy-disp2"],
      signer_name: "Legacy Rep",
      acknowledgement: true
    },
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const res = makeRes();
  await dispatchRouter(commercialRouter, req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "A batch must be for a single dispatch.");
  const ws1 = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws1.status, "Submitted");
  assert.equal(ws1.client_acknowledgement, undefined);
  const ws2 = db.field_worksheets.find((w) => w.id === "ws-legacy-disp2");
  assert.equal(ws2.status, "Submitted");
  assert.equal(ws2.client_acknowledgement, undefined);
});

// ── PART 2: FEATURE ON MODE (Batch C Commit 3 Enforcement) ───────────

test("Setup Batch C Flag for Feature On Suite", () => {
  process.env.ORAC_BATCH_C_ENABLED = "enabled";
  process.env.TIMESHEET_BATCH_CONFIRM = "enabled";
  process.env.TIMESHEET_CLIENT_RETURN = "enabled";
  process.env.TIMESHEET_ELIGIBILITY_CUTOVER = "enabled";
  process.env.TIMESHEET_AUTHORITY = "enabled";
});

test("C3-01: Signer snapshot derived from authenticated Client Viewer account (actor.name)", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws.status, "Client_Acknowledged");
  assert.equal(ws.client_acknowledgement.signer_name, "Farai Ncube");
  assert.equal(ws.client_acknowledgement.acknowledged_by_user_id, "u-cv-valid");
});

test("C3-02: Signer name spoofing prevented: free-text mismatch returns 400 SIGNER_NAME_MISMATCH", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_name: "Impostor Name", signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "SIGNER_NAME_MISMATCH");
  assert.equal(db.field_worksheets[0].status, "Submitted");
});

test("C3-03: Account without name returns 400 ACCOUNT_NAME_REQUIRED", () => {
  const db = makeDb();
  db.dispatch_card_grants.push({
    id: "dcg-noname",
    user_id: "u-cv-noname",
    client_id: "c-zimplats",
    dispatch_card_id: "disp-001",
    granted_by_id: "u-admin",
    grant_start: new Date().toISOString().slice(0, 10),
    grant_end: "2026-12-31",
    status: "active"
  });

  const req = makeReq({
    user: { id: "u-cv-noname", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "ACCOUNT_NAME_REQUIRED");
});

test("C3-04: Client Viewer without active dispatch-card grant returns 403 NO_ACTIVE_GRANT", () => {
  const db = makeDb();
  db.dispatch_card_grants = [];

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "NO_ACTIVE_GRANT");
});

test("C3-05: Client Viewer with expired grant returns 403 NO_ACTIVE_GRANT", () => {
  const db = makeDb();
  db.field_worksheets.push({
    id: "ws-002",
    dispatch_card_id: "disp-002",
    technician_id: "u-tech",
    work_date: "2026-09-10",
    hours: 8,
    status: "Submitted",
    revision_number: 1,
    acknowledgement_history: []
  });

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-002" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "NO_ACTIVE_GRANT");
});

test("C3-06: Client Viewer with revoked grant returns 403 NO_ACTIVE_GRANT", () => {
  const db = makeDb();
  const grant = db.dispatch_card_grants.find((g) => g.id === "dcg-valid");
  grant.status = "revoked";
  grant.revoked_at = new Date().toISOString();

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "NO_ACTIVE_GRANT");
});

test("C3-07: Client Viewer wrong client returns 403", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-other", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

test("C3-08: Append-only history: acknowledge creates kind 'acknowledged' entry with hash", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 200);
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.ok(Array.isArray(ws.acknowledgement_history));
  assert.equal(ws.acknowledgement_history.length, 1);

  const entry = ws.acknowledgement_history[0];
  assert.equal(entry.kind, "acknowledged");
  assert.equal(entry.signer_name, "Farai Ncube");
  assert.equal(entry.signer_role, "Site Manager");
  assert.equal(entry.acknowledged_by_user_id, "u-cv-valid");
  assert.equal(entry.dispatch_card_grant_id, "dcg-valid");
  assert.ok(entry.content_hash, "Must compute SHA-256 content_hash");
  assert.equal(entry.prior_hash, null, "First entry prior_hash must be null");
});

test("C3-09: Append-only history: return creates kind 'returned' entry with return_reason", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { reason: "Incorrect equipment tag logged on shift" },
    db
  });
  const res = makeRes();
  returnWorksheetByClient(req, res);

  assert.equal(res.statusCode, 200);
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws.status, "Returned_For_Correction");
  assert.equal(ws.acknowledgement_history.length, 1);

  const entry = ws.acknowledgement_history[0];
  assert.equal(entry.kind, "returned");
  assert.equal(entry.return_reason, "Incorrect equipment tag logged on shift");
  assert.equal(entry.dispatch_card_grant_id, "dcg-valid");
  assert.ok(entry.content_hash);
});

test("C3-10: Append-only history: return -> resubmit -> re-acknowledge preserves both entries", () => {
  const db = makeDb();
  // 1. Return
  returnWorksheetByClient(makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { reason: "Hours need adjustment" },
    db
  }), makeRes());

  // 2. Resubmit
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  ws.status = "Submitted";

  // 3. Re-acknowledge
  acknowledgeWorksheet(makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  }), makeRes());

  assert.equal(ws.acknowledgement_history.length, 2);
  assert.equal(ws.acknowledgement_history[0].kind, "returned");
  assert.equal(ws.acknowledgement_history[1].kind, "acknowledged");
  assert.equal(ws.acknowledgement_history[1].prior_hash, ws.acknowledgement_history[0].content_hash);
});

test("C3-11: Grant audit: exact active grant recorded; expired grant cannot be used", () => {
  const db = makeDb();
  // ws-002 on disp-002 has only expired grant
  db.field_worksheets.push({
    id: "ws-002",
    dispatch_card_id: "disp-002",
    technician_id: "u-tech",
    work_date: new Date().toISOString().slice(0, 10),
    hours: 8,
    status: "Submitted",
    revision_number: 1,
    acknowledgement_history: []
  });

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-002" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  // Expired grant must be rejected
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "NO_ACTIVE_GRANT");
  const ws = db.field_worksheets.find((w) => w.id === "ws-002");
  assert.equal(ws.acknowledgement_history.length, 0);
});

test("C3-12: History integrity: recursive canonical JSON hashing covers nested authority snapshot", () => {
  const entryA = {
    id: "wsack_1",
    kind: "acknowledged",
    signer_name: "Farai Ncube",
    authority_snapshot: {
      scope: "mine_site",
      authoriser: { name: "Chief Inspector", pin_verified: true },
      effective: "2026-11-26"
    }
  };

  const hashA = computeContentHash(entryA);

  // Tamper with a deep nested property
  const entryB = {
    id: "wsack_1",
    kind: "acknowledged",
    signer_name: "Farai Ncube",
    authority_snapshot: {
      scope: "mine_site",
      authoriser: { name: "Chief Inspector", pin_verified: false }, // tampered!
      effective: "2026-11-26"
    }
  };

  const hashB = computeContentHash(entryB);
  assert.notEqual(hashA, hashB, "Hash must change when deep nested property is tampered with");
});

test("C3-13: History disclosure: Client Viewer response allowlists safe fields only", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 200);
  const historyResponse = res.body.data.acknowledgement_history;
  assert.ok(Array.isArray(historyResponse));
  assert.equal(historyResponse.length, 1);

  const item = historyResponse[0];
  const allowedKeys = new Set([
    "id", "kind", "signer_name", "signer_role", "timestamp",
    "evidence_reference", "return_reason", "supersession_reason",
    "superseded_by", "content_hash", "prior_hash"
  ]);

  for (const key of Object.keys(item)) {
    assert.ok(allowedKeys.has(key), `Field '${key}' must not be disclosed in history summary`);
  }
  // Internal user IDs, internal grant IDs, rates, billing, or payroll must NOT be in the client view
  assert.equal(item.acknowledged_by_user_id, undefined);
  assert.equal(item.dispatch_card_grant_id, undefined);
  assert.equal(item.hourly_rate, undefined);
});

test("C3-14: Deferred supersession: revision path does NOT mark original superseded while revision is pending", () => {
  const db = makeDb();
  // Acknowledge first
  acknowledgeWorksheet(makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  }), makeRes());

  const origBefore = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(origBefore.acknowledgement_history.length, 1);

  // Set cutover date so supersession is deferred (Contract 2.2)
  db.clients[0].timesheet_cutover_date = "2026-01-01";

  // Revise as Admin
  const resRevise = makeRes();
  reviseWorksheet(makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    params: { id: "ws-001" },
    body: { reason: "Corrected overtime hours" },
    db
  }), resRevise);

  assert.equal(resRevise.statusCode, 200);
  const origAfter = db.field_worksheets.find((w) => w.id === "ws-001");
  // Original is NOT superseded yet
  assert.equal(origAfter.superseded_by, undefined);
  assert.ok(origAfter.pending_revision_id);
  // Acknowledgement history on original must NOT have a superseded entry yet
  assert.equal(origAfter.acknowledgement_history.length, 1);
});

test("C3-15: Atomic swap: activating replacement records superseded history on original linking replacement", () => {
  const db = makeDb();
  db.clients[0].timesheet_cutover_date = "2026-01-01";

  // Acknowledge original
  acknowledgeWorksheet(makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  }), makeRes());

  // Revise original
  const resRevise = makeRes();
  reviseWorksheet(makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    params: { id: "ws-001" },
    body: { reason: "Corrected overtime hours" },
    db
  }), resRevise);

  const revisionId = resRevise.body.data.id;
  const revision = db.field_worksheets.find((w) => w.id === revisionId);
  revision.status = "Submitted";

  // Now client acknowledges the replacement revision
  const resAckRev = makeRes();
  acknowledgeWorksheet(makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: revisionId },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  }), resAckRev);

  const orig = db.field_worksheets.find((w) => w.id === "ws-001");
  // Original is now superseded
  assert.equal(orig.superseded_by, revisionId);
  assert.equal(orig.pending_revision_id, undefined);

  // Original now has exactly 2 history entries: [acknowledged, superseded]
  assert.equal(orig.acknowledgement_history.length, 2);
  const supersededEntry = orig.acknowledgement_history[1];
  assert.equal(supersededEntry.kind, "superseded");
  assert.equal(supersededEntry.superseded_by, revisionId);
  assert.equal(supersededEntry.supersession_reason, "Corrected overtime hours");
  assert.equal(supersededEntry.prior_hash, orig.acknowledgement_history[0].content_hash);
});

test("C3-16: Dispatch freeze: acknowledge on invoiced dispatch returns 409 DISPATCH_FROZEN", () => {
  const db = makeDb();
  db.dispatch_card_grants.push({
    id: "dcg-inv",
    user_id: "u-cv-valid",
    client_id: "c-zimplats",
    dispatch_card_id: "disp-invoiced",
    grant_start: new Date().toISOString().slice(0, 10),
    grant_end: "2026-12-31",
    status: "active"
  });

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-on-invoiced" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "DISPATCH_FROZEN");
});

test("C3-17: Dispatch freeze: revise on invoiced dispatch returns 409 DISPATCH_FROZEN", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    params: { id: "ws-ack-invoiced" },
    body: { reason: "Attempting post-invoice revision" },
    db
  });
  const res = makeRes();
  reviseWorksheet(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "DISPATCH_FROZEN");
});

test("C3-18: Strict schema: unexpected fields on acknowledge payload return 400", () => {
  const parsed = ClientAcknowledgeWorksheetSchema.safeParse({
    signer_role: "Site Manager",
    acknowledgement: true,
    unexpected_commercial_data: "100.00 USD"
  });
  assert.equal(parsed.success, false);
});

test("C3-19: Strict schema: unexpected fields on return payload return 400", () => {
  const parsed = ClientReturnWorksheetSchema.safeParse({
    reason: "Valid return reason",
    extra_field: "injected"
  });
  assert.equal(parsed.success, false);
});

test("C3-20: Strict schema: unexpected fields on batch-confirm payload return 400", () => {
  const parsed = BatchConfirmTimesheetsSchema.safeParse({
    ids: ["ws-001"],
    signer_role: "Site Manager",
    acknowledgement: true,
    payroll_override: 500
  });
  assert.equal(parsed.success, false);
});

test("C3-21: Online-only: router schema rejects _offline payload via strict schema", () => {
  const parsed = ClientAcknowledgeWorksheetSchema.safeParse({
    signer_role: "Site Manager",
    acknowledgement: true,
    _offline: true
  });
  assert.equal(parsed.success, false);
});

test("C3-22: Online-only: controller rejects x-offline-replay header with 400 ONLINE_ONLY", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    headers: { "x-offline-replay": "true" },
    db
  });
  const res = makeRes();
  acknowledgeWorksheet(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "ONLINE_ONLY");
});

test("C3-23: Batch confirm: per-id active grant check: ungranted dispatch item returns NO_ACTIVE_GRANT", () => {
  const db = makeDb();
  db.field_worksheets.push({
    id: "ws-002",
    dispatch_card_id: "disp-002",
    technician_id: "u-tech",
    work_date: new Date().toISOString().slice(0, 10),
    hours: 8,
    status: "Submitted",
    revision_number: 1,
    acknowledgement_history: []
  });

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    body: {
      ids: ["ws-002"],
      signer_role: "Site Manager",
      acknowledgement: true
    },
    db
  });
  const res = makeRes();
  batchConfirmTimesheets(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.confirmed, 0);
  assert.equal(res.body.results[0].code, "NO_ACTIVE_GRANT");
});

test("C3-24: Batch confirm: signer name auto-populated from account and mismatch rejected", () => {
  const db = makeDb();
  const reqMismatch = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    body: {
      ids: ["ws-001"],
      signer_name: "Mismatch Name",
      signer_role: "Site Manager",
      acknowledgement: true
    },
    db
  });
  const resMismatch = makeRes();
  batchConfirmTimesheets(reqMismatch, resMismatch);

  assert.equal(resMismatch.statusCode, 400);
  assert.equal(resMismatch.body.code, "SIGNER_NAME_MISMATCH");

  // Auto-populate when omitted
  const reqAuto = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    body: {
      ids: ["ws-001"],
      signer_role: "Site Manager",
      acknowledgement: true
    },
    db
  });
  const resAuto = makeRes();
  batchConfirmTimesheets(reqAuto, resAuto);

  assert.equal(resAuto.statusCode, 200);
  assert.equal(resAuto.body.confirmed, 1);
  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws.client_acknowledgement.signer_name, "Farai Ncube");
  assert.equal(ws.acknowledgement_history[0].dispatch_card_grant_id, "dcg-valid");
});

test("C3-25: listOwnClientTimesheets returns only worksheets for dispatches with active grants", () => {
  const db = makeDb();
  // ws-001 is on disp-001 (active grant)
  // ws-002 is on disp-002 (expired grant)
  db.field_worksheets.push({
    id: "ws-002",
    dispatch_card_id: "disp-002",
    technician_id: "u-tech",
    work_date: new Date().toISOString().slice(0, 10),
    hours: 8,
    status: "Submitted",
    revision_number: 1,
    acknowledgement_history: []
  });

  const req = makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    db
  });
  const res = makeRes();
  listOwnClientTimesheets(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].id, "ws-001");
});

test("C3-26: Non-Client Viewer roles cannot acknowledge (403)", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-tech", role: "Technician", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  assert.throws(() => acknowledgeWorksheet(req, res), { status: 403 });
});

test("C3-27: Inactive user cannot acknowledge (403)", () => {
  const db = makeDb();
  const req = makeReq({
    user: { id: "u-cv-inactive", role: "Client Viewer", is_active: false },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  });
  const res = makeRes();
  assert.throws(() => acknowledgeWorksheet(req, res), { status: 403 });
});

test("C3-28: Generic sync hardening intact: PROTECTED_ENTITY_TYPES and ALLOWED_ENTITY_TYPES", () => {
  assert.ok(ALLOWED_ENTITY_TYPES.includes("inspection"));
  assert.ok(ALLOWED_ENTITY_TYPES.includes("equipment_tag"));
  assert.ok(PROTECTED_ENTITY_TYPES.includes("field_worksheets"));
  assert.ok(PROTECTED_ENTITY_TYPES.includes("timesheets"));
  assert.ok(PROTECTED_FIELDS.has("client_acknowledgement"));
  assert.ok(PROTECTED_FIELDS.has("acknowledgement_history"));
  assert.ok(PROTECTED_FIELDS.has("superseded_by"));
});

test("C3-29: Existing invoice eligibility logic continues to read client_acknowledgement pointer", () => {
  const db = makeDb();
  // Set cutover date so client acknowledgement is required for invoice eligibility
  db.clients[0].timesheet_cutover_date = "2026-01-01";

  const ws = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(isEligibleForDb(db, ws), false);

  acknowledgeWorksheet(makeReq({
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true },
    params: { id: "ws-001" },
    body: { signer_role: "Site Manager", acknowledgement: true },
    db
  }), makeRes());

  assert.equal(isEligibleForDb(db, ws), true);
});

test("C3-30: Commit 2 grant CRUD (create, list, revoke) remains intact", () => {
  const db = makeDb();
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

  // 1. Create grant
  const reqCreate = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    body: {
      user_id: "u-cv-valid",
      dispatch_card_id: "disp-002",
      grant_start: today,
      grant_end: future
    },
    db
  });
  const resCreate = makeRes();
  createGrant(reqCreate, resCreate);
  assert.equal(resCreate.statusCode, 200);
  assert.ok(resCreate.body.data);
  const newGrantId = resCreate.body.data.id;

  // 2. List grants
  const reqList = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    query: { user_id: "u-cv-valid" },
    db
  });
  const resList = makeRes();
  listGrants(reqList, resList);
  assert.equal(resList.statusCode, 200);
  assert.ok(resList.body.data.some((g) => g.id === newGrantId));

  // 3. Revoke grant
  const reqRevoke = makeReq({
    user: { id: "u-admin", role: "Admin", is_active: true },
    params: { id: newGrantId },
    body: { reason: "Site access concluded early" },
    db
  });
  const resRevoke = makeRes();
  revokeGrant(reqRevoke, resRevoke);
  assert.equal(resRevoke.statusCode, 200);
  assert.equal(resRevoke.body.data.status, "revoked");
});

test("C3-31: Router-level regression: Batch confirm verifies client scope BEFORE checking invoice freeze", async () => {
  const db = makeDb();
  // ws-on-invoiced is on disp-invoiced (has active invoice), owned by c-zimplats.
  // u-cv-other belongs to c-mimosa (different client).
  const req = {
    method: "POST",
    url: "/field_worksheets/batch-confirm",
    headers: {},
    body: {
      ids: ["ws-on-invoiced"],
      signer_role: "Site Manager",
      acknowledgement: true
    },
    user: { id: "u-cv-other", role: "Client Viewer", is_active: true, name: "Other Rep", client_id: "c-mimosa" },
    db,
    store: createMockStore(db)
  };
  const res = makeRes();
  await dispatchRouter(commercialRouter, req, res);

  // Must reject on client scope (NOT_FOUND_OR_OUT_OF_SCOPE), NOT leak 409 DISPATCH_FROZEN
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.confirmed, 0);
  assert.equal(res.body.results[0].code, "NOT_FOUND_OR_OUT_OF_SCOPE");
  assert.notEqual(res.statusCode, 409);
  assert.notEqual(res.body.code, "DISPATCH_FROZEN");
});

test("C3-32: Router-level regression: Batch confirm verifies active grant BEFORE checking invoice freeze", async () => {
  const db = makeDb();
  // u-cv-valid belongs to c-zimplats (same client as disp-invoiced), but has NO grant for disp-invoiced.
  const req = {
    method: "POST",
    url: "/field_worksheets/batch-confirm",
    headers: {},
    body: {
      ids: ["ws-on-invoiced"],
      signer_role: "Site Manager",
      acknowledgement: true
    },
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, name: "Farai Ncube", client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const res = makeRes();
  await dispatchRouter(commercialRouter, req, res);

  // Must reject on grant check (NO_ACTIVE_GRANT), NOT leak 409 DISPATCH_FROZEN
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.confirmed, 0);
  assert.equal(res.body.results[0].code, "NO_ACTIVE_GRANT");
  assert.notEqual(res.statusCode, 409);
  assert.notEqual(res.body.code, "DISPATCH_FROZEN");
});

test("C3-33: Router-level regression: Batch confirm checks invoice freeze when client scope AND active grant pass", async () => {
  const db = makeDb();
  // Grant active access on disp-invoiced for u-cv-valid
  db.dispatch_card_grants.push({
    id: "dcg-inv-valid",
    user_id: "u-cv-valid",
    client_id: "c-zimplats",
    dispatch_card_id: "disp-invoiced",
    grant_start: new Date().toISOString().slice(0, 10),
    grant_end: "2026-12-31",
    status: "active"
  });

  const req = {
    method: "POST",
    url: "/field_worksheets/batch-confirm",
    headers: {},
    body: {
      ids: ["ws-on-invoiced"],
      signer_role: "Site Manager",
      acknowledgement: true
    },
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, name: "Farai Ncube", client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const res = makeRes();
  await dispatchRouter(commercialRouter, req, res);

  // Scope and grant passed, so invoice freeze check is reached per-item: DISPATCH_FROZEN
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.results, "Expected per-item results array");
  const item = res.body.results.find((r) => r.id === "ws-on-invoiced");
  assert.ok(item, "Expected result for ws-on-invoiced");
  assert.equal(item.ok, false);
  assert.equal(item.code, "DISPATCH_FROZEN");
  assert.equal(res.body.confirmed, 0);
});

test("C3-34: Router-level regression: Single acknowledge verifies client scope and active grant BEFORE checking invoice freeze", async () => {
  const db = makeDb();

  // Subcase A: Wrong client -> 403, NOT 409 DISPATCH_FROZEN
  const reqWrongClient = {
    method: "POST",
    url: "/field_worksheets/ws-on-invoiced/client-acknowledge",
    headers: {},
    body: { signer_role: "Site Manager", acknowledgement: true },
    user: { id: "u-cv-other", role: "Client Viewer", is_active: true, name: "Other Rep", client_id: "c-mimosa" },
    db,
    store: createMockStore(db)
  };
  const resWrongClient = makeRes();
  await dispatchRouter(commercialRouter, reqWrongClient, resWrongClient);
  assert.equal(resWrongClient.statusCode, 403);
  assert.notEqual(resWrongClient.statusCode, 409);
  assert.notEqual(resWrongClient.body?.code, "DISPATCH_FROZEN");

  // Subcase B: Same client, but NO grant on invoiced dispatch -> 403 NO_ACTIVE_GRANT, NOT 409 DISPATCH_FROZEN
  const reqNoGrant = {
    method: "POST",
    url: "/field_worksheets/ws-on-invoiced/client-acknowledge",
    headers: {},
    body: { signer_role: "Site Manager", acknowledgement: true },
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, name: "Farai Ncube", client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const resNoGrant = makeRes();
  await dispatchRouter(commercialRouter, reqNoGrant, resNoGrant);
  assert.equal(resNoGrant.statusCode, 403);
  assert.equal(resNoGrant.body.code, "NO_ACTIVE_GRANT");
  assert.notEqual(resNoGrant.statusCode, 409);

  // Subcase C: Same client WITH active grant on invoiced dispatch -> reaches freeze check: 409 DISPATCH_FROZEN
  db.dispatch_card_grants.push({
    id: "dcg-inv-valid-single",
    user_id: "u-cv-valid",
    client_id: "c-zimplats",
    dispatch_card_id: "disp-invoiced",
    grant_start: new Date().toISOString().slice(0, 10),
    grant_end: "2026-12-31",
    status: "active"
  });
  const reqWithGrant = {
    method: "POST",
    url: "/field_worksheets/ws-on-invoiced/client-acknowledge",
    headers: {},
    body: { signer_role: "Site Manager", acknowledgement: true },
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, name: "Farai Ncube", client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const resWithGrant = makeRes();
  await dispatchRouter(commercialRouter, reqWithGrant, resWithGrant);
  assert.equal(resWithGrant.statusCode, 409);
  assert.equal(resWithGrant.body.code, "DISPATCH_FROZEN");
});

test("C3-35: Router-level regression: Batch mixing authorised and unauthorised records returns per-item results", async () => {
  const db = makeDb();
  // Add a second worksheet on a different dispatch (disp-002) where the caller
  // has NO active grant (the existing dcg-expired grant ended 2026-01-15).
  db.field_worksheets.push({
    id: "ws-no-grant",
    dispatch_card_id: "disp-002",
    technician_id: "u-tech",
    work_date: new Date().toISOString().slice(0, 10),
    hours: 6,
    status: "Submitted",
    revision_number: 1,
    acknowledgement_history: []
  });

  const req = {
    method: "POST",
    url: "/field_worksheets/batch-confirm",
    headers: {},
    body: {
      ids: ["ws-001", "ws-no-grant"],
      signer_role: "Site Manager",
      acknowledgement: true
    },
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, name: "Farai Ncube", client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const res = makeRes();
  await dispatchRouter(commercialRouter, req, res);

  // Response is 200 with per-item results, NOT a blanket 400/403/409
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.results, "Expected per-item results array");
  assert.equal(res.body.results.length, 2);

  // ws-001 is authorised (active grant on disp-001) → succeeds
  const r1 = res.body.results.find((r) => r.id === "ws-001");
  assert.ok(r1, "Expected result for ws-001");
  assert.equal(r1.ok, true);

  // ws-no-grant has an expired grant on disp-002 → fails with per-item code
  const r2 = res.body.results.find((r) => r.id === "ws-no-grant");
  assert.ok(r2, "Expected result for ws-no-grant");
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "NO_ACTIVE_GRANT");

  // Confirmed count reflects only the authorised item
  assert.equal(res.body.confirmed, 1);
});

test("C3-36: Router-level regression: Batch where authorised items span two dispatches is rejected with 400 before writing confirmations", async () => {
  const db = makeDb();
  // Grant active access on disp-002 as well for u-cv-valid
  db.dispatch_card_grants.push({
    id: "dcg-disp2-active",
    user_id: "u-cv-valid",
    client_id: "c-zimplats",
    dispatch_card_id: "disp-002",
    grant_start: new Date().toISOString().slice(0, 10),
    grant_end: "2026-12-31",
    status: "active"
  });

  db.field_worksheets.push({
    id: "ws-authorised-disp2",
    dispatch_card_id: "disp-002",
    technician_id: "u-tech",
    work_date: new Date().toISOString().slice(0, 10),
    hours: 6,
    status: "Submitted",
    revision_number: 1,
    acknowledgement_history: []
  });

  const req = {
    method: "POST",
    url: "/field_worksheets/batch-confirm",
    headers: {},
    body: {
      ids: ["ws-001", "ws-authorised-disp2"],
      signer_role: "Site Manager",
      acknowledgement: true
    },
    user: { id: "u-cv-valid", role: "Client Viewer", is_active: true, name: "Farai Ncube", client_id: "c-zimplats" },
    db,
    store: createMockStore(db)
  };
  const res = makeRes();
  await dispatchRouter(commercialRouter, req, res);

  // Both items are authorised, but they span two dispatches -> 400 rejection before writing confirmations
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "A batch must be for a single dispatch.");

  // Confirm NO state was modified
  const ws1 = db.field_worksheets.find((w) => w.id === "ws-001");
  assert.equal(ws1.status, "Submitted");
  assert.equal(ws1.client_acknowledgement, undefined);
  assert.equal(ws1.acknowledgement_history.length, 0);

  const ws2 = db.field_worksheets.find((w) => w.id === "ws-authorised-disp2");
  assert.equal(ws2.status, "Submitted");
  assert.equal(ws2.client_acknowledgement, undefined);
  assert.equal(ws2.acknowledgement_history.length, 0);

  assert.equal(db.audit_logs.length, 0);
});
